// Local DuckDB state schema DDL statements

export const LOCAL_STATE_DDL = `
CREATE TABLE IF NOT EXISTS local.main._dbtc_notebook (
  doc_id VARCHAR PRIMARY KEY,
  schema_version VARCHAR NOT NULL DEFAULT 'transit_v2',
  title VARCHAR NOT NULL,
  mode VARCHAR NOT NULL DEFAULT 'standard',
  live_interval_sec INTEGER NOT NULL DEFAULT 60,
  catalog_url VARCHAR NOT NULL,
  ossie_index_url VARCHAR NOT NULL,
  modified_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS local.main._dbtc_cells (
  cell_id VARCHAR PRIMARY KEY,
  ordinal INTEGER NOT NULL,
  view_name VARCHAR NOT NULL,
  kind VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  subtitle VARCHAR NOT NULL,
  source_note VARCHAR NOT NULL,
  markdown_text VARCHAR NOT NULL,
  sql_text VARCHAR NOT NULL,
  params_json VARCHAR NOT NULL,
  ossie_config_json VARCHAR,
  chart_type VARCHAR NOT NULL,
  chart_config_json VARCHAR NOT NULL,
  generated_at VARCHAR,
  ducklake_snapshot_id VARCHAR
);

CREATE TABLE IF NOT EXISTS local.main._dbtc_sources (
  source_name VARCHAR PRIMARY KEY,
  kind VARCHAR NOT NULL,
  url_or_filename VARCHAR NOT NULL,
  byte_size BIGINT,
  include_in_offline_export BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
`;

export const STARTER_NOTEBOOK = {
  docId: 'dbtc_starter_nyc',
  schemaVersion: 'transit_v2',
  title: 'NYC Transit Studio',
  mode: 'standard' as const,
  liveIntervalSec: 60,
  catalogUrl: 'https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ducklake/catalog.db',
  ossieIndexUrl: '',
  modifiedAt: Date.now(),
};

export const STARTER_CELLS = [
  {
    cellId: 'cell_intro',
    ordinal: 0,
    viewName: 'local.main.cell_intro',
    kind: 'markdown' as const,
    title: 'Welcome to Data Based Train Control',
    subtitle: 'NYC Transit Journalism and Analytics Studio',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `# Data Based Train Control (DBTC)

Welcome to **Data Based Train Control**, an interactive NYC transit notebook that runs live SQL and Apache Ossie semantic queries right inside your browser. Every chart and map below is powered by **DuckDB-Wasm** querying real metropolitan transit data from the **StraphangerDB** lakehouse, with no backend server required.

### StraphangerDB &amp; MTA Open Transit Resources

- **StraphangerDB Lakehouse**: [StraphangerDB Project](https://straphanger.page) &middot; [StraphangerDB DuckLake Catalog (\`prod.transit_v2\`)](https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ducklake/catalog.db) &middot; [Apache Ossie Semantic Specification (\`dbtc.ossie.yaml\`)](https://github.com/apache/ossie)
- **MTA Open Data &amp; Feeds**: [MTA Open Data Program](https://www.mta.info/open-data) &middot; [MTA Real-Time GTFS-RT Developer Portal](https://api.mta.info/) &middot; [MTA Performance &amp; Ridership Metrics](https://metrics.mta.info/)
- **New York Open Data Portals (Socrata) &amp; Maps**: [NY State Open Data (\`data.ny.gov\`)](https://data.ny.gov/browse?category=Transportation) &middot; [NYC Open Data (\`data.cityofnewyork.us\`)](https://data.cityofnewyork.us/) &middot; [Official MTA Subway Maps &amp; Diagrams](https://new.mta.info/maps)

### Part 1: Measuring Rider Wait Times Along a Line

When you ride a high-frequency subway line, you rarely check a printed timetable. What matters most is **headway**: how many minutes pass between one train and the next. In the **Station Progression** chart directly below, DBTC queries yesterday's daytime arrivals on the **Lexington Ave Line (4/5/6)** and calculates average wait intervals at every stop from The Bronx through Manhattan into Brooklyn. Shorter bars mean more frequent service and less time waiting on the platform.

<div class="story-callout"><span class="story-badge">Explore DBTC</span> Click <kbd>Show SQL</kbd> on any chart cell to read or edit its query, <kbd>Metric Builder</kbd> to build semantic queries with the <code>dbtc</code> Ossie spec without writing SQL, or open <kbd>Data &amp; Catalog Explorer</kbd> to search NY State and NYC Open Data portals directly.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_headways',
    ordinal: 1,
    viewName: 'local.main.cell_headways',
    kind: 'question' as const,
    title: 'Lexington Ave Line (4/5/6) Headway Regularity',
    subtitle: 'Observed morning rush train intervals (seconds) from The Bronx through Manhattan to Brooklyn yesterday (7-11 AM ET). Lower values are better: shorter bars mean higher frequency service and shorter wait times for riders.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v21-fast-yesterday-headways -- v20-straphangerdb-base-starter -- v19-prev-weekday-pruned-starter): Lexington Ave Line (4/5/6) Headway Regularity
SELECT *
FROM ossie_query(
  'dbtc',
  'subway_station_headways',
  '',
  'agency_id = ''MTA_NYCT_SUBWAY'' AND route_id IN (''4'', ''5'', ''6'') AND window = ''yesterday_am_rush'''
);`,
    paramsJson: '{"route_id": "4,5,6"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'subway_station_headways',
      selectedDimensions: [],
      selectedMetrics: [],
      filters: [
        { field: 'window', operator: '=', value: 'yesterday_am_rush' },
        { field: 'subway_station_headways.agency_id', operator: '=', value: 'MTA_NYCT_SUBWAY' },
        { field: 'subway_station_headways.route_id', operator: 'IN', value: ['4', '5', '6'] },
      ],
    }),
    chartType: 'station-progression' as const,
    chartConfigJson: '{"alignmentMode": "corridor", "metricColumn": "headway_sec", "showBoroughBands": true}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_marey',
    ordinal: 2,
    viewName: 'local.main.cell_story_marey',
    kind: 'markdown' as const,
    title: 'Following Every Train Across the Line',
    subtitle: 'How stringline diagrams trace individual trips, station holds, and express overtakes',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 2: Following Every Train Across the Line

