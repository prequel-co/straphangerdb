import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { normalizeArrowTable } from '../data/arrow-normalizer.js';
import {
  type CellId,
  asCellId,
  asCellViewIdentifier,
  asDuckLakeSnapshotId,
} from '../types/brands.js';
import type {
  ChartType,
  ExecutionMode,
  ReactiveCellState,
} from '../types/cell-state.js';
import { STARTER_NOTEBOOK } from './local-state-schema.js';
import {
  store,
  CellRuntimeRegistry,
  bumpHydrationEpoch,
  initSystemTables,
  hydrateStoreFromDuckDb,
  hydrateCellRuntime,
  persistNotebookToDuckDb,
  persistCellsBatchToDuckDb,
  getLocalRelationTypes,
  dropLocalRelationIfExists,
} from './store.js';

interface LocalTableSnapshot {
  readonly tableName: string;
  readonly columns: ReadonlyArray<{ readonly name: string; readonly dataType: string }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

interface LocalDbSnapshot {
  readonly format: 'dbtc/local-snapshot-v1';
  readonly tables: ReadonlyArray<LocalTableSnapshot>;
}

export function normalizeDuckDbSqlType(rawType?: string): string {
  if (!rawType) return 'VARCHAR';
  const trimmed = rawType.trim();
  const upper = trimmed.toUpperCase();
  if (upper.includes('TIMESTAMP')) {
    if (upper.includes('TZ') || upper.includes('TIME ZONE') || trimmed.includes(',')) {
      return 'TIMESTAMPTZ';
    }
    return 'TIMESTAMP';
  }
  if (upper.startsWith('DATE')) {
    return 'DATE';
  }
  if (upper.startsWith('BOOL')) {
    return 'BOOLEAN';
  }
  if (
    upper.startsWith('FLOAT') ||
    upper.startsWith('DOUBLE') ||
    upper.startsWith('DECIMAL') ||
    upper.startsWith('REAL')
  ) {
    return 'DOUBLE';
  }
  if (upper.startsWith('INT64') || upper.startsWith('UINT64') || upper === 'BIGINT') {
    return 'BIGINT';
  }
  if (
    upper.startsWith('INT') ||
    upper.startsWith('UINT') ||
    upper === 'SMALLINT' ||
    upper === 'TINYINT'
  ) {
    return 'INTEGER';
  }
  if (
    upper.includes('UTF8') ||
    upper.includes('CHAR') ||
    upper.includes('TEXT') ||
    upper.includes('STRING')
  ) {
    return 'VARCHAR';
  }
  if (/^[A-Z0-9_]+(\(\d+(,\s*\d+)?\))?$/i.test(trimmed)) {
    return upper;
  }
  return 'VARCHAR';
}

function formatSqlLiteral(val: unknown, dataType?: string): string {
  if (val === null || val === undefined) {
    return 'NULL';
  }
  const sqlType = normalizeDuckDbSqlType(dataType);
  if (sqlType === 'DATE' || sqlType === 'TIMESTAMP' || sqlType === 'TIMESTAMPTZ') {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return `CAST('${new Date(val).toISOString()}' AS ${sqlType})`;
    }
    if (typeof val === 'string') {
      return `CAST('${val.replace(/'/g, "''")}' AS ${sqlType})`;
    }
  }
  if (typeof val === 'boolean') {
    return val ? 'TRUE' : 'FALSE';
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (typeof val === 'string') {
    return `'${val.replace(/'/g, "''")}'`;
  }
  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
}

function isValidDuckDbFileBuffer(bytes: Uint8Array): boolean {
  // DuckDB database files are at least 12KB and contain magic "DUCK" at byte offset 8
  return (
    bytes.length >= 4096 &&
    bytes[8] === 0x44 &&
    bytes[9] === 0x55 &&
    bytes[10] === 0x43 &&
    bytes[11] === 0x4b
  );
}

export interface BentoDocPayload {
  readonly format: 'bento/dbtc';
  readonly version: 1;
  readonly embeddedDuckDbBase64: string;
  readonly exportedAt: string;
  readonly mode: 'standard' | 'offline' | 'live';
}

export async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressedBlob = await new Response(stream).blob();
    const arrayBuffer = await compressedBlob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  return data;
}

