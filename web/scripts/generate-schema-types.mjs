import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');

const versionGoPath = path.join(repoRoot, 'pkg/schema/version.go');
const tablesGoPath = path.join(repoRoot, 'pkg/schema/tables.go');
const colorsPluginGoPath = path.join(repoRoot, 'internal/sources/mta/colors/plugin.go');
const ossieDir = path.join(repoRoot, 'pkg/semantic/ossie/ducklake');
const targetFile = path.join(webRoot, 'src/types/straphanger-schema.gen.ts');

const isCheck = process.argv.includes('--check');

function defaultTextColorForHex(hex) {
  const upper = String(hex || '').trim().toUpperCase();
  if (['#FCCC0A', '#CE8E00', '#00B2A9', '#00A1DE', '#FF9900', '#F9A51A', '#FFD411', '#65C100'].includes(upper)) {
    return '#000000';
  }
  return '#FFFFFF';
}

function parseGoAliases(raw) {
  if (!raw || raw.trim() === 'nil') return [];
  const matches = [...raw.matchAll(/"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

function parseColorsPluginMetadata(goContent) {
  const metaMap = new Map();

  const subwayBlock = goContent.match(/subwaySpecs\s*:=\s*\[\]struct\s*\{[\s\S]*?\}\s*\{([\s\S]*?)\n\t\}/);
  if (subwayBlock) {
    const rowRe = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(true|false)\s*,\s*(nil|\[\]string\{[^}]*\})\s*\}/g;
    for (const m of subwayBlock[1].matchAll(rowRe)) {
      const id = m[1];
      let bullet = id;
      if (id === '6X') bullet = '6';
      else if (id === '7X') bullet = '7';
      else if (id === 'FX') bullet = 'F';
      else if (id === 'GS' || id === 'FS' || id === 'H') bullet = 'S';
      else if (id === 'SI' || id === 'SS') bullet = 'SIR';
      metaMap.set(`MTA_NYCT_SUBWAY:${id}`, {
        bulletCode: bullet,
        textColorHex: defaultTextColorForHex(m[3]),
        division: m[4],
        trunkGroup: m[5],
        tauranacColorHex: m[6],
        ind1953ColorHex: m[7],
        isDiamond: m[8] === 'true',
        aliases: parseGoAliases(m[9]),
      });
    }
  }

  for (const sirId of ['SI', 'SIR']) {
    metaMap.set(`MTA_NYCT_SIR:${sirId}`, {
      bulletCode: 'SIR',
      textColorHex: '#FFFFFF',
      division: 'SIR',
      trunkGroup: 'Staten Island Railway',
      tauranacColorHex: '#006BB6',
      ind1953ColorHex: '#0039A6',
      isDiamond: false,
      aliases: ['SI', 'SIR', 'SS'],
    });
  }

  const mnrBlock = goContent.match(/mnrSpecs\s*:=\s*\[\]struct\s*\{[\s\S]*?\}\s*\{([\s\S]*?)\n\t\}/);
  if (mnrBlock) {
    const rowRe = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(nil|\[\]string\{[^}]*\})\s*\}/g;
    for (const m of mnrBlock[1].matchAll(rowRe)) {
      metaMap.set(`MTA_METRO_NORTH:${m[1]}`, {
        bulletCode: m[2],
        routeShortLabel: m[3],
        textColorHex: defaultTextColorForHex(m[5]),
        division: 'MNR',
        trunkGroup: `Metro-North ${m[4]}`,
        isDiamond: false,
        aliases: parseGoAliases(m[6]),
      });
    }
  }

  const lirrBlock = goContent.match(/lirrSpecs\s*:=\s*\[\]struct\s*\{[\s\S]*?\}\s*\{([\s\S]*?)\n\t\}/);
  if (lirrBlock) {
    const rowRe = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(nil|\[\]string\{[^}]*\})\s*\}/g;
    for (const m of lirrBlock[1].matchAll(rowRe)) {
      metaMap.set(`MTA_LIRR:${m[1]}`, {
        bulletCode: m[2],
        routeShortLabel: m[3],
        textColorHex: defaultTextColorForHex(m[5]),
        division: 'LIRR',
        trunkGroup: `LIRR ${m[4]}`,
        isDiamond: false,
        aliases: parseGoAliases(m[6]),
      });
    }
  }

  const pathBlock = goContent.match(/pathSpecs\s*:=\s*\[\]struct\s*\{[\s\S]*?\}\s*\{([\s\S]*?)\n\t\}/);
  if (pathBlock) {
    const rowRe = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(nil|\[\]string\{[^}]*\})\s*\}/g;
    for (const m of pathBlock[1].matchAll(rowRe)) {
      metaMap.set(`PORT_AUTHORITY_PATH:${m[1]}`, {
        bulletCode: m[2],
        routeShortLabel: m[1],
        textColorHex: defaultTextColorForHex(m[4]),
        division: 'PATH',
        trunkGroup: `PATH ${m[3]}`,
        isDiamond: false,
        aliases: parseGoAliases(m[5]),
      });
    }
  }

  const addBlocks = [...goContent.matchAll(/add\(stagedRouteRecord\{([\s\S]*?)\n\t\}\)/g)];
  for (const b of addBlocks) {
    const body = b[1];
    const rId = body.match(/RouteID:\s*"([^"]+)"/)?.[1];
    const agId = body.match(/AgencyID:\s*"([^"]+)"/)?.[1];
    const cHex = body.match(/ColorHex:\s*"([^"]+)"/)?.[1];
    if (!rId || !agId) continue;
    const bullet = body.match(/BulletCode:\s*"([^"]+)"/)?.[1] || rId;
    const textHex = body.match(/TextColorHex:\s*"([^"]+)"/)?.[1] || defaultTextColorForHex(cHex);
    const div = body.match(/Division:\s*"([^"]+)"/)?.[1] || '';
    const trunk = body.match(/TrunkGroup:\s*"([^"]+)"/)?.[1] || '';
    const shortLbl = body.match(/RouteShortLabel:\s*"([^"]+)"/)?.[1];
    const aliasesRaw = body.match(/Aliases:\s*(\[\]string\{[^}]*\})/)?.[1];
    metaMap.set(`${agId}:${rId}`, {
      bulletCode: bullet,
      textColorHex: textHex,
      division: div,
      trunkGroup: trunk,
      isDiamond: false,
      aliases: parseGoAliases(aliasesRaw),
      ...(shortLbl ? { routeShortLabel: shortLbl } : {}),
    });
  }

  return metaMap;
}