Station averages show *where* waits build up, but how does a delay actually ripple down the tracks? Because DBTC has access to individual train position pings, it can reconstruct every train's complete journey from terminal to terminal using a classic railroad **Stringline (Marey) Diagram**.

In the **Flushing Line (7 / &lt;7&gt;)** chart below, stations from Queens to Manhattan are listed top-to-bottom while time flows left-to-right across yesterday's morning rush (7:00 AM to 10:00 AM). Each diagonal thread is a single train run:
- **Steeper slopes** mean the train is moving fast between stops.
- **Flat horizontal steps** show a train dwelling at a platform or being held by dispatchers.
- **Evenly spaced parallel lines** indicate smooth, regular service, while lines that pinch together reveal trains bunching up. Look closely in Queens to spot steeper peak-direction **&lt;7&gt; express** trips overtaking local **7** trains.

<div class="story-callout"><span class="story-badge">How to Read</span> Hover over any train thread to inspect its trip ID, arrival timestamp, and headway gap behind the train ahead of it, drag the bottom zoom slider to focus on a narrower window, or click <kbd>Export</kbd> to save a high-resolution graphic.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_marey',
    ordinal: 3,
    viewName: 'local.main.cell_marey',
    kind: 'question' as const,
    title: 'Flushing Line (7 / <7>) Stringline Trajectory Diagram',
    subtitle: 'Observed Manhattan-bound train trajectories from Flushing-Main St to 34 St-Hudson Yards from 7:00 AM to 10:00 AM yesterday. Each line traces one train trip over time. Steeper slopes mean higher speed; flat segments indicate dwell or holding; parallel lines mean evenly spaced service. Watch for diamond express trains (<7>) overtaking locals.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v20-straphangerdb-base-starter -- v19-prev-weekday-pruned-starter): Flushing Line (7 / <7>) Stringline Trajectory Diagram
SELECT *
FROM ossie_query(
  'dbtc',
  'train_stringline_marey',
  '',
  'agency_id = ''MTA_NYCT_SUBWAY'' AND route_id IN (''7'', ''7X'') AND window = ''prev_weekday_am_rush'''
);`,
    paramsJson: '{"route_id": "7,7X"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'train_stringline_marey',
      selectedDimensions: [],
      selectedMetrics: [],
      filters: [
        { field: 'window', operator: '=', value: 'prev_weekday_am_rush' },
        { field: 'train_stringline_marey.agency_id', operator: '=', value: 'MTA_NYCT_SUBWAY' },
        { field: 'train_stringline_marey.route_id', operator: 'IN', value: ['7', '7X'] },
      ],
    }),
    chartType: 'marey-chart' as const,
    chartConfigJson: '{"showBoroughBands": true}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_headway_horizon',
    ordinal: 4,
    viewName: 'local.main.cell_story_headway_horizon',
    kind: 'markdown' as const,
    title: 'Spotting Train Bunching and Service Gaps',
    subtitle: 'Interactive wait-time thresholds at a shared Queens transfer hub',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 3: Spotting Train Bunching and Service Gaps

When two local routes share the same tracks, a minor signal hold at a merge can cause two trains to arrive right on each other's bumper, leaving commuters behind them waiting 12 minutes or more for the next train.

The **Headway Horizon** chart below zooms in on a single busy checkpoint (**Jackson Hts-Roosevelt Av** in Queens) during the morning rush for the **R** and **M** lines. Each point plots how long riders waited since the previous train on that route:
- **Red dips (under 2 min)** flag **train bunching**, where a train follows too closely behind the one ahead.
- **Purple spikes (over 10 min)** highlight **service gaps**, where riders face abnormally long platform waits.

<div class="story-callout"><span class="story-badge">Interactive Controls</span> Use the <kbd>Thresholds</kbd> menu and the <kbd>Linear</kbd> / <kbd>Log</kbd> scale toggle in the top-right corner of the chart card below to adjust bunching and gapping cutoffs on the fly.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_headway_horizon_rm',
    ordinal: 5,
    viewName: 'local.main.cell_headway_horizon_rm',
    kind: 'question' as const,
    title: 'Queens Blvd Local (R/M) Train Spacing & Bunching',
    subtitle: 'Actual wait time between trains arriving at Jackson Hts-Roosevelt Av from 7:00 AM to 10:00 AM yesterday. Published MTA target headways during this morning rush are 6 to 8 minutes for the R train and 8 to 10 minutes for the M train (see https://en.wikipedia.org/wiki/List_of_New_York_City_Subway_services#Train_intervals). Dips below 2 min indicate bunching; spikes above 10 min show service gaps.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v19-prev-weekday-pruned-starter): Queens Blvd Local (R/M) Train Spacing & Wait Times (Ossie Lens: dbtc.subway_headway_horizon)
-- Powered by the ergonomic dbtc.subway_headway_horizon Lens (pushes prev_weekday_am_rush + R/M route filters directly into DuckLake).
SELECT *
FROM ossie_query(
  'dbtc',
  'subway_headway_horizon',
  '',
  'subway_headway_horizon.window = ''prev_weekday_am_rush'' AND subway_headway_horizon.route_id IN (''R'', ''M'')'
);`,
    paramsJson: '{"route_id": "R,M"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'subway_headway_horizon',
      selectedDimensions: [
        'subway_headway_horizon.event_time',
        'subway_headway_horizon.route_id',
        'subway_headway_horizon.station_name',
      ],
      selectedMetrics: [],
      filters: [
        { field: 'subway_headway_horizon.route_id', operator: 'IN', value: ['R', 'M'] },
      ],
    }),
    chartType: 'headway-horizon' as const,
    chartConfigJson: '{"bunchingThresholdSec": 120, "gappingThresholdSec": 600, "yAxisScale": "linear"}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_adherence',
    ordinal: 6,
    viewName: 'local.main.cell_story_adherence',
    kind: 'markdown' as const,
    title: 'Did the Scheduled Trains Actually Run?',
    subtitle: 'Auditing published GTFS timetables against observed subway runs in SQL',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 4: Did the Scheduled Trains Actually Run?

