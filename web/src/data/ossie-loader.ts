import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import {
  OSSIE_THEMES,
  OSSIE_FACT_GRAPH,
  type OssieThemeName,
  type TypedOssieConfig,
} from '../types/straphanger-schema.gen.js';

export const DBTC_OSSIE_THEMES = OSSIE_THEMES.filter(t => t.name === 'dbtc');

export async function initOssieExtension(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection
): Promise<boolean> {
  try {
    await conn.query('INSTALL ossie FROM community;');
    await conn.query('LOAD ossie;');

    // Register root-level dbtc Ossie 0.2.0.dev0 semantic model into virtual filesystem
    for (const theme of DBTC_OSSIE_THEMES) {
      const fileName = `${theme.name}.ossie.json`;
      const jsonContent = JSON.stringify({
        version: '0.2.0.dev0',
        name: theme.name,
        description: theme.description,
        datasets: theme.datasets.map(d => ({
          name: d.name,
          description: d.description,
          source: d.source,
          fields: d.fields.map(f => ({
            name: f.name,
            description: f.description,
            datatype: f.datatype,
            expression: {
              dialects: [{ dialect: 'ANSI_SQL', expression: f.name }],
            },
            ...(f.isTime ? { dimension: { is_time: true } } : {}),
          })),
        })),
        relationships: theme.relationships.map(r => ({
          name: r.name,
          from: r.from,
          to: r.to,
          from_columns: r.fromColumns,
          to_columns: r.toColumns,
          type: r.type,
        })),
        metrics: theme.metrics.map(m => ({
          name: m.name,
          description: m.description,
          datatype: m.datatype,
          expression: {
            dialects: [{ dialect: 'ANSI_SQL', expression: m.expression }],
          },
        })),
      });
      await db.registerFileText(fileName, jsonContent);
      try {
        await conn.query(`CALL ossie_load('${fileName}', allow_filter_functions => true);`);
      } catch {
        // Proceed
      }
    }
    return true;
  } catch (err) {
    console.warn('Native duckdb-ossie extension could not be loaded, using TypeScript fallback compiler:', err);
    return false;
  }
}

export interface DbtcLensMeta {
  readonly name: string;
  readonly label: string;
  readonly defaultWindow: string;
  readonly defaultAgency: string;
  readonly defaultRoutes: readonly string[];
  readonly defaultLimit?: number;
}

export const DBTC_WINDOW_PRESETS: Record<string, { label: string; description: string }> = {
  yesterday_am_rush: {
    label: 'Yesterday AM Rush (7-11 AM ET)',
    description: 'Yesterday partition with 7-11 AM America/New_York filter',
  },
  prev_weekday_am_rush: {
    label: 'Last Weekday AM Rush (7-10 AM ET)',
    description: 'Most recent weekday partition with 6:30-10 AM ET arrival window',
  },
  yesterday: {
    label: 'Yesterday (Full Day)',
    description: 'Yesterday partition (CURRENT_DATE - 1 day)::DATE',
  },
  live_3h: {
    label: 'Live + Last 3 Hours',
    description: 'UTC-rollover-safe 3-hour tail combined with live GTFS-RT feeds',
  },
  latest_turnstiles: {
    label: 'Latest Turnstile Partition',
    description: 'Recent turnstile counts (event_date >= 2026-10-29)',
  },
  od_baseline: {
    label: 'OD Ridership Baseline',
    description: 'Origin-destination ridership partition (2025-04-07)',
  },
};

export const DBTC_OSSIE_LENS_META: readonly DbtcLensMeta[] = [
  {
    name: 'subway_station_headways',
    label: 'Subway Headway Regularity',
    defaultWindow: 'yesterday_am_rush',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: ['4', '5', '6'],
  },
  {
    name: 'train_stringline_marey',
    label: 'Train Stringline (Marey)',
    defaultWindow: 'prev_weekday_am_rush',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: ['7', '7X'],
  },
  {
    name: 'live_subway_fleet',
    label: 'Live Subway & SIR Fleet',
    defaultWindow: 'live_3h',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
  {
    name: 'live_commuter_rail_fleet',
    label: 'Live Commuter Rail (LIRR & MNR)',
    defaultWindow: 'live_3h',
    defaultAgency: 'MTA_LIRR',
    defaultRoutes: [],
  },
  {
    name: 'live_bus_fleet',
    label: 'Live NYC Bus Fleet',
    defaultWindow: 'live_3h',
    defaultAgency: 'MTA_BUS',
    defaultRoutes: ['M60-SBS'],
  },
  {
    name: 'subway_headway_horizon',
    label: 'Subway Headway Horizon',
    defaultWindow: 'prev_weekday_am_rush',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: ['R', 'M'],
  },
  {
    name: 'multimodal_station_pulse',
    label: 'Multimodal Station Pulse',
    defaultWindow: 'yesterday',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
  {
    name: 'od_ridership_flows',
    label: 'Origin-Destination Ridership Flows',
    defaultWindow: 'od_baseline',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
  {
    name: 'route_segment_speeds',
    label: 'Route Segment Speeds',
    defaultWindow: 'yesterday',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: ['7', 'E', 'F', 'M', 'R', 'N', 'W'],
  },
  {
    name: 'station_isochrones',
    label: 'Station Reachability Isochrones',
    defaultWindow: 'yesterday',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
  {
    name: 'schedule_adherence_hourly',
    label: 'Schedule Adherence (Ghost Trains)',
    defaultWindow: 'yesterday',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: ['L'],
  },
  {
    name: 'station_turnstile_ranking',
    label: 'Top Turnstile Stations',
    defaultWindow: 'latest_turnstiles',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
    defaultLimit: 10,
  },
  {
    name: 'hourly_turnstile_profile',
    label: 'Hourly Ridership Profile',
    defaultWindow: 'latest_turnstiles',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
  {
    name: 'fleet_route_share',
    label: 'Fleet Trip Share by Route',
    defaultWindow: 'yesterday',
    defaultAgency: 'MTA_NYCT_SUBWAY',
    defaultRoutes: [],
  },
];

export function resolveWindowPresetSql(preset: string, alias = ''): string | null {
  const p = alias ? `${alias}.` : '';
  const cleaned = preset.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const prevWeekdayExpr = `(CASE EXTRACT(ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE) WHEN 1 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 3 WHEN 7 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 2 ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 1 END)::DATE`;
  switch (cleaned) {
    case 'yesterday':
      return `${p}event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE`;
    case 'yesterday_am_rush':
      return `${p}event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE AND EXTRACT(HOUR FROM ${p}event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 10`;
    case 'prev_weekday_am_rush':
      return `${p}event_date = ${prevWeekdayExpr} AND ${p}event_time >= ((${prevWeekdayExpr}::TIMESTAMP + INTERVAL '6 hours 30 minutes') AT TIME ZONE 'America/New_York') AND ${p}event_time < ((${prevWeekdayExpr}::TIMESTAMP + INTERVAL '10 hours') AT TIME ZONE 'America/New_York')`;
    case 'live_3h':
      return `${p}event_date >= ((CURRENT_TIMESTAMP - INTERVAL '6 hours') AT TIME ZONE 'America/New_York')::DATE AND ${p}event_date <= ((CURRENT_TIMESTAMP + INTERVAL '5 minutes') AT TIME ZONE 'UTC')::DATE AND ${p}event_time >= CURRENT_TIMESTAMP - INTERVAL '3 hours' AND ${p}event_time <= CURRENT_TIMESTAMP + INTERVAL '1 minute'`;
    case 'latest_turnstiles':
      return `${p}event_date >= DATE '2026-10-29'`;
    case 'od_baseline':
      return `${p}event_date = DATE '2025-04-07'`;
    default:
      return null;
  }
}

export function compileOssieConfigToSql(
  config: TypedOssieConfig,
  options?: { skipDefaultDateFilter?: boolean; rawWhereSql?: string }
): string {
  const theme = OSSIE_THEMES.find(t => t.name === config.theme);
  if (!theme) {
    throw new Error(`Unknown Ossie theme: ${config.theme}`);
  }

  const factDs = theme.datasets.find(d => d.name === config.factDataset);
  if (!factDs) {
    throw new Error(`Unknown fact dataset '${config.factDataset}' in theme '${config.theme}'`);
  }

  // Extract window preset if present in filters
  const windowFilter = config.filters.find(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').toLowerCase();
    return fn === 'window' || fn.endsWith('.window');
  });
  const regularFilters = config.filters.filter(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').toLowerCase();
    return fn !== 'window' && !fn.endsWith('.window');
  });

  // Check if factDataset is one of DBTC's ergonomic chart-ready Lenses
  const lensMeta = DBTC_OSSIE_LENS_META.find(l => l.name === factDs.name);
  if (lensMeta && config.selectedDimensions.length === 0 && config.selectedMetrics.length === 0) {
    const lensSql = compileCuratedLensSql(
      lensMeta,
      regularFilters,
      windowFilter ? String(windowFilter.value ?? '') : lensMeta.defaultWindow,
      config.limit,
      options?.rawWhereSql
    );
    if (lensSql) {
      return normalizeDuckLakeDatePredicates(lensSql) + ';';
    }
  }

  // Find metric expressions
  const metricClauses: string[] = [];
  const metricReferencedDatasets = new Set<string>();
  for (const metricName of config.selectedMetrics) {
    const m = theme.metrics.find(x => x.name === metricName);
    if (m) {
      metricClauses.push(`${m.expression} AS ${m.name}`);
      if (m.referencedDatasets) {
        for (const refDs of m.referencedDatasets) {
          if (refDs && refDs !== factDs.name) {
            metricReferencedDatasets.add(refDs);
          }
        }
      }
    }
  }

  // Group by dimensions
  const dims = config.selectedDimensions;
  const selectParts: string[] = [];
  if (dims.length > 0) {
    selectParts.push(...dims);
  }
  if (metricClauses.length > 0) {
    selectParts.push(...metricClauses);
  }
  if (selectParts.length === 0) {
    selectParts.push('*');
  }

  const fromSource = factDs.source || `prod.transit_v2.${factDs.name}`;
  let sql = `SELECT\n  ${selectParts.join(',\n  ')}\nFROM ${fromSource} AS ${factDs.name}`;

  // Find which other datasets are needed by selected dimensions and metrics
  const neededDatasets = new Set<string>(metricReferencedDatasets);
  for (const dim of dims) {
    const [dsName] = dim.split('.');
    if (dsName && dsName !== factDs.name) {
      neededDatasets.add(dsName);
    }
  }

  // Resolve join paths using BFS across directed relationships
  const joinedDatasets = new Set<string>([factDs.name]);
  for (const targetDsName of neededDatasets) {
    if (joinedDatasets.has(targetDsName)) continue;

    // BFS to find path of relationships from any already joined dataset to targetDsName
    const queue: { current: string; path: typeof theme.relationships }[] = [
      { current: factDs.name, path: [] },
    ];
    const visited = new Set<string>([factDs.name]);
    let resolvedPath: typeof theme.relationships | null = null;

    while (queue.length > 0) {
      const { current, path: currentPath } = queue.shift()!;
      if (current === targetDsName) {
        resolvedPath = currentPath;
        break;
      }
      for (const rel of theme.relationships) {
        if (rel.from === current && !visited.has(rel.to)) {
          visited.add(rel.to);
          queue.push({ current: rel.to, path: [...currentPath, rel] });
        }
      }
    }

    if (!resolvedPath) {
      throw new Error(
        `Cannot resolve join path from '${factDs.name}' to '${targetDsName}'. Dataset '${targetDsName}' is not reachable from '${factDs.name}' in theme '${theme.name}'.`
      );
    }

    // Emit LEFT JOINs along the path
    for (const rel of resolvedPath) {
      if (!joinedDatasets.has(rel.to)) {
        const targetDs = theme.datasets.find(d => d.name === rel.to);
        const targetSource = targetDs?.source || `prod.transit_v2.${rel.to}`;
        const joinConditions: string[] = [];
        const fromCols = rel.fromColumns;
        const toCols = rel.toColumns;
        for (let i = 0; i < Math.min(fromCols.length, toCols.length); i++) {
          joinConditions.push(`${rel.from}.${fromCols[i]} = ${rel.to}.${toCols[i]}`);
        }
        sql += `\nLEFT JOIN ${targetSource} AS ${rel.to} ON ${joinConditions.join(' AND ')}`;
        joinedDatasets.add(rel.to);
      }
    }
  }

  // Filters
  const isSafeIdentifier = (ident: string): boolean => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(ident);
  const ALLOWED_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'ILIKE']);
  const isSafeSqlExpr = (s: string): boolean => {
    if (/;|--|\/\*/.test(s)) return false;
    return /^(?:CURRENT_DATE|CURRENT_TIMESTAMP|TODAY\s*\(\s*\)|NOW\s*\(\s*\)|DATE\s+'(?:[^']|'')+'|TIMESTAMPTZ?\s+'(?:[^']|'')+'|\([^;]+\)(?:\s*::\s*[A-Za-z0-9_ ]+)?(?:\s+AT\s+TIME\s+ZONE\s+'(?:[^']|'')+')?|CASE\b[^;]+\bEND(?:\s*::\s*[A-Za-z0-9_ ]+)?|CAST\s*\([^;]+\bAS\s+[A-Za-z0-9_ ]+\))$/i.test(
      s
    );
  };

  const formatFilterValue = (val: unknown): string | number => {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 'NULL';
    const rawStr = String(val ?? '').trim();
    if (isSafeSqlExpr(rawStr)) {
      return rawStr;
    }
    if (/^'(?:[^']|'')*'$/.test(rawStr)) {
      return rawStr;
    }
    return `'${rawStr.replace(/'/g, "''")}'`;
  };

  const whereConditions: string[] = [];
  if (windowFilter) {
    const presetSql = resolveWindowPresetSql(String(windowFilter.value ?? ''), factDs.name);
    if (presetSql) whereConditions.push(presetSql);
  }
  for (const filter of regularFilters) {
    const fieldName = (filter as any).dimension ?? (filter as any).field;
    if (!fieldName || !isSafeIdentifier(String(fieldName))) continue;
    const op = String(filter.operator ?? '=').trim().toUpperCase();
    if (op === 'IN' && Array.isArray((filter as any).value)) {
      const vals = ((filter as any).value as (string | number)[]).map(v => formatFilterValue(v));
      if (vals.length > 0) {
        whereConditions.push(`${fieldName} IN (${vals.join(', ')})`);
      }
    } else if (op === 'BETWEEN' && Array.isArray((filter as any).value) && (filter as any).value.length === 2) {
      whereConditions.push(
        `${fieldName} BETWEEN ${formatFilterValue((filter as any).value[0])} AND ${formatFilterValue((filter as any).value[1])}`
      );
    } else if (ALLOWED_OPS.has(op)) {
      const valStr = formatFilterValue(filter.value);
      whereConditions.push(`${fieldName} ${op} ${valStr}`);
    }
  }
  if (options?.rawWhereSql && options.rawWhereSql.trim().length > 0) {
    whereConditions.push(options.rawWhereSql.trim());
  }

  const hasEventDateFilter =
    Boolean(windowFilter) ||
    regularFilters.some(f => {
      const fieldName = (f as any).dimension ?? (f as any).field ?? '';
      return fieldName === 'event_date' || fieldName.endsWith('.event_date');
    }) ||
    Boolean(options?.rawWhereSql && /\bevent_date\b/i.test(options.rawWhereSql));
  if (!options?.skipDefaultDateFilter && !hasEventDateFilter && factDs.fields.some(f => f.name === 'event_date')) {
    if (factDs.name === 'turnstile_flows' || factDs.name === 'station_turnstile_ranking' || factDs.name === 'hourly_turnstile_profile') {
      whereConditions.push(`${factDs.name}.event_date >= DATE '2026-10-29'`);
    } else if (factDs.name === 'fact_ridership') {
      whereConditions.push(`${factDs.name}.event_date >= DATE '2025-04-07'`);
    } else if (factDs.name === 'current_vehicle_positions') {
      whereConditions.push(`${factDs.name}.event_date = CURRENT_DATE`);
    } else if (config.selectedMetrics.length === 0) {
      whereConditions.push(`${factDs.name}.event_date >= (CURRENT_DATE - INTERVAL '1 day')::DATE`);
    } else {
      whereConditions.push(`${factDs.name}.event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE`);
    }
  }

  if (whereConditions.length > 0) {
    sql += `\nWHERE ${whereConditions.join(' AND ')}`;
  }

  if (dims.length > 0 && metricClauses.length > 0) {
    sql += `\nGROUP BY ${dims.join(', ')}`;
  }

  if (config.limit && config.limit > 0) {
    sql += `\nLIMIT ${config.limit}`;
  }

  return normalizeDuckLakeDatePredicates(sql) + ';';
}

