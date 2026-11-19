import { reactive, watch } from '@arrow-js/core';
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';
import type { ECharts } from 'echarts';
import {
  type CellId,
  type CellViewIdentifier,
  type DuckLakeSnapshotId,
  type ResolvedSql,
  asCellId,
  asCellViewIdentifier,
  asDuckLakeSnapshotId,
  asResolvedSql,
} from '../types/brands.js';
import type {
  ReactiveCellState,
  ReactiveNotebookState,
  ReactiveSourceState,
  ChartType,
  ExecutionMode,
} from '../types/cell-state.js';
import {
  UNBOUNDED_PARTITIONED_RELATIONS,
  PRE_BOUNDED_LIVE_VIEWS,
} from '../types/straphanger-schema.gen.js';
import { LOCAL_STATE_DDL, STARTER_NOTEBOOK, STARTER_CELLS } from './local-state-schema.js';
import { normalizeArrowTable, type NormalizedQueryResult } from '../data/arrow-normalizer.js';
import { executeSqlScript } from '../data/sql-utils.js';
import { expandOssieQueryCalls } from '../data/ossie-loader.js';
import { ensureFastDimensionCaches, prepareExecutableCellSql } from '../data/duckdb-client.js';
import { scheduleDraftAutosave } from './bento-serializer.js';

/**
 * Microtask-safe wrapper around `@arrow-js/core`'s `watch()`.
 *
 * In `@arrow-js/core`, mutating a reactive property pushes `runEffect` onto `queueStack`
 * to run on `queueMicrotask(executeQueue)`. If `stop()` is called synchronously before
 * that microtask drains, `@arrow-js/core` sets internal `rerun = null`, and when the
 * queued `runEffect()` executes, `stopTracking(watchKey, null)` registers `null` as a
 * property listener on every reactive dependency read during `effect()`, causing any
 * subsequent mutation of that reactive property to throw `TypeError: s[o] is not a function`.
 *
 * By gating `effect` and `afterEffect` on `stopped`, any already-queued `runEffect()`
 * returns immediately without reading any reactive properties (`deps` is empty), so `null`
 * is never added to any reactive property's listener list.
 */
export function watchReactive<T>(
  effect: () => T,
  afterEffect?: (value: T) => unknown
): [() => void, () => void] {
  let stopped = false;
  const wrappedEffect = (): T => {
    if (stopped) return undefined as unknown as T;
    return effect();
  };
  const [rawRerun, rawStop] = afterEffect
    ? watch(wrappedEffect, (val: T) => {
        if (stopped) return;
        afterEffect(val);
      })
    : watch(wrappedEffect);
  const rerunFn = typeof rawRerun === 'function' ? (rawRerun as () => void) : () => {};
  const safeStop = () => {
    if (stopped) return;
    stopped = true;
    rawStop();
    queueMicrotask(() => {
      try {
        rawStop();
      } catch {
        // Ignore
      }
    });
  };
  return [
    () => {
      if (!stopped) rerunFn();
    },
    safeStop,
  ];
}

export async function getLocalRelationTypes(conn: AsyncDuckDBConnection): Promise<Map<string, string>> {
  const types = new Map<string, string>();
  try {
    const res = await conn.query(
      `SELECT table_name, table_type FROM information_schema.tables WHERE table_catalog = 'local' AND table_schema = 'main';`
    );
    const norm = normalizeArrowTable(res);
    for (const row of norm.rows) {
      const name = String(row['table_name'] ?? '');
      const type = String(row['table_type'] ?? '').toUpperCase();
      if (name) {
        types.set(name, type);
      }
    }
  } catch {
    // Fallback if information_schema is unavailable in a test mock
  }
  return types;
}

export async function dropLocalRelationIfExists(
  conn: AsyncDuckDBConnection,
  relationName: string,
  knownTypes?: Map<string, string>
): Promise<void> {
  const cleanName = relationName.replace(/^local\.main\./i, '').replace(/^"|"$/g, '');
  const safeIdent = `"${cleanName.replace(/"/g, '""')}"`;
  let relType = knownTypes?.get(cleanName);
  if (!relType && !knownTypes) {
    try {
      const res = await conn.query(
        `SELECT table_type FROM information_schema.tables WHERE table_catalog = 'local' AND table_schema = 'main' AND table_name = '${cleanName.replace(/'/g, "''")}' LIMIT 1;`
      );
      if (res.numRows > 0) {
        const norm = normalizeArrowTable(res);
        relType = String(norm.rows[0]?.['table_type'] ?? '').toUpperCase();
      } else {
        return;
      }
    } catch {
      relType = undefined;
    }
  }
  if (!relType && knownTypes && knownTypes.size > 0) {
    return;
  }
  if (relType === 'VIEW') {
    try {
      await conn.query(`DROP VIEW IF EXISTS local.main.${safeIdent};`);
      knownTypes?.delete(cleanName);
    } catch {
      // Ignore
    }
  } else if (relType) {
    try {
      await conn.query(`DROP TABLE IF EXISTS local.main.${safeIdent};`);
      knownTypes?.delete(cleanName);
    } catch {
      // Ignore
    }
  } else {
    // Fallback when information_schema is mocked/empty: run each in its own try/catch
    try {
      await conn.query(`DROP VIEW IF EXISTS local.main.${safeIdent};`);
    } catch {
      // Ignore
    }
    try {
      await conn.query(`DROP TABLE IF EXISTS local.main.${safeIdent};`);
    } catch {
      // Ignore
    }
  }
}

export interface CellRuntimeArtifacts {
  arrowTable?: Table;
  normalized?: NormalizedQueryResult;
  echartsInstance?: ECharts;
  maplibreInstance?: unknown;
  liveSyncPinned?: boolean;
  justSyncedLiveAt?: number;
  inPlaceLiveRefresh?: boolean;
}

export const CellRuntimeRegistry = new Map<CellId, CellRuntimeArtifacts>();

let hydrationEpoch = 0;

export function bumpHydrationEpoch(): number {
  return ++hydrationEpoch;
}

export function getHydrationEpoch(): number {
  return hydrationEpoch;
}

export const store = reactive<{
  notebook: ReactiveNotebookState;
  cells: ReactiveCellState[];
  sources: ReactiveSourceState[];
}>({
  notebook: {
    docId: STARTER_NOTEBOOK.docId,
    schemaVersion: STARTER_NOTEBOOK.schemaVersion,
    title: STARTER_NOTEBOOK.title,
    mode: STARTER_NOTEBOOK.mode,
    liveIntervalSec: STARTER_NOTEBOOK.liveIntervalSec,
    catalogUrl: STARTER_NOTEBOOK.catalogUrl,
    ossieIndexUrl: STARTER_NOTEBOOK.ossieIndexUrl,
    modifiedAt: STARTER_NOTEBOOK.modifiedAt,
    readOnlyStoryMode: false,
    activeView: 'studio',
    activeCellId: null,
    manhattanTilt: false,
  },
  cells: [],
  sources: [],
});