Because DBTC runs a full relational SQL engine in your browser, you can join different tables together in a single query. Here we compare the MTA's published timetable (\`fact_schedules\`) against actual train detections (\`fact_vehicle_positions\`) to see how much of yesterday's promised service actually ran on the **L Line**.

The **Schedule Adherence Waterfall** below breaks the daily service audit into four clear steps:
- **Scheduled (Blue)**: The total number of train trips promised in the published timetable.
- **Ghost Trips (Red drop)**: Scheduled trips that never appeared in live tracking, often caused by crew shortages or equipment holds.
- **Unscheduled Added (Green step)**: Extra put-in trips added by dispatchers to fill gaps, leading to the final **Observed Operated (Orange)** total.

<div class="story-callout"><span class="story-badge">Try Changing the Route</span> Click <kbd>Show SQL</kbd> below and change <code>route_id = 'L'</code> to another subway line such as <code>'1'</code>, <code>'6'</code>, or <code>'A'</code>, then press <kbd>Run Query</kbd> to audit any line in the city.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_adherence_waterfall_canarsie',
    ordinal: 7,
    viewName: 'local.main.cell_adherence_waterfall_canarsie',
    kind: 'question' as const,
    title: 'Subway Route Schedule Adherence Waterfall',
    subtitle: 'Comparison of scheduled versus observed subway trips accounting for ghost trips and unscheduled service additions. High performance reflects greater than 95% service completion with near-zero ghost trips.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter): Subway Route Scheduled vs. Observed Trips Adherence Waterfall (Ossie Lens: dbtc.schedule_adherence_hourly)
-- Powered by the ergonomic dbtc.schedule_adherence_hourly Lens (compares published GTFS timetables against observed vehicle positions).
SELECT *
FROM ossie_query(
  'dbtc',
  'schedule_adherence_hourly',
  '',
  'schedule_adherence_hourly.window = ''yesterday'' AND schedule_adherence_hourly.route_id = ''L'''
);`,
    paramsJson: '{"route_id": "L"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'schedule_adherence_hourly',
      selectedDimensions: [
        'schedule_adherence_hourly.event_date',
        'schedule_adherence_hourly.agency_id',
        'schedule_adherence_hourly.route_id',
        'schedule_adherence_hourly.route_name',
      ],
      selectedMetrics: [
        'lens_scheduled_trips',
        'lens_observed_trips',
      ],
      filters: [
        { field: 'schedule_adherence_hourly.route_id', operator: '=', value: 'L' },
      ],
    }),
    chartType: 'adherence-waterfall' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_multimodal',
    ordinal: 8,
    viewName: 'local.main.cell_story_multimodal',
    kind: 'markdown' as const,
    title: 'Connecting Subways, Bikes, and Surface Transit',
    subtitle: 'Cross-agency queries joining subway turnstiles with live Citi Bike dock telemetry',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 5: Connecting Subways, Bikes, and Surface Transit

A New York commute rarely stops at the turnstile. StraphangerDB unifies **seven regional transit feeds** in one shared schema: NYC Subway, MTA Bus, LIRR, Metro-North, Staten Island Railway, NYC Ferry, and Citi Bike. That means a single DBTC cell can join underground rail ridership with street-level bike share availability.

The **Midtown Transit Pulse** chart below pairs hourly subway turnstile entries at **Grand Central-42 St** (bars, left axis) with available Citi Bikes, e-bikes, and open docks at surrounding street corners (lines, right axis) across all 24 hours of the day. Watch how rush-hour commuter surges drain nearby bike docks in the morning and evening, and how dock capacity recovers midday.

<div class="story-callout"><span class="story-badge">Multi-Agency Schema</span> You can query across all seven agencies using <code>agency_id</code> filters in SQL or by opening the <kbd>Data &amp; Schema</kbd> tab in the top navigation bar.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_multimodal_pulse_midtown',
    ordinal: 9,
    viewName: 'local.main.cell_multimodal_pulse_midtown',
    kind: 'question' as const,
    title: 'Midtown Transit Pulse: Subway Flows & Citi Bike Docks',
    subtitle: 'Hourly subway turnstile entries paired with adjacent micromobility bike and dock availability at Grand Central-42 St. NYC Subway fare gates meter entries only.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter): Midtown Transit Pulse: Subway Turnstile Entries & Citi Bike Availability (Ossie Lens: dbtc.multimodal_station_pulse)
-- Powered by the ergonomic dbtc.multimodal_station_pulse Lens across a 24-hour spine at Grand Central-42 St.
SELECT *
FROM ossie_query(
  'dbtc',
  'multimodal_station_pulse',
  '',
  'multimodal_station_pulse.window = ''yesterday'''
);`,
    paramsJson: '{"station_id": "610"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'multimodal_station_pulse',
      selectedDimensions: [
        'multimodal_station_pulse.hour_of_day',
      ],
      selectedMetrics: [
        'lens_multimodal_entries',
      ],
      filters: [],
    }),
    chartType: 'multimodal-pulse' as const,
    chartConfigJson: '{"groupBy": "time"}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_od_flow',
    ordinal: 10,
    viewName: 'local.main.cell_story_od_flow',
    kind: 'markdown' as const,
    title: 'Where Are Riders Actually Going?',
    subtitle: 'Exploring citywide origin-destination passenger flows across Sankey, bar, and matrix views',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 6: Where Are Riders Actually Going?

