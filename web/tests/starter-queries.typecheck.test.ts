import { describe, it, expect, vi } from 'vitest';
import { STARTER_NOTEBOOK, STARTER_CELLS } from '../src/state/local-state-schema.js';
import { checkPartitionGuardrail, expandCellSql, hydrateStoreFromDuckDb, store } from '../src/state/store.js';
import { matchesTileContract, TILE_CONTRACTS } from '../src/types/schema-contracts.js';
import { renderMarkdownWithSafeHtml, sanitizeMarkdownHtml } from '../src/ui/markdown-renderer.js';
import {
  buildSocrataCsvUrl,
  buildSocrataDiscoveryApiUrl,
  sanitizeSocrataViewName,
  searchCuratedSocrataCatalog,
  searchSocrataCatalog,
} from '../src/ui/data-uploads-view.js';
import type { ChartType, ExecutionMode } from '../src/types/cell-state.js';

describe('Starter Queries and Compile-Time Schema Contracts', () => {
  it('validates starter notebook metadata types', () => {
    const mode: ExecutionMode = STARTER_NOTEBOOK.mode;
    expect(mode).toBe('standard');
    expect(STARTER_NOTEBOOK.docId).toBe('dbtc_starter_nyc');
    expect(STARTER_NOTEBOOK.title).toBe('NYC Transit Studio');
    expect(STARTER_NOTEBOOK.catalogUrl).toContain('ducklake/catalog.db');
  });

  it('validates starter cell types, interleaved narrative markdown cells, and chart type contracts', () => {
    expect(STARTER_CELLS).toHaveLength(28);

    const markdownCells = STARTER_CELLS.filter(c => c.kind === 'markdown');
    const questionCells = STARTER_CELLS.filter(c => c.kind === 'question');
    expect(markdownCells).toHaveLength(14);
    expect(questionCells).toHaveLength(14);

    // Every pair of cells alternates: markdown narrative followed immediately by the chart it introduces
    for (let i = 0; i < STARTER_CELLS.length; i++) {
      const cell = STARTER_CELLS[i]!;
      expect(cell.ordinal).toBe(i);
      expect(cell.kind).toBe(i % 2 === 0 ? 'markdown' : 'question');
      // Zero em-dashes across all starter copy
      expect(cell.title).not.toContain('\u2014');
      expect(cell.subtitle).not.toContain('\u2014');
      expect(cell.markdownText).not.toContain('\u2014');
      expect(cell.sqlText).not.toContain('\u2014');
      expect(cell.sourceNote).toBe('Source: StraphangerDB');
    }

    const introCell = STARTER_CELLS.find(c => c.cellId === 'cell_intro')!;
    expect(introCell).toBeDefined();
    expect(introCell.markdownText).toContain('https://straphanger.page');
    expect(introCell.markdownText).toContain('https://data.ny.gov');
    expect(introCell.markdownText).toContain('https://data.cityofnewyork.us');
    expect(introCell.markdownText).toContain('https://api.mta.info');
    expect(introCell.markdownText).toContain('https://new.mta.info/maps');

    // Every default question cell uses the unified dbtc Ossie spec and ossie_query('dbtc', ...)
    for (const qc of questionCells) {
      expect(qc.ossieConfigJson).toBeTruthy();
      const parsedOssie = JSON.parse(qc.ossieConfigJson!);
      expect(parsedOssie.theme).toBe('dbtc');
      expect(qc.sqlText).toMatch(/ossie_query\(\s*'dbtc'/);
      const expanded = expandCellSql(qc.sqlText, JSON.parse(qc.paramsJson || '{}'));
      expect(expanded).not.toContain('ossie_query(');
      expect(expanded).toContain('prod.transit_v2.');
    }

    const questionCell = STARTER_CELLS.find(c => c.cellId === 'cell_headways')!;
    expect(questionCell).toBeDefined();

    const chartType: ChartType = questionCell.chartType;
    expect(chartType).toBe('station-progression');

    // Parse params and chart config
    const params = JSON.parse(questionCell.paramsJson);
    expect(params.route_id).toBe('4,5,6');

    const chartConfig = JSON.parse(questionCell.chartConfigJson);
    expect(chartConfig.alignmentMode).toBe('corridor');
    expect(chartConfig.metricColumn).toBe('headway_sec');

    const mareyCell = STARTER_CELLS.find(c => c.cellId === 'cell_marey')!;
    expect(mareyCell).toBeDefined();
    expect(mareyCell.chartType).toBe('marey-chart');
    const expandedMareyCell = expandCellSql(mareyCell.sqlText, {});
    expect(expandedMareyCell).toContain('CASE EXTRACT(ISODOW');
    expect(expandedMareyCell).toContain("INTERVAL '6 hours 30 minutes'");
    expect(expandedMareyCell).toContain("INTERVAL '10 hours'");
    expect(checkPartitionGuardrail(mareyCell.sqlText).ok).toBe(true);

    const horizonCell = STARTER_CELLS.find(c => c.cellId === 'cell_headway_horizon_rm')!;
    expect(horizonCell).toBeDefined();
    expect(horizonCell.chartType).toBe('headway-horizon');
    expect(checkPartitionGuardrail(horizonCell.sqlText).ok).toBe(true);

    const adherenceCell = STARTER_CELLS.find(c => c.cellId === 'cell_adherence_waterfall_canarsie')!;
    expect(adherenceCell).toBeDefined();
    expect(adherenceCell.chartType).toBe('adherence-waterfall');
    expect(checkPartitionGuardrail(adherenceCell.sqlText).ok).toBe(true);

    const multimodalCell = STARTER_CELLS.find(c => c.cellId === 'cell_multimodal_pulse_midtown')!;
    expect(multimodalCell).toBeDefined();
    expect(multimodalCell.chartType).toBe('multimodal-pulse');
    expect(checkPartitionGuardrail(multimodalCell.sqlText).ok).toBe(true);

    const odCell = STARTER_CELLS.find(c => c.cellId === 'cell_od_ridership_flow')!;
    expect(odCell).toBeDefined();
    expect(odCell.chartType).toBe('od-ridership-flow');
    expect(checkPartitionGuardrail(odCell.sqlText).ok).toBe(true);

    const routeSpeedCell = STARTER_CELLS.find(c => c.cellId === 'cell_route_speed_map')!;
    expect(routeSpeedCell).toBeDefined();
    expect(routeSpeedCell.chartType).toBe('route-segment-map');
    expect(checkPartitionGuardrail(routeSpeedCell.sqlText).ok).toBe(true);

    const isochroneCell = STARTER_CELLS.find(c => c.cellId === 'cell_isochrone_map')!;
    expect(isochroneCell).toBeDefined();
    expect(isochroneCell.chartType).toBe('isochrone-map');
    expect(JSON.parse(isochroneCell.chartConfigJson).defaultOriginStationId).toBe('237');
    expect(JSON.parse(isochroneCell.paramsJson).origin_station_id).toBe('237');
    expect(checkPartitionGuardrail(isochroneCell.sqlText).ok).toBe(true);

    const trainPositionCell = STARTER_CELLS.find(c => c.cellId === 'cell_train_position_map')!;
    expect(trainPositionCell).toBeDefined();
    expect(trainPositionCell.ordinal).toBe(17);
    expect(trainPositionCell.chartType).toBe('train-position-map');
    expect(expandCellSql(trainPositionCell.sqlText, {})).toContain('recent_fleet_check');
    expect(checkPartitionGuardrail(trainPositionCell.sqlText).ok).toBe(true);

    const commuterRailCell = STARTER_CELLS.find(c => c.cellId === 'cell_commuter_rail_map')!;
    expect(commuterRailCell).toBeDefined();
    expect(commuterRailCell.ordinal).toBe(19);
    expect(commuterRailCell.chartType).toBe('train-position-map');
    const expandedCommuter = expandCellSql(commuterRailCell.sqlText, {});
    expect(expandedCommuter).toContain('MTA_METRO_NORTH');
    expect(expandedCommuter).toContain('MTA_LIRR');
    expect(checkPartitionGuardrail(commuterRailCell.sqlText).ok).toBe(true);

    const busM60Cell = STARTER_CELLS.find(c => c.cellId === 'cell_bus_m60_map')!;
    expect(busM60Cell).toBeDefined();
    expect(busM60Cell.ordinal).toBe(21);
    expect(busM60Cell.chartType).toBe('train-position-map');
    expect(busM60Cell.sqlText).toContain('M60-SBS');
    expect(JSON.parse(busM60Cell.chartConfigJson).mapTables.theme).toBe('geo-light');
    expect(JSON.parse(busM60Cell.chartConfigJson).mapTables.hideSubwayOverlay).toBe(true);
    expect(JSON.parse(busM60Cell.chartConfigJson).mapTables.corridorOverlay).toBe('M60-SBS');
    expect(checkPartitionGuardrail(busM60Cell.sqlText).ok).toBe(true);

    const basicBarCell = STARTER_CELLS.find(c => c.cellId === 'cell_basic_bar_turnstiles')!;
    expect(basicBarCell?.chartType).toBe('bar');
    const basicLineCell = STARTER_CELLS.find(c => c.cellId === 'cell_basic_line_hourly')!;
    expect(basicLineCell?.chartType).toBe('line');
    const basicDonutCell = STARTER_CELLS.find(c => c.cellId === 'cell_basic_donut_fleet')!;
    expect(basicDonutCell?.chartType).toBe('donut');
  });

  it('ensures starter question queries pass the partition guardrail', () => {
    const questionCells = STARTER_CELLS.filter(c => c.kind === 'question');
    expect(questionCells).toHaveLength(14);
    for (const qc of questionCells) {
      const guard = checkPartitionGuardrail(qc.sqlText);
      expect(guard.ok).toBe(true);
    }
  });

  it('verifies starter question query satisfies station-progression tile contract', () => {
    // Columns projected by starter query
    const projectedColumns = [
      'event_date',
      'event_time',
      'agency_id',
      'route_id',
      'station_id',
      'station_name',
      'borough',
      'trip_id',
      'headway_sec',
      'avg_headway_sec',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['station-progression']);
    expect(matches).toBe(true);
  });

  it('verifies starter adherence waterfall query satisfies tile contract', () => {
    const projectedColumns = [
      'event_date',
      'agency_id',
      'route_id',
      'route_name',
      'scheduled_trips_count',
      'observed_trips_count',
      'ghost_trips_count',
      'unscheduled_trips_count',
      'service_completion_pct',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['adherence-waterfall']);
    expect(matches).toBe(true);
  });

  it('verifies starter multimodal pulse query satisfies tile contract', () => {
    const projectedColumns = [
      'event_date',
      'station_name',
      'station_id',
      'hour_of_day',
      'service_hour',
      'entry_count',
      'exit_count',
      'num_bikes_available',
      'num_ebikes_available',
      'num_docks_available',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['multimodal-pulse']);
    expect(matches).toBe(true);
  });

  it('verifies starter od ridership flow query satisfies tile contract', () => {
    const projectedColumns = [
      'event_date',
      'agency_id',
      'origin_station_id',
      'origin_station_name',
      'origin_borough',
      'destination_station_id',
      'destination_station_name',
      'destination_borough',
      'passenger_count',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['od-ridership-flow']);
    expect(matches).toBe(true);
  });

  it('verifies starter route segment map query satisfies tile contract', () => {
    const projectedColumns = [
      'event_date',
      'agency_id',
      'route_id',
      'from_station_id',
      'from_station_name',
      'from_lat',
      'from_lon',
      'to_station_id',
      'to_station_name',
      'to_lat',
      'to_lon',
      'effective_speed_mph',
      'leg_travel_time_sec',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['route-segment-map']);
    expect(matches).toBe(true);
  });

  it('verifies starter isochrone map query satisfies tile contract', () => {
    const projectedColumns = [
      'station_id',
      'station_name',
      'latitude',
      'longitude',
      'travel_time_sec',
      'travel_time_min',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['isochrone-map']);
    expect(matches).toBe(true);
  });

  it('verifies starter train position map query satisfies tile contract', () => {
    const projectedColumns = [
      'event_date',
      'event_time',
      'agency_id',
      'route_id',
      'trip_id',
      'vehicle_id',
      'station_id',
      'station_name',
      'latitude',
      'longitude',
      'bearing',
      'speed_mph',
      'status',
      'occupancy_status',
    ];

    const matches = matchesTileContract(projectedColumns, TILE_CONTRACTS['train-position-map']);
    expect(matches).toBe(true);
  });

  it('verifies template expansion on starter cell sql', () => {
    const questionCell = STARTER_CELLS.find(c => c.kind === 'question')!;
    const expanded = expandCellSql(questionCell.sqlText, { test_param: 'test_val' });
    expect(typeof expanded).toBe('string');
  });

  it('verifies origin_station_id parameter expansion and calibrated travel-time calculation on isochrone map starter SQL', () => {
    const storyIsochrone = STARTER_CELLS.find(c => c.cellId === 'cell_story_isochrone')!;
    expect(storyIsochrone.markdownText).toContain('How Travel Time Between Stations Is Computed');
    expect(storyIsochrone.markdownText).toContain('Station dwell time');
    expect(storyIsochrone.markdownText).toContain('Transfer wait penalty');

    const isochroneCell = STARTER_CELLS.find(c => c.cellId === 'cell_isochrone_map')!;
    expect(isochroneCell.sqlText).toContain('-- v22-ossie-lens-starter');
    expect(isochroneCell.sqlText).toContain('{{origin_station_id}}');
    const expanded = expandCellSql(isochroneCell.sqlText, { origin_station_id: '237' });
    expect(expanded).toContain('median(cl.leg_travel_time_sec)');
    expect(expanded).toContain('r.travel_time_sec + l.avg_leg_sec + 30.0');
    expect(expanded).toContain('270.0');
    expect(expanded).toContain("'237' AS station_id");
    expect(expanded).not.toContain('{{origin_station_id}}');
    expect(expanded).not.toContain('ossie_query(');
  });

  it('verifies train position map starter SQL matches stop IDs with NS directional suffixes, clamps future timestamps, and anchors on IRT + B-Division full-fleet windows', () => {
    const trainPosCell = STARTER_CELLS.find(c => c.cellId === 'cell_train_position_map')!;
    expect(trainPosCell.sqlText).toContain('-- v22-ossie-lens-starter');
    const expandedTrainPos = expandCellSql(trainPosCell.sqlText, {});
    expect(expandedTrainPos).toContain("ON rtrim(p.station_id, 'NS') = s.gtfs_stop_id");
    expect(expandedTrainPos).toContain("nullif(rtrim(p.station_id, 'NS'), '') AS station_id");
    expect(expandedTrainPos).not.toContain('p.station_id = s.gtfs_stop_id OR');
    expect(expandedTrainPos).toContain("OR (station_id IS NOT NULL AND station_id != '')");
    expect(expandedTrainPos).toContain('veh_station_cnt >= 2 OR max_veh_station_cnt < 2');
    expect(expandedTrainPos).toContain('WHEN p.latitude IS NOT NULL AND p.longitude IS NOT NULL');
    expect(expandedTrainPos).toMatch(/event_time <= CURRENT_TIMESTAMP \+ INTERVAL ''?1 minute''?/);
    expect(expandedTrainPos).toContain('irt_cnt >= 10');
    expect(expandedTrainPos).toContain('station_transitions');
    expect(expandedTrainPos).toContain('IS DISTINCT FROM prev_station_id');
  });

  it('verifies multimodal pulse starter SQL uses a 24-hour spine, 7-day turnstile partition pruning, and 3-day micromobility scan', () => {
    const pulseCell = STARTER_CELLS.find(c => c.cellId === 'cell_multimodal_pulse_midtown')!;
    expect(pulseCell.sqlText).toContain('-- v22-ossie-lens-starter');
    const expandedPulse = expandCellSql(pulseCell.sqlText, {});
    expect(expandedPulse).toContain('generate_series(0, 23)');
    expect(expandedPulse).toContain('turnstile_daily_hours AS');
    expect(expandedPulse).toContain("WHERE t.event_date >= DATE '2026-10-29'");
    expect(expandedPulse).toContain('m.event_date = (CURRENT_DATE');
    expect(expandedPulse).toContain('LEFT JOIN turnstiles');
  });

  it('verifies all starter question cells partition-prune on event_date within 1 to 7 days and include v13 marker', () => {
    for (const cell of STARTER_CELLS.filter(c => c.kind === 'question')) {
      expect(
        cell.sqlText.includes('-- v13-partition-pruned-starter') ||
          cell.sqlText.includes('-- v22-ossie-lens-starter')
      ).toBe(true);
      const expanded = expandCellSql(cell.sqlText, JSON.parse(cell.paramsJson || '{}'));
      expect(expanded).toMatch(/event_date\s*(?:>=|=)/);
      expect(expanded).not.toContain("INTERVAL '90 days'");
      expect(expanded).not.toContain("INTERVAL '30 days'");
      expect(expanded).not.toContain("INTERVAL '14 days'");
    }
  });

  it('verifies isochrone starter cell uses a generic title without hardcoded IRT/Lines 1-7 while SQL covers IRT lines and canonical GTFS transfer stop IDs', () => {
    const isochroneCell = STARTER_CELLS.find(c => c.cellId === 'cell_isochrone_map')!;
    expect(isochroneCell.title).toBe('NYC Subway Station Reachability & Walk Sheds');
    expect(isochroneCell.title).not.toContain('Lines 1-7');
    expect(isochroneCell.title).not.toContain('IRT');
    const expandedIso = expandCellSql(isochroneCell.sqlText, { origin_station_id: '237' });
    expect(expandedIso).toContain("route_id IN ('1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS', 'S')");
    expect(expandedIso).toContain('irt_transfers');
    expect(expandedIso).toContain("('229', '418'"); // Fulton St (2/3 <-> 4/5)
    expect(expandedIso).toContain("('228', '640'"); // Park Pl <-> Brooklyn Bridge-City Hall
    expect(expandedIso).toContain("('222', '415'"); // 149 St-Grand Concourse (2/5 <-> 4)
    expect(expandedIso).toContain("('127', '725'");
    expect(expandedIso).toContain("('631', '723'");
    expect(expandedIso).not.toContain("('229', '639'");
    expect(expandedIso).not.toContain("('221', '414'");
  });

  it('builds Socrata Discovery API and SODA CSV endpoints for data.ny.gov and data.cityofnewyork.us', async () => {
    expect(buildSocrataCsvUrl('data.ny.gov', 'wujg-7c2s')).toBe(
      'https://data.ny.gov/resource/wujg-7c2s.csv?$limit=50000'
    );
    expect(buildSocrataCsvUrl('data.cityofnewyork.us', 'gthc-hcne', 10000)).toBe(
      'https://data.cityofnewyork.us/resource/gthc-hcne.csv?$limit=10000'
    );
    expect(sanitizeSocrataViewName('MTA Subway Hourly Ridership', 'wujg-7c2s')).toBe(
      'mta_subway_hourly_ridership_wujg_7c2s'
    );
    expect(sanitizeSocrataViewName('2020 Census Tracts', '63ge-mke6')).toBe(
      'socrata_2020_census_tracts_63ge_mke6'
    );

    const bothUrl = buildSocrataDiscoveryApiUrl('subway ridership', 'all', 12);
    expect(bothUrl).toContain('domains=data.ny.gov%2Cdata.cityofnewyork.us');
    expect(bothUrl).toContain('q=subway+ridership');
    expect(bothUrl).toContain('only=datasets');

    const nycOnlyUrl = buildSocrataDiscoveryApiUrl('bus lanes', 'data.cityofnewyork.us', 10);
    expect(nycOnlyUrl).toContain('domains=data.cityofnewyork.us');
    expect(nycOnlyUrl).toContain('search_context=data.cityofnewyork.us');

    const curatedNy = searchCuratedSocrataCatalog('subway', 'data.ny.gov');
    expect(curatedNy.length).toBeGreaterThan(0);
    expect(curatedNy.every(d => d.domain === 'data.ny.gov')).toBe(true);

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            resource: {
              id: 'abcd-1234',
              name: 'MTA Bus Automated Camera Enforcement',
              description: 'Bus lane camera violations across NYC corridors.',
              updatedAt: '2025-04-05T12:00:00.000Z',
            },
            metadata: { domain: 'data.ny.gov' },
            classification: { domain_category: 'Transportation' },
            permalink: 'https://data.ny.gov/d/abcd-1234',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const results = await searchSocrataCatalog('bus camera', 'all', mockFetch);
    expect(results[0]?.id).toBe('abcd-1234');
    expect(results[0]?.domain).toBe('data.ny.gov');
    expect(results[0]?.csvUrl).toBe('https://data.ny.gov/resource/abcd-1234.csv?$limit=50000');
  });

  it('renders starter narrative markdown cells with safe inline HTML callouts and kbd hints', () => {
    const markdownCells = STARTER_CELLS.filter(c => c.kind === 'markdown');
    for (const mdCell of markdownCells) {
      const html = renderMarkdownWithSafeHtml(mdCell.markdownText);
      expect(html).toContain('<div class="story-callout">');
      expect(html).toContain('<span class="story-badge">');
      expect(html).toContain('<kbd>');
      expect(html).not.toContain('<script');
    }
  });

  it('allows safe HTML elements and inline styles while stripping XSS vectors in markdown cells', () => {
    const input = [
      '### Transit Story Header',
      '<div class="story-callout" style="color: #0039A6; background: url(javascript:alert(1)); padding: 8px;">',
      '  <span class="story-badge" onclick="alert(1)">Live Tip</span>',
      '  Press <kbd>Show SQL</kbd> or <mark>highlight</mark> and visit <a href="https://mta.info" target="_blank">MTA</a>.',
      '  <a href="javascript:alert(1)">Bad Link</a>',
      '  <a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(2)">Encoded Bad Link</a>',
      '  <a href="data:text/html,<script>alert(3)</script>">Data Link</a>',
      '</div>',
      '<script>window.pwned = true;</script>',
      '<iframe src="https://evil.example.com"></iframe>',
      '<style>body { display: none; }</style>',
      '<svg width="16" height="16" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#0039A6" onload="evil()" /></svg>',
    ].join('\n');

    const rendered = renderMarkdownWithSafeHtml(input);
    expect(rendered).toContain('<h3>Transit Story Header</h3>');
    expect(rendered).toContain('<div class="story-callout" style="color: #0039A6; padding: 8px">');
    expect(rendered).toContain('<span class="story-badge">Live Tip</span>');
    expect(rendered).toContain('<kbd>Show SQL</kbd>');
    expect(rendered).toContain('<mark>highlight</mark>');
    expect(rendered).toContain('<a href="https://mta.info" target="_blank" rel="noopener noreferrer">MTA</a>');
    expect(rendered).toContain('<svg width="16" height="16" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#0039A6" /></svg>');

    // Dangerous elements and attributes must be stripped
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('window.pwned');
    expect(rendered).not.toContain('<iframe');
    expect(rendered).not.toContain('<style');
    expect(rendered).not.toContain('onclick');
    expect(rendered).not.toContain('onload');
    expect(rendered).not.toContain('javascript:');
    expect(rendered).not.toContain('data:text/html');
    expect(rendered).not.toContain('url(');
    expect(rendered).toContain('<a>Bad Link</a>');
    expect(rendered).toContain('<a>Encoded Bad Link</a>');

    // Malformed / unclosed angle brackets inside attributes and unclosed <script>/<style> tags
    const malformed = [
      '<div title="<script>alert(1)</script>">Safe Body</div>',
      '<div <img src=x onerror=alert(2)>>Another Body</div>',
      '<blockquote cite="javascript:alert(3)">Quote</blockquote>',
      '<script>alert("unclosed script")',
    ].join('\n');
    const sanitizedMalformed = sanitizeMarkdownHtml(malformed);
    expect(sanitizedMalformed).not.toContain('onerror');
    expect(sanitizedMalformed).not.toContain('<script');
    expect(sanitizedMalformed).not.toContain('javascript:');
    expect(sanitizedMalformed).not.toContain('unclosed script');
    expect(sanitizedMalformed).toContain('&lt;div <img src="x">');
    expect(sanitizedMalformed).toContain('<blockquote>Quote</blockquote>');
  });

  it('migrates legacy 10-cell persisted session to interleaved 18-cell narrative + chart order on hydrateStoreFromDuckDb', async () => {
    const legacyQuestionCells = STARTER_CELLS.filter(c => c.kind === 'question');
    const legacyRows = [
      {
        cell_id: 'cell_intro',
        ordinal: 0,
        view_name: 'local.main.cell_intro',
        kind: 'markdown',
        title: 'Welcome to Data Based Train Control',
        subtitle: 'NYC Transit Journalism and Analytics Studio',
        source_note: 'Source: StraphangerDB',
        markdown_text: '# Data Based Train Control (DBTC)\nWelcome to the in-browser NYC transit investigation notebook.',
        sql_text: '',
        params_json: '{}',
        ossie_config_json: null,
        chart_type: 'table',
        chart_config_json: '{}',
        ducklake_snapshot_id: null,
      },
      ...legacyQuestionCells.map((qc, idx) => ({
        cell_id: qc.cellId,
        ordinal: idx + 1,
        view_name: qc.viewName,
        kind: qc.kind,
        title: qc.title,
        subtitle: qc.subtitle,
        source_note: qc.sourceNote,
        markdown_text: qc.markdownText,
        sql_text: qc.sqlText,
        params_json: qc.paramsJson,
        ossie_config_json: qc.ossieConfigJson,
        chart_type: qc.chartType,
        chart_config_json: qc.chartConfigJson,
        ducklake_snapshot_id: qc.ducklakeSnapshotId,
      })),
      {
        cell_id: 'cell_custom_user',
        ordinal: 10,
        view_name: 'local.main.cell_custom_user',
        kind: 'question',
        title: 'Custom Rider Query',
        subtitle: 'User added cell',
        source_note: 'Source: StraphangerDB',
        markdown_text: '',
        sql_text: 'SELECT 1;',
        params_json: '{}',
        ossie_config_json: null,
        chart_type: 'table',
        chart_config_json: '{}',
        ducklake_snapshot_id: null,
      },
    ];

    const makeArrowMock = (rows: Record<string, unknown>[]) => {
      if (rows.length === 0) {
        return { numRows: 0, schema: { fields: [] }, getChildAt: () => null };
      }
      const keys = Object.keys(rows[0]!);
      return {
        numRows: rows.length,
        schema: {
          fields: keys.map(name => ({ name, type: { toString: () => 'Utf8' } })),
        },
        getChildAt: (colIdx: number) => {
          const key = keys[colIdx]!;
          return {
            get: (rowIdx: number) => rows[rowIdx]?.[key] ?? null,
          };
        },
      };
    };

    const mockConn = {
      query: async (sql: string) => {
        if (sql.includes('FROM local.main._dbtc_notebook')) {
          return makeArrowMock([]);
        }
        if (sql.includes('FROM local.main._dbtc_cells')) {
          return makeArrowMock(legacyRows);
        }
        return makeArrowMock([]);
      },
    };

    await hydrateStoreFromDuckDb(mockConn as never);

    // 28 starter cells + 1 custom cell at the end = 29 cells
    expect(store.cells).toHaveLength(29);
    for (let i = 0; i < STARTER_CELLS.length; i++) {
      expect(store.cells[i]?.cellId).toBe(STARTER_CELLS[i]?.cellId);
      expect(store.cells[i]?.ordinal).toBe(i);
      expect(store.cells[i]?.kind).toBe(i % 2 === 0 ? 'markdown' : 'question');
    }
    expect(store.cells[0]?.markdownText).toContain('Part 1: Measuring Rider Wait Times');
    expect(store.cells[28]?.cellId).toBe('cell_custom_user');
    expect(store.cells[28]?.ordinal).toBe(28);
  });

  it('compiles ossieConfigJson for every starter question cell via compileOssieConfigToSql without errors', async () => {
    const { compileOssieConfigToSql } = await import('../src/data/ossie-loader.js');
    const questionCells = STARTER_CELLS.filter(c => c.kind === 'question');
    expect(questionCells).toHaveLength(14);
    for (const qc of questionCells) {
      const config = JSON.parse(qc.ossieConfigJson!);
      const compiledSql = compileOssieConfigToSql(config);
      expect(compiledSql).toContain('SELECT');
      expect(compiledSql).toMatch(/FROM (?:prod\.transit_v2\.|local\.main\.dbtc_)/);
      for (const metricName of config.selectedMetrics) {
        expect(compiledSql).toContain(`AS ${metricName}`);
      }
      for (const dimName of config.selectedDimensions) {
        expect(compiledSql).toContain(dimName);
      }
    }
  });

  it('preserves user params and chartConfig on already-migrated starter cells during hydrateStoreFromDuckDb', async () => {
    const persistedRows = STARTER_CELLS.map(sc => ({
      cell_id: sc.cellId,
      ordinal: sc.ordinal,
      view_name: sc.viewName,
      kind: sc.kind,
      title: sc.title,
      subtitle: sc.subtitle,
      source_note: sc.sourceNote,
      markdown_text: sc.markdownText,
      sql_text: sc.sqlText,
      params_json: sc.cellId === 'cell_isochrone_map' ? '{"origin_station_id": "127"}' : sc.paramsJson,
      ossie_config_json: sc.ossieConfigJson,
      chart_type: sc.chartType,
      chart_config_json:
        sc.cellId === 'cell_od_ridership_flow'
          ? '{"displayMode": "chord", "topStationsLimit": 15}'
          : sc.chartConfigJson,
      ducklake_snapshot_id: sc.ducklakeSnapshotId,
    }));

    const makeArrowMock = (rows: Record<string, unknown>[]) => {
      if (rows.length === 0) {
        return { numRows: 0, schema: { fields: [] }, getChildAt: () => null };
      }
      const keys = Object.keys(rows[0]!);
      return {
        numRows: rows.length,
        schema: {
          fields: keys.map(name => ({ name, type: { toString: () => 'Utf8' } })),
        },
        getChildAt: (colIdx: number) => {
          const key = keys[colIdx]!;
          return {
            get: (rowIdx: number) => rows[rowIdx]?.[key] ?? null,
          };
        },
      };
    };

    const executedQueries: string[] = [];
    const mockConn = {
      query: async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('FROM local.main._dbtc_notebook')) {
          return makeArrowMock([]);
        }
        if (sql.includes('FROM local.main._dbtc_cells')) {
          return makeArrowMock(persistedRows);
        }
        return makeArrowMock([]);
      },
    };

    await hydrateStoreFromDuckDb(mockConn as never);

    const hydratedIsochrone = store.cells.find(c => c.cellId === 'cell_isochrone_map');
    expect(hydratedIsochrone?.params['origin_station_id']).toBe('127');

    const hydratedOd = store.cells.find(c => c.cellId === 'cell_od_ridership_flow');
    expect(hydratedOd?.chartConfig['displayMode']).toBe('chord');
    expect(hydratedOd?.chartConfig['topStationsLimit']).toBe(15);

    // None of the already-migrated starter cells (including cell_multimodal_pulse_midtown) should be dropped or re-persisted individually
    expect(executedQueries.some(q => q.includes('DROP VIEW') || q.includes('DROP TABLE'))).toBe(false);
    expect(
      executedQueries.some(
        q => q.includes('INSERT OR REPLACE INTO local.main._dbtc_cells') && q.includes('cell_multimodal_pulse_midtown')
      )
    ).toBe(false);
  });

  it('applies theme-specific borough labels and route color overrides in buildMtaSubwayMapGeoJson', async () => {
    const {
      buildMtaSubwayMapGeoJson,
      setActiveMapNetworkData,
      resetActiveMapNetworkData,
      getDefaultMapNetworkData,
    } = await import('../src/viz/map/mta-subway-overlay.js');

    const baseNet = getDefaultMapNetworkData();
    setActiveMapNetworkData({
      ...baseNet,
      serviceLines: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { route_id: 'A', agency_id: 'MTA_NYCT_SUBWAY', service_name: '8 Av Express', color_hex: '#2850AD' },
            geometry: {
              type: 'MultiLineString',
              coordinates: [[[-73.9942, 40.7523], [-73.9819, 40.7681], [-73.9442, 40.8240]]],
            },
          },
        ],
      },
      auxiliaryCorridors: [
        {
          id: 'MTA_METRO_NORTH_HUD',
          agencyId: 'MTA_METRO_NORTH',
          badge: 'HUD',
          name: 'Hudson Line',
          colorHex: '#009B3A',
          aliases: ['MTA_METRO_NORTH:1', 'HUD'],
          chains: [[[-73.9772, 40.7527], [-73.9301, 40.8255]]],
        },
        {
          id: 'MTA_METRO_NORTH_HAR',
          agencyId: 'MTA_METRO_NORTH',
          badge: 'HAR',
          name: 'Harlem Line',
          colorHex: '#0039A6',
          aliases: ['MTA_METRO_NORTH:2', 'HAR'],
          chains: [[[-73.9772, 40.7527], [-73.7746, 41.0332]]],
        },
        {
          id: 'MTA_METRO_NORTH_NH',
          agencyId: 'MTA_METRO_NORTH',
          badge: 'NH',
          name: 'New Haven Line',
          colorHex: '#EE0034',
          aliases: ['MTA_METRO_NORTH:3', 'NH'],
          chains: [[[-73.9772, 40.7527], [-73.5418, 41.0468]]],
        },
      ],
    });
    try {

    const indGeo = buildMtaSubwayMapGeoJson(undefined, 'ind');
    const indBoroughNames = indGeo.boroughWatermarks.features.map(f => f.properties?.['name']);
    expect(indBoroughNames).toContain('RICHMOND');
    expect(indBoroughNames).toContain('MANHATTAN');
    const indRouteA = indGeo.subwayTrunks.features.find(f => f.properties?.['route_id'] === 'A');
    expect(indRouteA?.properties?.['color']).toBe('#0039A6');

    const mtaGeo = buildMtaSubwayMapGeoJson(undefined, 'mta');
    const mtaBoroughNames = mtaGeo.boroughWatermarks.features.map(f => f.properties?.['name']);
    expect(mtaBoroughNames).toContain('Staten Island');
    expect(mtaBoroughNames).toContain('Manhattan');
    const mtaHudson = mtaGeo.commuterRail.features.find(f => f.properties?.['route_id'] === 'HUD');
    const mtaHarlem = mtaGeo.commuterRail.features.find(f => f.properties?.['route_id'] === 'HAR');
    const mtaNewHaven = mtaGeo.commuterRail.features.find(f => f.properties?.['route_id'] === 'NH');
    expect(mtaHudson?.properties?.['color']).toBe('#009B3A');
    expect(mtaHarlem?.properties?.['color']).toBe('#0039A6');
    expect(mtaNewHaven?.properties?.['color']).toBe('#EE0034');

    const tauranacGeo = buildMtaSubwayMapGeoJson(undefined, 'tauranac-hertz');
    const tauranacBoroughNames = tauranacGeo.boroughWatermarks.features.map(f => f.properties?.['name']);
    expect(tauranacBoroughNames).toContain('STATEN ISLAND');
    expect(tauranacGeo.commuterRail.features.some(f => f.properties?.['route_id'] === 'HUD' && f.properties?.['color'] === '#009B3A')).toBe(true);

    const geoLight = buildMtaSubwayMapGeoJson(undefined, 'geo-light');
    expect(geoLight.commuterRail.features.some(f => f.properties?.['route_id'] === 'HAR' && f.properties?.['color'] === '#0039A6')).toBe(true);
    const geoDark = buildMtaSubwayMapGeoJson(undefined, 'geo-dark');
    expect(geoDark.commuterRail.features.some(f => f.properties?.['route_id'] === 'NH' && f.properties?.['color'] === '#EE0034')).toBe(true);
    } finally {
      resetActiveMapNetworkData();
    }
  });

  it('migrates persisted cell_marey and cell_headway_horizon_rm drafts from INTERVAL 5 days to previous-weekday starter', async () => {
    const persistedRows = STARTER_CELLS.map(sc => ({
      cell_id: sc.cellId,
      ordinal: sc.ordinal,
      view_name: sc.viewName,
      kind: sc.kind,
      title: sc.title,
      subtitle: sc.subtitle,
      source_note: sc.sourceNote,
      markdown_text: sc.markdownText,
      sql_text:
        sc.cellId === 'cell_marey' || sc.cellId === 'cell_headway_horizon_rm'
          ? `${sc.sqlText.replace('-- v19-prev-weekday-pruned-starter', '-- v14-legacy-draft').replace('-- v18-single-day-zonemap-starter', '-- v14-legacy-draft')}\n-- INTERVAL '5 days'`
          : sc.cellId === 'cell_basic_bar_turnstiles' || sc.cellId === 'cell_basic_line_hourly'
            ? sc.sqlText
                .replace('-- v14-fast-pruned-starter (-- v13-partition-pruned-starter)', '-- v13-partition-pruned-starter')
                .replace("DATE '2026-10-29'", "CURRENT_DATE - INTERVAL '3 days'")
            : sc.sqlText,
      params_json: sc.paramsJson,
      ossie_config_json: sc.ossieConfigJson,
      chart_type: sc.chartType,
      chart_config_json: sc.chartConfigJson,
      ducklake_snapshot_id: sc.ducklakeSnapshotId,
    }));

    const makeArrowMock = (rows: Record<string, unknown>[]) => {
      if (rows.length === 0) {
        return { numRows: 0, schema: { fields: [] }, getChildAt: () => null };
      }
      const keys = Object.keys(rows[0]!);
      return {
        numRows: rows.length,
        schema: {
          fields: keys.map(name => ({ name, type: { toString: () => 'Utf8' } })),
        },
        getChildAt: (colIdx: number) => {
          const key = keys[colIdx]!;
          return {
            get: (rowIdx: number) => rows[rowIdx]?.[key] ?? null,
          };
        },
      };
    };

    const mockConn = {
      query: async (sql: string) => {
        if (sql.includes('FROM local.main._dbtc_notebook')) {
          return makeArrowMock([]);
        }
        if (sql.includes('FROM local.main._dbtc_cells')) {
          return makeArrowMock(persistedRows);
        }
        return makeArrowMock([]);
      },
    };

    await hydrateStoreFromDuckDb(mockConn as never);

    const hydratedMarey = store.cells.find(c => c.cellId === 'cell_marey');
    const hydratedHorizon = store.cells.find(c => c.cellId === 'cell_headway_horizon_rm');
    const hydratedBasicBar = store.cells.find(c => c.cellId === 'cell_basic_bar_turnstiles');
    const hydratedBasicLine = store.cells.find(c => c.cellId === 'cell_basic_line_hourly');
    expect(hydratedMarey?.sqlText).toContain('-- v22-ossie-lens-starter');
    expect(hydratedMarey?.sqlText).not.toContain("INTERVAL '5 days'");
    expect(hydratedHorizon?.sqlText).toContain('-- v22-ossie-lens-starter');
    expect(hydratedHorizon?.sqlText).not.toContain("INTERVAL '5 days'");
    expect(hydratedBasicBar?.sqlText).toContain('-- v22-ossie-lens-starter');
    expect(expandCellSql(hydratedBasicBar?.sqlText ?? '', {})).toContain("DATE '2026-10-29'");
    expect(hydratedBasicLine?.sqlText).toContain('-- v22-ossie-lens-starter');
    expect(expandCellSql(hydratedBasicLine?.sqlText ?? '', {})).toContain("DATE '2026-10-29'");
  });

  it('verifies <7> rush-day selection in cell_marey, single-station R/M bounds in cell_headway_horizon_rm, station disambiguation in cell_basic_bar_turnstiles, and Other Routes in cell_basic_donut_fleet', () => {
    const marey = STARTER_CELLS.find(c => c.cellId === 'cell_marey')!;
    const expandedMarey = expandCellSql(marey.sqlText, {});
    expect(expandedMarey).not.toContain('fact_vehicle_positions.event_date < CURRENT_DATE');
    expect(expandedMarey).toContain("route_id IN ('7', '7X')");
    expect(expandedMarey).toContain('event_date = (CASE EXTRACT(ISODOW');
    expect(expandedMarey).toContain("right(station_id, 1) = 'S'");
    expect(expandedMarey).toContain("trip_id NOT LIKE '%..N%'");
    expect(expandedMarey).toContain('view_dim_stations');
    expect(expandedMarey).not.toContain('local.main.dim_stations');
    expect(expandedMarey).toContain('MAX(event_time) AS event_time');
    expect(expandedMarey).not.toContain("INTERVAL '2 days'");
    expect(marey.sqlText).toContain('-- v22-ossie-lens-starter');

    const horizon = STARTER_CELLS.find(c => c.cellId === 'cell_headway_horizon_rm')!;
    const expandedHorizon = expandCellSql(horizon.sqlText, {});
    expect(expandedHorizon).not.toContain('fact_vehicle_positions.event_date < CURRENT_DATE');
    expect(expandedHorizon).not.toContain("'M08'");
    expect(expandedHorizon).toContain('count(DISTINCT h.route_id) DESC');
    expect(expandedHorizon).toContain('h.headway_sec BETWEEN 30 AND 1800');
    expect(expandedHorizon).toContain('best_station');
    expect(expandedHorizon).toContain("right(station_id, 1) = 'S'");
    expect(expandedHorizon).toContain("trip_id NOT LIKE '%..N%'");
    expect(expandedHorizon).toContain('MAX(event_time) AS event_time');
    expect(expandedHorizon).not.toContain("INTERVAL ''2 days''");
    expect(horizon.sqlText).toContain('-- v22-ossie-lens-starter');

    const turnstilesBar = STARTER_CELLS.find(c => c.cellId === 'cell_basic_bar_turnstiles')!;
    const expandedTurnstilesBar = expandCellSql(turnstilesBar.sqlText, {});
    expect(expandedTurnstilesBar).toContain('GROUP BY t.station_id, c.complex_name, c.daytime_routes');
    expect(expandedTurnstilesBar).toContain('same_base_name_count');

    const fleetDonut = STARTER_CELLS.find(c => c.cellId === 'cell_basic_donut_fleet')!;
    const expandedFleetDonut = expandCellSql(fleetDonut.sqlText, {});
    expect(expandedFleetDonut).toContain("'Other Routes'");
    expect(expandedFleetDonut).toContain('WHEN rn <= 8');
  });

  it('distinguishes DuckDB-Wasm engine spin-up from cell SQL query execution in formatFreshness', async () => {
    const { formatFreshness } = await import('../src/ui/editorial-card.js');
    const { seedStarterCellsInStore } = await import('../src/state/store.js');

    store.notebook.engineStatus = 'booting';
    seedStarterCellsInStore('booting');
    const qCell = store.cells.find(c => c.kind === 'question')!;
    expect(qCell.executionState.status).toBe('booting');
    expect(formatFreshness(qCell)).toBe('Spinning up DuckDB-Wasm engine...');

    store.notebook.engineStatus = 'ready';
    qCell.executionState = { status: 'running', startTime: Date.now() };
    expect(formatFreshness(qCell)).toBe('Running SQL query in DuckDB-Wasm...');
  });

  it('prevents UTC midnight rollover from hiding active trains in cell_train_position_map after 7:00 PM EST', () => {
    const trainPos = STARTER_CELLS.find(c => c.cellId === 'cell_train_position_map')!;
    expect(trainPos.sqlText).toContain('-- v22-ossie-lens-starter');
    const expanded = expandCellSql(trainPos.sqlText, {});
    expect(expanded).not.toContain(
      "event_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE"
    );
    expect(expanded).toContain(
      "event_date <= ((CURRENT_TIMESTAMP + INTERVAL '5 minutes') AT TIME ZONE 'UTC')::DATE"
    );
  });
});