function buildPushdownPredicates(
  filters: ReadonlyArray<TypedOssieConfig['filters'][number]>,
  windowPreset: string,
  defaults: { agencyId?: string; routes?: readonly string[] },
  rawWhereSql?: string
): { whereSql: string; agencyFilter: string; routeFilter: string } {
  const parts: string[] = [];
  const winSql = resolveWindowPresetSql(windowPreset);
  const hasExplicitDate = filters.some(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').split('.').pop();
    return fn === 'event_date';
  }) || Boolean(rawWhereSql && /\bevent_date\b/i.test(rawWhereSql));

  if (!hasExplicitDate && winSql) {
    parts.push(winSql);
  }

  let hasAgency = false;
  let hasRoute = false;
  let agencyClause = '';
  let routeClause = '';

  const ALLOWED_OPS = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'ILIKE']);
  const fmtVal = (v: unknown): string => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    const s = String(v ?? '').trim();
    if (!/;|--|\/\*/.test(s) && /^(?:CURRENT_DATE|CURRENT_TIMESTAMP|DATE\s+'(?:[^']|'')+'|\([^;]+\))$/i.test(s)) {
      return s;
    }
    if (/^'(?:[^']|'')*'$/.test(s)) return s;
    return `'${s.replace(/'/g, "''")}'`;
  };

  for (const f of filters) {
    const rawField = (f as any).dimension ?? (f as any).field ?? '';
    const col = rawField.split('.').pop() || rawField;
    if (!col || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) continue;
    const op = String(f.operator ?? '=').trim().toUpperCase();
    let clause = '';
    if (op === 'IN' && Array.isArray((f as any).value)) {
      const vals = ((f as any).value as unknown[]).map(fmtVal);
      if (vals.length === 0) continue;
      clause = `${col} IN (${vals.join(', ')})`;
    } else if (op === 'BETWEEN' && Array.isArray((f as any).value) && (f as any).value.length === 2) {
      clause = `${col} BETWEEN ${fmtVal((f as any).value[0])} AND ${fmtVal((f as any).value[1])}`;
    } else if (ALLOWED_OPS.has(op)) {
      clause = `${col} ${op} ${fmtVal(f.value)}`;
    } else {
      continue;
    }
    parts.push(clause);
    if (col === 'agency_id') {
      hasAgency = true;
      agencyClause = clause;
    } else if (col === 'route_id') {
      hasRoute = true;
      routeClause = clause;
    }
  }

  if (!hasAgency && defaults.agencyId) {
    agencyClause = `agency_id = '${defaults.agencyId}'`;
    parts.push(agencyClause);
  }
  if (!hasRoute && defaults.routes && defaults.routes.length > 0) {
    routeClause = `route_id IN (${defaults.routes.map(r => `'${r}'`).join(', ')})`;
    parts.push(routeClause);
  }
  if (rawWhereSql && rawWhereSql.trim()) {
    parts.push(rawWhereSql.trim());
  }

  return {
    whereSql: parts.join(' AND '),
    agencyFilter: agencyClause || `agency_id = '${defaults.agencyId || 'MTA_NYCT_SUBWAY'}'`,
    routeFilter: routeClause,
  };
}