Turnstile counts tell us where riders swipe or tap into the system, while origin-destination models estimate where those trips finish across the five boroughs. DBTC lets you explore these station-to-station travel patterns and switch visual perspectives without rewriting your query.

The **Origin-Destination Passenger Flows** diagram below connects NYC's busiest subway hubs on the left (**Origins**) to destination complexes on the right (**Destinations**), calibrated to full-day turnstile volumes. Wider ribbons represent heavier daily rider corridors between major terminals like 34 St-Penn Station, Grand Central, Times Square, Fulton St, and Jackson Hts-Roosevelt Av.

<div class="story-callout"><span class="story-badge">Switch Views</span> Use the <kbd>Sankey</kbd>, <kbd>Ranked Bars</kbd>, and <kbd>Heatmap</kbd> buttons inside the chart or open <kbd>Hubs &amp; Thresholds</kbd> in the card header to pick custom stations and change how many top hubs are shown before long-tail stations group into <em>Other Stations</em>.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_od_ridership_flow',
    ordinal: 11,
    viewName: 'local.main.cell_od_ridership_flow',
    kind: 'question' as const,
    title: 'NYC Subway Key Hub Origin-Destination Passenger Flows',
    subtitle: 'Full-day passenger flows connecting high-ridership subway terminals and transfer hubs across Manhattan, Brooklyn, and Queens, calibrated to station complex turnstile entries. Configurable top volume hubs remain distinct while long-tail pairs group into Other Stations.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v20-straphangerdb-base-starter): Key NYC Subway Hub Origin-Destination Travel Matrix (Ossie Lens: dbtc.od_ridership_flows)
-- Powered by the ergonomic dbtc.od_ridership_flows Lens (unifies multi-complex terminals and calibrates to turnstile entries).
SELECT *
FROM ossie_query(
  'dbtc',
  'od_ridership_flows',
  '',
  'od_ridership_flows.window = ''od_baseline'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'od_ridership_flows',
      selectedDimensions: [
        'od_ridership_flows.origin_station_name',
        'od_ridership_flows.destination_station_name',
      ],
      selectedMetrics: ['lens_od_passengers'],
      filters: [],
    }),
    chartType: 'od-ridership-flow' as const,
    chartConfigJson: '{"displayMode": "sankey", "topStationsLimit": 10}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_route_speed',
    ordinal: 12,
    viewName: 'local.main.cell_story_route_speed',
    kind: 'markdown' as const,
    title: 'Mapping Corridor Speeds and Bottlenecks',
    subtitle: 'Spatial SQL and curved subway track geometry showing where trains fly and where they crawl',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 7: Mapping Corridor Speeds and Bottlenecks

Some transit questions only click when you see them on a map. DBTC pairs **DuckDB Spatial** with an interactive **MapLibre** subway canvas so station-to-station query results snap directly onto real NYC track curves.

In the **Route Segment Map** below, DBTC measures how many seconds trains take between consecutive stops and compares that against track distance to compute real-world speeds in miles per hour across Midtown Manhattan and Queens:
- **Emerald segments (22+ mph)** highlight fast express runs and East River tunnel crossings.
- **Cyan segments (14 to 22 mph)** show typical local cruising speeds.
- **Neon magenta segments (under 14 mph)** pinpoint slow zones, tight curves, and interlocking merges where trains lose time.

<div class="story-callout"><span class="story-badge">Interactive Map</span> Click any glowing track segment on the map to inspect its route, average speed, and travel time, or use the <kbd>Preset</kbd> and <kbd>Theme</kbd> selectors in the top-left corner of any map to switch between StraphangerDB network eras (Current, 1953 IND, 1929 Historical, 2035 Proposed) and NYC map styles (MTA, Tauranac / Hertz, 1953 IND, Geographic Light, and Geographic Dark).</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_route_speed_map',
    ordinal: 13,
    viewName: 'local.main.cell_route_speed_map',
    kind: 'question' as const,
    title: 'Midtown & Queens Subway Trunk Corridor Speeds',
    subtitle: 'Observed inter-station train speeds (mph) across Queens Blvd, 7 Line, 53rd St, and 60th St Manhattan-Queens trunk corridors. Neon magenta (< 14 mph), cyan (14-22 mph), and emerald (>= 22 mph) segments distinguish speed tiers from MTA route bullets.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter): Midtown & Queens Subway Trunk Corridor Speeds (Ossie Lens: dbtc.route_segment_speeds)
