import { store, persistCellToDuckDb, persistNotebookToDuckDb, executeCellQuery } from '../state/store.js';
import {
  ingestLocalFile,
  registerRemoteUrlView,
  removeSource,
  getConnectedSourceRowCount,
} from '../data/csv-ingest.js';
import {
  DEFAULT_DUCKLAKE_CATALOG_URL,
  getDuckDb,
  getDuckDbClient,
  getDuckDbConnection,
  refreshRemoteCatalog,
  resetCatalogHeaderStateForTest,
} from '../data/duckdb-client.js';
import { DBTC_OSSIE_THEMES } from '../data/ossie-loader.js';
import { asCellId, asCellViewIdentifier } from '../types/brands.js';
import {
  RECOMMENDED_ANALYTICS_RELATIONS,
  TRANSIT_BASE_TABLES,
  TRANSIT_SCHEMA_COLUMNS,
  UNBOUNDED_PARTITIONED_RELATIONS,
  NYC_AGENCIES,
} from '../types/straphanger-schema.gen.js';
import { TILE_CONTRACTS } from '../types/schema-contracts.js';
import { showToast } from './toast.js';

interface SnapshotItem {
  snapshotId: string;
  timestamp: string;
  isWithin7Days: boolean;
}

export type SocrataPortalDomain = 'all' | 'data.ny.gov' | 'data.cityofnewyork.us';

export interface SocrataDatasetHit {
  id: string;
  name: string;
  description: string;
  domain: 'data.ny.gov' | 'data.cityofnewyork.us';
  permalink: string;
  csvUrl: string;
  updatedAt: string;
  category: string;
  suggestedViewName: string;
}

export function sanitizeSocrataViewName(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36)
    .replace(/_+$/g, '');
  const cleanId = id.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const raw = `${base || 'socrata_dataset'}_${cleanId}`;
  return /^[0-9]/.test(raw) ? `socrata_${raw}` : raw;
}

export function buildSocrataCsvUrl(
  domain: 'data.ny.gov' | 'data.cityofnewyork.us',
  datasetId: string,
  limit = 50000
): string {
  const cleanId = datasetId.trim();
  return `https://${domain}/resource/${encodeURIComponent(cleanId)}.csv?$limit=${limit}`;
}

export function buildSocrataDiscoveryApiUrl(
  query: string,
  portal: SocrataPortalDomain = 'all',
  limit = 12
): string {
  const params = new URLSearchParams();
  const domains =
    portal === 'all' ? 'data.ny.gov,data.cityofnewyork.us' : portal;
  params.set('domains', domains);
  if (portal !== 'all') {
    params.set('search_context', portal);
  }
  params.set('only', 'datasets');
  params.set('limit', String(limit));
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    params.set('q', trimmed);
  }
  return `https://api.us.socrata.com/api/catalog/v1?${params.toString()}`;
}

export const CURATED_SOCRATA_TRANSIT_DATASETS: readonly SocrataDatasetHit[] = [
  {
    id: 'wujg-7c2s',
    name: 'MTA Subway Hourly Ridership: Beginning July 2020',
    description:
      'Hourly subway ridership estimates by station complex and fare class across all NYC Subway lines.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Subway-Hourly-Ridership-Beginning-July-2020/wujg-7c2s',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', 'wujg-7c2s'),
    updatedAt: '2025-04-01',
    category: 'Transportation',
    suggestedViewName: 'mta_subway_hourly_ridership_wujg_7c2s',
  },
  {
    id: '39hk-dx4f',
    name: 'MTA Subway Stations',
    description:
      'Official list of MTA New York City Transit subway stations with GTFS stop IDs, complexes, boroughs, daytime routes, and coordinates.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', '39hk-dx4f'),
    updatedAt: '2025-03-15',
    category: 'Transportation',
    suggestedViewName: 'mta_subway_stations_39hk_dx4f',
  },
  {
    id: 's692-irgq',
    name: 'MTA Subway Service Lines',
    description:
      'Curved geographic LineString and MultiLineString geometry and official hex colors for MTA NYC Subway service routes.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Subway-Service-Lines/s692-irgq',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', 's692-irgq'),
    updatedAt: '2025-02-20',
    category: 'Transportation',
    suggestedViewName: 'mta_subway_service_lines_s692_irgq',
  },
  {
    id: 'jsu2-fbtj',
    name: 'MTA Subway Origin-Destination Ridership Estimate',
    description:
      'Estimated station-to-station origin-destination subway passenger trips by hour of day, day of week, and month.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Subway-Origin-Destination-Ridership-Estimate-2/jsu2-fbtj',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', 'jsu2-fbtj'),
    updatedAt: '2025-03-28',
    category: 'Transportation',
    suggestedViewName: 'mta_subway_od_estimates_jsu2_fbtj',
  },
  {
    id: '4apg-4kt9',
    name: 'MTA Subway Customer Journey-Focused Metrics',
    description:
      'Monthly Additional Platform Time (APT), Additional Train Time (ATT), and Customer Journey Time Performance (CJTP) by subway line and period.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Subway-Customer-Journey-Focused-Metrics-Beginn/4apg-4kt9',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', '4apg-4kt9'),
    updatedAt: '2025-03-25',
    category: 'Transportation',
    suggestedViewName: 'mta_customer_journey_metrics_4apg_4kt9',
  },
  {
    id: 'vxuj-8kew',
    name: 'MTA Daily Ridership Data: Beginning 2020',
    description:
      'Systemwide daily ridership and traffic estimates across Subways, Buses, LIRR, Metro-North, Access-A-Ride, and Bridges & Tunnels.',
    domain: 'data.ny.gov',
    permalink: 'https://data.ny.gov/Transportation/MTA-Daily-Ridership-Data-Beginning-2020/vxuj-8kew',
    csvUrl: buildSocrataCsvUrl('data.ny.gov', 'vxuj-8kew'),
    updatedAt: '2025-04-02',
    category: 'Transportation',
    suggestedViewName: 'mta_daily_ridership_vxuj_8kew',
  },
  {
    id: 'gthc-hcne',
    name: 'Borough Boundaries',
    description:
      'Official New York City borough boundary MultiPolygon geometries and land/water surface areas from NYC Department of City Planning.',
    domain: 'data.cityofnewyork.us',
    permalink: 'https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne',
    csvUrl: buildSocrataCsvUrl('data.cityofnewyork.us', 'gthc-hcne'),
    updatedAt: '2025-01-18',
    category: 'City Government',
    suggestedViewName: 'nyc_borough_boundaries_gthc_hcne',
  },
  {
    id: 'ycrg-ses3',
    name: 'Bus Lanes - Local Streets',
    description:
      'NYC DOT street segments with dedicated bus lane treatments, hours of operation, and camera enforcement status across the five boroughs.',
    domain: 'data.cityofnewyork.us',
    permalink: 'https://data.cityofnewyork.us/Transportation/Bus-Lanes-Local-Streets/ycrg-ses3',
    csvUrl: buildSocrataCsvUrl('data.cityofnewyork.us', 'ycrg-ses3'),
    updatedAt: '2025-03-10',
    category: 'Transportation',
    suggestedViewName: 'nyc_dot_bus_lanes_ycrg_ses3',
  },
  {
    id: '5ef5-ddda',
    name: 'New York City Bike Routes',
    description:
      'NYC DOT bicycle network map including protected bike lanes, greenways, and signed bike corridors connecting to transit hubs.',
    domain: 'data.cityofnewyork.us',
    permalink: 'https://data.cityofnewyork.us/Transportation/New-York-City-Bike-Routes/5ef5-ddda',
    csvUrl: buildSocrataCsvUrl('data.cityofnewyork.us', '5ef5-ddda'),
    updatedAt: '2025-03-12',
    category: 'Transportation',
    suggestedViewName: 'nyc_bike_routes_5ef5_ddda',
  },
  {
    id: 'kk4q-3rt2',
    name: 'Subway Stations (NYC Open Data GIS)',
    description:
      'NYC geographic point locations and line assignments for subway stations across the five boroughs.',
    domain: 'data.cityofnewyork.us',
    permalink: 'https://data.cityofnewyork.us/Transportation/Subway-Stations/kk4q-3rt2',
    csvUrl: buildSocrataCsvUrl('data.cityofnewyork.us', 'kk4q-3rt2'),
    updatedAt: '2024-12-01',
    category: 'Transportation',
    suggestedViewName: 'nyc_gis_subway_stations_kk4q_3rt2',
  },
];