// 1. Parse version.go
const versionGoContent = fs.readFileSync(versionGoPath, 'utf-8');
const versionMatch = versionGoContent.match(/CurrentSchemaVersion\s*=\s*"([^"]+)"/);
if (!versionMatch) {
  throw new Error('Unable to extract CurrentSchemaVersion from version.go');
}
const schemaVersion = versionMatch[1];

// 2. Parse canonical routes from tables.go + internal/sources/mta/colors/plugin.go
const tablesGoContent = fs.readFileSync(tablesGoPath, 'utf-8');
const colorsPluginContent = fs.existsSync(colorsPluginGoPath)
  ? fs.readFileSync(colorsPluginGoPath, 'utf-8')
  : '';
const colorsMetaMap = parseColorsPluginMetadata(colorsPluginContent);
const canonicalRoutesMatch = tablesGoContent.match(/WITH canonical_routes\([^)]+\)\s+AS\s*\(\s*VALUES\s*([\s\S]*?)\n\s*\)/);
const canonicalRoutes = [];
if (canonicalRoutesMatch) {
  const lines = canonicalRoutesMatch[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('('));
  for (const line of lines) {
    const clean = line.replace(/^\(/, '').replace(/\),?$/, '');
    const parts = clean.split(',').map(p => p.trim().replace(/^'/, '').replace(/'$/, ''));
    if (parts.length >= 5) {
      const routeId = parts[0];
      const agencyId = parts[1];
      const routeName = parts[2];
      const colorHex = parts[3];
      const type = parts[4];
      const extra = colorsMetaMap.get(`${agencyId}:${routeId}`) || {};
      canonicalRoutes.push({
        routeId,
        agencyId,
        routeName,
        colorHex,
        type,
        bulletCode: extra.bulletCode || parts[5] || routeId,
        textColorHex: extra.textColorHex || defaultTextColorForHex(colorHex),
        division: extra.division || '',
        trunkGroup: extra.trunkGroup || routeName,
        isDiamond: Boolean(extra.isDiamond),
        aliases: extra.aliases || [],
        ...(extra.tauranacColorHex ? { tauranacColorHex: extra.tauranacColorHex } : {}),
        ...(extra.ind1953ColorHex ? { ind1953ColorHex: extra.ind1953ColorHex } : {}),
        ...(extra.routeShortLabel ? { routeShortLabel: extra.routeShortLabel } : {}),
      });
    }
  }
}

// Fixed definitions per architecture plan
const BASE_TABLES = [
  'dim_stations',
  'dim_routes',
  'fact_schedules',
  'fact_vehicle_positions',
  'fact_alerts',
  'fact_ridership',
  'dim_micromobility_stations',
  'fact_micromobility_status',
  'fact_turnstile_counts',
  'dim_boroughs',
  'dim_service_lines',
];