-- Powered by the ergonomic dbtc.route_segment_speeds Lens (computes consecutive leg speeds and service line colors).
SELECT *
FROM ossie_query(
  'dbtc',
  'route_segment_speeds',
  '',
  'route_segment_speeds.window = ''yesterday'' AND route_segment_speeds.route_id IN (''7'', ''7X'', ''E'', ''F'', ''FX'', ''M'', ''R'', ''N'', ''W'')'
);`,
    paramsJson: '{"route_id": "7,E,F,M,R,N,W"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'route_segment_speeds',
      selectedDimensions: [
        'route_segment_speeds.route_id',
        'route_segment_speeds.from_station_name',
        'route_segment_speeds.to_station_name',
      ],
      selectedMetrics: [],
      filters: [
        { field: 'route_segment_speeds.route_id', operator: 'IN', value: ['7', '7X', 'E', 'F', 'FX', 'M', 'R', 'N', 'W'] },
      ],
    }),
    chartType: 'route-segment-map' as const,
    chartConfigJson: '{"metricColumn": "speed_mph", "slowZoneThresholdMph": 14}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_isochrone',
    ordinal: 14,
    viewName: 'local.main.cell_story_isochrone',
    kind: 'markdown' as const,
    title: 'How Far Can You Travel in 30 Minutes?',
    subtitle: 'Parameterized recursive SQL queries and calibrated door-to-platform travel-time modeling',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 8: How Far Can You Travel in 30 Minutes?

DBTC supports dynamic SQL parameters written as \`{{origin_station_id}}\`, allowing interactive maps and controls to pass values straight back into your query and re-run it on the fly.

In the **Isochrone &amp; Walk Shed Map** below, a recursive SQL query starts from an origin station (defaulting to **Grand Army Plaza** in Brooklyn, station \`237\`) and walks the subway network across lines and transfer hubs to find the shortest travel time to every reachable stop:
- **Colored travel bands** group stations reachable within **10, 20, 30, and 45 minutes** of subway ride time.
- **Concentric walk rings** around each reachable station trace a **2.5 to 10-minute walk shed** (200m to 800m) into the surrounding neighborhood.

#### How Travel Time Between Stations Is Computed (and Calibrated)
Why did naive GTFS-RT position diffs previously produce travel times that looked artificially low?
1. **Polling jitter &amp; minimum-of-averages bias**: Taking \`MIN(event_time)\` per station and then \`MIN(leg_travel_time_sec)\` across routes with a 15-second floor allowed 30-second GTFS-RT feed polling artifacts and express skip-stop jumps to compress inter-station run times to 20 to 40 seconds per stop.
2. **Station dwell time**: Real subway trains spend ~30 seconds decelerating, opening doors, boarding passengers, and clearing the platform at each intermediate stop (rather than 15 seconds).
3. **Transfer wait penalty**: Walking between platforms at a transfer complex (90 to 150 seconds) also incurs an expected half-headway wait (~180 seconds / 3 minutes) for the connecting train.

To produce realistic NYC Subway travel times, the query below computes the **median observed inter-station run time** (\`45s\` to \`600s\` filter), enforces a **physical track-distance speed floor** (\`GREATEST(median_leg_sec, (chord_meters * 1.22) / 11.5)\`, capping effective inter-station run speed at ~25.7 mph along a 1.22x Manhattan/river track-curvature factor), adds **30 seconds of station dwell** per intermediate stop, and applies a **walk + 180-second transfer wait** when switching lines.

<div class="story-callout"><span class="story-badge">Click Any Station</span> Click any station dot on the map below to set it as the new origin and watch DuckDB recalculate travel-time contours from that stop, or open <kbd>Show SQL</kbd> to see how the <code>{{origin_station_id}}</code> parameter is bound.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_isochrone_map',
    ordinal: 15,
    viewName: 'local.main.cell_isochrone_map',
    kind: 'question' as const,
    title: 'NYC Subway Station Reachability & Walk Sheds',
    subtitle: 'Calibrated transit arrival tiers (10, 20, 30, and 45 minutes) from the selected origin station using median inter-station run times, Haversine track-speed floors, 30s station dwell, and transfer wait penalties, with concentric walk-radius rings (200m to 800m).',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter): NYC Subway Station Reachability & Walk Sheds (Ossie Lens: dbtc.station_isochrones)
-- Powered by the ergonomic dbtc.station_isochrones Lens with parameterized {{origin_station_id}} reachability.
SELECT *
FROM ossie_query(
  'dbtc',
  'station_isochrones',
  '',
  'station_isochrones.window = ''yesterday'' AND station_isochrones.origin_station_id = ''{{origin_station_id}}'''
);`,
    paramsJson: '{"origin_station_id": "237"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'station_isochrones',
      selectedDimensions: [
        'station_isochrones.station_id',
        'station_isochrones.station_name',
        'station_isochrones.isochrone_band',
      ],
      selectedMetrics: [],
      filters: [
        { field: 'station_isochrones.origin_station_id', operator: '=', value: '{{origin_station_id}}' },
      ],
    }),
    chartType: 'isochrone-map' as const,
    chartConfigJson: '{"defaultOriginStationId": "237", "cutoffMinutes": [10, 20, 30, 45]}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_train_position',
    ordinal: 16,
    viewName: 'local.main.cell_story_train_position',
    kind: 'markdown' as const,
    title: 'Watching the Live Fleet in Motion',
    subtitle: 'Real-time train telemetry, 15-minute kinematic replay, and building your own investigation',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 9: Watching the Live Fleet in Motion

To finish our tour, we zoom out to the live pulse of the entire subway system. By querying the most recent 15-minute window of vehicle position pings, DBTC interpolates active train movements along curved MTA service lines so you can watch the fleet move across all five boroughs.