export function searchCuratedSocrataCatalog(
  query: string,
  portal: SocrataPortalDomain = 'all'
): SocrataDatasetHit[] {
  const domainFiltered = CURATED_SOCRATA_TRANSIT_DATASETS.filter(item =>
    portal === 'all' ? true : item.domain === portal
  );
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [...domainFiltered];
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return domainFiltered.filter(item => {
    const haystack = `${item.id} ${item.name} ${item.description} ${item.category} ${item.domain}`.toLowerCase();
    return tokens.every(tok => haystack.includes(tok));
  });
}

export async function searchSocrataCatalog(
  query: string,
  portal: SocrataPortalDomain = 'all',
  fetchImpl: typeof fetch = fetch
): Promise<SocrataDatasetHit[]> {
  const curatedMatches = searchCuratedSocrataCatalog(query, portal);
  const url = buildSocrataDiscoveryApiUrl(query, portal, 12);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return curatedMatches;
    }
    const payload = (await response.json()) as {
      results?: Array<{
        resource?: {
          id?: string;
          name?: string;
          description?: string;
          updatedAt?: string;
        };
        metadata?: {
          domain?: string;
        };
        classification?: {
          domain_category?: string;
        };
        permalink?: string;
      }>;
    };
    const apiResults: SocrataDatasetHit[] = [];
    for (const entry of payload.results ?? []) {
      const id = entry.resource?.id?.trim();
      const name = entry.resource?.name?.trim();
      const rawDomain = entry.metadata?.domain?.trim();
      if (!id || !name) continue;
      const domain: 'data.ny.gov' | 'data.cityofnewyork.us' =
        rawDomain === 'data.cityofnewyork.us' ? 'data.cityofnewyork.us' : 'data.ny.gov';
      if (portal !== 'all' && domain !== portal) continue;
      apiResults.push({
        id,
        name,
        description: (entry.resource?.description ?? '').trim() || `${name} (${domain})`,
        domain,
        permalink: entry.permalink || `https://${domain}/d/${id}`,
        csvUrl: buildSocrataCsvUrl(domain, id),
        updatedAt: (entry.resource?.updatedAt ?? '').slice(0, 10) || 'Recent',
        category: entry.classification?.domain_category || 'Open Data',
        suggestedViewName: sanitizeSocrataViewName(name, id),
      });
    }
    if (apiResults.length === 0) {
      return curatedMatches;
    }
    const seen = new Set(apiResults.map(r => `${r.domain}:${r.id}`));
    for (const curated of curatedMatches) {
      if (!seen.has(`${curated.domain}:${curated.id}`) && apiResults.length < 15) {
        apiResults.push(curated);
      }
    }
    return apiResults;
  } catch {
    return curatedMatches;
  }
}