export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressedBlob = await new Response(stream).blob();
    const arrayBuffer = await decompressedBlob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
  return data;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  const CHUNK_SIZE = 32768;
  const chunks: string[] = [];
  const len = bytes.length;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function escapeScriptJson(jsonString: string): string {
  return jsonString.replace(/</g, '\\u003c');
}

export async function exportLocalDbBuffer(
  _db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  mode: 'standard' | 'offline' | 'live',
  options?: { includeCellResults?: boolean }
): Promise<Uint8Array> {
  // Save current store state into DuckDB in batch without re-triggering autosave,
  // pruning any cells that were deleted from store.cells.
  await persistNotebookToDuckDb(conn, store.notebook, false);
  await conn.query('DELETE FROM local.main._dbtc_cells;');
  await persistCellsBatchToDuckDb(conn, store.cells, false);

  const includeCellResults = mode === 'offline' || Boolean(options?.includeCellResults);
  const customSourceNames = new Set(store.sources.map(s => s.sourceName));
  const excludedTables = new Set<string>(
    ['dim_service_lines', 'dim_routes', 'dim_stations', 'dim_micromobility_stations'].filter(t => !customSourceNames.has(t))
  );
  if (mode === 'offline') {
    for (const source of store.sources) {
      if (source.kind === 'local_upload' && !source.includeInOfflineExport) {
        excludedTables.add(source.sourceName);
      }
    }
  } else {
    // In non-offline draft autosaves, do not dump large remote CSV cache tables or materialized cell tables into IndexedDB
    for (const source of store.sources) {
      if (source.kind !== 'local_upload') {
        excludedTables.add(source.sourceName);
      }
    }
    for (const cell of store.cells) {
      if (!customSourceNames.has(cell.cellId)) {
        excludedTables.add(cell.cellId);
      }
    }
  }

  const tables: LocalTableSnapshot[] = [];

  try {
    const tablesRes = await conn.query(
      `SELECT table_name FROM information_schema.tables WHERE table_catalog = 'local' AND table_schema = 'main' AND table_type = 'BASE TABLE';`
    );
    const normTables = normalizeArrowTable(tablesRes);
    const baseTableNames = normTables.rows.map(r => String(r['table_name']));

    for (const tbl of baseTableNames) {
      if (excludedTables.has(tbl)) continue;
      try {
        const dataRes = await conn.query(`SELECT * FROM local.main."${tbl.replace(/"/g, '""')}";`);
        const normData = normalizeArrowTable(dataRes);
        if (normData.columns.length === 0) continue;

        tables.push({
          tableName: tbl,
          columns: normData.columns.map(c => ({
            name: c.name,
            dataType: normalizeDuckDbSqlType(c.type),
          })),
          rows: normData.rows,
        });
      } catch {
        // Proceed if an individual table cannot be read
      }
    }

    if (includeCellResults) {
      const existingNames = new Set(tables.map(t => t.tableName));
      for (const cell of store.cells) {
        if (cell.kind === 'question' && !existingNames.has(cell.cellId)) {
          const cachedRuntime = CellRuntimeRegistry.get(cell.cellId)?.normalized;
          if (cachedRuntime && cachedRuntime.columns.length > 0) {
            tables.push({
              tableName: cell.cellId,
              columns: cachedRuntime.columns.map(c => ({
                name: c.name,
                dataType: normalizeDuckDbSqlType(c.type),
              })),
              rows: cachedRuntime.rows,
            });
            continue;
          }
          if (mode === 'offline') {
            try {
              const dataRes = await conn.query(`SELECT * FROM local.main."${cell.cellId.replace(/"/g, '""')}";`);
              const normData = normalizeArrowTable(dataRes);
              if (normData.columns.length > 0) {
                tables.push({
                  tableName: cell.cellId,
                  columns: normData.columns.map(c => ({
                    name: c.name,
                    dataType: normalizeDuckDbSqlType(c.type),
                  })),
                  rows: normData.rows,
                });
              }
            } catch {
              // If view didn't exist or had errors, proceed
            }
          }
        }
      }
    }
  } catch {
    // Proceed with empty tables list if schema query fails
  }

  const snapshot: LocalDbSnapshot = {
    format: 'dbtc/local-snapshot-v1',
    tables,
  };

  return new TextEncoder().encode(JSON.stringify(snapshot));
}