In the **Live Fleet Positions &amp; Kinematics** map below:
- Press **Play / Pause** or drag the timeline scrubber in the player bar to replay the last 15 minutes of subway movement at 1x, 2x, 5x, or 10x speed.
- Click <kbd>LIVE</kbd> in the player bar to jump the timeline to the latest observation and re-sync the live DuckDB feed.
- Click any moving train badge on the map to inspect its route, trip ID, current speed, and next station stop.

<div class="story-callout"><span class="story-badge">Build Your Own</span> Ready to start your own investigation? Use <kbd>+ Add Question Cell</kbd> and <kbd>+ Add Markdown Cell</kbd> at the top of the notebook, or click <kbd>Copy Prompt</kbd> on any cell to paste the full StraphangerDB schema into an AI assistant.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_train_position_map',
    ordinal: 17,
    viewName: 'local.main.cell_train_position_map',
    kind: 'question' as const,
    title: 'Live NYC Subway Fleet Positions & Kinematics',
    subtitle: 'Active subway train positions, bearings, and 15-minute kinematic timelapse replay across the rapid transit network. Click LIVE in the player bar to jump the scrubber to the latest observation and re-sync the live DuckDB feed.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v18-realtime-gtfs-rt-starter): Live NYC Subway Fleet Positions & Kinematics (Ossie Lens: dbtc.live_subway_fleet)
-- Powered by the ergonomic dbtc.live_subway_fleet Lens (combines partition-pruned DuckLake 3h tail with live GTFS-RT feeds).
SELECT *
FROM ossie_query(
  'dbtc',
  'live_subway_fleet',
  '',
  'live_subway_fleet.window = ''live_3h'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'live_subway_fleet',
      selectedDimensions: [
        'live_subway_fleet.event_time',
        'live_subway_fleet.route_id',
        'live_subway_fleet.vehicle_id',
        'live_subway_fleet.station_name',
      ],
      selectedMetrics: [],
      filters: [],
    }),
    chartType: 'train-position-map' as const,
    chartConfigJson: '{"showFleetFilter": true}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_commuter_rail',
    ordinal: 18,
    viewName: 'local.main.cell_story_commuter_rail',
    kind: 'markdown' as const,
    title: 'Regional Rail in Motion: Live Metro-North, LIRR & PATH Fleets',
    subtitle: 'Tracking regional trains across the Hudson Valley, Connecticut, Long Island, and New Jersey on unified Tri-State rail corridors',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 10: Regional Rail in Motion (Metro-North, LIRR &amp; PATH)