const VIEWS = [
  'view_current_vehicle_positions',
  'view_current_micromobility_status',
  'view_active_alerts',
  'view_dim_stations',
  'view_station_complexes',
  'view_dim_routes',
  'view_dim_micromobility_stations',
  'view_vehicle_kinematics',
  'view_station_headways',
  'view_station_to_station_legs',
  'view_alert_routes',
  'view_alert_stations',
  'view_turnstile_flows',
  'view_schedule_adherence',
  'view_station_hourly_summary',
  'view_dim_surface_routes',
  'view_dim_surface_stations',
  'view_surface_kinematics',
  'view_surface_headways',
  'view_dim_boroughs',
  'view_dim_map_geography',
  'view_dim_service_lines',
  'view_dim_routes_1929',
  'view_dim_service_lines_1929',
  'view_dim_stations_1929',
  'view_dim_routes_1953',
  'view_dim_service_lines_1953',
  'view_dim_stations_1953',
  'view_dim_routes_proposed',
  'view_dim_service_lines_proposed',
  'view_dim_stations_proposed',
];

const UNBOUNDED_PARTITIONED = [
  'fact_schedules',
  'fact_vehicle_positions',
  'fact_alerts',
  'fact_ridership',
  'fact_micromobility_status',
  'fact_turnstile_counts',
  'view_vehicle_kinematics',
  'view_station_headways',
  'view_station_to_station_legs',
  'view_alert_routes',
  'view_alert_stations',
  'view_turnstile_flows',
  'view_schedule_adherence',
  'view_station_hourly_summary',
  'view_surface_kinematics',
  'view_surface_headways',
];

const PRE_BOUNDED_LIVE = [
  'view_current_vehicle_positions',
  'view_current_micromobility_status',
  'view_active_alerts',
];

const DIMENSION_RELATIONS = [
  'dim_stations',
  'dim_routes',
  'dim_micromobility_stations',
  'dim_boroughs',
  'dim_service_lines',
  'view_dim_stations',
  'view_station_complexes',
  'view_dim_routes',
  'view_dim_micromobility_stations',
  'view_dim_surface_routes',
  'view_dim_surface_stations',
  'view_dim_boroughs',
  'view_dim_map_geography',
  'view_dim_service_lines',
  'view_dim_routes_1929',
  'view_dim_service_lines_1929',
  'view_dim_stations_1929',
  'view_dim_routes_1953',
  'view_dim_service_lines_1953',
  'view_dim_stations_1953',
  'view_dim_routes_proposed',
  'view_dim_service_lines_proposed',
  'view_dim_stations_proposed',
];

const RECOMMENDED_ANALYTICS = [
  ...VIEWS,
  'fact_schedules',
  'fact_ridership',
];

const RAW_SCD_BASE_TABLES = [
  'dim_stations',
  'dim_routes',
  'dim_micromobility_stations',
  'dim_boroughs',
  'dim_service_lines',
  'fact_alerts',
];

const NYC_AGENCIES = [
  'MTA_NYCT_SUBWAY',
  'MTA_NYCT_SIR',
  'MTA_LIRR',
  'MTA_METRO_NORTH',
  'PORT_AUTHORITY_PATH',
  'NJ_TRANSIT',
  'MTA_BUS',
  'CITIBIKE',
  'NYC_FERRY',
];

const AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS = ['1', '2', '3', '4', '5', '6', '7'];