export function findCellDependencies(sqlText: string): CellId[] {
  const stripped = sqlText
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const matches: CellId[] = [];
  const regex = /\b(?:local\.main\.)?cell_([a-zA-Z0-9_-]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const fullId = `cell_${match[1]}`;
    matches.push(asCellId(fullId));
  }
  return matches;
}

export function markDownstreamCellsStale(updatedCellId: CellId): void {
  for (const cell of store.cells) {
    if (cell.cellId === updatedCellId) continue;
    const deps = findCellDependencies(cell.sqlText);
    if (deps.includes(updatedCellId)) {
      cell.executionState = {
        status: 'stale-upstream',
        upstreamCellId: updatedCellId,
      };
    }
  }
}

export function expandCellSql(
  sqlTemplate: string,
  params: Record<string, string>
): ResolvedSql {
  let expanded = sqlTemplate;
  for (const [key, val] of Object.entries(params)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    expanded = expanded.replace(pattern, val);
  }
  return asResolvedSql(expandOssieQueryCalls(expanded));
}

function hasPartitionPredicate(sql: string): boolean {
  // Strip string literals and comments
  const stripped = sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/`[^`]*`/g, '``');

  // Match WHERE or ON clauses
  // A WHERE/ON clause ends at GROUP BY, ORDER BY, HAVING, WINDOW, LIMIT, FETCH, UNION, INTERSECT, EXCEPT, or closing paren/semicolon/end of string
  const clauseRegex = /\b(?:WHERE|ON)\b([\s\S]*?)(?=\b(?:GROUP\s+BY|ORDER\s+BY|HAVING|WINDOW|LIMIT|FETCH|UNION|INTERSECT|EXCEPT)\b|[);]|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = clauseRegex.exec(stripped)) !== null) {
    const clauseBody = match[1] ?? '';
    if (/\b(?:EVENT_DATE|EVENT_TIME)\b/i.test(clauseBody)) {
      return true;
    }
  }

  return false;
}

export function checkPartitionGuardrail(sql: string): { ok: boolean; warning?: string } {
  const expandedSql = expandOssieQueryCalls(sql);
  const upperSql = expandedSql.toUpperCase();
  for (const partitioned of UNBOUNDED_PARTITIONED_RELATIONS) {
    if (upperSql.includes(partitioned.toUpperCase())) {
      // Check if it is a pre-bounded view which is exempt
      const isExempt = (PRE_BOUNDED_LIVE_VIEWS as readonly string[]).includes(partitioned);
      if (isExempt) continue;

      if (!hasPartitionPredicate(expandedSql)) {
        return {
          ok: false,
          warning: `Query references partitioned table '${partitioned}' without event_date or event_time filter. Consider adding a date filter for optimal performance.`,
        };
      }
    }
  }
  return { ok: true };
}

export const validateQueryGuardrails = checkPartitionGuardrail;

export async function initSystemTables(conn: AsyncDuckDBConnection): Promise<void> {
  await executeSqlScript(conn, LOCAL_STATE_DDL);
}

export async function hydrateStoreFromDuckDb(
  conn: AsyncDuckDBConnection,
  knownLocalRelTypes?: Map<string, string>,
  options?: { isBentoImport?: boolean }
): Promise<void> {
  await initSystemTables(conn);

  // 1. Read notebook
  const nbResult = await conn.query('SELECT * FROM local.main._dbtc_notebook LIMIT 1;');
  if (nbResult.numRows > 0) {
    const norm = normalizeArrowTable(nbResult);
    const row = norm.rows[0];
    if (row) {
      store.notebook.docId = String(row['doc_id'] ?? STARTER_NOTEBOOK.docId);
      store.notebook.schemaVersion = String(row['schema_version'] ?? 'transit_v2');
      const rawTitle = String(row['title'] ?? 'NYC Transit Studio');
      store.notebook.title = rawTitle === 'NYC Subway Transit Studio' ? 'NYC Transit Studio' : rawTitle;
      store.notebook.mode = (String(row['mode'] ?? 'standard')) as ExecutionMode;
      store.notebook.liveIntervalSec = Number(row['live_interval_sec'] ?? 60);
      store.notebook.catalogUrl = String(row['catalog_url'] ?? STARTER_NOTEBOOK.catalogUrl);
      store.notebook.ossieIndexUrl = String(row['ossie_index_url'] ?? '');
      store.notebook.modifiedAt = Number(row['modified_at'] ?? Date.now());
      if (rawTitle === 'NYC Subway Transit Studio') {
        await persistNotebookToDuckDb(conn, store.notebook, false);
      }
    }
  } else {
    // Insert starter notebook
    await persistNotebookToDuckDb(conn, store.notebook, false);
  }

  // 2. Read cells
  const cellsResult = await conn.query('SELECT * FROM local.main._dbtc_cells ORDER BY ordinal ASC;');
  if (cellsResult.numRows > 0) {
    const localRelTypes = knownLocalRelTypes ?? (await getLocalRelationTypes(conn));
    const normCells = normalizeArrowTable(cellsResult);
    const existingById = new Map<CellId, ReactiveCellState>(store.cells.map(c => [c.cellId, c]));

    const hydratedCells: ReactiveCellState[] = normCells.rows.map(r => {
      const cellId = asCellId(String(r['cell_id']));
      let params: Record<string, string> = {};
      try {
        params = JSON.parse(String(r['params_json'] ?? '{}'));
      } catch {
        params = {};
      }

      let chartConfig: Record<string, unknown> = {};
      try {
        chartConfig = JSON.parse(String(r['chart_config_json'] ?? '{}'));
      } catch {
        chartConfig = {};
      }

      let ossieConfig = null;
      if (r['ossie_config_json']) {
        try {
          ossieConfig = JSON.parse(String(r['ossie_config_json']));
        } catch {
          ossieConfig = null;
        }
      }

      const snapId = r['ducklake_snapshot_id'] ? asDuckLakeSnapshotId(String(r['ducklake_snapshot_id'])) : null;
      const existingCell = existingById.get(cellId);
      const preservedExecState =
        existingCell &&
        (existingCell.executionState.status === 'running' || existingCell.executionState.status === 'booting')
          ? existingCell.executionState
          : ({ status: 'idle' } as const);

      const nextData: ReactiveCellState = {
        cellId,
        ordinal: Number(r['ordinal'] ?? 0),
        viewName: asCellViewIdentifier(String(r['view_name'] ?? `local.main.${cellId}`)),
        kind: (String(r['kind'] ?? 'question')) as 'question' | 'markdown',
        title: String(r['title'] ?? ''),
        subtitle: String(r['subtitle'] ?? ''),
        sourceNote: String(r['source_note'] ?? ''),
        markdownText: String(r['markdown_text'] ?? ''),
        sqlText: String(r['sql_text'] ?? ''),
        params,
        ossieConfig,
        chartType: (String(r['chart_type'] ?? 'table')) as ChartType,
        chartConfig,
        ducklakeSnapshotId: snapId,
        executionState: preservedExecState,
        snapshotState: snapId
          ? { status: 'pinned-valid', snapshotId: snapId, snapshotTimestamp: Date.now() }
          : { status: 'unpinned' },
        showSqlEditor: false,
        showOssiePillBar: String(r['kind'] ?? 'question') !== 'markdown',
      };

      if (existingCell) {
        Object.assign(existingCell, nextData);
        return existingCell;
      }
      return nextData;
    });

    const idsMatch =
      hydratedCells.length === store.cells.length &&
      hydratedCells.every((c, i) => store.cells[i]?.cellId === c.cellId);
    if (!idsMatch) {
      store.cells = hydratedCells;
    }

    const shouldRunStarterMigrations =
      store.notebook.docId === STARTER_NOTEBOOK.docId &&
      store.notebook.mode !== 'offline' &&
      !options?.isBentoImport;

    if (shouldRunStarterMigrations) {
    // Migrate legacy starter cell_intro narrative if persisted from an earlier build
    const starterIntro = STARTER_CELLS.find(sc => sc.cellId === 'cell_intro');
    const existingIntro = store.cells.find(c => c.cellId === 'cell_intro');
    if (
      starterIntro &&
      existingIntro &&
      (!existingIntro.markdownText.includes('Part 1: Measuring Rider Wait Times') ||
        !existingIntro.markdownText.includes('story-callout') ||
        !existingIntro.markdownText.includes('mta.info/open-data'))
    ) {
      existingIntro.title = starterIntro.title;
      existingIntro.subtitle = starterIntro.subtitle;
      existingIntro.sourceNote = starterIntro.sourceNote;
      existingIntro.markdownText = starterIntro.markdownText;
      await persistCellToDuckDb(conn, existingIntro, false);
    }

    // Migrate legacy starter cell_headways query if persisted from an earlier build
    const starterHeadways = STARTER_CELLS.find(sc => sc.cellId === 'cell_headways');
    const existingHeadways = store.cells.find(c => c.cellId === 'cell_headways');
    if (
      starterHeadways &&
      existingHeadways &&
      !existingHeadways.sqlText.includes('-- v22-ossie-lens-starter')
    ) {
      existingHeadways.sqlText = starterHeadways.sqlText;
      existingHeadways.subtitle = starterHeadways.subtitle;
      existingHeadways.sourceNote = starterHeadways.sourceNote;
      existingHeadways.ossieConfig = starterHeadways.ossieConfigJson ? JSON.parse(starterHeadways.ossieConfigJson) : null;
      existingHeadways.chartConfig = JSON.parse(starterHeadways.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingHeadways.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_headways', localRelTypes);
      await persistCellToDuckDb(conn, existingHeadways, false);
    }

    // Migrate starter cell_marey if persisted with legacy SQL
    const starterMarey = STARTER_CELLS.find(sc => sc.cellId === 'cell_marey');
    const existingMarey = store.cells.find(c => c.cellId === 'cell_marey');
    if (
      starterMarey &&
      existingMarey &&
      (!existingMarey.sqlText.includes('-- v22-ossie-lens-starter') ||
        existingMarey.sqlText.includes('-- v14-legacy-draft') ||
        existingMarey.sqlText.includes("INTERVAL '5 days'"))
    ) {
      existingMarey.title = starterMarey.title;
      existingMarey.subtitle = starterMarey.subtitle;
      existingMarey.sourceNote = starterMarey.sourceNote;
      existingMarey.sqlText = starterMarey.sqlText;
      existingMarey.ossieConfig = starterMarey.ossieConfigJson ? JSON.parse(starterMarey.ossieConfigJson) : null;
      existingMarey.chartType = starterMarey.chartType;
      existingMarey.chartConfig = JSON.parse(starterMarey.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingMarey.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_marey', localRelTypes);
      await persistCellToDuckDb(conn, existingMarey, false);
    }

    const starterStoryMarey = STARTER_CELLS.find(sc => sc.cellId === 'cell_story_marey');
    const existingStoryMarey = store.cells.find(c => c.cellId === 'cell_story_marey');
    if (
      starterStoryMarey &&
      existingStoryMarey &&
      !existingStoryMarey.markdownText.includes('7:00 AM to 10:00 AM')
    ) {
      existingStoryMarey.markdownText = starterStoryMarey.markdownText;
      await persistCellToDuckDb(conn, existingStoryMarey, false);
    }

    // Migrate Headway Horizon R/M starter cell if persisted with legacy SQL
    const starterHorizonRm = STARTER_CELLS.find(sc => sc.cellId === 'cell_headway_horizon_rm');
    const existingHorizonRm = store.cells.find(c => c.cellId === 'cell_headway_horizon_rm');
    if (
      starterHorizonRm &&
      existingHorizonRm &&
      (!existingHorizonRm.sqlText.includes('-- v22-ossie-lens-starter') ||
        existingHorizonRm.sqlText.includes("INTERVAL '5 days'") ||
        !existingHorizonRm.subtitle.includes('6 to 8 minutes') ||
        !existingHorizonRm.subtitle.includes('wikipedia.org') ||
        existingHorizonRm.sourceNote.includes('wikipedia') ||
        existingHorizonRm.subtitle.includes('spikes above 15 min') ||
        (existingHorizonRm.chartConfig?.['gappingThresholdSec'] === 900) ||
        existingHorizonRm.title.includes('Headway Horizon'))
    ) {
      existingHorizonRm.title = starterHorizonRm.title;
      existingHorizonRm.subtitle = starterHorizonRm.subtitle;
      existingHorizonRm.sourceNote = starterHorizonRm.sourceNote;
      existingHorizonRm.sqlText = starterHorizonRm.sqlText;
      existingHorizonRm.ossieConfig = starterHorizonRm.ossieConfigJson ? JSON.parse(starterHorizonRm.ossieConfigJson) : null;
      existingHorizonRm.chartType = starterHorizonRm.chartType;
      existingHorizonRm.chartConfig = JSON.parse(starterHorizonRm.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingHorizonRm.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_headway_horizon_rm', localRelTypes);
      await persistCellToDuckDb(conn, existingHorizonRm, false);
    }

    // Migrate Cell 4 (Adherence Waterfall) if using legacy schema columns, multi-partition CTE scans, or un-deduplicated service_id schedules
    const starterAdherence = STARTER_CELLS.find(sc => sc.cellId === 'cell_adherence_waterfall_canarsie');
    const existingAdherence = store.cells.find(c => c.cellId === 'cell_adherence_waterfall_canarsie');
    if (
      starterAdherence &&
      existingAdherence &&
      (!existingAdherence.sqlText.includes('-- v22-ossie-lens-starter') ||
        existingAdherence.title.includes('Canarsie') ||
        !existingAdherence.title.includes('Subway Route'))
    ) {
      const customRouteMatch = existingAdherence.sqlText.match(/(?:a\.)?route_id\s*=\s*'([^']+)'/);
      const customRouteId = customRouteMatch?.[1];
      existingAdherence.sqlText = customRouteId
        ? starterAdherence.sqlText.replaceAll("''L''", `''${customRouteId}''`)
        : starterAdherence.sqlText;
      existingAdherence.title = starterAdherence.title;
      existingAdherence.subtitle = starterAdherence.subtitle;
      existingAdherence.sourceNote = starterAdherence.sourceNote;
      existingAdherence.ossieConfig = starterAdherence.ossieConfigJson ? JSON.parse(starterAdherence.ossieConfigJson) : null;
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingAdherence.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_adherence_waterfall_canarsie', localRelTypes);
      await persistCellToDuckDb(conn, existingAdherence, false);
    }

    // Migrate Cell 5 (Multimodal Pulse) if using legacy station IDs, unshifted service_hour, single-hour slice, or missing v14 partition pruning
    const starterPulse = STARTER_CELLS.find(sc => sc.cellId === 'cell_multimodal_pulse_midtown');
    const existingPulse = store.cells.find(c => c.cellId === 'cell_multimodal_pulse_midtown');
    if (
      starterPulse &&
      existingPulse &&
      !existingPulse.sqlText.includes('-- v22-ossie-lens-starter')
    ) {
      existingPulse.sqlText = starterPulse.sqlText;
      existingPulse.title = starterPulse.title;
      existingPulse.subtitle = starterPulse.subtitle;
      existingPulse.sourceNote = starterPulse.sourceNote;
      existingPulse.ossieConfig = starterPulse.ossieConfigJson ? JSON.parse(starterPulse.ossieConfigJson) : null;
      existingPulse.params = JSON.parse(starterPulse.paramsJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingPulse.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_multimodal_pulse_midtown', localRelTypes);
      await persistCellToDuckDb(conn, existingPulse, false);
    }

    // Migrate Cell 6 (OD Ridership Flow)
    const starterOd = STARTER_CELLS.find(sc => sc.cellId === 'cell_od_ridership_flow');
    const existingOd = store.cells.find(c => c.cellId === 'cell_od_ridership_flow');
    if (
      starterOd &&
      existingOd &&
      (!existingOd.sqlText.includes('-- v22-ossie-lens-starter') ||
        !existingOd.subtitle.includes('Other Stations'))
    ) {
      existingOd.sqlText = starterOd.sqlText;
      existingOd.title = starterOd.title;
      existingOd.subtitle = starterOd.subtitle;
      existingOd.sourceNote = starterOd.sourceNote;
      existingOd.ossieConfig = starterOd.ossieConfigJson ? JSON.parse(starterOd.ossieConfigJson) : null;
      existingOd.chartConfig = {
        ...JSON.parse(starterOd.chartConfigJson),
        ...existingOd.chartConfig,
      };
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingOd.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_od_ridership_flow', localRelTypes);
      await persistCellToDuckDb(conn, existingOd, false);
    }

    // Migrate Cell 7 (Route Speed Map)
    const starterRouteSpeed = STARTER_CELLS.find(sc => sc.cellId === 'cell_route_speed_map');
    const existingRouteSpeed = store.cells.find(c => c.cellId === 'cell_route_speed_map');
    if (
      starterRouteSpeed &&
      existingRouteSpeed &&
      (!existingRouteSpeed.sqlText.includes('-- v22-ossie-lens-starter') ||
        existingRouteSpeed.chartType !== 'route-segment-map')
    ) {
      existingRouteSpeed.sqlText = starterRouteSpeed.sqlText;
      existingRouteSpeed.title = starterRouteSpeed.title;
      existingRouteSpeed.subtitle = starterRouteSpeed.subtitle;
      existingRouteSpeed.sourceNote = starterRouteSpeed.sourceNote;
      existingRouteSpeed.ossieConfig = starterRouteSpeed.ossieConfigJson ? JSON.parse(starterRouteSpeed.ossieConfigJson) : null;
      existingRouteSpeed.chartType = starterRouteSpeed.chartType;
      existingRouteSpeed.params = JSON.parse(starterRouteSpeed.paramsJson);
      existingRouteSpeed.chartConfig = JSON.parse(starterRouteSpeed.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingRouteSpeed.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_route_speed_map', localRelTypes);
      await persistCellToDuckDb(conn, existingRouteSpeed, false);
    }

    const starterStoryRouteSpeed = STARTER_CELLS.find(sc => sc.cellId === 'cell_story_route_speed');
    const existingStoryRouteSpeed = store.cells.find(c => c.cellId === 'cell_story_route_speed');
    if (
      starterStoryRouteSpeed &&
      existingStoryRouteSpeed &&
      !existingStoryRouteSpeed.markdownText.includes('Geographic Light')
    ) {
      existingStoryRouteSpeed.markdownText = starterStoryRouteSpeed.markdownText;
      await persistCellToDuckDb(conn, existingStoryRouteSpeed, false);
    }

    // Migrate Cell 8 (Isochrone Map)
    const starterIsochrone = STARTER_CELLS.find(sc => sc.cellId === 'cell_isochrone_map');
    const existingIsochrone = store.cells.find(c => c.cellId === 'cell_isochrone_map');
    if (
      starterIsochrone &&
      existingIsochrone &&
      (!existingIsochrone.sqlText.includes('-- v22-ossie-lens-starter') ||
        !existingIsochrone.sqlText.includes('{{origin_station_id}}') ||
        !existingIsochrone.params?.['origin_station_id'] ||
        !existingIsochrone.subtitle.includes('Calibrated transit arrival tiers') ||
        existingIsochrone.title.includes('Lines 1-7') ||
        existingIsochrone.title.includes('IRT') ||
        existingIsochrone.chartType !== 'isochrone-map')
    ) {
      const preservedOrigin = existingIsochrone.params?.['origin_station_id'];
      existingIsochrone.sqlText = starterIsochrone.sqlText;
      existingIsochrone.title = starterIsochrone.title;
      existingIsochrone.subtitle = starterIsochrone.subtitle;
      existingIsochrone.sourceNote = starterIsochrone.sourceNote;
      existingIsochrone.ossieConfig = starterIsochrone.ossieConfigJson ? JSON.parse(starterIsochrone.ossieConfigJson) : null;
      existingIsochrone.chartType = starterIsochrone.chartType;
      existingIsochrone.params = preservedOrigin
        ? { ...JSON.parse(starterIsochrone.paramsJson), origin_station_id: preservedOrigin }
        : JSON.parse(starterIsochrone.paramsJson);
      if (!existingIsochrone.chartConfig || Object.keys(existingIsochrone.chartConfig).length === 0) {
        existingIsochrone.chartConfig = JSON.parse(starterIsochrone.chartConfigJson);
      }
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingIsochrone.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_isochrone_map', localRelTypes);
      await persistCellToDuckDb(conn, existingIsochrone, false);
    }

    const starterStoryIsochrone = STARTER_CELLS.find(sc => sc.cellId === 'cell_story_isochrone');
    const existingStoryIsochrone = store.cells.find(c => c.cellId === 'cell_story_isochrone');
    if (
      starterStoryIsochrone &&
      existingStoryIsochrone &&
      !existingStoryIsochrone.markdownText.includes('How Travel Time Between Stations Is Computed')
    ) {
      existingStoryIsochrone.markdownText = starterStoryIsochrone.markdownText;
      await persistCellToDuckDb(conn, existingStoryIsochrone, false);
    }

    // Migrate Cell 9 (Train Position Map)
    const starterTrainPos = STARTER_CELLS.find(sc => sc.cellId === 'cell_train_position_map');
    const existingTrainPos = store.cells.find(c => c.cellId === 'cell_train_position_map');
    if (
      starterTrainPos &&
      existingTrainPos &&
      (!existingTrainPos.sqlText.includes('-- v22-ossie-lens-starter') ||
        !existingTrainPos.subtitle.includes('Click LIVE in the player bar') ||
        existingTrainPos.chartType !== 'train-position-map')
    ) {
      existingTrainPos.sqlText = starterTrainPos.sqlText;
      existingTrainPos.title = starterTrainPos.title;
      existingTrainPos.subtitle = starterTrainPos.subtitle;
      existingTrainPos.sourceNote = starterTrainPos.sourceNote;
      existingTrainPos.ossieConfig = starterTrainPos.ossieConfigJson ? JSON.parse(starterTrainPos.ossieConfigJson) : null;
      existingTrainPos.chartType = starterTrainPos.chartType;
      existingTrainPos.params = JSON.parse(starterTrainPos.paramsJson);
      existingTrainPos.chartConfig = JSON.parse(starterTrainPos.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingTrainPos.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_train_position_map', localRelTypes);
      await persistCellToDuckDb(conn, existingTrainPos, false);
    }

    // Migrate Cell 18 & 19 (Regional Commuter Rail & PATH Story + Fleet Map)
    const starterStoryCommuter = STARTER_CELLS.find(sc => sc.cellId === 'cell_story_commuter_rail');
    const existingStoryCommuter = store.cells.find(c => c.cellId === 'cell_story_commuter_rail');
    if (
      starterStoryCommuter &&
      existingStoryCommuter &&
      !existingStoryCommuter.markdownText.includes('PORT_AUTHORITY_PATH')
    ) {
      existingStoryCommuter.title = starterStoryCommuter.title;
      existingStoryCommuter.subtitle = starterStoryCommuter.subtitle;
      existingStoryCommuter.sourceNote = starterStoryCommuter.sourceNote;
      existingStoryCommuter.markdownText = starterStoryCommuter.markdownText;
      await persistCellToDuckDb(conn, existingStoryCommuter, false);
    }

    const starterCommuterMap = STARTER_CELLS.find(sc => sc.cellId === 'cell_commuter_rail_map');
    const existingCommuterMap = store.cells.find(c => c.cellId === 'cell_commuter_rail_map');
    if (
      starterCommuterMap &&
      existingCommuterMap &&
      !existingCommuterMap.sqlText.includes('-- v22-ossie-lens-starter')
    ) {
      existingCommuterMap.sqlText = starterCommuterMap.sqlText;
      existingCommuterMap.title = starterCommuterMap.title;
      existingCommuterMap.subtitle = starterCommuterMap.subtitle;
      existingCommuterMap.sourceNote = starterCommuterMap.sourceNote;
      existingCommuterMap.ossieConfig = starterCommuterMap.ossieConfigJson
        ? JSON.parse(starterCommuterMap.ossieConfigJson)
        : null;
      existingCommuterMap.chartType = starterCommuterMap.chartType;
      existingCommuterMap.params = JSON.parse(starterCommuterMap.paramsJson);
      existingCommuterMap.chartConfig = JSON.parse(starterCommuterMap.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingCommuterMap.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_commuter_rail_map', localRelTypes);
      await persistCellToDuckDb(conn, existingCommuterMap, false);
    }

    const starterStoryBusM60 = STARTER_CELLS.find(sc => sc.cellId === 'cell_story_bus_m60');
    const existingStoryBusM60 = store.cells.find(c => c.cellId === 'cell_story_bus_m60');
    if (
      starterStoryBusM60 &&
      existingStoryBusM60 &&
      !existingStoryBusM60.markdownText.includes('gtfsrt.prod.obanyc.com')
    ) {
      existingStoryBusM60.title = starterStoryBusM60.title;
      existingStoryBusM60.subtitle = starterStoryBusM60.subtitle;
      existingStoryBusM60.sourceNote = starterStoryBusM60.sourceNote;
      existingStoryBusM60.markdownText = starterStoryBusM60.markdownText;
      await persistCellToDuckDb(conn, existingStoryBusM60, false);
    }

    const starterBusM60Map = STARTER_CELLS.find(sc => sc.cellId === 'cell_bus_m60_map');
    const existingBusM60Map = store.cells.find(c => c.cellId === 'cell_bus_m60_map');
    if (
      starterBusM60Map &&
      existingBusM60Map &&
      !existingBusM60Map.sqlText.includes('-- v22-ossie-lens-starter')
    ) {
      existingBusM60Map.sqlText = starterBusM60Map.sqlText;
      existingBusM60Map.title = starterBusM60Map.title;
      existingBusM60Map.subtitle = starterBusM60Map.subtitle;
      existingBusM60Map.sourceNote = starterBusM60Map.sourceNote;
      existingBusM60Map.ossieConfig = starterBusM60Map.ossieConfigJson
        ? JSON.parse(starterBusM60Map.ossieConfigJson)
        : null;
      existingBusM60Map.chartType = starterBusM60Map.chartType;
      existingBusM60Map.params = JSON.parse(starterBusM60Map.paramsJson);
      existingBusM60Map.chartConfig = JSON.parse(starterBusM60Map.chartConfigJson);
      if (store.notebook.mode !== 'offline') {
        CellRuntimeRegistry.delete(existingBusM60Map.cellId);
      }
      await dropLocalRelationIfExists(conn, 'cell_bus_m60_map', localRelTypes);
      await persistCellToDuckDb(conn, existingBusM60Map, false);
    }

    // Migrate Basic BI starter cells (Cells 19, 21, 23) to v14/v15 partition-pruned turnstile & fleet queries
    for (const basicCellId of ['cell_basic_bar_turnstiles', 'cell_basic_line_hourly', 'cell_basic_donut_fleet'] as const) {
      const starterBasic = STARTER_CELLS.find(sc => sc.cellId === basicCellId);
      const existingBasic = store.cells.find(c => c.cellId === basicCellId);
      if (
        starterBasic &&
        existingBasic &&
        !existingBasic.sqlText.includes('-- v22-ossie-lens-starter')
      ) {
        existingBasic.sqlText = starterBasic.sqlText;
        existingBasic.title = starterBasic.title;
        existingBasic.subtitle = starterBasic.subtitle;
        existingBasic.sourceNote = starterBasic.sourceNote;
        existingBasic.ossieConfig = starterBasic.ossieConfigJson ? JSON.parse(starterBasic.ossieConfigJson) : null;
        if (store.notebook.mode !== 'offline') {
          CellRuntimeRegistry.delete(existingBasic.cellId);
        }
        await dropLocalRelationIfExists(conn, basicCellId, localRelTypes);
        await persistCellToDuckDb(conn, existingBasic, false);
      }
    }

    // In standard or live mode, question cells must be dynamic views backed by their SQL query,
    // never stale materialized BASE TABLE snapshots left over from an earlier offline import/draft.
    if (store.notebook.mode !== 'offline') {
      for (const cell of store.cells) {
        if (cell.kind === 'question' && localRelTypes.get(cell.cellId) === 'BASE TABLE') {
          await dropLocalRelationIfExists(conn, cell.cellId, localRelTypes);
        }
      }
    }

    // Ensure all starter cells from STARTER_CELLS exist and are interleaved in canonical starter order
    let needsStarterCellsPersist = false;
    for (const sc of STARTER_CELLS) {
      const existingCell = store.cells.find(c => c.cellId === sc.cellId);
      const parsedOssie = sc.ossieConfigJson ? JSON.parse(sc.ossieConfigJson) : null;
      if (!existingCell) {
        const newCell = {
          cellId: asCellId(sc.cellId),
          ordinal: sc.ordinal,
          viewName: asCellViewIdentifier(sc.viewName),
          kind: sc.kind,
          title: sc.title,
          subtitle: sc.subtitle,
          sourceNote: sc.sourceNote,
          markdownText: sc.markdownText,
          sqlText: sc.sqlText,
          params: JSON.parse(sc.paramsJson),
          ossieConfig: parsedOssie,
          chartType: sc.chartType,
          chartConfig: JSON.parse(sc.chartConfigJson),
          ducklakeSnapshotId: null,
          executionState: { status: 'idle' as const },
          snapshotState: { status: 'unpinned' as const },
          showSqlEditor: false,
          showOssiePillBar: sc.kind !== 'markdown',
        };
        store.cells.push(newCell);
        needsStarterCellsPersist = true;
      } else {
        if (existingCell.sourceNote !== 'Source: StraphangerDB') {
          existingCell.sourceNote = 'Source: StraphangerDB';
          needsStarterCellsPersist = true;
        }
        if (!existingCell.ossieConfig && parsedOssie) {
          existingCell.ossieConfig = parsedOssie;
          needsStarterCellsPersist = true;
        }
      }
    }

    const starterIdSet = new Set<string>(STARTER_CELLS.map(sc => sc.cellId));
    const orderedStarters = STARTER_CELLS.map(sc => store.cells.find(c => c.cellId === sc.cellId)).filter(
      (c): c is ReactiveCellState => c !== undefined
    );
    const customCells = store.cells.filter(c => !starterIdSet.has(c.cellId));
    const targetCellsOrder = [...orderedStarters, ...customCells];

    const orderChanged =
      targetCellsOrder.length !== store.cells.length ||
      targetCellsOrder.some((c, idx) => store.cells[idx]?.cellId !== c.cellId || c.ordinal !== idx);

    if (orderChanged) {
      store.cells = targetCellsOrder;
      needsStarterCellsPersist = true;
    }

    if (needsStarterCellsPersist) {
      for (let i = 0; i < store.cells.length; i++) {
        store.cells[i]!.ordinal = i;
      }
      await persistCellsBatchToDuckDb(conn, store.cells, false);
    }
    } // end shouldRunStarterMigrations
  } else {
    // Populate starter cells if not already pre-seeded in memory
    if (store.cells.length === 0) {
      seedStarterCellsInStore('idle');
    }
    await persistCellsBatchToDuckDb(conn, store.cells, false);
  }

  // 3. Read sources
  const sourcesResult = await conn.query('SELECT * FROM local.main._dbtc_sources ORDER BY created_at ASC;');
  if (sourcesResult.numRows > 0) {
    const normSources = normalizeArrowTable(sourcesResult);
    store.sources = normSources.rows.map(r => ({
      sourceName: String(r['source_name']),
      kind: String(r['kind']) as 'local_upload' | 'remote_csv_url' | 'remote_parquet_url',
      urlOrFilename: String(r['url_or_filename']),
      byteSize: Number(r['byte_size'] ?? 0),
      includeInOfflineExport: Boolean(r['include_in_offline_export']),
      createdAt: Number(r['created_at'] ?? Date.now()),
    }));
  } else {
    store.sources = [];
  }

  if (store.cells.length > 0 && !store.notebook.activeCellId) {
    store.notebook.activeCellId = store.cells.find(c => c.kind === 'question')?.cellId ?? store.cells[0]?.cellId ?? null;
  }

  await verifyCellSnapshots(conn);
}

export function seedStarterCellsInStore(initialQuestionStatus: 'idle' | 'booting' | 'running' = 'idle'): void {
  store.cells = STARTER_CELLS.map(sc => {
    const cellId = asCellId(sc.cellId);
    const executionState =
      sc.kind === 'question' && initialQuestionStatus === 'running'
        ? { status: 'running' as const, startTime: Date.now() }
        : sc.kind === 'question' && initialQuestionStatus === 'booting'
          ? { status: 'booting' as const, startTime: Date.now() }
          : { status: 'idle' as const };
    return {
      cellId,
      ordinal: sc.ordinal,
      viewName: asCellViewIdentifier(sc.viewName),
      kind: sc.kind,
      title: sc.title,
      subtitle: sc.subtitle,
      sourceNote: sc.sourceNote,
      markdownText: sc.markdownText,
      sqlText: sc.sqlText,
      params: JSON.parse(sc.paramsJson),
      ossieConfig: sc.ossieConfigJson ? JSON.parse(sc.ossieConfigJson) : null,
      chartType: sc.chartType,
      chartConfig: JSON.parse(sc.chartConfigJson),
      ducklakeSnapshotId: null,
      executionState,
      snapshotState: { status: 'unpinned' as const },
      showSqlEditor: false,
      showOssiePillBar: sc.kind !== 'markdown',
    };
  });
  if (store.cells.length > 0 && !store.notebook.activeCellId) {
    store.notebook.activeCellId = store.cells.find(c => c.kind === 'question')?.cellId ?? store.cells[0]?.cellId ?? null;
  }
}

export async function verifyCellSnapshots(_conn: AsyncDuckDBConnection): Promise<void> {
  // Never execute prod.snapshots() against the remote R2 DuckLake catalog as it triggers
  // a C++ assertion failure ("Invalid bitpacking mode") that invalidates the DuckDB instance.
  const now = Date.now();
  for (const cell of store.cells) {
    if (cell.ducklakeSnapshotId) {
      cell.snapshotState = {
        status: 'pinned-valid',
        snapshotId: cell.ducklakeSnapshotId,
        snapshotTimestamp: now,
      };
    }
  }
}

export async function persistNotebookToDuckDb(
  conn: AsyncDuckDBConnection,
  nb: ReactiveNotebookState,
  triggerAutosave = true
): Promise<void> {
  const sql = `
    INSERT OR REPLACE INTO local.main._dbtc_notebook (
      doc_id, schema_version, title, mode, live_interval_sec, catalog_url, ossie_index_url, modified_at
    ) VALUES (
      '${nb.docId.replace(/'/g, "''")}',
      '${nb.schemaVersion.replace(/'/g, "''")}',
      '${nb.title.replace(/'/g, "''")}',
      '${nb.mode}',
      ${nb.liveIntervalSec},
      '${nb.catalogUrl.replace(/'/g, "''")}',
      '${nb.ossieIndexUrl.replace(/'/g, "''")}',
      ${Date.now()}
    );
  `;
  await conn.query(sql);
  if (triggerAutosave) {
    scheduleDraftAutosave();
  }
}

function buildCellValuesTuple(cell: ReactiveCellState, nowIso: string): string {
  const paramsJson = JSON.stringify(cell.params).replace(/'/g, "''");
  const chartConfigJson = JSON.stringify(cell.chartConfig).replace(/'/g, "''");
  const ossieJson = cell.ossieConfig ? `'${JSON.stringify(cell.ossieConfig).replace(/'/g, "''")}'` : 'NULL';
  const snapshotStr = cell.ducklakeSnapshotId ? `'${cell.ducklakeSnapshotId}'` : 'NULL';
  return `(
    '${cell.cellId}',
    ${cell.ordinal},
    '${cell.viewName}',
    '${cell.kind}',
    '${cell.title.replace(/'/g, "''")}',
    '${cell.subtitle.replace(/'/g, "''")}',
    '${cell.sourceNote.replace(/'/g, "''")}',
    '${cell.markdownText.replace(/'/g, "''")}',
    '${cell.sqlText.replace(/'/g, "''")}',
    '${paramsJson}',
    ${ossieJson},
    '${cell.chartType}',
    '${chartConfigJson}',
    '${nowIso}',
    ${snapshotStr}
  )`;
}