export async function exportBentoDocument(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  mode: 'standard' | 'offline' | 'live'
): Promise<string> {
  const dbBytes = await exportLocalDbBuffer(db, conn, mode, { includeCellResults: true });
  const compressed = await compressGzip(dbBytes);
  const b64 = uint8ArrayToBase64(compressed);

  const payload: BentoDocPayload = {
    format: 'bento/dbtc',
    version: 1,
    embeddedDuckDbBase64: b64,
    exportedAt: new Date().toISOString(),
    mode,
  };

  const payloadJson = escapeScriptJson(JSON.stringify(payload, null, 2));

  // If reading from current document HTML template
  let baseHtml = '';
  if (typeof document !== 'undefined') {
    const docClone = document.documentElement.cloneNode(true) as HTMLElement;
    const appClone = docClone.querySelector('#app');
    if (appClone) {
      appClone.innerHTML = '';
    }
    // Replace or insert #bento-doc script tag
    let bentoScript = docClone.querySelector('#bento-doc');
    if (!bentoScript) {
      bentoScript = document.createElement('script');
      bentoScript.id = 'bento-doc';
      bentoScript.setAttribute('type', 'application/bento+json');
      docClone.querySelector('head')?.appendChild(bentoScript);
    }
    bentoScript.textContent = payloadJson;
    baseHtml = '<!DOCTYPE html>\n' + docClone.outerHTML;
  } else {
    const scriptOpen = '<' + 'script type="application/bento+json" id="bento-doc">';
    const scriptClose = '<' + '/script>';
    const safeTitle = store.notebook.title
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    baseHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle}</title>
  ${scriptOpen}
${payloadJson}
  ${scriptClose}
</head>
<body>
  <div id="app"></div>
</body>
</html>`;
  }

  return baseHtml;
}

function extractBentoPayloadText(htmlContent: string): string {
  let payloadText = '';
  const trimmed = htmlContent.trim();

  // 1. Check if input is already raw JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.format === 'bento/dbtc') {
        payloadText = trimmed;
      }
    } catch {
      // Fall through to DOM/HTML extraction
    }
  }

  // 2. Check if running in browser and targeting current DOM document
  if (!payloadText && typeof document !== 'undefined') {
    const existingBentoEl = document.getElementById('bento-doc');
    if (
      existingBentoEl?.textContent &&
      (htmlContent === document.documentElement?.outerHTML || trimmed === existingBentoEl.textContent.trim())
    ) {
      payloadText = existingBentoEl.textContent.trim();
    }
  }

  // 3. Parse via DOMParser to isolate DOM script elements from JS string literals
  if (!payloadText && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
      const bentoEl = doc.getElementById('bento-doc') || doc.querySelector('script[type="application/bento+json"]');
      if (bentoEl?.textContent) {
        payloadText = bentoEl.textContent.trim();
      }
    } catch {
      // Fall through to regex
    }
  }

  // 4. Targeted regex fallback specifically requiring application/bento+json
  if (!payloadText) {
    const jsonScriptMatch =
      htmlContent.match(/<script[^>]*type=["']application\/bento\+json["'][^>]*id=["']bento-doc["'][^>]*>([\s\S]*?)<\/script>/i) ||
      htmlContent.match(/<script[^>]*id=["']bento-doc["'][^>]*type=["']application\/bento\+json["'][^>]*>([\s\S]*?)<\/script>/i) ||
      htmlContent.match(/<script[^>]*id=["']bento-doc["'][^>]*>([\s\S]*?)<\/script>/i);

    if (jsonScriptMatch && jsonScriptMatch[1]) {
      payloadText = jsonScriptMatch[1].trim();
    }
  }

  return payloadText;
}

/**
 * Prehydrates `store.notebook`, `store.cells`, `store.sources`, and `CellRuntimeRegistry`
 * directly from an embedded `#bento-doc` JSON or HTML string in memory BEFORE DuckDB-WASM
 * finishes booting, allowing saved `.dbtc.html` files to mount the full UI and charts immediately.
 */
export async function prehydrateFromEmbeddedBentoJson(htmlOrJson: string): Promise<boolean> {
  try {
    const payloadText = extractBentoPayloadText(htmlOrJson);
    if (!payloadText) return false;
    const payload: BentoDocPayload = JSON.parse(payloadText);
    if (payload.format !== 'bento/dbtc' || !payload.embeddedDuckDbBase64) return false;

    if (payload.mode) {
      store.notebook.mode = payload.mode;
    }

    const compressedBytes = base64ToUint8Array(payload.embeddedDuckDbBase64);
    const dbBytes = await decompressGzip(compressedBytes);
    if (!dbBytes || dbBytes.length < 4 || dbBytes[0] !== 0x7b) return false;

    const jsonText = new TextDecoder().decode(dbBytes);
    const parsed = JSON.parse(jsonText) as Partial<LocalDbSnapshot>;
    if (parsed.format !== 'dbtc/local-snapshot-v1' || !Array.isArray(parsed.tables)) {
      return false;
    }

    const snapshotTables = parsed.tables as ReadonlyArray<LocalTableSnapshot>;
    const nbTbl = snapshotTables.find(t => t.tableName === '_dbtc_notebook');
    const nbRow = nbTbl?.rows?.[0];
    if (nbRow) {
      store.notebook.docId = String(nbRow['doc_id'] ?? STARTER_NOTEBOOK.docId);
      store.notebook.schemaVersion = String(nbRow['schema_version'] ?? 'transit_v2');
      const rawTitle = String(nbRow['title'] ?? 'NYC Transit Studio');
      store.notebook.title = rawTitle === 'NYC Subway Transit Studio' ? 'NYC Transit Studio' : rawTitle;
      store.notebook.mode = (payload.mode || String(nbRow['mode'] ?? 'standard')) as ExecutionMode;
      store.notebook.liveIntervalSec = Number(nbRow['live_interval_sec'] ?? 60);
      store.notebook.catalogUrl = String(nbRow['catalog_url'] ?? STARTER_NOTEBOOK.catalogUrl);
      store.notebook.ossieIndexUrl = String(nbRow['ossie_index_url'] ?? '');
      store.notebook.modifiedAt = Number(nbRow['modified_at'] ?? Date.now());
    }

    const sourcesTbl = snapshotTables.find(t => t.tableName === '_dbtc_sources');
    const customSourceNames = new Set<string>();
    if (sourcesTbl && Array.isArray(sourcesTbl.rows)) {
      store.sources = sourcesTbl.rows.map(r => {
        const sourceName = String(r['source_name'] ?? '');
        if (sourceName) customSourceNames.add(sourceName);
        return {
          sourceName,
          kind: String(r['kind'] ?? 'local_upload') as 'local_upload' | 'remote_csv_url' | 'remote_parquet_url',
          urlOrFilename: String(r['url_or_filename'] ?? ''),
          byteSize: Number(r['byte_size'] ?? 0),
          includeInOfflineExport: Boolean(r['include_in_offline_export']),
          createdAt: Number(r['created_at'] ?? Date.now()),
        };
      });
    }

    const cellsTbl = snapshotTables.find(t => t.tableName === '_dbtc_cells');
    if (!cellsTbl || !Array.isArray(cellsTbl.rows) || cellsTbl.rows.length === 0) {
      return false;
    }

    const snapshotQuestionCellIds = new Set<string>(
      cellsTbl.rows
        .filter(r => String(r['kind'] ?? 'question') === 'question')
        .map(r => String(r['cell_id'] ?? ''))
        .filter(Boolean)
    );

    for (const tbl of snapshotTables) {
      if (
        snapshotQuestionCellIds.has(tbl.tableName) &&
        !customSourceNames.has(tbl.tableName) &&
        Array.isArray(tbl.columns) &&
        tbl.columns.length > 0 &&
        Array.isArray(tbl.rows)
      ) {
        const cid = asCellId(tbl.tableName);
        const existing = CellRuntimeRegistry.get(cid) ?? {};
        CellRuntimeRegistry.set(cid, {
          ...existing,
          normalized: {
            columns: tbl.columns.map(c => ({
              name: c.name,
              type: normalizeDuckDbSqlType(c.dataType),
            })),
            rows: [...tbl.rows],
            totalRowCount: tbl.rows.length,
          },
        });
      }
    }

    const sortedRows = [...cellsTbl.rows].sort(
      (a, b) => Number(a['ordinal'] ?? 0) - Number(b['ordinal'] ?? 0)
    );

    const hydratedCells: ReactiveCellState[] = sortedRows.map(r => {
      const cellId = asCellId(String(r['cell_id']));
      const kind = (String(r['kind'] ?? 'question')) as 'question' | 'markdown';
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
      const prehydrated = CellRuntimeRegistry.get(cellId)?.normalized;
      const hasCachedRows = Boolean(prehydrated && prehydrated.columns.length > 0);

      const executionState: ReactiveCellState['executionState'] =
        kind !== 'question'
          ? { status: 'idle' }
          : hasCachedRows
          ? {
              status: 'success',
              executionMs: 1,
              rowCount: prehydrated!.totalRowCount,
              executedAt: Date.now(),
              executedMode: store.notebook.mode,
            }
          : store.notebook.mode === 'offline'
          ? { status: 'idle' }
          : store.notebook.engineStatus === 'booting'
          ? { status: 'booting', startTime: Date.now() }
          : { status: 'running', startTime: Date.now() };

      return {
        cellId,
        ordinal: Number(r['ordinal'] ?? 0),
        viewName: asCellViewIdentifier(String(r['view_name'] ?? `local.main.${cellId}`)),
        kind,
        title: String(r['title'] ?? ''),
        subtitle: String(r['subtitle'] ?? ''),
        sourceNote: String(r['source_note'] || 'Source: StraphangerDB'),
        markdownText: String(r['markdown_text'] ?? ''),
        sqlText: String(r['sql_text'] ?? ''),
        params,
        ossieConfig,
        chartType: (String(r['chart_type'] ?? 'table')) as ChartType,
        chartConfig,
        ducklakeSnapshotId: snapId,
        executionState,
        snapshotState: snapId
          ? { status: 'pinned-valid', snapshotId: snapId, snapshotTimestamp: Date.now() }
          : { status: 'unpinned' },
        showSqlEditor: false,
        showOssiePillBar: kind !== 'markdown',
      };
    });

    store.cells = hydratedCells;
    if (store.cells.length > 0 && !store.notebook.activeCellId) {
      store.notebook.activeCellId =
        store.cells.find((c: { kind: string; cellId: CellId }) => c.kind === 'question')?.cellId ??
        store.cells[0]?.cellId ??
        null;
    }
    return true;
  } catch {
    return false;
  }
}

export async function importBentoDocument(
  arg1: AsyncDuckDB | string,
  arg2: AsyncDuckDBConnection | AsyncDuckDB,
  arg3: string | AsyncDuckDBConnection,
  options?: { deferUncachedQueries?: boolean }
): Promise<void> {
  let db: AsyncDuckDB;
  let conn: AsyncDuckDBConnection;
  let htmlContent: string;

  if (typeof arg1 === 'string') {
    htmlContent = arg1;
    db = arg2 as AsyncDuckDB;
    conn = arg3 as AsyncDuckDBConnection;
  } else {
    db = arg1;
    conn = arg2 as AsyncDuckDBConnection;
    htmlContent = arg3 as string;
  }

  const payloadText = extractBentoPayloadText(htmlContent);

  if (!payloadText) {
    throw new Error('Valid #bento-doc script tag not found in document');
  }

  const payload: BentoDocPayload = JSON.parse(payloadText);

  if (payload.format !== 'bento/dbtc') {
    throw new Error(`Unsupported document format: ${payload.format}`);
  }

  // Cancel any in-flight initial startup hydration loop so it does not compete with this import
  bumpHydrationEpoch();

  // Clear previous notebook's runtime artifacts & active cell selection
  for (const artifacts of CellRuntimeRegistry.values()) {
    try {
      artifacts.echartsInstance?.dispose();
    } catch {
      // Ignore
    }
    try {
      const m = artifacts.maplibreInstance as { destroy?: () => void } | undefined;
      m?.destroy?.();
    } catch {
      // Ignore
    }
  }
  CellRuntimeRegistry.clear();
  store.notebook.activeCellId = null;

  if (payload.mode) {
    store.notebook.mode = payload.mode;
  }

  const compressedBytes = base64ToUint8Array(payload.embeddedDuckDbBase64);
  const dbBytes = await decompressGzip(compressedBytes);

  // Restore database tables into local session
  await restoreDatabaseFromBuffer(db, conn, dbBytes);

  // Hydrate store from newly loaded local.db without running starter migrations
  await hydrateStoreFromDuckDb(conn, undefined, { isBentoImport: true });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dbtc:notebook-updated'));
  }

  for (const cell of store.cells) {
    if (cell.kind === 'question') {
      const prehydrated = CellRuntimeRegistry.get(cell.cellId)?.normalized;
      if (prehydrated && prehydrated.columns.length > 0 && prehydrated.rows.length > 0) {
        try {
          await hydrateCellRuntime(conn, cell.cellId);
        } catch (err) {
          console.warn(`Failed hydrating cell runtime for ${cell.cellId}:`, err);
        }
      } else if (options?.deferUncachedQueries) {
        cell.executionState = { status: 'running', startTime: Date.now() };
      } else {
        try {
          await hydrateCellRuntime(conn, cell.cellId);
        } catch (err) {
          console.warn(`Failed hydrating cell runtime for ${cell.cellId}:`, err);
        }
      }
    }
  }
}