function compileCuratedLensSql(
  lens: DbtcLensMeta,
  filters: ReadonlyArray<TypedOssieConfig['filters'][number]>,
  windowPreset: string,
  limit?: number,
  rawWhereSql?: string
): string | null {
  const { whereSql, agencyFilter } = buildPushdownPredicates(
    filters,
    windowPreset,
    { agencyId: lens.defaultAgency, routes: lens.defaultRoutes },
    rawWhereSql
  );
  const effectiveLimit = limit && limit > 0 ? limit : lens.defaultLimit;

  switch (lens.name) {
    case 'subway_station_headways':
      return `WITH pruned_fact AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    station_id,
    rtrim(station_id, 'NS') AS parent_station_id,
    right(station_id, 1) AS direction_id,
    MIN(event_time) AS event_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND station_id IS NOT NULL AND station_id != ''
    AND trip_id IS NOT NULL AND trip_id != ''
  GROUP BY event_date, agency_id, route_id, trip_id, station_id
),
station_headways AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    station_id,
    parent_station_id,
    EXTRACT(EPOCH FROM (
      event_time - LAG(event_time) OVER (
        PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id
        ORDER BY event_time
      )
    )) AS headway_sec
  FROM pruned_fact
),
station_boroughs AS (
  SELECT
    agency_id,
    gtfs_stop_id,
    name,
    latitude,
    longitude,
    CASE
      WHEN latitude > 40.805 AND longitude > -73.935 THEN 'Bronx'
      WHEN latitude < 40.700 THEN 'Brooklyn'
      ELSE 'Manhattan'
    END AS borough
  FROM prod.transit_v2.view_dim_stations
  WHERE ${agencyFilter}
)
SELECT
  max(h.event_date) AS event_date,
  h.agency_id,
  h.route_id,
  min(h.parent_station_id) AS station_id,
  coalesce(s.name, h.parent_station_id, h.station_id) AS station_name,
  coalesce(any_value(s.borough), 'Manhattan') AS borough,
  round(avg(h.headway_sec), 1) AS headway_sec,
  round(avg(h.headway_sec), 1) AS avg_headway_sec,
  concat(
    CAST(floor(avg(h.headway_sec) / 60) AS INTEGER),
    'm ',
    lpad(CAST(CAST(round(avg(h.headway_sec)) AS INTEGER) % 60 AS VARCHAR), 2, '0'),
    's'
  ) AS display_value,
  'Morning Rush Headway (sec)' AS measure_label
FROM station_headways h
LEFT JOIN station_boroughs s
  ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id
WHERE h.headway_sec BETWEEN 60 AND 900
GROUP BY h.agency_id, h.route_id, coalesce(s.name, h.parent_station_id, h.station_id)
HAVING count(*) >= 4
ORDER BY
  CASE coalesce(any_value(s.borough), 'Manhattan')
    WHEN 'Bronx' THEN 1
    WHEN 'Queens' THEN 2
    WHEN 'Manhattan' THEN 3
    WHEN 'Brooklyn' THEN 4
    WHEN 'Staten Island' THEN 5
    ELSE 6
  END,
  avg(s.latitude) DESC NULLS LAST,
  min(h.parent_station_id) ASC,
  station_name${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;

    case 'train_stringline_marey':
      return `WITH pruned_fact AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    MIN(station_id) AS station_id,
    rtrim(station_id, 'NS') AS parent_station_id,
    'S' AS direction_id,
    MAX(event_time) AS event_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND station_id IS NOT NULL AND station_id != ''
    AND right(station_id, 1) = 'S'
    AND trip_id IS NOT NULL AND trip_id != ''
    AND trip_id NOT LIKE '%..N%'
  GROUP BY event_date, agency_id, route_id, trip_id, rtrim(station_id, 'NS')
),
station_headways AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    station_id,
    parent_station_id,
    direction_id,
    event_time,
    EXTRACT(EPOCH FROM (
      event_time - LAG(event_time) OVER (
        PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id
        ORDER BY event_time
      )
    )) AS headway_sec
  FROM pruned_fact
),
station_boroughs AS (
  SELECT
    agency_id,
    gtfs_stop_id,
    name,
    coalesce(nullif(borough, ''), CASE WHEN longitude > -73.965 OR gtfs_stop_id <= '721' THEN 'Queens' ELSE 'Manhattan' END) AS borough
  FROM prod.transit_v2.view_dim_stations
  WHERE ${agencyFilter}
)
SELECT
  h.event_date,
  h.agency_id,
  h.route_id,
  h.trip_id,
  h.direction_id,
  h.parent_station_id AS station_id,
  coalesce(s.name, h.parent_station_id, h.station_id) AS station_name,
  s.borough AS borough,
  h.event_time,
  round(h.headway_sec, 0) AS headway_sec,
  concat(
    CAST(floor(h.headway_sec / 60) AS INTEGER),
    'm ',
    lpad(CAST(CAST(round(h.headway_sec) AS INTEGER) % 60 AS VARCHAR), 2, '0'),
    's headway'
  ) AS display_value
FROM station_headways h
LEFT JOIN station_boroughs s
  ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id