export async function persistCellsBatchToDuckDb(
  conn: AsyncDuckDBConnection,
  cells: readonly ReactiveCellState[],
  triggerAutosave = true
): Promise<void> {
  if (cells.length === 0) return;
  const nowIso = new Date().toISOString();
  const tuples = cells.map(c => buildCellValuesTuple(c, nowIso)).join(',\n');
  const sql = `
    INSERT OR REPLACE INTO local.main._dbtc_cells (
      cell_id, ordinal, view_name, kind, title, subtitle, source_note,
      markdown_text, sql_text, params_json, ossie_config_json,
      chart_type, chart_config_json, generated_at, ducklake_snapshot_id
    ) VALUES ${tuples};
  `;
  await conn.query(sql);
  if (triggerAutosave) {
    scheduleDraftAutosave();
  }
}

export async function persistCellToDuckDb(
  conn: AsyncDuckDBConnection,
  cell: ReactiveCellState,
  triggerAutosave = true
): Promise<void> {
  const nowIso = new Date().toISOString();
  const sql = `
    INSERT OR REPLACE INTO local.main._dbtc_cells (
      cell_id, ordinal, view_name, kind, title, subtitle, source_note,
      markdown_text, sql_text, params_json, ossie_config_json,
      chart_type, chart_config_json, generated_at, ducklake_snapshot_id
    ) VALUES ${buildCellValuesTuple(cell, nowIso)};
  `;
  await conn.query(sql);
  if (triggerAutosave) {
    scheduleDraftAutosave();
  }
}