export const exportBentoDocHtml = exportBentoDocument;
export const importBentoDocHtml = importBentoDocument;

// IndexedDB draft autosave
const IDB_NAME = 'dbtc_storage';
const IDB_STORE = 'drafts';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'docId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function autosaveDraftToIndexedDb(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection
): Promise<void> {
  try {
    const rawBytes = await exportLocalDbBuffer(db, conn, store.notebook.mode);
    const compressed = await compressGzip(rawBytes);
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
      tx.objectStore(IDB_STORE).put({
        docId: store.notebook.docId,
        compressedBytes: compressed,
        updatedAt: Date.now(),
      });
    });
  } catch {
    // Autosave error caught silently
  }
}

export async function restoreDatabaseFromBuffer(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  dbBytes: Uint8Array
): Promise<boolean> {
  if (!dbBytes || dbBytes.length < 4) {
    return false;
  }

  // 1. Check for JSON LocalDbSnapshot format ('dbtc/local-snapshot-v1')
  if (dbBytes[0] === 0x7b) {
    try {
      const jsonText = new TextDecoder().decode(dbBytes);
      const parsed = JSON.parse(jsonText) as Partial<LocalDbSnapshot>;
      if (parsed.format === 'dbtc/local-snapshot-v1' && Array.isArray(parsed.tables)) {
        await initSystemTables(conn);
        const systemTables = new Set(['_dbtc_notebook', '_dbtc_cells', '_dbtc_sources']);
        const seededTopologyTables = new Set(['dim_routes', 'dim_service_lines', 'dim_stations', 'dim_micromobility_stations']);
        const snapshotTables = parsed.tables as ReadonlyArray<LocalTableSnapshot>;

        const sourcesTbl = snapshotTables.find(t => t.tableName === '_dbtc_sources');
        const customSourceNames = new Set<string>(
          (sourcesTbl?.rows ?? []).map(r => String(r['source_name'] ?? '')).filter(Boolean)
        );
        const nbTbl = snapshotTables.find(t => t.tableName === '_dbtc_notebook');
        const snapshotMode = String(nbTbl?.rows?.[0]?.['mode'] ?? 'standard');
        const cellsTbl = snapshotTables.find(t => t.tableName === '_dbtc_cells');
        const snapshotQuestionCellIds = new Set<string>(
          (cellsTbl?.rows ?? [])
            .filter(r => String(r['kind'] ?? 'question') === 'question')
            .map(r => String(r['cell_id'] ?? ''))
            .filter(Boolean)
        );

        const localRelTypes = await getLocalRelationTypes(conn);

        for (const tbl of snapshotTables) {
          if (!tbl.tableName || !Array.isArray(tbl.columns) || tbl.columns.length === 0) continue;
          // Skip built-in seeded topology tables unless customized as an uploaded source
          if (seededTopologyTables.has(tbl.tableName) && !customSourceNames.has(tbl.tableName)) {
            continue;
          }
          // Hydrate in-memory CellRuntimeRegistry for question cells so charts render immediately
          // upon opening a saved .dbtc.html file without waiting on remote catalog.db queries.
          if (
            snapshotQuestionCellIds.has(tbl.tableName) &&
            !customSourceNames.has(tbl.tableName) &&
            Array.isArray(tbl.rows)
          ) {
            const cid = asCellId(tbl.tableName);
            const existing = CellRuntimeRegistry.get(cid) ?? {};
            CellRuntimeRegistry.set(cid, {
              ...existing,
              normalized: {
                columns: tbl.columns.map(c => ({
                  name: c.name,
                  type: normalizeDuckDbSqlType(c.dataType),
                })),
                rows: [...tbl.rows],
                totalRowCount: tbl.rows.length,
              },
            });
          }
          // In non-offline mode, do not restore stale materialized question cell tables in DuckDB
          if (
            snapshotMode !== 'offline' &&
            snapshotQuestionCellIds.has(tbl.tableName) &&
            !customSourceNames.has(tbl.tableName)
          ) {
            await dropLocalRelationIfExists(conn, tbl.tableName, localRelTypes);
            continue;
          }

          const cols: ReadonlyArray<{ readonly name: string; readonly dataType: string }> = tbl.columns;
          const safeTbl = `"${tbl.tableName.replace(/"/g, '""')}"`;
          try {
            if (systemTables.has(tbl.tableName)) {
              await conn.query(`DELETE FROM local.main.${safeTbl};`);
            } else {
              await dropLocalRelationIfExists(conn, tbl.tableName, localRelTypes);
              const colDefs = cols
                .map(c => `"${c.name.replace(/"/g, '""')}" ${normalizeDuckDbSqlType(c.dataType)}`)
                .join(', ');
              await conn.query(`CREATE TABLE local.main.${safeTbl} (${colDefs});`);
              localRelTypes.set(tbl.tableName, 'BASE TABLE');
            }

            if (Array.isArray(tbl.rows) && tbl.rows.length > 0) {
              const rows: ReadonlyArray<Record<string, unknown>> = tbl.rows;
              const colNames = cols.map(c => `"${c.name.replace(/"/g, '""')}"`).join(', ');
              const BATCH_SIZE = 200;
              for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const valuesTuples = batch
                  .map(row => {
                    const vals = cols.map(c => formatSqlLiteral(row[c.name], c.dataType));
                    return `(${vals.join(', ')})`;
                  })
                  .join(', ');
                await conn.query(`INSERT INTO local.main.${safeTbl} (${colNames}) VALUES ${valuesTuples};`);
              }
            }
          } catch (tblErr) {
            console.warn(`Could not restore snapshot table ${tbl.tableName}:`, tblErr);
          }
        }
        return true;
      }
    } catch (err) {
      console.warn('Failed restoring JSON snapshot from buffer:', err);
      return false;
    }
  }

  // 2. Legacy binary DuckDB database buffer format: validate magic header before ATTACH
  if (!isValidDuckDbFileBuffer(dbBytes)) {
    return false;
  }

  const tempName = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`;
  try {
    await db.registerFileBuffer(tempName, dbBytes);
    await conn.query(`ATTACH '${tempName}' AS temp_restore;`);

    // Retrieve all user base tables from temp_restore (avoid views so they can be defined from SQL text)
    const tablesRes = await conn.query(
      `SELECT table_name FROM information_schema.tables WHERE table_catalog = 'temp_restore' AND table_schema = 'main' AND table_type = 'BASE TABLE';`
    );
    const normTables = normalizeArrowTable(tablesRes);
    const tableNames = normTables.rows.map(r => String(r['table_name']));

    const seededTopologyTables = new Set(['dim_routes', 'dim_service_lines', 'dim_stations', 'dim_micromobility_stations']);
    const localRelTypes = await getLocalRelationTypes(conn);

    for (const tbl of tableNames) {
      if (seededTopologyTables.has(tbl)) continue;
      const safeTbl = `"${tbl.replace(/"/g, '""')}"`;
      try {
        await dropLocalRelationIfExists(conn, tbl, localRelTypes);
        await conn.query(`CREATE OR REPLACE TABLE local.main.${safeTbl} AS SELECT * FROM temp_restore.main.${safeTbl};`);
        localRelTypes.set(tbl, 'BASE TABLE');
      } catch (copyErr) {
        console.warn(`Could not copy table ${tbl} from restore buffer:`, copyErr);
      }
    }

    try {
      await conn.query(`DETACH temp_restore;`);
    } catch {
      // Proceed
    }
    return true;
  } catch (err) {
    console.warn('Failed restoring database from buffer:', err);
    return false;
  } finally {
    try {
      await db.dropFile(tempName);
    } catch {
      // Proceed
    }
  }
}