The metropolitan rail network extends far beyond the five boroughs across the entire Tri-State region. Because StraphangerDB ingests live GTFS-RT telemetry for **Metro-North Railroad** (\`MTA_METRO_NORTH\`), the **Long Island Rail Road** (\`MTA_LIRR\`), and **PATH** (\`PORT_AUTHORITY_PATH\`) in the same \`fact_vehicle_positions\` schema, DBTC tracks regional trains from Poughkeepsie, Wassaic, New Haven, and Port Jervis into Grand Central and Hoboken, from Penn Station and Atlantic Terminal out to Montauk and Greenport, and under the Hudson between Newark, Journal Square, Hoboken, World Trade Center, and 33rd Street.

In the **Live Metro-North, LIRR &amp; PATH Regional Rail Fleet** map below:
- **Metro-North trunk lines** render across Westchester, the Hudson Valley, Connecticut, and Rockland/Orange Counties in their official branch colors: **Hudson** (\`HUD\` green), **Harlem** (\`HAR\` blue), **New Haven / New Canaan / Danbury / Waterbury** (\`NH\` red), **Pascack Valley** (\`PV\` purple), and **Port Jervis** (\`PJ\` orange).
- **LIRR branches** span City Terminal Zone, Port Washington, Babylon, Ronkonkoma, Huntington / Port Jefferson, Oyster Bay, Hempstead, Long Beach, Far Rockaway, West Hempstead, and Montauk across Nassau and Suffolk Counties.
- **PATH trans-Hudson lines** render across Newark, Harrison, Journal Square, Grove Street, Exchange Place, Newport, Hoboken, World Trade Center, and 33rd Street (\`NWK-WTC\` red, \`JSQ-33\` yellow-gold, \`HOB-33\` blue, \`HOB-WTC\` green).
- Open <kbd>Colors</kbd> in any chart header to customize **Metro-North, LIRR &amp; PATH** or **MTA** route bullets across maps and charts.

<div class="story-callout"><span class="story-badge">Regional Corridors</span> Click any branch badge in the top-right filter bar to isolate Metro-North, LIRR, or PATH trains, or switch the map preset to <kbd>Geographic Map (Light)</kbd> or <kbd>Geographic Map (Dark)</kbd> to view regional rail over keyless OpenFreeMap street cartography.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_commuter_rail_map',
    ordinal: 19,
    viewName: 'local.main.cell_commuter_rail_map',
    kind: 'question' as const,
    title: 'Live Metro-North, LIRR & PATH Regional Rail Fleet Positions',
    subtitle: 'Real-time regional train positions, branch bullets, and 15-minute kinematic replay across Metro-North Railroad, Long Island Rail Road, and PATH trans-Hudson corridors.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v18-realtime-gtfs-rt-starter): Live Metro-North, LIRR & PATH Regional Rail Fleet Positions (Ossie Lens: dbtc.live_commuter_rail_fleet)
-- Powered by the ergonomic dbtc.live_commuter_rail_fleet Lens (combines DuckLake tail with live LIRR & MNR GTFS-RT feeds).
SELECT *
FROM ossie_query(
  'dbtc',
  'live_commuter_rail_fleet',
  '',
  'live_commuter_rail_fleet.window = ''live_3h'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'live_commuter_rail_fleet',
      selectedDimensions: [
        'live_commuter_rail_fleet.event_time',
        'live_commuter_rail_fleet.agency_id',
        'live_commuter_rail_fleet.route_id',
        'live_commuter_rail_fleet.vehicle_id',
        'live_commuter_rail_fleet.station_name',
      ],
      selectedMetrics: [],
      filters: [],
    }),
    chartType: 'train-position-map' as const,
    chartConfigJson: '{"showFleetFilter": true, "initialCenter": [-73.88, 40.82], "initialZoom": 8.8}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_bus_m60',
    ordinal: 20,
    viewName: 'local.main.cell_story_bus_m60',
    kind: 'markdown' as const,
    title: 'Crosstown to LaGuardia: Live M60 Select Bus Service',
    subtitle: 'Street-level bus kinematics across Morningside Heights, 125th Street, the RFK Bridge, and LaGuardia Airport on geographic basemaps',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 11: Surface Transit on Geographic Basemaps (M60-SBS)

Subway schematics are great for underground trunk corridors, while surface bus routes follow neighborhood streets, bridges, and airport roadways. Every map in DBTC now includes **Geographic Map (Light)** and **Geographic Map (Dark)** street basemap options alongside schematic transit themes.

Below, DBTC filters surface telemetry strictly to the **M60 Select Bus Service (\`M60-SBS\`)**, tracing crosstown buses from **W 106 St &amp; Broadway** through **Columbia University**, across **125th Street** in Harlem (connecting to the 1, A/B/C/D, 2/3, and 4/5/6 subways plus Harlem-125 St Metro-North), over the **RFK Bridge** along **Astoria Blvd**, and into **LaGuardia Airport Terminals A, B, and C**.

<div class="story-callout"><span class="story-badge">Geographic Light &amp; Dark</span> Use the <kbd>Theme</kbd> dropdown in the top-left toolbar of any map to toggle between <strong>Geographic (Light)</strong>, <strong>Geographic (Dark)</strong>, <strong>MTA</strong>, <strong>Tauranac / Hertz</strong>, and <strong>1953 IND</strong>.</div>

<div class="story-callout"><span class="story-badge">CORS Note (DuckLake Only)</span> Unlike the Subway, SIR, LIRR, and MNR GTFS-RT feeds, MTA Bus (<code>gtfsrt.prod.obanyc.com/vehiclePositions</code>) does not send <code>Access-Control-Allow-Origin</code> headers, so browsers block direct client-side fetches. This cell reads exclusively from <strong>StraphangerDB DuckLake</strong> so it loads immediately without CORS errors. (If you configure a CORS proxy via <code>localStorage.setItem('dbtc_gtfs_rt_proxy_url', ...)</code>, you can query <code>local.main.live_mta_bus_positions</code> directly.)</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_bus_m60_map',
    ordinal: 21,
    viewName: 'local.main.cell_bus_m60_map',
    kind: 'question' as const,
    title: 'Live M60 Select Bus Service Positions (Harlem to LaGuardia)',
    subtitle: 'Active M60-SBS bus positions, headings, and 15-minute kinematic replay between W 106 St, 125 St, Astoria Blvd, and LaGuardia Airport on a real-world geographic street map.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v22-bus-cors-lakehouse-starter): Live M60 Select Bus Service Positions (Ossie Lens: dbtc.live_bus_fleet)
-- Powered by the ergonomic dbtc.live_bus_fleet Lens (filtered to M60-SBS).
SELECT *
FROM ossie_query(
  'dbtc',
  'live_bus_fleet',
  '',
  'live_bus_fleet.window = ''live_3h'' AND live_bus_fleet.agency_id = ''MTA_BUS'' AND live_bus_fleet.route_id IN (''M60-SBS'')'
);`,
    paramsJson: '{"route_id": "M60-SBS"}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'live_bus_fleet',
      selectedDimensions: [
        'live_bus_fleet.event_time',
        'live_bus_fleet.route_id',
        'live_bus_fleet.vehicle_id',
        'live_bus_fleet.station_name',
      ],
      selectedMetrics: [],
      filters: [
        { field: 'live_bus_fleet.agency_id', operator: '=', value: 'MTA_BUS' },
        { field: 'live_bus_fleet.route_id', operator: 'IN', value: ['M60-SBS'] },
      ],
    }),
    chartType: 'train-position-map' as const,
    chartConfigJson: JSON.stringify({
      showFleetFilter: true,
      initialCenter: [-73.918, 40.788],
      initialZoom: 12.1,
      mapTables: {
        routesTable: 'prod.transit_v2.view_dim_routes',
        tracksTable: 'prod.transit_v2.view_dim_service_lines',
        stationsTable: 'prod.transit_v2.view_dim_stations',
        presetId: 'geo-light',
        theme: 'geo-light',
        hideSubwayOverlay: true,
        corridorOverlay: 'M60-SBS',
      },
    }),
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_basic_bar',
    ordinal: 22,
    viewName: 'local.main.cell_story_basic_bar',
    kind: 'markdown' as const,
    title: 'Fast Editorial Charts: Ranked Bar Comparisons',
    subtitle: 'Simple, instant SQL aggregations and flexible column remapping across standard BI chart types',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 12: Fast Editorial Charts &amp; Column Remapping

In addition to bespoke transit visuals, DBTC includes a complete suite of **Standard BI Charts** (bar, line, area, donut, scatter, radar, treemap, and more) that work with any simple SQL query. Every chart type defines a default column schema, and you can use the <kbd>Columns</kbd> dropdown in any card header to remap which query columns drive the category axis, metric values, or series grouping.