export async function deleteCellFromDuckDb(
  conn: AsyncDuckDBConnection,
  cellId: CellId
): Promise<void> {
  await conn.query(`DELETE FROM local.main._dbtc_cells WHERE cell_id = '${cellId}';`);
  await dropLocalRelationIfExists(conn, cellId);
  scheduleDraftAutosave();
}

export async function persistSourceToDuckDb(
  conn: AsyncDuckDBConnection,
  source: ReactiveSourceState
): Promise<void> {
  const sql = `
    INSERT OR REPLACE INTO local.main._dbtc_sources (
      source_name, kind, url_or_filename, byte_size, include_in_offline_export, created_at
    ) VALUES (
      '${source.sourceName.replace(/'/g, "''")}',
      '${source.kind}',
      '${source.urlOrFilename.replace(/'/g, "''")}',
      ${source.byteSize},
      ${source.includeInOfflineExport ? 'TRUE' : 'FALSE'},
      ${source.createdAt}
    );
  `;
  await conn.query(sql);
  scheduleDraftAutosave();
}

export async function deleteSourceFromDuckDb(
  conn: AsyncDuckDBConnection,
  sourceName: string
): Promise<void> {
  await conn.query(`DELETE FROM local.main._dbtc_sources WHERE source_name = '${sourceName.replace(/'/g, "''")}';`);
  await dropLocalRelationIfExists(conn, sourceName);
  scheduleDraftAutosave();
}