export async function loadDraftFromIndexedDb(
  docId: string,
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection
): Promise<boolean> {
  try {
    const idb = await openIdb();
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(docId);
    return new Promise(resolve => {
      req.onsuccess = async () => {
        try {
          if (req.result?.compressedBytes) {
            const dbBytes = await decompressGzip(req.result.compressedBytes);
            const restored = await restoreDatabaseFromBuffer(db, conn, dbBytes);
            if (!restored) {
              await clearDraftFromIndexedDb(docId);
              resolve(false);
              return;
            }
            await hydrateStoreFromDuckDb(conn);
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (err) {
          console.warn('Could not restore draft from IndexedDB:', err);
          resolve(false);
        }
      };
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelDraftAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

export function scheduleDraftAutosave(
  db?: AsyncDuckDB | null,
  conn?: AsyncDuckDBConnection | null,
  delayMs = 1000
): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  autosaveTimer = setTimeout(async () => {
    try {
      let resolvedDb = db;
      let resolvedConn = conn;
      if (!resolvedDb || !resolvedConn) {
        const { getDuckDbClient, getDuckDbConnection } = await import('../data/duckdb-client.js');
        resolvedDb = getDuckDbClient();
        resolvedConn = getDuckDbConnection();
      }
      if (resolvedDb && resolvedConn) {
        await autosaveDraftToIndexedDb(resolvedDb, resolvedConn);
      }
    } catch {
      // Ignore autosave error
    }
  }, delayMs);
}

export async function clearDraftFromIndexedDb(docId: string): Promise<void> {
  cancelDraftAutosave();
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
      tx.objectStore(IDB_STORE).delete(docId);
    });
  } catch {
    // Clear draft error caught silently
  }
}