export function buildLlmSystemPrompt(): string {
  const recommendedSchemas = RECOMMENDED_ANALYTICS_RELATIONS.map(rel => {
    const cols = TRANSIT_SCHEMA_COLUMNS[rel] ?? [];
    const isPartitioned = (UNBOUNDED_PARTITIONED_RELATIONS as readonly string[]).includes(rel);
    const colList = cols.map(c => `\`${c.name}\` (${c.datatype})`).join(', ');
    return `- **\`prod.transit_v2.${rel}\`**${isPartitioned ? ' [Partitioned by `event_date`]' : ''}\n  Columns: ${colList}`;
  }).join('\n');

  const rawBaseSchemas = TRANSIT_BASE_TABLES.map(rel => {
    const cols = TRANSIT_SCHEMA_COLUMNS[rel] ?? [];
    const colList = cols.map(c => `\`${c.name}\` (${c.datatype})`).join(', ');
    return `- **\`prod.transit_v2.${rel}\`** (Raw SCD2 Base Table)\n  Columns: ${colList}`;
  }).join('\n');

  const customSourcesSection = store.sources.length > 0
    ? `\n### Custom Uploaded / Remote Sources (\`local.main\`)\n` +
      store.sources.map(s => `- **\`local.main.${s.sourceName}\`** (${s.kind}: ${s.urlOrFilename})`).join('\n') + '\n'
    : '';

  const ossieSection = DBTC_OSSIE_THEMES.map(t => {
    const datasetsText = t.datasets
      .map(d => `  - Dataset \`${d.name}\` -> \`${d.source}\` (${d.description})`)
      .join('\n');
    const relsText = t.relationships
      .map(
        r =>
          `  - Join \`${r.name}\` (${r.type}): \`${r.from}\` (${r.fromColumns.join(', ')}) -> \`${r.to}\` (${r.toColumns.join(', ')})`
      )
      .join('\n');
    const metricsText = t.metrics
      .map(m => `  - Metric \`${m.name}\` (${m.datatype}): ${m.description}\n    SQL: \`${m.expression}\``)
      .join('\n');
    return `### Spec: \`${t.name}\` (${t.description})\n**Datasets:**\n${datasetsText}\n**Relationships:**\n${relsText}\n**Metrics:**\n${metricsText}`;
  }).join('\n\n');

  const transitVisualsMeta: Record<keyof typeof TILE_CONTRACTS, { label: string; notes: string }> = {
    'marey-chart': {
      label: 'Marey Train Trajectory Stringline Diagram (Time vs. Station Progression)',
      notes: 'Join `prod.transit_v2.view_dim_stations s ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id` and select `coalesce(s.name, h.parent_station_id) AS station_name`, `h.route_id`, `h.trip_id`, `h.event_time` (or `arrival_time`, `departure_time`), and `h.direction_id = \'0\'` (filter to one direction for clean stringlines). Optional columns: `borough`, `dwell_sec`, `headway_sec`, `display_value` (custom formatted measure in tooltip), `station_label`, `route_label`.',
    },
    'station-progression': {
      label: 'Station Progression Route Diagram (Editorial Corridor Style)',
      notes: 'Always LEFT JOIN `prod.transit_v2.view_dim_stations s ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id` to include `coalesce(s.name, h.parent_station_id) AS station_name` and `ORDER BY avg(s.latitude) DESC` (North-to-South corridor progression). Supports any numeric measure (`headway_sec`, `median_income`, `revenue`, `passenger_count`, `value`, etc.) plus optional SQL display overrides: `display_value` (or `formatted_value`, e.g. `\'3m 42s\'` or `\'$84,500\'` for tooltips & axis inference), `measure_label` (custom Y-axis title, e.g. `\'Median Household Income\'`), `measure_unit` (e.g. `\'USD\'`, `\'%\'`, `\'sec\'`), `station_label` (custom station label), and `route_label` (custom legend label).',
    },
    'route-segment-map': {
      label: 'Route Segment Speed / Congestion Map (MapLibre GL)',
      notes: 'Requires `route_id` plus either (`from_station_id`, `to_station_id`) or (`latitude`, `longitude`) and a speed/headway metric.',
    },
    'isochrone-map': {
      label: 'Travel-Time Isochrone Reachability Map',
      notes: 'Requires station identifier, `latitude`, `longitude`, and a travel duration column.',
    },
    'train-position-map': {
      label: 'Live / Snapshot Fleet Position Map',
      notes: 'Query `prod.transit_v2.view_current_vehicle_positions` or `view_vehicle_kinematics` for `vehicle_id`/`trip_id`, `latitude`, `longitude`, and `event_time`.',
    },
    'headway-horizon': {
      label: 'Headway Regularity & Bunching Distribution Chart',
      notes: 'Requires `route_id` and `headway_sec` (or `avg_headway_sec`).',
    },
    'adherence-waterfall': {
      label: 'Scheduled vs. Observed Trip Adherence Waterfall',
      notes: 'Query `prod.transit_v2.view_schedule_adherence` and alias `scheduled_trips AS scheduled_trips_count`, `observed_trips AS observed_trips_count`.',
    },
    'multimodal-pulse': {
      label: 'Multimodal Subway Turnstile & Citi Bike Pulse',
      notes: 'Combines subway station entry/exit counts (`total_entries`, `total_exits` or `entry_count`, `exit_count`) with micromobility dock status (`num_bikes_available`, `num_ebikes_available`, `num_docks_available`).',
    },
    'od-ridership-flow': {
      label: 'Origin-Destination Ridership Flow Matrix',
      notes: 'Query `prod.transit_v2.fact_ridership` or `prod.transit_v2.view_station_to_station_legs` with origin, destination, and `passenger_count`.',
    },
  };

  const transitContractsSection = (Object.keys(TILE_CONTRACTS) as (keyof typeof TILE_CONTRACTS)[])
    .map((key, idx) => {
      const contract = TILE_CONTRACTS[key];
      const meta = transitVisualsMeta[key];
      const reqSets = contract.requiredAnyOfSets
        .map((set, i) => `     - Requirement ${i + 1} (include at least one): ${set.map(c => `\`${c}\``).join(' | ')}`)
        .join('\n');
      const optCols = contract.optionalColumns?.map(c => `\`${c}\``).join(', ') ?? 'None';
      return `${idx + 1}. **\`${key}\`** - ${meta.label}\n   - **Required Column Sets (ALL sets must be satisfied in SELECT):**\n${reqSets}\n   - **Optional Columns:** ${optCols}\n   - **Best Practice:** ${meta.notes}`;
    })
    .join('\n\n');

  const totalMetricsCount = DBTC_OSSIE_THEMES.reduce((acc, t) => acc + t.metrics.length, 0);

  return `# StraphangerDB / Data Based Train Control (DBTC) - LLM SQL & Visual Prompt

You are assisting a transit data journalist and analyst using **Data Based Train Control (DBTC)**, an in-browser reactive SQL and Apache Ossie notebook powered by DuckDB-Wasm and the StraphangerDB DuckLake lakehouse.

## 1. DuckDB SQL Dialect & Lakehouse Rules
- **Engine**: DuckDB-Wasm. Use DuckDB SQL syntax.
- **Production Catalog**: Attached as \`prod.transit_v2\` (read-only multi-agency NYC transit lakehouse).
- **Local Scratch / Views**: Each notebook cell is compiled into \`local.main.<cell_id>\` and can be referenced downstream. Uploaded files live in \`local.main.<source_name>\`.
- **Template Parameters**: Use \`{{param_name}}\` for interactive UI parameters.
- **Partition Pushdown Guardrail**: Fact tables and views marked \`[Partitioned by event_date]\` MUST include an \`event_date\` or \`event_time\` filter (e.g., \`WHERE event_date = CURRENT_DATE - INTERVAL '1 day'\`) to avoid scanning all historical Parquet partitions.
- **Station Names**: Always join \`prod.transit_v2.view_dim_stations s ON <fact>.parent_station_id = s.gtfs_stop_id AND <fact>.agency_id = s.agency_id\` (or \`station_id = s.gtfs_stop_id\`) and project \`s.name AS station_name\` so charts display human-readable station names instead of raw GTFS stop IDs.

## 2. Recommended Analytics Views & Relations (\`prod.transit_v2\`)
Always prefer these deduplicated \`view_*\` relations over raw SCD2 base tables:

${recommendedSchemas}

### Raw SCD2 Base Tables (Use only when inspecting historical \`valid_from\` / \`valid_to\` versions)
${rawBaseSchemas}
${customSourcesSection}
## 3. Canonical NYC Agency IDs (\`agency_id\`)
Filter or group by \`agency_id\` using these exact values:
${NYC_AGENCIES.map(a => `- \`${a}\``).join('\n')}

## 4. Apache Ossie Semantic Model (\`dbtc\`, ${totalMetricsCount} Metrics, Exact Join Keys)
You can write raw DuckDB SQL or \`ossie_query('dbtc', ...)\` calls using the exact metric expressions and join relationships below:

${ossieSection}

## 5. Required Column Schemas for Visual Types
DBTC automatically unlocks specialized transit visualizations when your SQL \`SELECT\` output includes the required column names (case-insensitive):

### Schema-Unlocked Transit Visuals (9 Types)
${transitContractsSection}

### Standard BI & Editorial Chart Types (16 Types)
- \`table\`: Editorial publication table with automatic MTA route badges and inline metric bars.
- \`bar\`, \`stacked-bar\`: 1 categorical dimension + 1 or more numeric measures.
- \`line\`, \`area\`, \`stacked-area\`: 1 temporal/ordered axis + 1 or more numeric measures.
- \`scatter\`, \`bubble\`: 2 numeric axes (x, y) + optional size/group columns.
- \`pie\`, \`donut\`: 1 categorical column + 1 numeric measure.
- \`heatmap\`, \`radar\`, \`treemap\`, \`sunburst\`, \`boxplot\`: Multi-dimensional distribution visuals.
- \`kpi-metric\`: Big number headline KPI card with delta comparison.

When I ask for a transit question or visualization, respond with:
1. The **Recommended Visual Type** (e.g. \`station-progression\`, \`marey-chart\`, \`bar\`) and why.
2. A ready-to-run **DuckDB SQL query** against \`prod.transit_v2\` that satisfies all required schema columns, joins \`view_dim_stations\` for human-readable \`station_name\`s, and includes an \`event_date\` partition filter.
`;
}

let lastConnectedSocrata: {
  viewName: string;
  name: string;
  domain: string;
  id: string;
  rowCount?: number | undefined;
} | null = null;

interface UserDefinedSqlView {
  viewName: string;
  sqlText: string;
  updatedAt: string;
}

const userDefinedViews: UserDefinedSqlView[] = [];