const cellExecutionSeq = new Map<CellId, number>();

export function cancelCellQuery(
  conn: AsyncDuckDBConnection | null | undefined,
  cellId: CellId
): void {
  const nextSeq = (cellExecutionSeq.get(cellId) ?? 0) + 1;
  cellExecutionSeq.set(cellId, nextSeq);
  const cell = store.cells.find(c => c.cellId === cellId);
  if (cell) {
    cell.executionState = {
      status: 'error',
      error: 'Query execution cancelled by user.',
      failedAt: Date.now(),
    };
  }
  try {
    const maybeCancel = (conn as unknown as { cancelSent?: () => unknown })?.cancelSent;
    if (typeof maybeCancel === 'function') {
      void Promise.resolve(maybeCancel.call(conn)).catch(() => {});
    }
  } catch {
    // Ignore if driver does not support cancelSent
  }
}

export async function executeCellQuery(
  conn: AsyncDuckDBConnection,
  cellId: CellId,
  triggerAutosave = true,
  options?: { inPlaceRefresh?: boolean }
): Promise<void> {
  const cell = store.cells.find(c => c.cellId === cellId);
  if (!cell || cell.kind !== 'question') return;

  const seq = (cellExecutionSeq.get(cellId) ?? 0) + 1;
  cellExecutionSeq.set(cellId, seq);

  const resolvedSql = expandCellSql(cell.sqlText, cell.params);
  const startTime = Date.now();
  if (options?.inPlaceRefresh) {
    const existing = CellRuntimeRegistry.get(cellId) ?? {};
    CellRuntimeRegistry.set(cellId, {
      ...existing,
      inPlaceLiveRefresh: true,
    });
  } else {
    cell.executionState = { status: 'running', startTime };
  }

  try {
    await ensureFastDimensionCaches(conn);
    if (cellExecutionSeq.get(cellId) !== seq) return;
    const cleanSql = prepareExecutableCellSql(resolvedSql);

    // Only materialize a DuckDB VIEW in local.main if another cell explicitly depends on this cellId.
    // Avoiding unconditional CREATE OR REPLACE VIEW prevents DuckDB from binding remote DuckLake
    // queries twice (once during CREATE VIEW and once during SELECT) and avoids information_schema scans.
    const hasDependents = store.cells.some(
      c => c.cellId !== cellId && c.kind === 'question' && findCellDependencies(c.sqlText).includes(cellId)
    );
    const safeCellIdent = `"${cellId.replace(/"/g, '""')}"`;
    if (hasDependents) {
      try {
        await conn.query(`DROP TABLE IF EXISTS local.main.${safeCellIdent};`);
      } catch {
        // Ignore if existing object is already a view
      }
      const viewSql = `CREATE OR REPLACE VIEW local.main.${safeCellIdent} AS ${cleanSql};`;
      await conn.query(viewSql);
      if (cellExecutionSeq.get(cellId) !== seq) return;
    }

    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const rowCap = isMobile ? 15000 : 50000;
    const querySql = hasDependents
      ? `SELECT * FROM local.main.${safeCellIdent} LIMIT ${rowCap};`
      : `SELECT * FROM (\n${cleanSql}\n) AS _cell_q LIMIT ${rowCap};`;
    const arrowResult = await conn.query(querySql);
    if (cellExecutionSeq.get(cellId) !== seq) return;

    const normalized = normalizeArrowTable(arrowResult);

    const existing = CellRuntimeRegistry.get(cellId) ?? {};
    CellRuntimeRegistry.set(cellId, {
      ...existing,
      arrowTable: arrowResult,
      normalized,
    });

    const executionMs = Date.now() - startTime;
    cell.executionState = {
      status: 'success',
      executionMs,
      rowCount: normalized.totalRowCount,
      executedAt: Date.now(),
      executedMode: store.notebook.mode,
    };

    markDownstreamCellsStale(cellId);
    if (triggerAutosave) {
      scheduleDraftAutosave();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dbtc:cell-executed', { detail: { cellId } }));
    }
  } catch (err) {
    if (cellExecutionSeq.get(cellId) !== seq) return;
    const message = err instanceof Error ? err.message : String(err);
    cell.executionState = {
      status: 'error',
      error: message,
      failedAt: Date.now(),
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dbtc:cell-executed', { detail: { cellId, error: message } }));
    }
  }
}