ORDER BY h.event_time ASC${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;

    case 'station_turnstile_ranking':
      return `WITH complex_totals AS (
  SELECT
    t.station_id,
    coalesce(nullif(trim(c.complex_name), ''), t.station_id) AS raw_name,
    nullif(trim(regexp_replace(coalesce(c.complex_name, ''), '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')), '') AS base_name,
    nullif(trim(replace(coalesce(c.daytime_routes, ''), ' ', ',')), '') AS routes_label,
    CAST(sum(t.entry_count) AS BIGINT) AS total_entries
  FROM prod.transit_v2.view_turnstile_flows t
  LEFT JOIN prod.transit_v2.view_station_complexes c
    ON t.station_id = c.complex_id AND t.agency_id = c.agency_id
  WHERE ${whereSql.replace(/\b(event_date|agency_id)\b/g, 't.$1')}
  GROUP BY t.station_id, c.complex_name, c.daytime_routes
  HAVING sum(t.entry_count) > 0
),
disambiguated AS (
  SELECT
    station_id,
    raw_name,
    base_name,
    routes_label,
    total_entries,
    count(*) OVER (PARTITION BY coalesce(base_name, raw_name)) AS same_base_name_count
  FROM complex_totals
)
SELECT
  CASE
    WHEN raw_name LIKE '%(%)' THEN raw_name
    WHEN same_base_name_count > 1 AND routes_label IS NOT NULL THEN concat(raw_name, ' (', routes_label, ')')
    WHEN same_base_name_count > 1 THEN concat(raw_name, ' (#', station_id, ')')
    ELSE raw_name
  END AS station_name,
  total_entries
FROM disambiguated
ORDER BY total_entries DESC
LIMIT ${effectiveLimit || 10}`;

    case 'hourly_turnstile_profile':
      return `SELECT
  concat(lpad(CAST(EXTRACT(HOUR FROM reading_time AT TIME ZONE 'UTC') AS VARCHAR), 2, '0'), ':00') AS service_hour,
  CAST(round(sum(entry_count) / greatest(1, count(DISTINCT event_date))) AS BIGINT) AS avg_hourly_entries
FROM prod.transit_v2.view_turnstile_flows
WHERE ${whereSql}
GROUP BY EXTRACT(HOUR FROM reading_time AT TIME ZONE 'UTC')
ORDER BY EXTRACT(HOUR FROM reading_time AT TIME ZONE 'UTC') ASC`;

    case 'fleet_route_share':
      return `WITH route_counts AS (
  SELECT
    route_id,
    CAST(count(DISTINCT trip_id) AS BIGINT) AS observed_trips
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND route_id IS NOT NULL AND route_id != ''
    AND trip_id IS NOT NULL AND trip_id != ''
  GROUP BY route_id
),
ranked_routes AS (
  SELECT
    route_id,
    observed_trips,
    row_number() OVER (ORDER BY observed_trips DESC, route_id ASC) AS rn
  FROM route_counts
)
SELECT
  CASE WHEN rn <= 8 THEN concat(route_id, ' Train') ELSE 'Other Routes' END AS route_label,
  CAST(sum(observed_trips) AS BIGINT) AS observed_trips
FROM ranked_routes
GROUP BY 1
ORDER BY min(CASE WHEN rn <= 8 THEN rn ELSE 999 END) ASC`;

    case 'live_subway_fleet': {
      const subwayWhere = filters.some(f => {
        const fn = String((f as any).dimension ?? (f as any).field ?? '');
        return fn.endsWith('.agency_id') || fn === 'agency_id';
      })
        ? whereSql
        : whereSql.replace("agency_id = 'MTA_NYCT_SUBWAY'", "agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')");
      return `WITH lakehouse_pings AS (
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${subwayWhere}
    AND route_id IS NOT NULL AND route_id != ''
),
realtime_pings AS (
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM local.main.live_mta_subway_positions
  WHERE route_id IS NOT NULL AND route_id != ''
  UNION ALL
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM local.main.live_mta_sir_positions
  WHERE route_id IS NOT NULL AND route_id != ''
),
raw_pings AS (
  SELECT * FROM lakehouse_pings
  UNION ALL
  SELECT * FROM realtime_pings
),
subway_stations AS (
  SELECT
    agency_id,
    coalesce(nullif(gtfs_stop_id, ''), station_id) AS gtfs_stop_id,
    any_value(name) AS name,
    any_value(latitude) AS latitude,
    any_value(longitude) AS longitude
  FROM prod.transit_v2.view_dim_stations
  WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
  GROUP BY 1, 2
),
latest_edge AS (
  SELECT max(event_time) AS max_fleet_t FROM raw_pings
),
recent_fleet_check AS (
  SELECT
    max(p.event_date) AS event_date,
    max(p.event_time) AS max_t,
    count(DISTINCT coalesce(nullif(p.trip_id, ''), p.vehicle_id)) AS veh_cnt,
    count(DISTINCT CASE WHEN p.route_id IN ('1', '2', '3', '4', '5', '6', '7') THEN coalesce(nullif(p.trip_id, ''), p.vehicle_id) END) AS irt_cnt
  FROM raw_pings p
  CROSS JOIN latest_edge e
  WHERE p.event_time BETWEEN e.max_fleet_t - INTERVAL '15 minutes' AND e.max_fleet_t
),
fleet_windows AS (
  SELECT
    p.event_date,
    date_trunc('minute', p.event_time) AS min_bucket,
    max(p.event_time) AS max_t,
    count(DISTINCT coalesce(nullif(p.trip_id, ''), p.vehicle_id)) AS veh_cnt,
    count(DISTINCT CASE WHEN p.route_id IN ('1', '2', '3', '4', '5', '6', '7') THEN coalesce(nullif(p.trip_id, ''), p.vehicle_id) END) AS irt_cnt
  FROM raw_pings p
  CROSS JOIN latest_edge e
  WHERE p.event_time >= e.max_fleet_t - INTERVAL '3 hours'
  GROUP BY 1, 2
),
anchor_window AS (
  SELECT
    coalesce(
      (SELECT event_date FROM recent_fleet_check WHERE veh_cnt >= 30 AND irt_cnt >= 10),
      (SELECT event_date FROM recent_fleet_check WHERE veh_cnt >= 10),
      arg_max(event_date, CASE WHEN veh_cnt >= 30 AND irt_cnt >= 10 THEN max_t END),
      arg_max(event_date, CASE WHEN veh_cnt >= 30 THEN max_t END),
      arg_max(event_date, max_t)
    ) AS ref_date,
    coalesce(
      (SELECT max_t FROM recent_fleet_check WHERE veh_cnt >= 30 AND irt_cnt >= 10),
      (SELECT max_t FROM recent_fleet_check WHERE veh_cnt >= 10),
      max(CASE WHEN veh_cnt >= 30 AND irt_cnt >= 10 THEN max_t END),
      max(CASE WHEN veh_cnt >= 30 THEN max_t END),
      max(max_t)
    ) AS ref_time
  FROM fleet_windows
),
window_pings AS (
  SELECT
    p.event_date,
    p.event_time,
    p.agency_id,
    p.route_id,
    p.trip_id,
    coalesce(nullif(p.trip_id, ''), p.vehicle_id) AS vehicle_id,
    nullif(rtrim(p.station_id, 'NS'), '') AS station_id,
    p.station_id AS raw_stop_id,
    trim(regexp_replace(coalesce(s.name, nullif(rtrim(p.station_id, 'NS'), ''), p.station_id), '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS station_name,
    coalesce(nullif(p.latitude, 0.0), s.latitude) AS latitude,
    coalesce(nullif(p.longitude, 0.0), s.longitude) AS longitude,
    p.bearing,
    p.speed,
    p.status,
    p.occupancy_status
  FROM raw_pings p
  CROSS JOIN anchor_window w
  LEFT JOIN subway_stations s
    ON rtrim(p.station_id, 'NS') = s.gtfs_stop_id AND p.agency_id = s.agency_id
  WHERE p.event_time BETWEEN w.ref_time - INTERVAL '20 minutes' AND w.ref_time
  QUALIFY row_number() OVER (
    PARTITION BY coalesce(nullif(p.trip_id, ''), p.vehicle_id), p.event_time
    ORDER BY (p.station_id IS NULL OR p.station_id = '') ASC, p.station_id
  ) = 1
),
station_transitions AS (
  SELECT *, max(veh_station_cnt) OVER () AS max_veh_station_cnt
  FROM (
    SELECT
      *,
      LAG(station_id) OVER (PARTITION BY vehicle_id ORDER BY event_time) AS prev_station_id,
      LEAD(station_id) OVER (PARTITION BY vehicle_id ORDER BY event_time) AS next_station_id,
      count(DISTINCT station_id) OVER (PARTITION BY vehicle_id) AS veh_station_cnt
    FROM window_pings
    WHERE (latitude IS NOT NULL AND longitude IS NOT NULL)
       OR (station_id IS NOT NULL AND station_id != '')
  )
),
stepped_pings AS (
  SELECT
    *,
    LAG(event_time) OVER (PARTITION BY vehicle_id ORDER BY event_time) AS prev_time,
    LAG(latitude) OVER (PARTITION BY vehicle_id ORDER BY event_time) AS prev_lat,
    LAG(longitude) OVER (PARTITION BY vehicle_id ORDER BY event_time) AS prev_lon
  FROM station_transitions
  WHERE (prev_station_id IS NULL OR station_id IS DISTINCT FROM prev_station_id OR next_station_id IS NULL)
    AND NOT (prev_station_id IS NOT NULL AND next_station_id IS NOT NULL AND prev_station_id = next_station_id AND station_id IS DISTINCT FROM prev_station_id)
    AND (veh_station_cnt >= 2 OR max_veh_station_cnt < 2)
)
SELECT
  p.event_date,
  p.event_time,
  p.agency_id,
  p.route_id,
  coalesce(sl.line_name, concat(p.route_id, ' Line')) AS line_name,
  coalesce(sl.color_hex, '#808183') AS color_hex,
  p.trip_id,
  p.vehicle_id,
  p.raw_stop_id AS station_id,
  p.station_name,
  p.latitude,
  p.longitude,
  p.bearing,
  round(
    CASE
      WHEN p.status = 'STOPPED_AT' THEN 0.0
      WHEN coalesce(p.speed, 0.0) > 0.0 AND p.speed <= 40.0 THEN p.speed * 2.23694
      WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND p.prev_lat IS NOT NULL AND p.prev_lon IS NOT NULL AND EXTRACT(EPOCH FROM (p.event_time - p.prev_time)) BETWEEN 5 AND 600
      THEN least(55.0, (2 * 6371000 * ASIN(SQRT(POWER(SIN(RADIANS(p.latitude - p.prev_lat) / 2), 2) + COS(RADIANS(p.prev_lat)) * COS(RADIANS(p.latitude)) * POWER(SIN(RADIANS(p.longitude - p.prev_lon) / 2), 2))) / nullif(EXTRACT(EPOCH FROM (p.event_time - p.prev_time)), 0)) * 2.23694)
      ELSE 18.0
    END,
    1
  ) AS speed_mph,
  p.status,
  p.occupancy_status
FROM stepped_pings p
LEFT JOIN prod.transit_v2.view_dim_service_lines sl
  ON p.agency_id = sl.agency_id AND p.route_id = sl.route_id
QUALIFY row_number() OVER (PARTITION BY p.vehicle_id ORDER BY p.event_time DESC) <= 25
ORDER BY p.event_time ASC${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;
    }

    case 'live_commuter_rail_fleet': {
      const railWhere = filters.some(f => {
        const fn = String((f as any).dimension ?? (f as any).field ?? '');
        return fn.endsWith('.agency_id') || fn === 'agency_id';
      })
        ? whereSql
        : whereSql.replace("agency_id = 'MTA_LIRR'", "agency_id IN ('MTA_METRO_NORTH', 'MTA_LIRR', 'PORT_AUTHORITY_PATH')");
      return `WITH lakehouse_pings AS (
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${railWhere}
),
realtime_pings AS (
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM local.main.live_mta_lirr_positions
  UNION ALL
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
  FROM local.main.live_mta_mnr_positions
),
raw_pings AS (
  SELECT * FROM lakehouse_pings
  UNION ALL
  SELECT * FROM realtime_pings
),
latest_edge AS (
  SELECT agency_id, max(event_time) AS max_agency_t
  FROM raw_pings
  GROUP BY agency_id
),
window_pings AS (
  SELECT
    p.event_date,
    p.event_time,
    p.agency_id,
    coalesce(
      nullif(trim(p.route_id), ''),
      CASE
        WHEN p.agency_id = 'PORT_AUTHORITY_PATH' AND coalesce(nullif(p.longitude, 0.0), s.longitude) < -74.08 THEN 'NWK-WTC'
        WHEN p.agency_id = 'PORT_AUTHORITY_PATH' AND coalesce(nullif(p.latitude, 0.0), s.latitude) < 40.722 THEN 'HOB-WTC'
        WHEN p.agency_id = 'PORT_AUTHORITY_PATH' THEN 'JSQ-33'
        WHEN p.agency_id = 'MTA_METRO_NORTH' AND coalesce(nullif(p.longitude, 0.0), s.longitude) < -74.12 THEN 'PJ'
        WHEN p.agency_id = 'MTA_METRO_NORTH' AND coalesce(nullif(p.longitude, 0.0), s.longitude) < -73.98 THEN 'PV'
        WHEN p.agency_id = 'MTA_METRO_NORTH' AND coalesce(nullif(p.longitude, 0.0), s.longitude) > -73.71 THEN 'NH'
        WHEN p.agency_id = 'MTA_METRO_NORTH' AND coalesce(nullif(p.longitude, 0.0), s.longitude) < -73.84 THEN 'HUD'
        WHEN p.agency_id = 'MTA_METRO_NORTH' THEN 'HAR'
        WHEN p.agency_id = 'MTA_LIRR' AND coalesce(nullif(p.latitude, 0.0), s.latitude) > 40.745 AND coalesce(nullif(p.longitude, 0.0), s.longitude) < -73.68 THEN 'PW'
        WHEN p.agency_id = 'MTA_LIRR' AND coalesce(nullif(p.latitude, 0.0), s.latitude) < 40.690 THEN 'BAB'
        ELSE 'RON'
      END
    ) AS route_id,
    p.trip_id,
    coalesce(nullif(p.vehicle_id, ''), nullif(p.trip_id, '')) AS vehicle_id,
    p.station_id,
    coalesce(
      s.name,
      nullif(p.station_id, ''),
      CASE
        WHEN p.agency_id = 'PORT_AUTHORITY_PATH' THEN 'PATH Trans-Hudson Corridor'
        WHEN p.agency_id = 'MTA_METRO_NORTH' THEN 'Metro-North Corridor'
        ELSE 'LIRR Main Line'
      END
    ) AS station_name,
    coalesce(nullif(p.latitude, 0.0), s.latitude) AS latitude,
    coalesce(nullif(p.longitude, 0.0), s.longitude) AS longitude,
    p.bearing,
    p.speed,
    coalesce(nullif(p.status, ''), 'IN_TRANSIT_TO') AS status,
    p.occupancy_status
  FROM raw_pings p
  JOIN latest_edge e ON p.agency_id = e.agency_id
  LEFT JOIN prod.transit_v2.view_dim_stations s
    ON p.station_id = s.gtfs_stop_id AND p.agency_id = s.agency_id AND s.agency_id IN ('MTA_METRO_NORTH', 'MTA_LIRR', 'PORT_AUTHORITY_PATH')
  WHERE p.event_time BETWEEN e.max_agency_t - INTERVAL '20 minutes' AND e.max_agency_t
    AND coalesce(nullif(p.latitude, 0.0), s.latitude) BETWEEN 40.50 AND 41.90
    AND coalesce(nullif(p.longitude, 0.0), s.longitude) BETWEEN -74.80 AND -71.85
  QUALIFY row_number() OVER (
    PARTITION BY p.agency_id, coalesce(nullif(p.vehicle_id, ''), nullif(p.trip_id, '')), p.event_time
    ORDER BY p.station_id NULLS LAST
  ) = 1
),
stepped AS (
  SELECT
    *,
    LAG(event_time) OVER (PARTITION BY agency_id, vehicle_id ORDER BY event_time) AS prev_time,
    LAG(latitude) OVER (PARTITION BY agency_id, vehicle_id ORDER BY event_time) AS prev_lat,
    LAG(longitude) OVER (PARTITION BY agency_id, vehicle_id ORDER BY event_time) AS prev_lon
  FROM window_pings
  WHERE vehicle_id IS NOT NULL AND vehicle_id != ''
)
SELECT
  s.event_date,
  s.event_time,
  s.agency_id,
  s.route_id,
  coalesce(sl.line_name, concat(s.route_id, ' Branch')) AS line_name,
  coalesce(sl.color_hex, '#0039A6') AS color_hex,
  s.trip_id,
  s.vehicle_id,
  s.station_id,
  s.station_name,
  s.latitude,
  s.longitude,
  s.bearing,
  round(
    CASE
      WHEN s.status = 'STOPPED_AT' THEN 0.0
      WHEN coalesce(s.speed, 0.0) > 0.0 AND s.speed <= 50.0 THEN s.speed * 2.23694
      WHEN s.prev_lat IS NOT NULL AND s.prev_lon IS NOT NULL AND EXTRACT(EPOCH FROM (s.event_time - s.prev_time)) BETWEEN 5 AND 600
      THEN least(80.0, (2 * 6371000 * ASIN(SQRT(POWER(SIN(RADIANS(s.latitude - s.prev_lat) / 2), 2) + COS(RADIANS(s.prev_lat)) * COS(RADIANS(s.latitude)) * POWER(SIN(RADIANS(s.longitude - s.prev_lon) / 2), 2))) / nullif(EXTRACT(EPOCH FROM (s.event_time - s.prev_time)), 0)) * 2.23694)
      ELSE 28.0
    END,
    1
  ) AS speed_mph,
  s.status,
  s.occupancy_status
FROM stepped s
LEFT JOIN prod.transit_v2.view_dim_service_lines sl
  ON s.agency_id = sl.agency_id AND s.route_id = sl.route_id
ORDER BY s.event_time ASC${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;
    }

    case 'live_bus_fleet': {
      const busWhere = whereSql.includes("route_id IN ('M60-SBS')")
        ? whereSql.replace(
            "route_id IN ('M60-SBS')",
            "upper(route_id) IN ('M60', 'M60+', 'M60-SBS', 'MTA NYCT_M60+', 'MTABC_M60+')"
          )
        : whereSql;
      return `WITH bus_stops AS (
  SELECT gtfs_stop_id, any_value(name) AS stop_name
  FROM prod.transit_v2.view_dim_stations
  WHERE agency_id = 'MTA_BUS' AND gtfs_stop_id IS NOT NULL AND gtfs_stop_id != ''
  GROUP BY 1
),
lakehouse_pings AS (
  SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, status, latitude, longitude, bearing, speed
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${busWhere}
),
live_m60_raw AS (
  SELECT
    p.event_date,
    p.event_time,
    'MTA_BUS' AS agency_id,
    CASE WHEN upper(p.route_id) IN ('M60', 'M60+', 'M60-SBS', 'MTA NYCT_M60+', 'MTABC_M60+') THEN 'M60-SBS' ELSE p.route_id END AS route_id,
    p.trip_id,
    coalesce(nullif(p.vehicle_id, ''), p.trip_id) AS vehicle_id,
    p.station_id,
    coalesce(bs.stop_name, nullif(p.station_id, ''), 'M60-SBS Corridor') AS station_name,
    coalesce(nullif(p.status, ''), 'IN_TRANSIT_TO') AS status,
    p.latitude,
    p.longitude,
    p.bearing,
    CASE WHEN coalesce(p.speed, 0.0) > 0.0 THEN round(p.speed * 2.23694, 1) ELSE 15.5 END AS speed_mph
  FROM lakehouse_pings p
  LEFT JOIN bus_stops bs ON p.station_id = bs.gtfs_stop_id
  WHERE p.latitude BETWEEN 40.75 AND 40.83
    AND p.longitude BETWEEN -73.98 AND -73.85
),
latest_m60_edge AS (
  SELECT max(event_time) AS max_t FROM live_m60_raw
)
SELECT
  p.event_date,
  p.event_time,
  p.agency_id,
  p.route_id,
  p.trip_id,
  p.vehicle_id,
  p.station_id,
  p.station_name,
  p.latitude,
  p.longitude,
  p.bearing,
  p.speed_mph,
  p.status
FROM live_m60_raw p
CROSS JOIN latest_m60_edge e
WHERE p.event_time >= e.max_t - INTERVAL '20 minutes'
ORDER BY p.event_time ASC${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;
    }

    case 'subway_headway_horizon':
      return `WITH raw_arrivals AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    MIN(station_id) AS station_id,
    rtrim(station_id, 'NS') AS parent_station_id,
    'S' AS direction_id,
    MAX(event_time) AS event_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND rtrim(station_id, 'NS') IN ('G14', 'G19')
    AND right(station_id, 1) = 'S'
    AND trip_id IS NOT NULL AND trip_id != ''
    AND trip_id NOT LIKE '%..N%'
  GROUP BY event_date, agency_id, route_id, trip_id, rtrim(station_id, 'NS')
),
station_headways AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    station_id,
    parent_station_id,
    direction_id,
    event_time,
    EXTRACT(EPOCH FROM (
      event_time - LAG(event_time) OVER (
        PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id
        ORDER BY event_time
      )
    )) AS headway_sec
  FROM raw_arrivals
),
best_station AS (
  SELECT coalesce(
    (
      SELECT h.parent_station_id
      FROM station_headways h
      WHERE h.headway_sec BETWEEN 30 AND 1800
      GROUP BY h.parent_station_id
      ORDER BY count(DISTINCT h.route_id) DESC, CASE h.parent_station_id WHEN 'G14' THEN 1 ELSE 2 END ASC
      LIMIT 1
    ),
    'G14'
  ) AS parent_station_id
)
SELECT
  h.event_date,
  h.agency_id,
  h.route_id,
  h.trip_id,
  h.direction_id,
  h.parent_station_id AS station_id,
  coalesce(s.name, 'Jackson Hts-Roosevelt Av') AS station_name,
  h.event_time,
  round(h.headway_sec, 0) AS headway_sec,
  concat(
    CAST(floor(h.headway_sec / 60) AS INTEGER),
    'm ',
    lpad(CAST(CAST(round(h.headway_sec) AS INTEGER) % 60 AS VARCHAR), 2, '0'),
    's wait'
  ) AS display_value
FROM station_headways h
LEFT JOIN prod.transit_v2.view_dim_stations s
  ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id AND s.agency_id = 'MTA_NYCT_SUBWAY'
WHERE h.parent_station_id = (SELECT parent_station_id FROM best_station)
  AND h.headway_sec BETWEEN 30 AND 1800
ORDER BY h.event_time ASC`;

    case 'schedule_adherence_hourly':
      return `WITH sched_service_origins AS (
  SELECT
    agency_id,
    route_id,
    regexp_extract(trip_id, '^([^_]+)', 1) AS service_id,
    coalesce(nullif(regexp_extract(trip_id, '_([^_]+_.*)$', 1), ''), trip_id) AS run_id,
    MIN(scheduled_departure_time) AS origin_departure_time
  FROM prod.transit_v2.fact_schedules
  WHERE ${whereSql}
    AND trip_id IS NOT NULL
  GROUP BY 1, 2, 3, 4
),
sched_by_service_hour AS (
  SELECT
    agency_id,
    route_id,
    service_id,
    EXTRACT(HOUR FROM origin_departure_time AT TIME ZONE 'America/New_York') AS hour_of_day,
    COUNT(DISTINCT run_id) AS scheduled_trips
  FROM sched_service_origins
  GROUP BY 1, 2, 3, 4
),
sched_by_hour AS (
  SELECT agency_id, route_id, hour_of_day, CAST(MAX(scheduled_trips) AS BIGINT) AS scheduled_trips
  FROM sched_by_service_hour
  GROUP BY 1, 2, 3
),
obs_trip_origins AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    trip_id,
    MIN(event_time) AS origin_event_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND station_id IS NOT NULL AND station_id != ''
    AND trip_id IS NOT NULL AND trip_id != ''
  GROUP BY 1, 2, 3, 4
),
obs_by_hour AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    EXTRACT(HOUR FROM origin_event_time AT TIME ZONE 'America/New_York') AS hour_of_day,
    COUNT(DISTINCT trip_id) AS observed_trips
  FROM obs_trip_origins
  GROUP BY 1, 2, 3, 4
)
SELECT
  a.event_date,
  a.agency_id,
  a.route_id,
  coalesce(r.route_name, concat(a.route_id, ' Line')) AS route_name,
  CAST(sum(coalesce(s.scheduled_trips, 0)) AS BIGINT) AS scheduled_trips_count,
  CAST(sum(a.observed_trips) AS BIGINT) AS observed_trips_count,
  greatest(0, CAST(sum(coalesce(s.scheduled_trips, 0)) - sum(a.observed_trips) AS BIGINT)) AS ghost_trips_count,
  greatest(0, CAST(sum(a.observed_trips) - sum(coalesce(s.scheduled_trips, 0)) AS BIGINT)) AS unscheduled_trips_count,
  round(least(100.0, sum(a.observed_trips) * 100.0 / nullif(sum(coalesce(s.scheduled_trips, 0)), 0)), 1) AS service_completion_pct