export function renderDataUploadsView(container: HTMLElement): void {
  let showRawScd2 = false;
  let customViewNameDraft = '';
  let customViewSqlDraft = '';
  let customViewStatus: string | null = null;
  let catalogUrlStatus: string | null = null;
  let isUpdatingCatalogUrl = false;
  const snapshots: SnapshotItem[] = [
    {
      snapshotId: 'latest',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      isWithin7Days: true,
    },
  ];
  let socrataQuery = '';
  let socrataPortal: SocrataPortalDomain = 'all';
  let socrataResults: SocrataDatasetHit[] = [...CURATED_SOCRATA_TRANSIT_DATASETS];
  let socrataSearching = false;
  let connectingSocrataView: string | null = null;
  let socrataErrorBanner: string | null = null;
  let socrataStatusMessage = 'Showing featured NY State (data.ny.gov) and NYC Open Data (data.cityofnewyork.us) Socrata datasets.';

  const totalMetricsCount = DBTC_OSSIE_THEMES.reduce((acc, t) => acc + t.metrics.length, 0);

  const openSourceInNewNotebookCell = async (viewName: string, datasetTitle: string) => {
    const newId = asCellId(`cell_${Date.now().toString(36)}`);
    const ordinal = store.cells.length;
    const sqlText = `SELECT *\nFROM local.main.${viewName}\nLIMIT 100;`;
    const newCell = {
      cellId: newId,
      ordinal,
      viewName: asCellViewIdentifier(`local.main.${newId}`),
      kind: 'question' as const,
      title: datasetTitle || `Socrata: ${viewName}`,
      subtitle: `Queried from local.main.${viewName}`,
      sourceNote: 'Source: StraphangerDB',
      markdownText: '',
      sqlText,
      params: {},
      ossieConfig: null,
      chartType: 'table' as const,
      chartConfig: {},
      ducklakeSnapshotId: null,
      executionState: { status: 'idle' as const },
      snapshotState: { status: 'unpinned' as const },
      showSqlEditor: false,
      showOssiePillBar: true,
    };
    store.cells.push(newCell);
    store.notebook.activeCellId = newId;
    store.notebook.activeView = 'studio';

    try {
      const conn = getDuckDbConnection() ?? (await getDuckDb()).conn;
      await persistCellToDuckDb(conn, newCell);
      await executeCellQuery(conn, newId);
    } catch (err) {
      console.warn('Could not auto-execute new Socrata notebook cell:', err);
    }
  };

  const renderContent = () => {
    const connectedSourceNames = new Set(store.sources.map(s => s.sourceName));
    if (lastConnectedSocrata && !connectedSourceNames.has(lastConnectedSocrata.viewName)) {
      lastConnectedSocrata = null;
    }

    container.innerHTML = `
      <div class="data-uploads-view">
        <header class="uploads-header">
          <div class="uploads-header-info">
            <h1>Data &amp; Catalog Explorer</h1>
            <p>Browse built-in StraphangerDB lakehouse tables and the DBTC Ossie semantic model, upload manual CSV/Parquet files, search NY &amp; NYC Open Data portals, or define your own SQL views.</p>
          </div>
        </header>

        <div class="uploads-grid">
          <!-- Bucket Card 1: Built-In Datasets: NYC DuckLake Catalog (prod.transit_v2) + Ossie Spec (dbtc) -->
          <section class="uploads-card uploads-card-full" id="builtin-catalog-ossie-card">
            <h2>1. NYC DuckLake Catalog (prod.transit_v2) &amp; Ossie Semantic Model (dbtc &middot; ${totalMetricsCount} Metrics)</h2>
            <p class="socrata-subtitle" style="margin-bottom: 12px;">
              Built-in multi-agency transit lakehouse relations and semantic metrics pre-attached in every DBTC notebook.
            </p>
            <div class="catalog-url-config" style="margin-bottom: 14px; padding: 10px 12px; border: 1px solid #E2E8F0; border-radius: 6px; background: #F8FAFC;">
              <label for="ducklake-catalog-url-input" style="display: block; font-size: 12px; font-weight: 700; color: #0F172A; margin-bottom: 6px;">
                DuckLake Catalog URL (<code>prod</code>)
              </label>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                <input
                  type="url"
                  id="ducklake-catalog-url-input"
                  class="dbtc-input"
                  value="${(store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL).replace(/"/g, '&quot;')}"
                  placeholder="${DEFAULT_DUCKLAKE_CATALOG_URL}"
                  style="flex: 1; min-width: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;"
                  ${isUpdatingCatalogUrl ? 'disabled' : ''}
                />
                <button type="button" id="save-catalog-url-btn" class="dbtc-btn btn-sm btn-primary" ${isUpdatingCatalogUrl ? 'disabled' : ''}>
                  ${isUpdatingCatalogUrl ? 'Connecting...' : 'Apply &amp; Reconnect'}
                </button>
                <button type="button" id="reset-catalog-url-btn" class="dbtc-btn btn-sm btn-secondary" ${isUpdatingCatalogUrl ? 'disabled' : ''}>
                  Reset Default
                </button>
              </div>
              <div style="margin-top: 6px; font-size: 11px; color: #64748B;">
                Saved in <code>local.main._dbtc_notebook</code> and preserved when you download this notebook HTML file.
              </div>
              ${
                catalogUrlStatus
                  ? `<div class="socrata-status-bar" style="margin-top: 8px;">${catalogUrlStatus}</div>`
                  : ''
              }
            </div>
            <div class="catalog-controls">
              <label class="raw-scd2-toggle-label">
                <input type="checkbox" id="toggle-raw-scd2" ${showRawScd2 ? 'checked' : ''} />
                Include Raw SCD2 Base Tables (Warning: Historical snapshots contain multiple rows per entity)
              </label>
            </div>

            <div class="catalog-relations-list">
              <h3>Recommended Deduplicated Views (NYC Agencies Scoped) <span style="font-size: 11px; font-weight: 400; color: #64748B;">(Click to copy)</span></h3>
              <ul class="relation-pills">
                ${RECOMMENDED_ANALYTICS_RELATIONS.map(rel => `<li class="rel-pill rel-view" data-copy-rel="prod.transit_v2.${rel}" role="button" tabindex="0" title="Click to copy prod.transit_v2.${rel}" style="cursor: pointer;">prod.transit_v2.${rel}</li>`).join('')}
              </ul>

              ${
                showRawScd2
                  ? `
                <div class="scd2-section">
                  <h3>Raw SCD2 Base Tables</h3>
                  <div class="scd2-warning-box">
                    ⚠️ SCD2 base tables contain raw historical valid_from / valid_to records. For standard analytics, use the corresponding view_* deduplicated views instead.
                  </div>
                  <ul class="relation-pills">
                    ${TRANSIT_BASE_TABLES.map(t => `<li class="rel-pill rel-base">prod.transit_v2.${t}</li>`).join('')}
                  </ul>
                </div>
              `
                  : ''
              }

              <h3>Supported NYC Agencies</h3>
              <div class="agencies-pills">
                ${NYC_AGENCIES.map(a => `<span class="agency-badge">${a}</span>`).join('')}
              </div>

              <h3>Active 7-Day DuckLake Catalog Status</h3>
              <table class="dbtc-sources-table">
                <thead>
                  <tr>
                    <th>Snapshot ID</th>
                    <th>Timestamp</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${snapshots
                    .map(
                      s => `
                    <tr>
                      <td><code>${s.snapshotId}</code></td>
                      <td>${s.timestamp}</td>
                      <td>
                        <span class="snapshot-badge ${s.isWithin7Days ? 'badge-active' : 'badge-expired'}">
                          ${s.isWithin7Days ? 'Active (<= 7 days)' : 'Expired (> 7 days)'}
                        </span>
                      </td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>

              <h3 style="margin-top: 18px;">Ossie Semantic Model Reference (dbtc &middot; ${totalMetricsCount} Metrics)</h3>
              <div class="ossie-themes-accordion">
                ${DBTC_OSSIE_THEMES.map(
                  t => `
                  <div class="ossie-theme-panel">
                    <div class="theme-panel-header">
                      <span class="theme-name"><b>${t.name}</b></span>
                      <span class="theme-desc">${t.description}</span>
                    </div>
                    <div class="theme-panel-body">
                      <div class="theme-metrics-list">
                        <b>Datasets (${t.datasets.length}):</b>
                        <ul>
                          ${t.datasets.map(d => `<li><code>${d.name}</code> &rarr; <code>${d.source}</code>: ${d.description}</li>`).join('')}
                        </ul>
                        <b>Metrics (${t.metrics.length}):</b>
                        <ul>
                          ${t.metrics.map(m => `<li><code>${m.name}</code>: ${m.description || m.expression}</li>`).join('')}
                        </ul>
                      </div>
                    </div>
                  </div>
                `
                ).join('')}
              </div>
            </div>
          </section>

          <!-- Bucket Card 2: Manual Upload & Remote URL -->
          <section class="uploads-card uploads-card-full" id="manual-upload-card">
            <h2>2. Manual Upload: Local File or Connect Remote URL</h2>
            <div class="upload-dropzone" id="file-dropzone">
              <p>Drag &amp; drop local CSV or Parquet file (<code>.csv</code>, <code>.parquet</code>, <code>.pq</code> — max 100 MB)</p>
              <label class="dbtc-btn btn-primary file-select-label">
                Select Local File
                <input type="file" id="local-file-input" accept=".csv,.parquet,.pq" style="display:none;" />
              </label>
              <label class="offline-export-checkbox-label">
                <input type="checkbox" id="include-in-offline-checkbox" />
                Include raw table in Offline .dbtc.html export
              </label>
              <div id="upload-progress-status" style="margin-top: 8px; font-size: 12px; color: #0039A6; display: none;"></div>
            </div>

            <div class="remote-url-box">
              <h3>Connect Remote CSV / Parquet URL</h3>
              <p style="font-size: 11.5px; color: #64748B; margin: 0 0 8px;">
                Remote URLs are queried directly from your browser via DuckDB-Wasm — the host must allow CORS (<code>Access-Control-Allow-Origin: *</code>) and serve raw CSV or Parquet.
              </p>
              <div class="remote-url-form">
                <input type="text" id="remote-name-input" class="dbtc-input" placeholder="View name (e.g. mta_turnstiles_2024)" />
                <input type="url" id="remote-url-input" class="dbtc-input" placeholder="https://example.com/data.csv or .parquet" />
                <button id="add-remote-url-btn" class="dbtc-btn btn-secondary">Connect View</button>
              </div>
            </div>

            <div class="active-sources-list">
              <h3>Registered Data Sources (${store.sources.length})</h3>
              ${
                store.sources.length === 0
                  ? '<p class="empty-state">No custom local or remote data sources registered.</p>'
                  : `
                <table class="dbtc-sources-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Target</th>
                      <th>Offline Export</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${store.sources
                      .map(
                        s => `
                      <tr>
                        <td><b>local.main.${s.sourceName}</b></td>
                        <td>${s.kind}</td>
                        <td class="socrata-endpoint-url">${s.urlOrFilename}</td>
                        <td>${s.includeInOfflineExport ? 'Yes' : 'No'}</td>
                        <td>
                          <div class="source-action-btns">
                            <button type="button" class="dbtc-btn btn-xs btn-secondary query-socrata-cell-btn" data-socrata-view="${s.sourceName}" data-socrata-name="${s.sourceName}">Query in Notebook</button>
                            <button type="button" class="dbtc-btn btn-xs btn-danger delete-source-btn" data-source-name="${s.sourceName}">Delete</button>
                          </div>
                        </td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              `
              }
            </div>
          </section>

          <!-- Bucket Card 3: Socrata Search -->
          <section class="uploads-card uploads-card-full socrata-explorer-card" id="socrata-open-data-explorer">
            <div class="socrata-card-header">
              <div>
                <h2>3. Search NY &amp; NYC Open Data Portals</h2>
                <p class="socrata-subtitle">
                  Search public datasets across <a href="https://data.ny.gov/" target="_blank" rel="noopener noreferrer">data.ny.gov</a> (NY State &amp; MTA Open Data) and <a href="https://data.cityofnewyork.us/" target="_blank" rel="noopener noreferrer">data.cityofnewyork.us</a> (NYC Open Data) and mount any dataset directly into DuckDB.
                </p>
              </div>
            </div>

            <div class="socrata-search-controls">
              <input
                type="search"
                id="socrata-search-input"
                class="dbtc-input socrata-search-input"
                placeholder="Search datasets (e.g. subway ridership, turnstiles, stations, bus lanes, citi bike)..."
                value="${socrataQuery.replace(/"/g, '&quot;')}"
              />
              <select id="socrata-portal-select" class="dbtc-select socrata-portal-select" aria-label="Open Data Portal">
                <option value="all" ${socrataPortal === 'all' ? 'selected' : ''}>All Portals (data.ny.gov + data.cityofnewyork.us)</option>
                <option value="data.ny.gov" ${socrataPortal === 'data.ny.gov' ? 'selected' : ''}>NY State &amp; MTA (https://data.ny.gov/)</option>
                <option value="data.cityofnewyork.us" ${socrataPortal === 'data.cityofnewyork.us' ? 'selected' : ''}>NYC Open Data (https://data.cityofnewyork.us/)</option>
              </select>
              <button id="socrata-search-btn" class="dbtc-btn btn-primary" ${socrataSearching ? 'disabled' : ''}>
                ${socrataSearching ? 'Searching...' : 'Search Socrata'}
              </button>
            </div>

            <div class="socrata-quick-chips">
              <span class="socrata-chip-label">Quick topics:</span>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="subway ridership">Subway Ridership</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="subway stations">Subway Stations</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="origin destination">Origin-Destination</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="customer journey">Customer Journey</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="bus lanes">Bus Lanes</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="borough boundaries">Borough Boundaries</button>
              <button type="button" class="dbtc-btn btn-xs socrata-topic-chip" data-query="">Show All Featured</button>
            </div>

            <div class="socrata-status-bar">${socrataStatusMessage}</div>

            ${
              lastConnectedSocrata
                ? `
              <div class="socrata-connected-banner" id="socrata-connected-banner" role="status">
                <div class="socrata-connected-banner-main">
                  <span class="socrata-connected-check">✓ Connected to DuckDB</span>
                  <span class="socrata-connected-detail">
                    <b>${lastConnectedSocrata.name}</b> (${lastConnectedSocrata.domain} &middot; <code>${lastConnectedSocrata.id}</code>) is mounted at
                    <code>local.main.${lastConnectedSocrata.viewName}</code>${
                      lastConnectedSocrata.rowCount !== undefined
                        ? ` (${lastConnectedSocrata.rowCount.toLocaleString()} rows loaded)`
                        : ''
                    }
                  </span>
                </div>
                <div class="socrata-connected-banner-actions">
                  <code class="socrata-sql-preview">SELECT * FROM local.main.${lastConnectedSocrata.viewName} LIMIT 100;</code>
                  <button
                    type="button"
                    class="dbtc-btn btn-xs btn-secondary copy-socrata-sql-btn"
                    data-sql="SELECT * FROM local.main.${lastConnectedSocrata.viewName} LIMIT 100;"
                  >
                    Copy SQL
                  </button>
                  <button
                    type="button"
                    class="dbtc-btn btn-xs btn-primary query-socrata-cell-btn"
                    data-socrata-view="${lastConnectedSocrata.viewName}"
                    data-socrata-name="${lastConnectedSocrata.name.replace(/"/g, '&quot;')}"
                  >
                    Open in New Notebook Cell
                  </button>
                </div>
              </div>
            `
                : ''
            }

            ${
              socrataErrorBanner
                ? `
              <div class="socrata-error-banner" role="alert">
                ⚠️ ${socrataErrorBanner}
              </div>
            `
                : ''
            }

            ${
              socrataResults.length === 0
                ? '<p class="empty-state">No matching Socrata datasets found. Try a broader search query or switch portal filter to All Portals.</p>'
                : `
              <table class="dbtc-sources-table socrata-results-table">
                <thead>
                  <tr>
                    <th>Portal</th>
                    <th>Dataset &amp; Socrata ID</th>
                    <th>Description</th>
                    <th>Endpoint &amp; DuckDB Relation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${socrataResults
                    .map(hit => {
                      const isConnected = connectedSourceNames.has(hit.suggestedViewName);
                      const isConnecting = connectingSocrataView === hit.suggestedViewName;
                      const rowCount = getConnectedSourceRowCount(hit.suggestedViewName);
                      return `
                    <tr class="${isConnected ? 'socrata-row-connected' : ''} ${isConnecting ? 'socrata-row-connecting' : ''}">
                      <td>
                        <span class="socrata-domain-badge ${hit.domain === 'data.ny.gov' ? 'domain-ny' : 'domain-nyc'}">
                          ${hit.domain}
                        </span>
                      </td>
                      <td>
                        <div class="socrata-dataset-title">
                          <a href="${hit.permalink}" target="_blank" rel="noopener noreferrer"><b>${hit.name}</b></a>
                        </div>
                        <div class="socrata-dataset-meta">
                          ID: <code>${hit.id}</code> &middot; ${hit.category} &middot; Updated: ${hit.updatedAt}
                        </div>
                      </td>
                      <td class="socrata-dataset-desc">${hit.description.slice(0, 220)}${hit.description.length > 220 ? '...' : ''}</td>
                      <td>
                        <div class="socrata-relation-cell">
                          <code>local.main.${hit.suggestedViewName}</code>
                          ${
                            isConnected
                              ? `<span class="socrata-connected-pill">✓ Mounted in DuckDB${
                                  rowCount !== undefined ? ` (${rowCount.toLocaleString()} rows)` : ''
                                }</span>`
                              : ''
                          }
                        </div>
                        <div class="socrata-endpoint-url"><code>${hit.csvUrl}</code></div>
                      </td>
                      <td>
                        <div class="socrata-action-group">
                          <button
                            type="button"
                            class="dbtc-btn btn-xs ${
                              isConnecting
                                ? 'socrata-btn-connecting'
                                : isConnected
                                  ? 'socrata-btn-connected'
                                  : 'btn-primary'
                            } connect-socrata-btn"
                            data-socrata-id="${hit.id}"
                            data-socrata-domain="${hit.domain}"
                            data-socrata-name="${hit.name.replace(/"/g, '&quot;')}"
                            data-socrata-view="${hit.suggestedViewName}"
                            data-socrata-csv="${hit.csvUrl}"
                            ${isConnecting ? 'disabled' : ''}
                          >
                            ${
                              isConnecting
                                ? '⏳ Connecting to DuckDB...'
                                : isConnected
                                  ? '✓ Connected in DuckDB'
                                  : 'Connect to DuckDB'
                            }
                          </button>
                          ${
                            isConnected
                              ? `
                            <button
                              type="button"
                              class="dbtc-btn btn-xs btn-secondary query-socrata-cell-btn"
                              data-socrata-view="${hit.suggestedViewName}"
                              data-socrata-name="${hit.name.replace(/"/g, '&quot;')}"
                            >
                              Open in Notebook
                            </button>
                          `
                              : ''
                          }
                        </div>
                      </td>
                    </tr>
                  `;
                    })
                    .join('')}
                </tbody>
              </table>
            `
            }
          </section>

          <!-- Bucket Card 4: User-Defined Views (local.main) -->
          <section class="uploads-card uploads-card-full" id="user-defined-views-card">
            <h2>4. User-Defined SQL Views (local.main)</h2>
            <p class="socrata-subtitle" style="margin-bottom: 12px;">
              Define reusable custom SQL views in <code>local.main</code> that can be queried across any cell in your notebook.
            </p>
            <div class="remote-url-box" style="margin-top: 8px;">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                  <label for="custom-view-name-input" style="font-size: 12px; font-weight: 600;">View Name:</label>
                  <input
                    type="text"
                    id="custom-view-name-input"
                    class="dbtc-input"
                    style="max-width: 280px;"
                    placeholder="e.g. view_rush_hour_routes"
                    value="${customViewNameDraft.replace(/"/g, '&quot;')}"
                  />
                  <button type="button" id="save-custom-view-btn" class="dbtc-btn btn-primary">
                    Create / Replace View
                  </button>
                </div>
                <textarea
                  id="custom-view-sql-input"
                  class="dbtc-input"
                  rows="4"
                  style="font-family: var(--font-mono, monospace); font-size: 12px; width: 100%; resize: vertical;"
                  placeholder="SELECT route_id, count(*) AS stop_events FROM prod.transit_v2.view_station_headways WHERE event_date >= CURRENT_DATE - INTERVAL '1 day' GROUP BY 1"
                >${customViewSqlDraft}</textarea>
                ${
                  customViewStatus
                    ? `<div class="socrata-status-bar" style="margin-top: 4px;">${customViewStatus}</div>`
                    : ''
                }
              </div>
            </div>

            <div class="active-sources-list" style="margin-top: 14px;">
              <h3>Defined User Views (${userDefinedViews.length})</h3>
              ${
                userDefinedViews.length === 0
                  ? '<p class="empty-state">No custom SQL views defined yet. Enter a view name and SQL query above to create one in <code>local.main</code>.</p>'
                  : `
                <table class="dbtc-sources-table">
                  <thead>
                    <tr>
                      <th>Relation</th>
                      <th>SQL Definition</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${userDefinedViews
                      .map(
                        v => `
                      <tr>
                        <td><b>local.main.${v.viewName}</b></td>
                        <td><code style="font-size: 11px;">${v.sqlText.replace(/</g, '&lt;')}</code></td>
                        <td>${v.updatedAt}</td>
                        <td>
                          <div class="source-action-btns">
                            <button type="button" class="dbtc-btn btn-xs btn-secondary query-socrata-cell-btn" data-socrata-view="${v.viewName}" data-socrata-name="View: ${v.viewName}">Query in Notebook</button>
                            <button type="button" class="dbtc-btn btn-xs btn-danger drop-custom-view-btn" data-view-name="${v.viewName}">Drop View</button>
                          </div>
                        </td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              `
              }
            </div>
          </section>
        </div>
      </div>
    `;

    // Attach event listeners
    const fileInput = container.querySelector('#local-file-input') as HTMLInputElement | null;
    const offlineCheckbox = container.querySelector('#include-in-offline-checkbox') as HTMLInputElement | null;
    const remoteNameInput = container.querySelector('#remote-name-input') as HTMLInputElement | null;
    const remoteUrlInput = container.querySelector('#remote-url-input') as HTMLInputElement | null;
    const addRemoteBtn = container.querySelector('#add-remote-url-btn') as HTMLButtonElement | null;
    const toggleScd2Checkbox = container.querySelector('#toggle-raw-scd2') as HTMLInputElement | null;
    const catalogUrlInput = container.querySelector('#ducklake-catalog-url-input') as HTMLInputElement | null;
    const saveCatalogUrlBtn = container.querySelector('#save-catalog-url-btn') as HTMLButtonElement | null;
    const resetCatalogUrlBtn = container.querySelector('#reset-catalog-url-btn') as HTMLButtonElement | null;

    const applyCatalogUrl = async (rawUrl: string) => {
      const nextUrl = rawUrl.trim();
      if (!nextUrl || !/^https?:\/\//i.test(nextUrl)) {
        catalogUrlStatus = '⚠️ Please enter a valid http:// or https:// DuckLake catalog.db URL.';
        renderContent();
        return;
      }
      isUpdatingCatalogUrl = true;
      catalogUrlStatus = null;
      renderContent();
      try {
        store.notebook.catalogUrl = nextUrl;
        const conn = getDuckDbConnection() ?? (await getDuckDb()).conn;
        await persistNotebookToDuckDb(conn, store.notebook);
        if (store.notebook.mode === 'offline') {
          catalogUrlStatus = '✓ Saved catalog URL to DuckDB (will attach when switched out of Offline mode).';
        } else {
          resetCatalogHeaderStateForTest();
          const ok = await refreshRemoteCatalog(conn, { force: true, catalogUrl: nextUrl });
          catalogUrlStatus = ok
            ? '✓ Connected to DuckLake catalog and saved to DuckDB.'
            : '⚠️ Saved catalog URL to DuckDB, but could not attach remote catalog (check URL/CORS).';
        }
      } catch (err) {
        catalogUrlStatus = `⚠️ Failed to update catalog URL: ${String(err)}`;
      } finally {
        isUpdatingCatalogUrl = false;
        renderContent();
      }
    };

    saveCatalogUrlBtn?.addEventListener('click', () => {
      void applyCatalogUrl(catalogUrlInput?.value ?? '');
    });

    resetCatalogUrlBtn?.addEventListener('click', () => {
      void applyCatalogUrl(DEFAULT_DUCKLAKE_CATALOG_URL);
    });
    const socrataInput = container.querySelector('#socrata-search-input') as HTMLInputElement | null;
    const socrataPortalSelect = container.querySelector('#socrata-portal-select') as HTMLSelectElement | null;
    const socrataSearchBtn = container.querySelector('#socrata-search-btn') as HTMLButtonElement | null;
    const customViewNameInput = container.querySelector('#custom-view-name-input') as HTMLInputElement | null;
    const customViewSqlInput = container.querySelector('#custom-view-sql-input') as HTMLTextAreaElement | null;
    const saveCustomViewBtn = container.querySelector('#save-custom-view-btn') as HTMLButtonElement | null;

    saveCustomViewBtn?.addEventListener('click', async () => {
      const rawName = (customViewNameInput?.value ?? '').trim();
      const rawSql = (customViewSqlInput?.value ?? '').trim().replace(/(?:\s*;)+\s*$/, '');
      const cleanName = rawName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      if (!cleanName || !rawSql) {
        customViewStatus = '⚠️ Please provide both a valid view name and a SQL SELECT query.';
        renderContent();
        return;
      }
      customViewNameDraft = cleanName;
      customViewSqlDraft = rawSql;
      try {
        const conn = getDuckDbConnection() ?? (await getDuckDb()).conn;
        await conn.query(`CREATE OR REPLACE VIEW local.main."${cleanName}" AS ${rawSql};`);
        const existingIdx = userDefinedViews.findIndex(v => v.viewName === cleanName);
        const entry: UserDefinedSqlView = {
          viewName: cleanName,
          sqlText: rawSql,
          updatedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        if (existingIdx >= 0) {
          userDefinedViews[existingIdx] = entry;
        } else {
          userDefinedViews.push(entry);
        }
        customViewNameDraft = '';
        customViewSqlDraft = '';
        customViewStatus = `✓ Created view local.main.${cleanName}.`;
        renderContent();
      } catch (err) {
        customViewStatus = `⚠️ Failed creating view local.main.${cleanName}: ${String(err)}`;
        renderContent();
      }
    });

    container.querySelectorAll('.drop-custom-view-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const viewName = btn.getAttribute('data-view-name') ?? '';
        if (!viewName) return;
        try {
          const conn = getDuckDbConnection() ?? (await getDuckDb()).conn;
          await conn.query(`DROP VIEW IF EXISTS local.main."${viewName.replace(/"/g, '""')}";`);
        } catch {
          // Proceed even if already dropped
        }
        const idx = userDefinedViews.findIndex(v => v.viewName === viewName);
        if (idx >= 0) userDefinedViews.splice(idx, 1);
        customViewStatus = `Dropped view local.main.${viewName}.`;
        renderContent();
      });
    });

    const runSocrataSearch = async (queryText: string, portalVal: SocrataPortalDomain) => {
      socrataQuery = queryText;
      socrataPortal = portalVal;
      socrataSearching = true;
      socrataStatusMessage = `Searching ${portalVal === 'all' ? 'data.ny.gov and data.cityofnewyork.us' : portalVal}...`;
      renderContent();

      const hits = await searchSocrataCatalog(socrataQuery, socrataPortal);
      socrataResults = hits;
      socrataSearching = false;
      const portalLabel =
        socrataPortal === 'all'
          ? 'data.ny.gov & data.cityofnewyork.us'
          : socrataPortal;
      socrataStatusMessage = socrataQuery.trim()
        ? `Found ${hits.length} Socrata dataset${hits.length === 1 ? '' : 's'} matching "${socrataQuery.trim()}" across ${portalLabel}.`
        : `Showing ${hits.length} featured Socrata datasets across ${portalLabel}.`;
      renderContent();
    };

    socrataSearchBtn?.addEventListener('click', () => {
      const q = socrataInput?.value ?? '';
      const p = (socrataPortalSelect?.value as SocrataPortalDomain) || 'all';
      void runSocrataSearch(q, p);
    });

    socrataInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = socrataInput.value;
        const p = (socrataPortalSelect?.value as SocrataPortalDomain) || 'all';
        void runSocrataSearch(q, p);
      }
    });

    socrataPortalSelect?.addEventListener('change', () => {
      const q = socrataInput?.value ?? socrataQuery;
      const p = (socrataPortalSelect.value as SocrataPortalDomain) || 'all';
      void runSocrataSearch(q, p);
    });

    container.querySelectorAll('.socrata-topic-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-query') ?? '';
        void runSocrataSearch(q, socrataPortal);
      });
    });

    container.querySelectorAll('.connect-socrata-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const viewName = btn.getAttribute('data-socrata-view') ?? '';
        const csvUrl = btn.getAttribute('data-socrata-csv') ?? '';
        const domain = btn.getAttribute('data-socrata-domain') ?? '';
        const datasetId = btn.getAttribute('data-socrata-id') ?? '';
        const datasetName = btn.getAttribute('data-socrata-name') || viewName;
        if (!viewName || !csvUrl) return;

        if (remoteNameInput) remoteNameInput.value = viewName;
        if (remoteUrlInput) remoteUrlInput.value = csvUrl;

        socrataErrorBanner = null;
        connectingSocrataView = viewName;
        socrataStatusMessage = `⏳ Connecting ${domain}/${datasetId} into DuckDB as local.main.${viewName}...`;
        renderContent();

        try {
          let db = getDuckDbClient();
          let conn = getDuckDbConnection();
          if (!db || !conn) {
            const initialized = await getDuckDb();
            db = initialized.db;
            conn = initialized.conn;
          }

          const finalViewName = await registerRemoteUrlView(conn, viewName, csvUrl, false, db);
          const rowCount = getConnectedSourceRowCount(finalViewName);
          connectingSocrataView = null;
          lastConnectedSocrata = {
            viewName: finalViewName,
            name: datasetName,
            domain,
            id: datasetId,
            rowCount,
          };
          socrataStatusMessage = `✓ Connected Socrata dataset ${domain}/${datasetId} as DuckDB relation local.main.${finalViewName}${
            rowCount !== undefined ? ` (${rowCount.toLocaleString()} rows)` : ''
          }.`;
          renderContent();
        } catch (err) {
          console.error('Socrata dataset connect error:', err);
          connectingSocrataView = null;
          socrataErrorBanner = `Could not directly mount ${domain}/${datasetId} (${String(err)}). The CSV URL has been populated in Section 2 above.`;
          socrataStatusMessage = `Populated ${csvUrl} into Remote URL input.`;
          renderContent();
        }
      });
    });

    container.querySelectorAll('.copy-socrata-sql-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sql = btn.getAttribute('data-sql') ?? '';
        if (!sql) return;
        try {
          await navigator.clipboard.writeText(sql);
          const origText = btn.textContent;
          btn.textContent = '✓ Copied SQL!';
          setTimeout(() => {
            btn.textContent = origText;
          }, 1800);
        } catch {
          // Ignore clipboard permission failure
        }
      });
    });

    container.querySelectorAll('.query-socrata-cell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const viewName = btn.getAttribute('data-socrata-view') ?? '';
        const datasetName = btn.getAttribute('data-socrata-name') ?? viewName;
        if (!viewName) return;
        void openSourceInNewNotebookCell(viewName, datasetName);
      });
    });

    toggleScd2Checkbox?.addEventListener('change', () => {
      showRawScd2 = toggleScd2Checkbox.checked;
      renderContent();
    });

    // Click-to-copy on catalog relation pills
    container.querySelectorAll('.rel-pill[data-copy-rel]').forEach(pill => {
      const copyRel = async () => {
        const text = pill.getAttribute('data-copy-rel');
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          showToast(`Copied "${text}" to clipboard.`, 'success');
        } catch {
          showToast(`Relation: ${text}`, 'info');
        }
      };
      pill.addEventListener('click', () => void copyRel());
      pill.addEventListener('keydown', e => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          void copyRel();
        }
      });
    });

    const handleLocalFileIngest = async (file: File) => {
      const progressEl = container.querySelector('#upload-progress-status') as HTMLElement | null;
      if (progressEl) {
        progressEl.style.display = 'block';
        progressEl.textContent = `Ingesting "${file.name}" into local DuckDB-Wasm...`;
      }
      try {
        let db = getDuckDbClient();
        let conn = getDuckDbConnection();
        if (!db || !conn) {
          const initialized = await getDuckDb();
          db = initialized.db;
          conn = initialized.conn;
        }
        const includeInOffline = offlineCheckbox?.checked ?? false;
        const res = await ingestLocalFile(db, conn, file, includeInOffline);
        showToast(
          `Ingested local.main.${res.tableName} (${res.rowCount.toLocaleString()} rows).`,
          'success'
        );
        renderContent();
      } catch (err) {
        console.error('File ingest error:', err);
        showToast(`Error ingesting file: ${err instanceof Error ? err.message : String(err)}`, 'error');
        if (progressEl) {
          progressEl.style.display = 'none';
        }
      }
    };

    const dropzoneEl = container.querySelector('#file-dropzone') as HTMLElement | null;
    dropzoneEl?.addEventListener('dragover', e => {
      e.preventDefault();
      dropzoneEl.style.borderColor = '#0039A6';
      dropzoneEl.style.backgroundColor = '#EFF6FF';
    });
    dropzoneEl?.addEventListener('dragleave', () => {
      dropzoneEl.style.borderColor = '';
      dropzoneEl.style.backgroundColor = '';
    });
    dropzoneEl?.addEventListener('drop', e => {
      e.preventDefault();
      dropzoneEl.style.borderColor = '';
      dropzoneEl.style.backgroundColor = '';
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (file) {
        void handleLocalFileIngest(file);
      }
    });

    fileInput?.addEventListener('change', async e => {
      const inputEl = e.target as HTMLInputElement;
      const file = inputEl.files?.[0];
      if (!file) return;
      await handleLocalFileIngest(file);
      inputEl.value = '';
    });

    addRemoteBtn?.addEventListener('click', async () => {
      const viewName = remoteNameInput?.value.trim();
      const url = remoteUrlInput?.value.trim();
      if (!viewName || !url) {
        showToast('Please specify both view name and remote URL.', 'warning');
        return;
      }

      try {
        let db = getDuckDbClient();
        let conn = getDuckDbConnection();
        if (!db || !conn) {
          const initialized = await getDuckDb();
          db = initialized.db;
          conn = initialized.conn;
        }
        const registeredName = await registerRemoteUrlView(conn, viewName, url, undefined, db);
        const rowCount = getConnectedSourceRowCount(registeredName);
        lastConnectedSocrata = {
          viewName: registeredName,
          name: registeredName,
          domain: 'remote',
          id: 'custom-url',
          rowCount,
        };
        socrataStatusMessage = `✓ Connected remote relation local.main.${registeredName}.`;
        showToast(`Connected remote relation local.main.${registeredName}.`, 'success');
        if (remoteNameInput) remoteNameInput.value = '';
        if (remoteUrlInput) remoteUrlInput.value = '';
        renderContent();
      } catch (err) {
        console.error('Remote URL view error:', err);
        showToast(
          `Error connecting remote URL view: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        );
      }
    });

    container.querySelectorAll('.delete-source-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sourceName = btn.getAttribute('data-source-name');
        if (!sourceName) return;

        if (!confirm(`Delete registered source ${sourceName}?`)) return;

        const conn = getDuckDbConnection() ?? (await getDuckDb()).conn;
        await removeSource(conn, sourceName);
        if (lastConnectedSocrata?.viewName === sourceName) {
          lastConnectedSocrata = null;
        }
        renderContent();
      });
    });
  };

  renderContent();
}