The **Bar Chart** below runs a lightweight aggregation over recent turnstile readings to rank top subway stations by total rider entries.

<div class="story-callout"><span class="story-badge">Try Column Remapping</span> Click any tile in the left Visualization Picker or open <kbd>Columns</kbd> in the top-right of the card header below to switch between Bar, Horizontal Bar, Lollipop, Treemap, or Donut views on the same query result.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_basic_bar_turnstiles',
    ordinal: 23,
    viewName: 'local.main.cell_basic_bar_turnstiles',
    kind: 'question' as const,
    title: 'Top NYC Subway Stations by Recent Turnstile Entries',
    subtitle: 'Ranked comparison of subway stations with the highest cumulative turnstile entries in the latest turnstile partition.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter -- v15-disambiguated-stations): Top NYC Subway Stations by Turnstile Entries
SELECT *
FROM ossie_query(
  'dbtc',
  'station_turnstile_ranking',
  '',
  'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''latest_turnstiles'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'station_turnstile_ranking',
      selectedDimensions: [],
      selectedMetrics: [],
      filters: [
        { field: 'window', operator: '=', value: 'latest_turnstiles' },
        { field: 'station_turnstile_ranking.agency_id', operator: '=', value: 'MTA_NYCT_SUBWAY' },
      ],
      limit: 10,
    }),
    chartType: 'bar' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_basic_line',
    ordinal: 24,
    viewName: 'local.main.cell_story_basic_line',
    kind: 'markdown' as const,
    title: 'Fast Time-Series Trends: Hourly Subway Ridership',
    subtitle: 'Plotting diurnal commuter peaks with a clean 10-line SQL query',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 13: Fast Time-Series Line Charts

Standard **Line** and **Area** charts automatically map your first string or timestamp column to the horizontal X-axis and numeric measures to the vertical Y-axis.

The **Line Chart** below aggregates systemwide subway turnstile entries by hour of day over the latest turnstile readings, clearly highlighting the morning rush-hour climb around 8:00 AM and the evening commuter peak at 5:00 PM.

<div class="story-callout"><span class="story-badge">Switch Chart Types</span> Click <kbd>Area</kbd>, <kbd>Step Line</kbd>, or <kbd>Sparkline Grid</kbd> in the left sidebar to restyle this time series instantaneously without re-running the query.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_basic_line_hourly',
    ordinal: 25,
    viewName: 'local.main.cell_basic_line_hourly',
    kind: 'question' as const,
    title: 'Systemwide Hourly Subway Turnstile Entries Profile',
    subtitle: 'Average hourly turnstile entries across all metered NYC Subway stations by hour of day (00:00 to 23:00).',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter): Systemwide Hourly Subway Turnstile Entries Profile
SELECT *
FROM ossie_query(
  'dbtc',
  'hourly_turnstile_profile',
  '',
  'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''latest_turnstiles'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'hourly_turnstile_profile',
      selectedDimensions: [],
      selectedMetrics: [],
      filters: [
        { field: 'window', operator: '=', value: 'latest_turnstiles' },
        { field: 'hourly_turnstile_profile.agency_id', operator: '=', value: 'MTA_NYCT_SUBWAY' },
      ],
    }),
    chartType: 'line' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_story_basic_donut',
    ordinal: 26,
    viewName: 'local.main.cell_story_basic_donut',
    kind: 'markdown' as const,
    title: 'Proportional Breakdowns: Fleet Share by Subway Trunk Line',
    subtitle: 'Part-to-whole composition using donut, treemap, and radar charts',
    sourceNote: 'Source: StraphangerDB',
    markdownText: `### Part 14: Part-to-Whole Donut &amp; Composition Charts

When you want to show how individual routes or boroughs contribute to a systemwide total, **Donut**, **Treemap**, and **Funnel** charts map a category label and a numeric value into proportional slices.

The **Donut Chart** below counts distinct active train trips observed across the busiest NYC Subway routes over the past 24 hours.

<div class="story-callout"><span class="story-badge">Explore Your Own SQL</span> Edit the SQL in any of these basic chart cells or click <kbd>+ Add Question Cell</kbd> at the top of the notebook to build your own custom queries and visualizations.</div>`,
    sqlText: '',
    paramsJson: '{}',
    ossieConfigJson: null,
    chartType: 'table' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
  {
    cellId: 'cell_basic_donut_fleet',
    ordinal: 27,
    viewName: 'local.main.cell_basic_donut_fleet',
    kind: 'question' as const,
    title: 'Observed Subway Trip Share Among Top 8 Routes',
    subtitle: 'Distribution of distinct observed train trips across the eight highest-frequency NYC Subway routes and all other routes over the last 24 hours.',
    sourceNote: 'Source: StraphangerDB',
    markdownText: '',
    sqlText: `-- v22-ossie-lens-starter (-- v14-fast-pruned-starter -- v15-other-bucket-donut): Observed Subway Trip Share Among Top 8 Routes
SELECT *
FROM ossie_query(
  'dbtc',
  'fleet_route_share',
  '',
  'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''yesterday'''
);`,
    paramsJson: '{}',
    ossieConfigJson: JSON.stringify({
      theme: 'dbtc',
      factDataset: 'fleet_route_share',
      selectedDimensions: [],
      selectedMetrics: [],
      filters: [
        { field: 'window', operator: '=', value: 'yesterday' },
        { field: 'fleet_route_share.agency_id', operator: '=', value: 'MTA_NYCT_SUBWAY' },
      ],
    }),
    chartType: 'donut' as const,
    chartConfigJson: '{}',
    ducklakeSnapshotId: null,
  },
];