export async function hydrateCellRuntime(
  conn: AsyncDuckDBConnection,
  cellId: CellId
): Promise<void> {
  const cell = store.cells.find(c => c.cellId === cellId);
  if (!cell || cell.kind !== 'question') return;

  // If restoreDatabaseFromBuffer already populated CellRuntimeRegistry from a saved .dbtc.html
  // snapshot, mark the cell as succeeded immediately without re-querying remote catalog.db.
  const prehydrated = CellRuntimeRegistry.get(cellId)?.normalized;
  if (prehydrated && prehydrated.columns.length > 0 && prehydrated.rows.length > 0) {
    if (cell.executionState.status !== 'success') {
      cell.executionState = {
        status: 'success',
        executionMs: 1,
        rowCount: prehydrated.totalRowCount,
        executedAt: Date.now(),
        executedMode: store.notebook.mode,
      };
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dbtc:cell-executed', { detail: { cellId } }));
    }
    return;
  }

  // In standard or live mode, execute the cell query directly without scanning information_schema
  if (store.notebook.mode !== 'offline') {
    await executeCellQuery(conn, cellId, false);
    return;
  }

  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const rowCap = isMobile ? 15000 : 50000;

  try {
    const startTime = Date.now();
    cell.executionState = { status: 'running', startTime };
    const querySql = `SELECT * FROM local.main.${cellId} LIMIT ${rowCap};`;
    const arrowResult = await conn.query(querySql);
    const normalized = normalizeArrowTable(arrowResult);
    const existing = CellRuntimeRegistry.get(cellId) ?? {};
    CellRuntimeRegistry.set(cellId, {
      ...existing,
      arrowTable: arrowResult,
      normalized,
    });
    cell.executionState = {
      status: 'success',
      executionMs: Date.now() - startTime,
      rowCount: normalized.totalRowCount,
      executedAt: Date.now(),
      executedMode: store.notebook.mode,
    };
  } catch (err) {
    console.warn(`Failed hydrating offline relation for ${cellId}:`, err);
    if (prehydrated) {
      cell.executionState = {
        status: 'success',
        executionMs: 1,
        rowCount: prehydrated.totalRowCount,
        executedAt: Date.now(),
        executedMode: store.notebook.mode,
      };
    } else {
      cell.executionState = { status: 'idle' };
    }
  }
}