// Schema column mapping
const COLUMNS = {
  dim_stations: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
    { name: 'structure', datatype: 'VARCHAR' },
    { name: 'is_accessible', datatype: 'BOOLEAN' },
    { name: 'valid_from', datatype: 'TIMESTAMPTZ' },
    { name: 'valid_to', datatype: 'TIMESTAMPTZ' },
    { name: 'is_current', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  dim_routes: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'type', datatype: 'VARCHAR' },
    { name: 'valid_from', datatype: 'TIMESTAMPTZ' },
    { name: 'valid_to', datatype: 'TIMESTAMPTZ' },
    { name: 'is_current', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_schedules: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'scheduled_arrival_time', datatype: 'TIMESTAMPTZ' },
    { name: 'scheduled_departure_time', datatype: 'TIMESTAMPTZ' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_vehicle_positions: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'bearing', datatype: 'DOUBLE' },
    { name: 'speed', datatype: 'DOUBLE' },
    { name: 'occupancy_status', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_alerts: [
    { name: 'alert_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'event_date', datatype: 'DATE' },
    { name: 'detected_at', datatype: 'TIMESTAMPTZ' },
    { name: 'last_seen_at', datatype: 'TIMESTAMPTZ' },
    { name: 'removed_at', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_start', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_end', datatype: 'TIMESTAMPTZ' },
    { name: 'affected_route_ids', datatype: 'VARCHAR' },
    { name: 'cause', datatype: 'VARCHAR' },
    { name: 'effect', datatype: 'VARCHAR' },
    { name: 'header_text', datatype: 'VARCHAR' },
    { name: 'description_text', datatype: 'VARCHAR' },
    { name: 'severity', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_ridership: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'origin_station_id', datatype: 'VARCHAR' },
    { name: 'destination_station_id', datatype: 'VARCHAR' },
    { name: 'passenger_count', datatype: 'BIGINT' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  dim_micromobility_stations: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'capacity', datatype: 'INTEGER' },
    { name: 'valid_from', datatype: 'TIMESTAMPTZ' },
    { name: 'valid_to', datatype: 'TIMESTAMPTZ' },
    { name: 'is_current', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_micromobility_status: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'num_bikes_available', datatype: 'INTEGER' },
    { name: 'num_ebikes_available', datatype: 'INTEGER' },
    { name: 'num_docks_available', datatype: 'INTEGER' },
    { name: 'is_installed', datatype: 'BOOLEAN' },
    { name: 'is_renting', datatype: 'BOOLEAN' },
    { name: 'is_returning', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  fact_turnstile_counts: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'device_id', datatype: 'VARCHAR' },
    { name: 'reading_time', datatype: 'TIMESTAMPTZ' },
    { name: 'entry_count', datatype: 'BIGINT' },
    { name: 'exit_count', datatype: 'BIGINT' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_current_vehicle_positions: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'bearing', datatype: 'DOUBLE' },
    { name: 'speed', datatype: 'DOUBLE' },
    { name: 'occupancy_status', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_current_micromobility_status: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'num_bikes_available', datatype: 'INTEGER' },
    { name: 'num_ebikes_available', datatype: 'INTEGER' },
    { name: 'num_docks_available', datatype: 'INTEGER' },
    { name: 'is_installed', datatype: 'BOOLEAN' },
    { name: 'is_renting', datatype: 'BOOLEAN' },
    { name: 'is_returning', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_active_alerts: [
    { name: 'alert_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'event_date', datatype: 'DATE' },
    { name: 'detected_at', datatype: 'TIMESTAMPTZ' },
    { name: 'last_seen_at', datatype: 'TIMESTAMPTZ' },
    { name: 'removed_at', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_start', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_end', datatype: 'TIMESTAMPTZ' },
    { name: 'affected_route_ids', datatype: 'VARCHAR' },
    { name: 'cause', datatype: 'VARCHAR' },
    { name: 'effect', datatype: 'VARCHAR' },
    { name: 'header_text', datatype: 'VARCHAR' },
    { name: 'description_text', datatype: 'VARCHAR' },
    { name: 'severity', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_stations: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
    { name: 'structure', datatype: 'VARCHAR' },
    { name: 'is_accessible', datatype: 'BOOLEAN' },
    { name: 'route_count', datatype: 'INTEGER' },
    { name: 'is_interlined_junction', datatype: 'BOOLEAN' },
    { name: 'borough', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_station_complexes: [
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'complex_name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
    { name: 'is_accessible', datatype: 'BOOLEAN' },
    { name: 'station_count', datatype: 'BIGINT' },
    { name: 'route_count', datatype: 'BIGINT' },
  ],
  view_dim_routes: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'type', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
    { name: 'bullet_code', datatype: 'VARCHAR' },
    { name: 'text_color_hex', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'trunk_group', datatype: 'VARCHAR' },
  ],
  view_dim_micromobility_stations: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'capacity', datatype: 'INTEGER' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_vehicle_kinematics: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'bearing', datatype: 'DOUBLE' },
    { name: 'occupancy_status', datatype: 'VARCHAR' },
    { name: 'delta_time_sec', datatype: 'DOUBLE' },
    { name: 'step_distance_meters', datatype: 'DOUBLE' },
    { name: 'effective_speed_mps', datatype: 'DOUBLE' },
    { name: 'effective_speed_mph', datatype: 'DOUBLE' },
    { name: 'accel_mps2', datatype: 'DOUBLE' },
    { name: 'dwell_sec', datatype: 'DOUBLE' },
    { name: 'signal_delay_sec', datatype: 'DOUBLE' },
  ],
  view_station_headways: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'parent_station_id', datatype: 'VARCHAR' },
    { name: 'direction_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'headway_sec', datatype: 'DOUBLE' },
    { name: 'headway_sec_squared', datatype: 'DOUBLE' },
  ],
  view_station_to_station_legs: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'from_station_id', datatype: 'VARCHAR' },
    { name: 'to_station_id', datatype: 'VARCHAR' },
    { name: 'departure_time', datatype: 'TIMESTAMPTZ' },
    { name: 'arrival_time', datatype: 'TIMESTAMPTZ' },
    { name: 'leg_travel_time_sec', datatype: 'DOUBLE' },
    { name: 'leg_distance_meters', datatype: 'DOUBLE' },
    { name: 'leg_speed_mps', datatype: 'DOUBLE' },
  ],
  view_alert_routes: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'alert_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'detected_at', datatype: 'TIMESTAMPTZ' },
    { name: 'last_seen_at', datatype: 'TIMESTAMPTZ' },
    { name: 'removed_at', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_start', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_end', datatype: 'TIMESTAMPTZ' },
    { name: 'cause', datatype: 'VARCHAR' },
    { name: 'effect', datatype: 'VARCHAR' },
    { name: 'header_text', datatype: 'VARCHAR' },
    { name: 'description_text', datatype: 'VARCHAR' },
    { name: 'severity', datatype: 'VARCHAR' },
  ],
  view_alert_stations: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'alert_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'raw_stop_id', datatype: 'VARCHAR' },
    { name: 'parent_station_id', datatype: 'VARCHAR' },
    { name: 'detected_at', datatype: 'TIMESTAMPTZ' },
    { name: 'last_seen_at', datatype: 'TIMESTAMPTZ' },
    { name: 'removed_at', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_start', datatype: 'TIMESTAMPTZ' },
    { name: 'active_period_end', datatype: 'TIMESTAMPTZ' },
    { name: 'cause', datatype: 'VARCHAR' },
    { name: 'effect', datatype: 'VARCHAR' },
    { name: 'header_text', datatype: 'VARCHAR' },
    { name: 'description_text', datatype: 'VARCHAR' },
    { name: 'severity', datatype: 'VARCHAR' },
  ],
  view_turnstile_flows: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'device_id', datatype: 'VARCHAR' },
    { name: 'reading_time', datatype: 'TIMESTAMPTZ' },
    { name: 'service_hour', datatype: 'TIMESTAMPTZ' },
    { name: 'entry_count', datatype: 'BIGINT' },
    { name: 'exit_count', datatype: 'BIGINT' },
    { name: 'payment_method', datatype: 'VARCHAR' },
    { name: 'fare_class_category', datatype: 'VARCHAR' },
  ],
  view_schedule_adherence: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'service_hour', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'hour_of_day', datatype: 'DOUBLE' },
    { name: 'scheduled_trips_count', datatype: 'BIGINT' },
    { name: 'observed_trips_count', datatype: 'BIGINT' },
    { name: 'ghost_trips_count', datatype: 'BIGINT' },
    { name: 'unscheduled_trips_count', datatype: 'BIGINT' },
    { name: 'service_completion_pct', datatype: 'DOUBLE' },
    { name: 'avg_observed_headway_sec', datatype: 'DOUBLE' },
    { name: 'median_observed_headway_sec', datatype: 'DOUBLE' },
    { name: 'sum_headway_sec_squared', datatype: 'DOUBLE' },
    { name: 'active_alerts_count', datatype: 'BIGINT' },
  ],
  view_station_hourly_summary: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'parent_station_id', datatype: 'VARCHAR' },
    { name: 'service_hour', datatype: 'TIMESTAMPTZ' },
    { name: 'total_entries', datatype: 'BIGINT' },
    { name: 'total_exits', datatype: 'BIGINT' },
    { name: 'train_arrivals_count', datatype: 'BIGINT' },
    { name: 'avg_headway_sec', datatype: 'DOUBLE' },
    { name: 'station_alerts_count', datatype: 'BIGINT' },
  ],
  view_dim_surface_routes: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'type', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
    { name: 'bullet_code', datatype: 'VARCHAR' },
    { name: 'text_color_hex', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'trunk_group', datatype: 'VARCHAR' },
  ],
  view_dim_surface_stations: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
    { name: 'structure', datatype: 'VARCHAR' },
    { name: 'is_accessible', datatype: 'BOOLEAN' },
    { name: 'route_count', datatype: 'INTEGER' },
    { name: 'is_interlined_junction', datatype: 'BOOLEAN' },
    { name: 'borough', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_surface_kinematics: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'bearing', datatype: 'DOUBLE' },
    { name: 'occupancy_status', datatype: 'VARCHAR' },
    { name: 'delta_time_sec', datatype: 'DOUBLE' },
    { name: 'step_distance_meters', datatype: 'DOUBLE' },
    { name: 'effective_speed_mps', datatype: 'DOUBLE' },
    { name: 'effective_speed_mph', datatype: 'DOUBLE' },
    { name: 'accel_mps2', datatype: 'DOUBLE' },
    { name: 'dwell_sec', datatype: 'DOUBLE' },
    { name: 'signal_delay_sec', datatype: 'DOUBLE' },
  ],
  view_surface_headways: [
    { name: 'event_date', datatype: 'DATE' },
    { name: 'event_time', datatype: 'TIMESTAMPTZ' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'trip_id', datatype: 'VARCHAR' },
    { name: 'vehicle_id', datatype: 'VARCHAR' },
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'parent_station_id', datatype: 'VARCHAR' },
    { name: 'direction_id', datatype: 'VARCHAR' },
    { name: 'status', datatype: 'VARCHAR' },
    { name: 'headway_sec', datatype: 'DOUBLE' },
    { name: 'headway_sec_squared', datatype: 'DOUBLE' },
  ],
  dim_boroughs: [
    { name: 'boro_code', datatype: 'INTEGER' },
    { name: 'boro_name', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_area', datatype: 'DOUBLE' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'valid_from', datatype: 'TIMESTAMPTZ' },
    { name: 'valid_to', datatype: 'TIMESTAMPTZ' },
    { name: 'is_current', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  dim_service_lines: [
    { name: 'line_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'service_name', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'line_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'valid_from', datatype: 'TIMESTAMPTZ' },
    { name: 'valid_to', datatype: 'TIMESTAMPTZ' },
    { name: 'is_current', datatype: 'BOOLEAN' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_boroughs: [
    { name: 'boro_code', datatype: 'INTEGER' },
    { name: 'boro_name', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_area', datatype: 'DOUBLE' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_map_geography: [
    { name: 'boro_code', datatype: 'INTEGER' },
    { name: 'boro_name', datatype: 'VARCHAR' },
    { name: 'region_kind', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_area', datatype: 'DOUBLE' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_service_lines: [
    { name: 'line_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'service_name', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'line_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_routes_1929: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
  ],
  view_dim_service_lines_1929: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
  ],
  view_dim_stations_1929: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'borough', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
  ],
  view_dim_routes_1953: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'type', datatype: 'VARCHAR' },
    { name: 'raw_payload', datatype: 'VARIANT' },
    { name: 'bullet_code', datatype: 'VARCHAR' },
    { name: 'text_color_hex', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'trunk_group', datatype: 'VARCHAR' },
  ],
  view_dim_service_lines_1953: [
    { name: 'line_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'service_name', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
    { name: 'line_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'geom_wkt', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
    { name: 'shape_leng', datatype: 'DOUBLE' },
    { name: 'raw_payload', datatype: 'VARIANT' },
  ],
  view_dim_stations_1953: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'borough', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
  ],
  view_dim_routes_proposed: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'division', datatype: 'VARCHAR' },
  ],
  view_dim_service_lines_proposed: [
    { name: 'route_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'route_name', datatype: 'VARCHAR' },
    { name: 'color_hex', datatype: 'VARCHAR' },
    { name: 'geom_geojson', datatype: 'VARCHAR' },
  ],
  view_dim_stations_proposed: [
    { name: 'station_id', datatype: 'VARCHAR' },
    { name: 'agency_id', datatype: 'VARCHAR' },
    { name: 'name', datatype: 'VARCHAR' },
    { name: 'latitude', datatype: 'DOUBLE' },
    { name: 'longitude', datatype: 'DOUBLE' },
    { name: 'gtfs_stop_id', datatype: 'VARCHAR' },
    { name: 'complex_id', datatype: 'VARCHAR' },
    { name: 'borough', datatype: 'VARCHAR' },
    { name: 'daytime_routes', datatype: 'VARCHAR' },
  ],
};

// 3. Parse Ossie models
const ossieFiles = fs.readdirSync(ossieDir).filter(f => f.endsWith('.yaml'));
const ossieThemes = [];
const ossieFactGraph = {};

for (const file of ossieFiles) {
  const content = fs.readFileSync(path.join(ossieDir, file), 'utf-8');
  const parsed = YAML.parse(content);
  const sm = parsed.semantic_model?.[0] || parsed;
  const themeName = sm.name;
  
  const datasets = (sm.datasets || []).map(d => ({
    name: d.name,
    description: d.description || '',
    source: d.source || '',
    ...(d.lens ? { isLens: true, lensLabel: d.lens.label || d.name, defaultDimensions: d.lens.default_dimensions || [], defaultMetrics: d.lens.default_metrics || [], defaultWindow: d.lens.default_window || '' } : {}),
    fields: (d.fields || []).map(f => ({
      name: f.name,
      datatype: f.datatype || 'VARCHAR',
      description: f.description || '',
      expression: f.expression?.dialects?.[0]?.expression || f.name,
      isDimension: !!f.dimension,
      isTime: !!f.dimension?.is_time,
    })),
  }));

  const relationships = (sm.relationships || []).map(r => ({
    name: r.name,
    from: r.from,
    to: r.to,
    fromColumns: r.from_columns || [],
    toColumns: r.to_columns || [],
    type: r.type || 'many_to_one',
  }));

  const metrics = (sm.metrics || []).map(m => {
    // Detect dataset referenced in metric expression
    const expr = m.expression?.dialects?.[0]?.expression || '';
    const referencedDatasets = [];
    for (const d of datasets) {
      if (expr.includes(`${d.name}.`)) {
        referencedDatasets.push(d.name);
      }
    }
    return {
      name: m.name,
      description: m.description || '',
      datatype: m.datatype || 'DOUBLE',
      expression: expr,
      referencedDatasets,
    };
  });

  ossieThemes.push({
    name: themeName,
    description: sm.description || '',
    datasets,
    relationships,
    metrics,
  });

  // Build reachability graph for this theme
  // Build adjacency
  const adj = {};
  for (const d of datasets) {
    adj[d.name] = new Set();
  }
  for (const r of relationships) {
    if (adj[r.from]) adj[r.from].add(r.to);
  }

  // Identify fact datasets: datasets referenced by at least one metric
  const factDatasetsSet = new Set();
  for (const m of metrics) {
    for (const dName of m.referencedDatasets) {
      factDatasetsSet.add(dName);
    }
  }
  // Fallback: non-dim datasets
  if (factDatasetsSet.size === 0) {
    for (const d of datasets) {
      if (!d.name.startsWith('dim_')) factDatasetsSet.add(d.name);
    }
  }

  const themeGraph = {
    factDatasets: Array.from(factDatasetsSet),
    datasets: {},
  };

  for (const d of datasets) {
    // BFS to find reachable datasets
    const visited = new Set([d.name]);
    const queue = [d.name];
    while (queue.length > 0) {
      const curr = queue.shift();
      const neighbors = adj[curr] || new Set();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    // Collect all dimensions from reachable datasets
    const dims = [];
    for (const reachName of visited) {
      const reachDs = datasets.find(x => x.name === reachName);
      if (reachDs) {
        for (const f of reachDs.fields) {
          dims.push(`${reachName}.${f.name}`);
        }
      }
    }

    // Collect metrics applicable to this dataset
    const availableMetrics = metrics
      .filter(m => m.referencedDatasets.length === 0 || m.referencedDatasets.every(ref => visited.has(ref)))
      .map(m => m.name);

    themeGraph.datasets[d.name] = {
      reachableDatasets: Array.from(visited),
      dimensions: dims,
      metrics: availableMetrics,
    };
  }

  ossieFactGraph[themeName] = themeGraph;
}

// 4. Generate TypeScript output
const tsCode = `// Generated automatically by scripts/generate-schema-types.mjs
// Do not edit manually. Re-run 'npm run codegen:schema' to update.

export const CURRENT_SCHEMA_VERSION = '${schemaVersion}' as const;
export type CurrentSchemaVersion = typeof CURRENT_SCHEMA_VERSION;

export const TRANSIT_BASE_TABLES = ${JSON.stringify(BASE_TABLES, null, 2)} as const;
export type TransitBaseTableName = (typeof TRANSIT_BASE_TABLES)[number];

export const TRANSIT_VIEWS = ${JSON.stringify(VIEWS, null, 2)} as const;
export type TransitViewName = (typeof TRANSIT_VIEWS)[number];

export const TRANSIT_RELATIONS = [
  ...TRANSIT_BASE_TABLES,
  ...TRANSIT_VIEWS,
] as const;
export type TransitRelationName = (typeof TRANSIT_RELATIONS)[number];

export type QualifiedProdRelation = \`prod.\${typeof CURRENT_SCHEMA_VERSION}.\${TransitRelationName}\`;

export const NYC_AGENCIES = ${JSON.stringify(NYC_AGENCIES, null, 2)} as const;
export type CanonicalAgencyId = (typeof NYC_AGENCIES)[number];

export const AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS = ${JSON.stringify(AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS, null, 2)} as const;
export type AmbiguousRouteId = (typeof AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS)[number];

export const UNBOUNDED_PARTITIONED_RELATIONS = ${JSON.stringify(UNBOUNDED_PARTITIONED, null, 2)} as const;
export type UnboundedPartitionedRelationName = (typeof UNBOUNDED_PARTITIONED_RELATIONS)[number];

export const PRE_BOUNDED_LIVE_VIEWS = ${JSON.stringify(PRE_BOUNDED_LIVE, null, 2)} as const;
export type PreBoundedLiveViewName = (typeof PRE_BOUNDED_LIVE_VIEWS)[number];

export const DIMENSION_RELATIONS = ${JSON.stringify(DIMENSION_RELATIONS, null, 2)} as const;
export type DimensionRelationName = (typeof DIMENSION_RELATIONS)[number];

export const RECOMMENDED_ANALYTICS_RELATIONS = ${JSON.stringify(RECOMMENDED_ANALYTICS, null, 2)} as const;
export type RecommendedAnalyticsRelationName = (typeof RECOMMENDED_ANALYTICS_RELATIONS)[number];

export const RAW_SCD_BASE_TABLES = ${JSON.stringify(RAW_SCD_BASE_TABLES, null, 2)} as const;
export type RawScdBaseTableName = (typeof RAW_SCD_BASE_TABLES)[number];

export interface SchemaColumn {
  readonly name: string;
  readonly datatype: string;
}

export const TRANSIT_SCHEMA_COLUMNS: Record<TransitRelationName, readonly SchemaColumn[]> = ${JSON.stringify(COLUMNS, null, 2)} as const;

export interface CanonicalRouteInfo {
  readonly routeId: string;
  readonly agencyId: string;
  readonly routeName: string;
  readonly colorHex: string;
  readonly type: string;
  readonly bulletCode: string;
  readonly textColorHex?: string;
  readonly division?: string;
  readonly trunkGroup?: string;
  readonly isDiamond?: boolean;
  readonly aliases?: readonly string[];
  readonly tauranacColorHex?: string;
  readonly ind1953ColorHex?: string;
  readonly routeShortLabel?: string;
}

export const CANONICAL_ROUTES: Record<string, CanonicalRouteInfo> = ${JSON.stringify(
  canonicalRoutes.reduce((acc, r) => {
    acc[`${r.agencyId}:${r.routeId}`] = r;
    return acc;
  }, {}),
  null,
  2
)} as const;

export interface OssieField {
  readonly name: string;
  readonly datatype: string;
  readonly description: string;
  readonly expression?: string;
  readonly isDimension: boolean;
  readonly isTime: boolean;
}

export interface OssieDataset {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly isLens?: boolean;
  readonly lensLabel?: string;
  readonly defaultDimensions?: readonly string[];
  readonly defaultMetrics?: readonly string[];
  readonly defaultWindow?: string;
  readonly fields: readonly OssieField[];
}

export interface OssieRelationship {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly fromColumns: readonly string[];
  readonly toColumns: readonly string[];
  readonly type: string;
}

export interface OssieMetric {
  readonly name: string;
  readonly description: string;
  readonly datatype: string;
  readonly expression: string;
  readonly referencedDatasets: readonly string[];
}

export interface OssieTheme {
  readonly name: string;
  readonly description: string;
  readonly datasets: readonly OssieDataset[];
  readonly relationships: readonly OssieRelationship[];
  readonly metrics: readonly OssieMetric[];
}

export const OSSIE_THEMES: readonly OssieTheme[] = ${JSON.stringify(ossieThemes, null, 2)} as const;

export type OssieThemeName = (typeof OSSIE_THEMES)[number]['name'];

export const OSSIE_FACT_GRAPH = ${JSON.stringify(ossieFactGraph, null, 2)} as const;

export interface TypedOssieConfig<
  TTheme extends OssieThemeName = OssieThemeName,
  TFact extends string = string,
> {
  readonly theme: TTheme;
  readonly factDataset: TFact;
  readonly selectedMetrics: readonly string[];
  readonly selectedDimensions: readonly string[];
  readonly filters: readonly {
    readonly field: string;
    readonly operator: '=' | '!=' | 'IN' | 'BETWEEN' | '>' | '<' | '>=' | '<=';
    readonly value: string | number | readonly (string | number)[];
  }[];
  readonly limit?: number;
}
`;

if (isCheck) {
  if (!fs.existsSync(targetFile)) {
    console.error(`Check failed: ${targetFile} does not exist. Run 'npm run codegen:schema'`);
    process.exit(1);
  }
  const currentContent = fs.readFileSync(targetFile, 'utf-8');
  if (currentContent !== tsCode) {
    console.error(`Check failed: ${targetFile} is out of date. Run 'npm run codegen:schema'`);
    process.exit(1);
  }
  console.log('Zero-drift schema check passed.');
  process.exit(0);
} else {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, tsCode, 'utf-8');
  console.log(`Generated ${targetFile} successfully.`);
}