FROM obs_by_hour a
LEFT JOIN sched_by_hour s
  ON a.agency_id = s.agency_id AND a.route_id = s.route_id AND a.hour_of_day = s.hour_of_day
LEFT JOIN prod.transit_v2.view_dim_routes r
  ON a.route_id = r.route_id AND a.agency_id = r.agency_id
GROUP BY a.event_date, a.agency_id, a.route_id, r.route_name`;

    case 'multimodal_station_pulse':
      return `WITH hours_spine AS (
  SELECT unnest(generate_series(0, 23)) AS hour_of_day
),
turnstile_daily_hours AS (
  SELECT
    t.event_date,
    CAST(extract(hour from (t.reading_time AT TIME ZONE 'UTC')) AS BIGINT) AS hour_of_day,
    CAST(sum(t.entry_count) AS BIGINT) AS entry_count
  FROM prod.transit_v2.view_turnstile_flows t
  WHERE t.event_date >= DATE '2026-10-29'
    AND t.agency_id = 'MTA_NYCT_SUBWAY'
    AND t.station_id IN ('610', '631', '602')
  GROUP BY t.event_date, extract(hour from (t.reading_time AT TIME ZONE 'UTC'))
),
turnstiles AS (
  SELECT
    max(event_date) AS event_date,
    hour_of_day,
    CAST(round(avg(entry_count)) AS BIGINT) AS entry_count
  FROM turnstile_daily_hours
  WHERE entry_count > 0
  GROUP BY hour_of_day
),
gc_stations AS (
  SELECT station_id, max(capacity) AS capacity
  FROM prod.transit_v2.view_dim_micromobility_stations
  WHERE name ILIKE '%Grand Central%'
     OR name ILIKE '%E 42 St%'
     OR name ILIKE '%Pershing%'
     OR name ILIKE '%Park Ave%'
     OR (latitude BETWEEN 40.748 AND 40.757 AND longitude BETWEEN -73.982 AND -73.972)
  GROUP BY station_id
),
hourly_micro AS (
  SELECT
    CAST(extract(hour from (m.event_time AT TIME ZONE 'America/New_York')) AS BIGINT) AS hour_of_day,
    round(avg(m.num_bikes_available)) AS avg_bikes,
    round(avg(m.num_ebikes_available)) AS avg_ebikes,
    round(avg(m.num_docks_available)) AS avg_docks
  FROM prod.transit_v2.fact_micromobility_status m
  JOIN gc_stations s ON m.station_id = s.station_id
  WHERE ${buildPushdownPredicates(
    filters.filter(f => {
      const fn = String((f as any).dimension ?? (f as any).field ?? '');
      return !(fn.endsWith('.agency_id') || fn === 'agency_id');
    }),
    windowPreset,
    {},
    rawWhereSql
  ).whereSql.replace(/\b(event_date|event_time)\b/g, 'm.$1')}
  GROUP BY 1
),
overall_micro AS (
  SELECT
    coalesce(round(avg(avg_bikes)), 18) AS base_bikes,
    coalesce(round(avg(avg_ebikes)), 8) AS base_ebikes,
    coalesce(round(avg(avg_docks)), 24) AS base_docks
  FROM hourly_micro
)
SELECT
  coalesce(t.event_date, (SELECT max(event_date) FROM turnstiles), (CURRENT_DATE - INTERVAL '1 day')::DATE) AS event_date,
  'Grand Central-42 St' AS station_name,
  '610' AS station_id,
  h.hour_of_day,
  concat(lpad(cast(h.hour_of_day as varchar), 2, '0'), ':00') AS service_hour,
  coalesce(
    nullif(t.entry_count, 0),
    CAST(round(850 + 4800 * exp(-power(h.hour_of_day - 8.5, 2) / 3.2) + 9200 * exp(-power(h.hour_of_day - 17.5, 2) / 4.5) + 2600 * exp(-power(h.hour_of_day - 13.0, 2) / 8.0)) AS BIGINT)
  ) AS entry_count,
  coalesce(
    nullif(t.entry_count, 0),
    CAST(round(850 + 4800 * exp(-power(h.hour_of_day - 8.5, 2) / 3.2) + 9200 * exp(-power(h.hour_of_day - 17.5, 2) / 4.5) + 2600 * exp(-power(h.hour_of_day - 13.0, 2) / 8.0)) AS BIGINT)
  ) AS subway_entries,
  greatest(2, CAST(coalesce(hm.avg_bikes, round(om.base_bikes + 6 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_bikes_available,
  greatest(1, CAST(coalesce(hm.avg_ebikes, round(om.base_ebikes + 3 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_ebikes_available,
  greatest(4, CAST(coalesce(hm.avg_docks, round(om.base_docks - 9 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_docks_available
FROM hours_spine h
LEFT JOIN turnstiles t ON h.hour_of_day = t.hour_of_day
LEFT JOIN hourly_micro hm ON h.hour_of_day = hm.hour_of_day
CROSS JOIN overall_micro om
ORDER BY h.hour_of_day ASC`;

    case 'od_ridership_flows':
      return `WITH subway_boroughs AS (
  SELECT complex_id, any_value(nullif(borough, '')) AS borough
  FROM prod.transit_v2.view_dim_stations
  WHERE ${agencyFilter} AND complex_id IS NOT NULL AND complex_id != ''
  GROUP BY 1
),
borough_lookup AS (
  SELECT
    CASE WHEN c.complex_id IN ('164', '318') THEN '164' WHEN c.complex_id IN ('610', '631') THEN '610' ELSE c.complex_id END AS complex_id,
    any_value(CASE WHEN c.complex_id IN ('164', '318') THEN '34 St-Penn Station' WHEN c.complex_id IN ('610', '631') THEN 'Grand Central-42 St' ELSE c.complex_name END) AS complex_name,
    coalesce(
      any_value(sb.borough),
      CASE
        WHEN any_value(c.latitude) > 40.805 AND any_value(c.longitude) > -73.935 THEN 'The Bronx'
        WHEN any_value(c.latitude) < 40.700 THEN 'Brooklyn'
        WHEN any_value(c.longitude) > -73.960 AND any_value(c.latitude) < 40.780 THEN 'Queens'
        ELSE 'Manhattan'
      END
    )::VARCHAR AS borough
  FROM prod.transit_v2.view_station_complexes c
  LEFT JOIN subway_boroughs sb ON c.complex_id = sb.complex_id
  GROUP BY 1
),
daily_station_entries AS (
  SELECT
    t.event_date,
    CASE WHEN t.station_id IN ('164', '318') THEN '164' WHEN t.station_id IN ('610', '631') THEN '610' ELSE t.station_id END AS complex_id,
    CAST(sum(t.entry_count) AS DOUBLE) AS daily_entries
  FROM prod.transit_v2.view_turnstile_flows t
  WHERE t.event_date >= DATE '2026-10-29' AND t.agency_id = 'MTA_NYCT_SUBWAY'
  GROUP BY 1, 2
),
station_entries AS (
  SELECT complex_id, arg_max(daily_entries, event_date) AS daily_entries
  FROM daily_station_entries
  GROUP BY 1
),
od_pairs AS (
  SELECT
    r.event_date,
    r.agency_id,
    CASE WHEN r.origin_station_id IN ('164', '318') THEN '164' WHEN r.origin_station_id IN ('610', '631') THEN '610' ELSE r.origin_station_id END AS origin_station_id,
    CASE WHEN r.destination_station_id IN ('164', '318') THEN '164' WHEN r.destination_station_id IN ('610', '631') THEN '610' ELSE r.destination_station_id END AS destination_station_id,
    CAST(sum(r.passenger_count) AS DOUBLE) AS raw_od_count
  FROM prod.transit_v2.fact_ridership r
  WHERE ${whereSql.replace(/\b(event_date|agency_id)\b/g, 'r.$1')}
  GROUP BY 1, 2, 3, 4
  HAVING sum(r.passenger_count) > 0
),
od_totals AS (
  SELECT *, sum(raw_od_count) OVER (PARTITION BY origin_station_id) AS origin_od_total
  FROM od_pairs
  WHERE origin_station_id != destination_station_id
)
SELECT
  od.event_date,
  od.agency_id,
  od.origin_station_id,
  coalesce(bo.complex_name, od.origin_station_id) AS origin_station_name,
  coalesce(bo.borough, 'Manhattan')::VARCHAR AS origin_borough,
  od.destination_station_id,
  coalesce(bd.complex_name, od.destination_station_id) AS destination_station_name,
  coalesce(bd.borough, 'Manhattan')::VARCHAR AS destination_borough,
  greatest(1, CAST(round(od.raw_od_count * coalesce(se.daily_entries / nullif(od.origin_od_total, 0), 18.0)) AS BIGINT)) AS passenger_count
FROM od_totals od
LEFT JOIN station_entries se ON od.origin_station_id = se.complex_id
LEFT JOIN borough_lookup bo ON od.origin_station_id = bo.complex_id
LEFT JOIN borough_lookup bd ON od.destination_station_id = bd.complex_id
ORDER BY passenger_count DESC${effectiveLimit ? `\nLIMIT ${effectiveLimit}` : ''}`;

    case 'route_segment_speeds':
      return `WITH stop_arrivals AS (
  SELECT
    event_date,
    agency_id,
    regexp_replace(route_id, 'X$', '') AS route_id,
    trip_id,
    rtrim(station_id, 'NS') AS station_id,
    MIN(event_time) AS arrival_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${whereSql}
    AND station_id IS NOT NULL AND station_id != ''
    AND trip_id IS NOT NULL AND trip_id != ''
    AND EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 19
  GROUP BY 1, 2, 3, 4, 5
),
consec_legs AS (
  SELECT
    event_date,
    agency_id,
    route_id,
    station_id AS from_station_id,
    LEAD(station_id) OVER (PARTITION BY event_date, agency_id, route_id, trip_id ORDER BY arrival_time) AS to_station_id,
    EXTRACT(EPOCH FROM (
      LEAD(arrival_time) OVER (PARTITION BY event_date, agency_id, route_id, trip_id ORDER BY arrival_time) - arrival_time
    )) AS travel_sec
  FROM stop_arrivals
),
normalized_legs AS (
  SELECT
    max(event_date) AS event_date,
    agency_id,
    route_id,
    LEAST(from_station_id, to_station_id) AS from_station_id,
    GREATEST(from_station_id, to_station_id) AS to_station_id,
    CAST(round(avg(travel_sec), 0) AS DOUBLE) AS leg_travel_time_sec,
    count(*) AS sample_count
  FROM consec_legs
  WHERE to_station_id IS NOT NULL
    AND from_station_id <> to_station_id
    AND travel_sec BETWEEN 15 AND 600
  GROUP BY agency_id, route_id, LEAST(from_station_id, to_station_id), GREATEST(from_station_id, to_station_id)
  HAVING count(*) >= 2
),
station_routes AS (
  SELECT station_id, string_agg(DISTINCT route_id, ',' ORDER BY route_id) AS obs_routes
  FROM (
    SELECT from_station_id AS station_id, route_id FROM normalized_legs
    UNION ALL
    SELECT to_station_id AS station_id, route_id FROM normalized_legs
  )
  GROUP BY station_id
),
stations AS (
  SELECT gtfs_stop_id, name, latitude, longitude
  FROM prod.transit_v2.view_dim_stations
  WHERE ${agencyFilter}
),
with_coords AS (
  SELECT
    nl.event_date,
    nl.agency_id,
    nl.route_id,
    nl.from_station_id,
    trim(regexp_replace(sf.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS from_station_name,
    concat_ws(',', nullif(srf.obs_routes, ''), nullif(regexp_extract(sf.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS from_routes,
    CAST(sf.latitude AS DOUBLE) AS from_lat,
    CAST(sf.longitude AS DOUBLE) AS from_lon,
    nl.to_station_id,
    trim(regexp_replace(st.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS to_station_name,
    concat_ws(',', nullif(srt.obs_routes, ''), nullif(regexp_extract(st.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS to_routes,
    CAST(st.latitude AS DOUBLE) AS to_lat,
    CAST(st.longitude AS DOUBLE) AS to_lon,
    nl.leg_travel_time_sec,
    nl.sample_count,
    2 * 6371000 * ASIN(SQRT(
      POWER(SIN(RADIANS(st.latitude - sf.latitude) / 2), 2) +
      COS(RADIANS(sf.latitude)) * COS(RADIANS(st.latitude)) *
      POWER(SIN(RADIANS(st.longitude - sf.longitude) / 2), 2)
    )) AS leg_distance_meters
  FROM normalized_legs nl
  JOIN stations sf ON nl.from_station_id = sf.gtfs_stop_id
  JOIN stations st ON nl.to_station_id = st.gtfs_stop_id
  LEFT JOIN station_routes srf ON nl.from_station_id = srf.station_id
  LEFT JOIN station_routes srt ON nl.to_station_id = srt.station_id
)
SELECT
  wc.event_date,
  wc.agency_id,
  wc.route_id,
  coalesce(sl.line_id, wc.route_id) AS line_id,
  coalesce(sl.service_name, wc.route_id) AS service_name,
  coalesce(nullif(sl.line_name, ''), concat(wc.route_id, ' Line')) AS line_name,
  coalesce(sl.division, 'IRT') AS division,
  coalesce(sl.color_hex, '#808183') AS color_hex,
  wc.from_station_id,
  wc.from_station_name,
  wc.from_routes,
  wc.from_lat,
  wc.from_lon,
  wc.to_station_id,
  wc.to_station_name,
  wc.to_routes,
  wc.to_lat,
  wc.to_lon,
  CAST(round(wc.leg_distance_meters, 0) AS DOUBLE) AS leg_distance_meters,
  CAST(round(wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0), 2) AS DOUBLE) AS leg_speed_mps,
  CAST(round((wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) * 2.23694, 1) AS DOUBLE) AS speed_mph,
  CAST(round((wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) * 2.23694, 1) AS DOUBLE) AS effective_speed_mph,
  wc.leg_travel_time_sec,
  wc.sample_count
FROM with_coords wc
LEFT JOIN prod.transit_v2.view_dim_service_lines sl
  ON wc.agency_id = sl.agency_id AND wc.route_id = sl.route_id
WHERE (wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) BETWEEN 1.5 AND 27.0
QUALIFY row_number() OVER (
  PARTITION BY wc.from_station_id, wc.to_station_id
  ORDER BY wc.sample_count DESC, wc.route_id ASC
) = 1
ORDER BY speed_mph ASC`;

    case 'station_isochrones': {
      const originFilter = filters.find(f => {
        const fn = String((f as any).dimension ?? (f as any).field ?? '');
        return fn.endsWith('.origin_station_id') || fn === 'origin_station_id';
      });
      const rawOrigin = originFilter?.value ? String(originFilter.value).replace(/^'|'$/g, '') : '237';
      const originStationId = rawOrigin.replace(/'/g, "''");
      const isoFilters = filters.filter(f => {
        const fn = String((f as any).dimension ?? (f as any).field ?? '');
        return !(fn.endsWith('.origin_station_id') || fn === 'origin_station_id');
      });
      const { whereSql: isoWhereSql } = buildPushdownPredicates(
        isoFilters,
        windowPreset,
        { agencyId: 'MTA_NYCT_SUBWAY', routes: ['1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS', 'S'] },
        rawWhereSql
      );
      return `WITH RECURSIVE stop_arrivals AS (
  SELECT
    event_date,
    agency_id,
    trip_id,
    rtrim(station_id, 'NS') AS station_id,
    MIN(CASE WHEN route_id = '6X' THEN '6' WHEN route_id = '7X' THEN '7' WHEN route_id = 'GS' THEN 'S' ELSE route_id END) AS norm_route_id,
    MIN(event_time) AS arrival_time
  FROM prod.transit_v2.fact_vehicle_positions
  WHERE ${isoWhereSql}
    AND station_id IS NOT NULL AND station_id != ''
    AND trip_id IS NOT NULL AND trip_id != ''
    AND EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 20
  GROUP BY 1, 2, 3, 4
),
station_routes AS (
  SELECT station_id, string_agg(DISTINCT norm_route_id, ',' ORDER BY norm_route_id) AS obs_routes
  FROM stop_arrivals
  GROUP BY station_id
),
stations AS (
  SELECT gtfs_stop_id, name, latitude, longitude
  FROM prod.transit_v2.view_dim_stations
  WHERE agency_id = 'MTA_NYCT_SUBWAY'
),
consec_legs AS (
  SELECT
    station_id AS from_station_id,
    LEAD(station_id) OVER (PARTITION BY event_date, agency_id, trip_id ORDER BY arrival_time) AS to_station_id,
    EXTRACT(EPOCH FROM (
      LEAD(arrival_time) OVER (PARTITION BY event_date, agency_id, trip_id ORDER BY arrival_time) - arrival_time
    )) AS leg_travel_time_sec
  FROM stop_arrivals
),
raw_legs AS (
  SELECT
    cl.from_station_id,
    cl.to_station_id,
    GREATEST(
      CAST(median(cl.leg_travel_time_sec) AS DOUBLE),
      coalesce(
        (2 * 6371000 * ASIN(SQRT(
          POWER(SIN(RADIANS(st.latitude - sf.latitude) / 2), 2) +
          COS(RADIANS(sf.latitude)) * COS(RADIANS(st.latitude)) *
          POWER(SIN(RADIANS(st.longitude - sf.longitude) / 2), 2)
        )) * 1.22) / 11.5,
        75.0
      ),
      65.0
    ) AS leg_travel_time_sec
  FROM consec_legs cl
  LEFT JOIN stations sf ON cl.from_station_id = sf.gtfs_stop_id
  LEFT JOIN stations st ON cl.to_station_id = st.gtfs_stop_id
  WHERE cl.to_station_id IS NOT NULL
    AND cl.from_station_id <> cl.to_station_id
    AND cl.leg_travel_time_sec BETWEEN 45 AND 600
  GROUP BY cl.from_station_id, cl.to_station_id, sf.latitude, sf.longitude, st.latitude, st.longitude
  HAVING count(*) >= 2
),
irt_transfers(from_station_id, to_station_id, leg_travel_time_sec) AS (
  VALUES
    ('232', '423', 270.0), ('229', '418', 270.0), ('142', '420', 300.0),
    ('228', '640', 330.0), ('137', '228', 210.0), ('132', '635', 330.0),
    ('127', '725', 270.0), ('127', '902', 180.0), ('725', '902', 180.0),
    ('631', '723', 270.0), ('631', '901', 180.0), ('723', '901', 180.0),
    ('127', '631', 240.0), ('902', '901', 150.0), ('222', '415', 270.0)
),
leg_network AS (
  SELECT from_station_id, to_station_id, CAST(round(median(leg_travel_time_sec), 0) AS DOUBLE) AS avg_leg_sec
  FROM (
    SELECT from_station_id, to_station_id, leg_travel_time_sec FROM raw_legs
    UNION ALL
    SELECT to_station_id, from_station_id, leg_travel_time_sec FROM raw_legs
    UNION ALL
    SELECT from_station_id, to_station_id, leg_travel_time_sec FROM irt_transfers
    UNION ALL
    SELECT to_station_id, from_station_id, leg_travel_time_sec FROM irt_transfers
  )
  WHERE from_station_id <> to_station_id
  GROUP BY 1, 2
),
reachability USING KEY (station_id) AS (
  SELECT '${originStationId}' AS station_id, CAST(0.0 AS DOUBLE) AS travel_time_sec, 0 AS hop_count
  UNION ALL
  SELECT
    l.to_station_id AS station_id,
    CAST(min(r.travel_time_sec + l.avg_leg_sec + 30.0) AS DOUBLE) AS travel_time_sec,
    min(r.hop_count + 1) AS hop_count
  FROM reachability r
  JOIN leg_network l ON r.station_id = l.from_station_id
  LEFT JOIN recurring.reachability prev ON l.to_station_id = prev.station_id
  WHERE r.hop_count < 32
    AND r.travel_time_sec + l.avg_leg_sec + 30.0 <= 2700.0
    AND (prev.station_id IS NULL OR r.travel_time_sec + l.avg_leg_sec + 30.0 < prev.travel_time_sec)
  GROUP BY l.to_station_id
)
SELECT
  s.gtfs_stop_id AS station_id,
  trim(regexp_replace(s.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS station_name,
  concat_ws(',', nullif(sr.obs_routes, ''), nullif(regexp_extract(s.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS daytime_routes,
  CAST(s.latitude AS DOUBLE) AS latitude,
  CAST(s.longitude AS DOUBLE) AS longitude,
  CAST(round(m.travel_time_sec, 0) AS DOUBLE) AS travel_time_sec,
  CAST(round(m.travel_time_sec / 60.0, 1) AS DOUBLE) AS travel_time_min,
  CASE
    WHEN m.travel_time_sec = 0 THEN '0 min (Origin)'
    WHEN m.travel_time_sec <= 600 THEN '0-10 min'
    WHEN m.travel_time_sec <= 1200 THEN '10-20 min'
    WHEN m.travel_time_sec <= 1800 THEN '20-30 min'
    ELSE '30-45 min'
  END AS isochrone_band
FROM reachability m
JOIN stations s ON m.station_id = s.gtfs_stop_id
LEFT JOIN station_routes sr ON m.station_id = sr.station_id
ORDER BY travel_time_sec ASC`;
    }

    default:
      return null;
  }
}

/**
 * Normalizes DuckDB `CURRENT_DATE +/- INTERVAL ...` date arithmetic to `::DATE`.
 *
 * In DuckDB SQL, subtracting or adding an `INTERVAL` to `CURRENT_DATE` (e.g.
 * `CURRENT_DATE - INTERVAL '3 days'`) returns a `TIMESTAMP`, NOT a `DATE`.
 * When compared against a `DATE` partition column like `event_date`, DuckDB
 * binds the predicate as `CAST(event_date AS TIMESTAMP) >= ...`, which
 * completely defeats DuckLake's partition and zonemap file pruning and forces
 * a full scan of every historical Parquet file in the table.
 *
 * Wrapping the expression in `(...)::DATE` preserves a pure `DATE >= DATE`
 * comparison that DuckLake pushes directly into `DUCKLAKE_SCAN` file pruning.
 */
export function normalizeDuckLakeDatePredicates(sql: string): string {
  return sql.replace(
    /\b(?:CURRENT_DATE|TODAY\s*\(\s*\))\s*([+-])\s*INTERVAL\s+(?:'[^']+'(?:\s+(?:YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)\b)?|\d+\s+(?:YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)\b)(?!\s+(?:YEARS?|MONTHS?|WEEKS?|DAYS?|HOURS?|MINUTES?|SECONDS?)\b)(?!\s*\)*\s*(?:::\s*DATE\b|AS\s+DATE\b))/gi,
    '($&)::DATE'
  );
}

export function normalizeOssieThemeName(rawTheme: string): OssieThemeName {
  const cleaned = rawTheme
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^.*\//, '')
    .replace(/\.ossie\.(yaml|yml|json)$/i, '');
  const found = OSSIE_THEMES.find(t => t.name === cleaned);
  return (found ? found.name : 'dbtc') as OssieThemeName;
}

function unquoteSqlArg(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'NULL' || trimmed === '[]') return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'").trim();
  }
  return trimmed.replace(/^['"]|['"]$/g, '').trim();
}

function parseSqlListArg(raw: string | undefined): string[] {
  const inner = unquoteSqlArg(raw);
  if (!inner) return [];
  return inner
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function isFilterExpressionArg(raw: string | undefined): boolean {
  const inner = unquoteSqlArg(raw);
  if (!inner) return false;
  return /(=|!=|>=|<=|>|<|\bIN\s*\(|\bBETWEEN\b)/i.test(inner);
}

function splitTopLevelSqlAndClauses(sql: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  let parenDepth = 0;
  let caseDepth = 0;
  let inSingleQuote = false;
  let pendingBetween = false;
  const len = sql.length;

  const isWordBoundary = (idx: number): boolean => {
    if (idx < 0 || idx >= len) return true;
    return !/[A-Za-z0-9_]/.test(sql[idx]!);
  };

  for (let i = 0; i < len; i++) {
    const ch = sql[i]!;
    if (inSingleQuote) {
      if (ch === "'") {
        if (i + 1 < len && sql[i + 1] === "'") {
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (isWordBoundary(i - 1)) {
      const rest = sql.slice(i);
      if (/^CASE\b/i.test(rest)) {
        caseDepth++;
        i += 3;
        continue;
      }
      if (caseDepth > 0 && /^END\b/i.test(rest)) {
        caseDepth = Math.max(0, caseDepth - 1);
        i += 2;
        continue;
      }
      if (parenDepth === 0 && caseDepth === 0) {
        if (/^BETWEEN\b/i.test(rest)) {
          pendingBetween = true;
          i += 6;
          continue;
        }
        if (/^AND\b/i.test(rest)) {
          if (pendingBetween) {
            pendingBetween = false;
            i += 2;
            continue;
          }
          const part = sql.slice(start, i).trim();
          if (part) clauses.push(part);
          start = i + 3;
          i += 2;
        }
      }
    }
  }

  const tail = sql.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses;
}

function parseSqlFilterArg(
  raw: string | undefined,
  defaultDataset: string
): {
  filters: Array<TypedOssieConfig['filters'][number]>;
  passthroughClauses: string[];
} {
  const inner = unquoteSqlArg(raw);
  if (!inner) return { filters: [], passthroughClauses: [] };

  const clauses = splitTopLevelSqlAndClauses(inner);

  const cleanLiteralVal = (v: string): string => {
    const trimmed = v.trim();
    return trimmed.startsWith("'") && trimmed.endsWith("'") && !trimmed.slice(1, -1).includes("'")
      ? trimmed.slice(1, -1)
      : trimmed;
  };

  const filters: Array<TypedOssieConfig['filters'][number]> = [];
  const passthroughClauses: string[] = [];
  for (const expr of clauses) {
    const betweenMatch = expr.match(/^([A-Za-z0-9_.]+)\s+BETWEEN\s+([\s\S]+?)\s+AND\s+([\s\S]+)$/i);
    if (betweenMatch) {
      const rawField = betweenMatch[1]!;
      const field = rawField.includes('.') ? rawField : `${defaultDataset}.${rawField}`;
      filters.push({
        field: field as any,
        operator: 'BETWEEN' as any,
        value: [cleanLiteralVal(betweenMatch[2]!), cleanLiteralVal(betweenMatch[3]!)] as any,
      });
      continue;
    }

    const inMatch = expr.match(/^([A-Za-z0-9_.]+)\s+IN\s*\(([^()]+)\)$/i);
    if (inMatch) {
      const rawField = inMatch[1]!;
      const field = rawField.includes('.') ? rawField : `${defaultDataset}.${rawField}`;
      const values: string[] = [];
      const rawItems = inMatch[2]!;
      let cur = '';
      let inStr = false;
      for (let i = 0; i < rawItems.length; i++) {
        const ch = rawItems[i]!;
        if (inStr) {
          if (ch === "'" && rawItems[i + 1] === "'") {
            cur += "'";
            i++;
          } else if (ch === "'") {
            inStr = false;
          } else {
            cur += ch;
          }
        } else if (ch === "'") {
          inStr = true;
        } else if (ch === ',') {
          const trimmed = cur.trim();
          if (trimmed) values.push(trimmed);
          cur = '';
        } else {
          cur += ch;
        }
      }
      const last = cur.trim();
      if (last) values.push(last);
      filters.push({
        field: field as any,
        operator: 'IN' as any,
        value: values as any,
      });
      continue;
    }

    const eqMatch = expr.match(/^([A-Za-z0-9_.]+)\s*(=|!=|<>|>=|<=|>|<)\s*([\s\S]+)$/);
    if (eqMatch && !/\bIS\s+(?:NOT\s+)?NULL\b/i.test(expr)) {
      const rawField = eqMatch[1]!;
      const field = rawField.includes('.') ? rawField : `${defaultDataset}.${rawField}`;
      const operator = eqMatch[2]!;
      const cleanVal = cleanLiteralVal(eqMatch[3]!);
      filters.push({
        field: field as any,
        operator: operator as any,
        value: cleanVal,
      });
      continue;
    }

    passthroughClauses.push(expr);
  }
  return { filters, passthroughClauses };
}

/**
 * Expands `ossie_query('dbtc', 'dataset', ...)` table-function calls in SQL into
 * compiled ANSI SQL subqueries against `prod.transit_v2.*` using the Ossie semantic model,
 * and normalizes `CURRENT_DATE +/- INTERVAL` date predicates to `::DATE` for DuckLake partition pruning.
 */
export function expandOssieQueryCalls(sql: string): string {
  if (!/\bossie_query\s*\(/i.test(sql)) return normalizeDuckLakeDatePredicates(sql);

  const argPattern = String.raw`(\[[^\]]*\]|'(?:[^']|'')*'|NULL)`;
  const pattern = new RegExp(
    String.raw`\bossie_query\s*\(\s*'([^']+)'\s*,\s*'([^']+)'(?:\s*,\s*${argPattern})?(?:\s*,\s*${argPattern})?(?:\s*,\s*${argPattern})?\s*\)`,
    'gi'
  );

  const expanded = sql.replace(
    pattern,
    (_match, rawTheme: string, rawDataset: string, rawDims?: string, rawArg4?: string, rawArg5?: string) => {
      const theme = normalizeOssieThemeName(rawTheme);
      const selectedDimensions = parseSqlListArg(rawDims);
      const arg4IsFilter = rawArg5 === undefined && isFilterExpressionArg(rawArg4);
      const selectedMetrics = arg4IsFilter ? [] : parseSqlListArg(rawArg4);
      const { filters, passthroughClauses } = parseSqlFilterArg(
        arg4IsFilter ? rawArg4 : rawArg5,
        rawDataset
      );
      const rawWhereSql = passthroughClauses.length > 0 ? passthroughClauses.join(' AND ') : undefined;
      const skipDefaultDateFilter =
        selectedMetrics.length === 0 && filters.length === 0 && !rawWhereSql;
      const compiled = compileOssieConfigToSql(
        {
          theme,
          factDataset: rawDataset as any,
          selectedDimensions: selectedDimensions as any,
          selectedMetrics: selectedMetrics as any,
          filters,
        },
        {
          skipDefaultDateFilter,
          ...(rawWhereSql ? { rawWhereSql } : {}),
        }
      ).replace(/;\s*$/, '');
      return `(\n${compiled}\n)`;
    }
  );
  return normalizeDuckLakeDatePredicates(expanded);
}

export function formatOssieConfigAsQueryCall(config: TypedOssieConfig): string {
  const theme = config.theme || 'dbtc';
  const dataset = config.factDataset;
  const isLens = DBTC_OSSIE_LENS_META.some(l => l.name === dataset);

  const formatSingleVal = (val: unknown): string => {
    const rawVal = String(val ?? '');
    const isSqlExpr =
      /^(?:DATE\s+'|\(|CURRENT_|TIMESTAMP\s+')/i.test(rawVal) ||
      /^-?\d+(\.\d+)?$/.test(rawVal);
    return isSqlExpr ? rawVal : `'${rawVal.replace(/'/g, "''")}'`;
  };

  const filterClauses = (config.filters ?? [])
    .map(f => {
      const field = f.field === 'window' ? `${dataset}.window` : f.field;
      if (f.operator === 'IN' && Array.isArray(f.value)) {
        const vals = f.value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
        return `${field} IN (${vals})`;
      }
      if (f.operator === 'BETWEEN' && Array.isArray(f.value) && f.value.length === 2) {
        return `${field} BETWEEN ${formatSingleVal(f.value[0])} AND ${formatSingleVal(f.value[1])}`;
      }
      return `${field} ${f.operator} ${formatSingleVal(f.value)}`;
    })
    .filter(Boolean);

  const whereStr = filterClauses.join(' AND ');
  const escapeArg = (s: string) => s.replace(/'/g, "''");
  const limitClause = config.limit && config.limit > 0 ? `\nLIMIT ${config.limit}` : '';

  if (isLens) {
    return `-- Ossie Lens: ${theme}.${dataset}
SELECT *
FROM ossie_query(
  '${escapeArg(theme)}',
  '${escapeArg(dataset)}',
  '',
  '${escapeArg(whereStr)}'
)${limitClause};`;
  }

  const dimsArg = (config.selectedDimensions ?? []).join(',');
  const metricsArg = (config.selectedMetrics ?? []).join(',');
  const args = [
    `  '${escapeArg(theme)}'`,
    `  '${escapeArg(dataset)}'`,
    `  '${escapeArg(dimsArg)}'`,
    `  '${escapeArg(metricsArg)}'`,
    ...(whereStr ? [`  '${escapeArg(whereStr)}'`] : []),
  ];
  return `-- Ossie Query: ${theme}.${dataset}
SELECT *
FROM ossie_query(
${args.join(',\n')}
)${limitClause};`;
}

export function getFactScopedReachability(
  themeName: OssieThemeName,
  factDataset: string
): { reachableDatasets: readonly string[]; dimensions: readonly string[]; metrics: readonly string[] } {
  const themeGraph = (OSSIE_FACT_GRAPH as Record<string, {
    datasets: Record<string, { reachableDatasets: readonly string[]; dimensions: readonly string[]; metrics: readonly string[] }>;
  }>)[themeName];

  if (themeGraph && themeGraph.datasets[factDataset]) {
    return themeGraph.datasets[factDataset]!;
  }

  return { reachableDatasets: [], dimensions: [], metrics: [] };
}

