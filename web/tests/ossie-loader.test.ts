import { describe, it, expect, vi } from 'vitest';
import {
  OSSIE_THEMES,
  OSSIE_FACT_GRAPH,
  type TypedOssieConfig,
} from '../src/types/straphanger-schema.gen.js';
import {
  compileOssieConfigToSql,
  expandOssieQueryCalls,
  initOssieExtension,
} from '../src/data/ossie-loader.js';

describe('Ossie Semantic Models and SQL Compiler', () => {
  it('loads all six canonical transit semantic themes including dbtc', () => {
    expect(OSSIE_THEMES).toHaveLength(6);
    const themeNames = OSSIE_THEMES.map(t => t.name);
    expect(themeNames).toContain('dbtc');
    expect(themeNames).toContain('network_accessibility_and_demand');
    expect(themeNames).toContain('rail_operations');
    expect(themeNames).toContain('service_reliability_and_micromobility');
    expect(themeNames).toContain('surface_kinematics');
    expect(themeNames).toContain('unified_transit_network');
  });

  it('validates fact graph reachability per theme including dbtc', () => {
    const dbtc = (OSSIE_FACT_GRAPH as Record<string, any>)['dbtc'];
    expect(dbtc).toBeDefined();
    expect(dbtc.factDatasets).toContain('station_headways');
    expect(dbtc.factDatasets).toContain('schedule_adherence');
    expect(dbtc.factDatasets).toContain('turnstile_flows');
    expect(dbtc.factDatasets).toContain('fact_ridership');
    expect(dbtc.factDatasets).toContain('station_to_station_legs');
    expect(dbtc.factDatasets).toContain('current_vehicle_positions');

    const demand = (OSSIE_FACT_GRAPH as Record<string, any>)['network_accessibility_and_demand'];
    expect(demand).toBeDefined();
    expect(demand.factDatasets).toContain('turnstile_flows');
    expect(demand.factDatasets).toContain('fact_ridership');

    const rail = (OSSIE_FACT_GRAPH as Record<string, any>)['rail_operations'];
    expect(rail).toBeDefined();
    expect(rail.factDatasets).toContain('station_headways');
  });

  it('compiles a typed Ossie configuration into SQL with joins and group by', () => {
    const config: TypedOssieConfig = {
      theme: 'dbtc',
      factDataset: 'station_headways',
      selectedMetrics: ['median_headway_sec', 'avg_headway_sec'],
      selectedDimensions: ['station_headways.route_id', 'station_headways.event_date'],
      filters: [
        { field: 'station_headways.route_id', operator: '=', value: "'6'" },
      ],
    };

    const sql = compileOssieConfigToSql(config);

    expect(sql).toContain('SELECT');
    expect(sql).toContain('station_headways.route_id');
    expect(sql).toContain('station_headways.event_date');
    expect(sql).toContain('median_headway_sec');
    expect(sql).toContain('avg_headway_sec');
    expect(sql).toContain('FROM');
    expect(sql).toContain('station_headways');
    expect(sql).toContain("WHERE station_headways.route_id = '6'");
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('station_headways.route_id, station_headways.event_date');
  });

  it('expands inline ossie_query(dbtc, ...) table-function calls into executable DuckDB subqueries', () => {
    const rawSql = `SELECT s.name, s.latitude FROM ossie_query('dbtc', 'dim_stations', 'dim_stations.agency_id,dim_stations.gtfs_stop_id,dim_stations.name,dim_stations.latitude', '') s WHERE s.agency_id = 'MTA_NYCT_SUBWAY';`;
    const expanded = expandOssieQueryCalls(rawSql);
    expect(expanded).not.toContain('ossie_query(');
    expect(expanded).toContain('FROM prod.transit_v2.view_dim_stations AS dim_stations');
    expect(expanded).toContain('dim_stations.name');
  });

  it('throws an error for non-existent theme or fact dataset', () => {
    const badThemeConfig: TypedOssieConfig = {
      theme: 'non_existent_theme' as any,
      factDataset: 'station_headways' as any,
      selectedMetrics: [],
      selectedDimensions: [],
      filters: [],
    };
    expect(() => compileOssieConfigToSql(badThemeConfig)).toThrow(/Unknown Ossie theme/);

    const badFactConfig: TypedOssieConfig = {
      theme: 'rail_operations',
      factDataset: 'fake_fact' as any,
      selectedMetrics: [],
      selectedDimensions: [],
      filters: [],
    };
    expect(() => compileOssieConfigToSql(badFactConfig)).toThrow(/Unknown fact dataset/);
  });

  it('throws an error if an unreachable dataset dimension is requested', () => {
    const invalidConfig: TypedOssieConfig = {
      theme: 'rail_operations',
      factDataset: 'station_headways',
      selectedMetrics: ['avg_headway_sec'],
      selectedDimensions: ['station_to_station_legs.to_station_id' as any],
      filters: [],
    };
    expect(() => compileOssieConfigToSql(invalidConfig)).toThrow(
      /Cannot resolve join path from 'station_headways' to 'station_to_station_legs'/
    );
  });

  it('resolves multi-hop joins across snowflake dimensions', () => {
    const multiHopConfig: TypedOssieConfig = {
      theme: 'unified_transit_network',
      factDataset: 'station_hourly_summary',
      selectedMetrics: ['total_hourly_entries'],
      selectedDimensions: ['station_complexes.complex_name' as any],
      filters: [],
    };
    const sql = compileOssieConfigToSql(multiHopConfig);
    expect(sql).toContain('LEFT JOIN prod.transit_v2.view_dim_stations AS dim_stations');
    expect(sql).toContain('LEFT JOIN prod.transit_v2.view_station_complexes AS station_complexes');
  });

  it('registers only the root-level dbtc Ossie 0.2.0.dev0 JSON model without semantic_model wrapper', async () => {
    const { DBTC_OSSIE_THEMES } = await import('../src/data/ossie-loader.js');
    expect(DBTC_OSSIE_THEMES).toHaveLength(1);
    expect(DBTC_OSSIE_THEMES[0]?.name).toBe('dbtc');

    const registeredFiles: Record<string, string> = {};
    const mockDb = {
      registerFileText: vi.fn(async (name: string, content: string) => {
        registeredFiles[name] = content;
      }),
    } as any;
    const mockConn = {
      query: vi.fn(async () => ({})),
    } as any;

    const ok = await initOssieExtension(mockDb, mockConn);
    expect(ok).toBe(true);
    expect(Object.keys(registeredFiles)).toEqual(['dbtc.ossie.json']);

    const dbtcJson = registeredFiles['dbtc.ossie.json'] ?? '{}';
    const dbtcModel = JSON.parse(dbtcJson);
    expect(dbtcModel.semantic_model).toBeUndefined();
    expect(dbtcModel.version).toBe('0.2.0.dev0');
    expect(dbtcModel.name).toBe('dbtc');
    expect(dbtcModel.datasets[0].fields[0].expression).toEqual({
      dialects: [{ dialect: 'ANSI_SQL', expression: dbtcModel.datasets[0].fields[0].name }],
    });
    expect(dbtcModel.relationships[0].from_columns).toBeDefined();
    expect(dbtcModel.relationships[0].to_columns).toBeDefined();
    expect(dbtcModel.metrics[0].expression.dialects[0].dialect).toBe('ANSI_SQL');
  });

  it('ingests Socrata CSV via registerFileBuffer in registerRemoteUrlView and tracks rowCount', async () => {
    const { registerRemoteUrlView, getConnectedSourceRowCount, removeSource } = await import(
      '../src/data/csv-ingest.js'
    );
    const executedSql: string[] = [];
    const registeredBuffers: Record<string, Uint8Array> = {};
    const mockDb = {
      registerFileBuffer: vi.fn(async (path: string, bytes: Uint8Array) => {
        registeredBuffers[path] = bytes;
      }),
    } as any;
    const mockConn = {
      query: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        if (sql.includes('SELECT COUNT(*)')) {
          return {
            getChildAt: () => ({ get: () => 472 }),
          };
        }
        return {};
      }),
    } as any;
    const mockFetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://data.ny.gov/resource/39hk-dx4f.csv?$limit=5000');
      return {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('station_id,name\n127,Times Sq\n').buffer,
      };
    }) as unknown as typeof fetch;

    const viewName = await registerRemoteUrlView(
      mockConn,
      'mta_subway_stations_39hk_dx4f',
      'https://data.ny.gov/resource/39hk-dx4f.csv?$limit=50000',
      false,
      mockDb,
      mockFetch
    );

    expect(viewName).toBe('mta_subway_stations_39hk_dx4f');
    expect(registeredBuffers['remote/mta_subway_stations_39hk_dx4f.csv']).toBeDefined();
    expect(
      executedSql.some(s =>
        s.includes(
          "CREATE OR REPLACE TABLE local.main.mta_subway_stations_39hk_dx4f AS SELECT * FROM read_csv_auto('remote/mta_subway_stations_39hk_dx4f.csv');"
        )
      )
    ).toBe(true);
    expect(getConnectedSourceRowCount('mta_subway_stations_39hk_dx4f')).toBe(472);

    await removeSource(mockConn, 'mta_subway_stations_39hk_dx4f');
    expect(getConnectedSourceRowCount('mta_subway_stations_39hk_dx4f')).toBeUndefined();
  });

  it('retries Socrata CSV buffer ingestion with sample_size=-1, ignore_errors=true when mixed-type columns fail default sampling', async () => {
    const { registerRemoteUrlView, getConnectedSourceRowCount, removeSource } = await import(
      '../src/data/csv-ingest.js'
    );
    const executedSql: string[] = [];
    const mockDb = {
      registerFileBuffer: vi.fn(async () => {}),
    } as any;
    const mockConn = {
      query: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        if (sql.includes("read_csv_auto('remote/mta_subway_hourly_ridership_wujg_7c2s.csv');")) {
          throw new Error('Conversion Error: Could not convert string "TRAM1" to INT64');
        }
        if (sql.includes('SELECT COUNT(*)')) {
          return {
            getChildAt: () => ({ get: () => 5000 }),
          };
        }
        return {};
      }),
    } as any;
    const mockFetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('station_complex_id,ridership\n601,120\nTRAM1,45\n').buffer,
    })) as unknown as typeof fetch;

    const viewName = await registerRemoteUrlView(
      mockConn,
      'mta_subway_hourly_ridership_wujg_7c2s',
      'https://data.ny.gov/resource/wujg-7c2s.csv?$limit=50000',
      false,
      mockDb,
      mockFetch
    );

    expect(viewName).toBe('mta_subway_hourly_ridership_wujg_7c2s');
    expect(
      executedSql.some(s =>
        s.includes(
          "CREATE OR REPLACE TABLE local.main.mta_subway_hourly_ridership_wujg_7c2s AS SELECT * FROM read_csv_auto('remote/mta_subway_hourly_ridership_wujg_7c2s.csv', sample_size=-1, ignore_errors=true);"
        )
      )
    ).toBe(true);
    expect(getConnectedSourceRowCount('mta_subway_hourly_ridership_wujg_7c2s')).toBe(5000);
    await removeSource(mockConn, 'mta_subway_hourly_ridership_wujg_7c2s');
  });

  it('normalizes CURRENT_DATE +/- INTERVAL expressions to ::DATE idempotently for DuckLake partition pruning', async () => {
    const { normalizeDuckLakeDatePredicates } = await import('../src/data/ossie-loader.js');
    const raw = `SELECT * FROM prod.transit_v2.fact_vehicle_positions WHERE event_date >= CURRENT_DATE - INTERVAL '3 days' AND event_time <= CURRENT_TIMESTAMP + INTERVAL '1 minute';`;
    const normalized = normalizeDuckLakeDatePredicates(raw);
    expect(normalized).toContain("WHERE event_date >= (CURRENT_DATE - INTERVAL '3 days')::DATE");
    expect(normalized).toContain("AND event_time <= CURRENT_TIMESTAMP + INTERVAL '1 minute'");

    // ANSI SQL interval syntax (`INTERVAL '3' DAY`, `INTERVAL 3 DAYS`) and `TODAY()`
    const ansiAndToday = `WHERE event_date >= CURRENT_DATE - INTERVAL '3' DAY AND event_date >= CURRENT_DATE - INTERVAL 5 DAYS AND event_date <= today() - INTERVAL '1 day'`;
    const normalizedAnsi = normalizeDuckLakeDatePredicates(ansiAndToday);
    expect(normalizedAnsi).toBe(
      `WHERE event_date >= (CURRENT_DATE - INTERVAL '3' DAY)::DATE AND event_date >= (CURRENT_DATE - INTERVAL 5 DAYS)::DATE AND event_date <= (today() - INTERVAL '1 day')::DATE`
    );

    // Idempotent on second pass and on already-cast expressions (including nested parens)
    expect(normalizeDuckLakeDatePredicates(normalized)).toBe(normalized);
    expect(normalizeDuckLakeDatePredicates(normalizedAnsi)).toBe(normalizedAnsi);
    const alreadyCast = `WHERE event_date >= (CURRENT_DATE - INTERVAL '3 days')::DATE AND event_date >= CURRENT_DATE - INTERVAL '3 days'::DATE AND event_date >= CAST(CURRENT_DATE - INTERVAL '3 days' AS DATE) AND event_date >= CAST((CURRENT_DATE - INTERVAL '3 days') AS DATE)`;
    expect(normalizeDuckLakeDatePredicates(alreadyCast)).toBe(alreadyCast);
  });

  it('registers DuckLake catalog.db in memory via registerFileBuffer when valid DUCK header is fetched and falls back to httpfs otherwise', async () => {
    const { attachRemoteDuckLakeCatalog } = await import('../src/data/duckdb-client.js');
    const validDuckBytes = new Uint8Array(4096);
    validDuckBytes[8] = 0x44; // 'D'
    validDuckBytes[9] = 0x55; // 'U'
    validDuckBytes[10] = 0x43; // 'C'
    validDuckBytes[11] = 0x4b; // 'K'

    const registered: Record<string, Uint8Array> = {};
    const dropped: string[] = [];
    const executedSql: string[] = [];
    const mockDb = {
      dropFile: vi.fn(async (name: string) => {
        dropped.push(name);
      }),
      registerFileBuffer: vi.fn(async (name: string, buf: Uint8Array) => {
        registered[name] = buf;
      }),
    };
    const mockConn = {
      query: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        return {} as any;
      }),
    };
    const okFetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => validDuckBytes.buffer,
    })) as unknown as typeof fetch;

    const mode = await attachRemoteDuckLakeCatalog(
      mockDb,
      mockConn,
      'https://example.com/ducklake/catalog.db',
      okFetch
    );
    expect(mode).toBe('memory-buffer');
    expect(dropped).toEqual(['prod_catalog.db']);
    expect(registered['prod_catalog.db']).toBeDefined();
    expect(executedSql).toEqual(["ATTACH 'ducklake:prod_catalog.db' AS prod (READ_ONLY);"]);

    // Uses prefetchedBytesPromise without calling fetch again
    const neverFetch = vi.fn(async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    const prefetchedMode = await attachRemoteDuckLakeCatalog(
      mockDb,
      mockConn,
      'https://example.com/ducklake/catalog.db',
      neverFetch,
      Promise.resolve(validDuckBytes)
    );
    expect(prefetchedMode).toBe('memory-buffer');
    expect(neverFetch).not.toHaveBeenCalled();

    // Fallback when fetch fails
    const fallbackSql: string[] = [];
    const failFetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    const fallbackMode = await attachRemoteDuckLakeCatalog(
      mockDb,
      {
        query: vi.fn(async (sql: string) => {
          fallbackSql.push(sql);
          return {} as any;
        }),
      },
      'https://example.com/ducklake/catalog.db',
      failFetch
    );
    expect(fallbackMode).toBe('httpfs');
    expect(fallbackSql).toEqual(["ATTACH 'ducklake:https://example.com/ducklake/catalog.db' AS prod (READ_ONLY);"]);
  });

  it('expands 4-argument ossie_query calls with escaped single-quote SQL date filters, BETWEEN clauses, and starter cell subqueries', async () => {
    const { STARTER_CELLS } = await import('../src/state/local-state-schema.js');

    const sqlWithEscapedFilter = `SELECT * FROM ossie_query('dbtc', 'fact_vehicle_positions', 'fact_vehicle_positions.event_date,fact_vehicle_positions.route_id', 'fact_vehicle_positions.event_date = (CURRENT_DATE - INTERVAL ''1 day'')::DATE AND fact_vehicle_positions.route_id IN (''4'', ''5'', ''6'')')`;
    const expanded = expandOssieQueryCalls(sqlWithEscapedFilter);
    expect(expanded).not.toContain('ossie_query(');
    expect(expanded).toContain("WHERE fact_vehicle_positions.event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE");
    expect(expanded).toContain("fact_vehicle_positions.route_id IN ('4', '5', '6')");

    // BETWEEN ... AND ... inside ossie_query 4th argument must not be split on AND and dropped
    const sqlWithBetweenFilter = `SELECT * FROM ossie_query('dbtc', 'fact_vehicle_positions', 'fact_vehicle_positions.event_date,fact_vehicle_positions.agency_id', 'fact_vehicle_positions.event_date BETWEEN DATE ''2026-11-08'' AND DATE ''2026-11-09'' AND fact_vehicle_positions.agency_id = ''MTA_NYCT_SUBWAY''')`;
    const expandedBetween = expandOssieQueryCalls(sqlWithBetweenFilter);
    expect(expandedBetween).not.toContain('ossie_query(');
    expect(expandedBetween).toContain(
      "WHERE fact_vehicle_positions.event_date BETWEEN DATE '2026-11-08' AND DATE '2026-11-09' AND fact_vehicle_positions.agency_id = 'MTA_NYCT_SUBWAY'"
    );

    // Default event_date filter injection for turnstile_flows and current_vehicle_positions
    const defaultTurnstileSql = compileOssieConfigToSql({
      theme: 'dbtc',
      factDataset: 'turnstile_flows',
      selectedDimensions: ['turnstile_flows.station_id'],
      selectedMetrics: ['total_entries'],
      filters: [],
    });
    expect(defaultTurnstileSql).toContain("turnstile_flows.event_date >= DATE '2026-10-29'");

    const defaultLivePosSql = compileOssieConfigToSql({
      theme: 'dbtc',
      factDataset: 'current_vehicle_positions',
      selectedDimensions: ['current_vehicle_positions.route_id'],
      selectedMetrics: ['active_trains_count'],
      filters: [],
    });
    expect(defaultLivePosSql).toContain('current_vehicle_positions.event_date = CURRENT_DATE');

    // Verify all 14 starter question cells expand cleanly without leftover ossie_query() calls
    // and compile their ossieConfigJson with unquoted SQL date expressions
    const questionCells = STARTER_CELLS.filter(c => c.kind === 'question');
    expect(questionCells).toHaveLength(14);
    for (const qc of questionCells) {
      expect(
        qc.sqlText.includes('-- v14-fast-pruned-starter') ||
          qc.sqlText.includes('-- v22-ossie-lens-starter')
      ).toBe(true);
      const expandedCellSql = expandOssieQueryCalls(qc.sqlText);
      expect(expandedCellSql).not.toContain('ossie_query(');
      if (qc.ossieConfigJson) {
        const compiled = compileOssieConfigToSql(JSON.parse(qc.ossieConfigJson));
        expect(compiled).toContain('event_date');
        expect(compiled).not.toContain("'(CURRENT_DATE");
        expect(compiled).not.toContain("'DATE ");
      }
    }

    const pulseCell = STARTER_CELLS.find(c => c.cellId === 'cell_multimodal_pulse_midtown')!;
    const expandedPulse = expandOssieQueryCalls(pulseCell.sqlText);
    expect(expandedPulse).toContain(
      "WHERE t.event_date >= DATE '2026-10-29'\n    AND t.agency_id = 'MTA_NYCT_SUBWAY'\n    AND t.station_id IN ('610', '631', '602')"
    );
  });

  it('executes all 14 expanded starter queries in DuckDB with fast-path dimension rewrites and verifies non-empty turnstile, Marey/Horizon, commuter rail, M60-SBS, complex names, and unaliased view rewrites', async () => {
    const { execFileSync } = await import('node:child_process');
    const { STARTER_CELLS } = await import('../src/state/local-state-schema.js');
    const { rewriteFastPathDimensionViews } = await import('../src/data/duckdb-client.js');

    const schemaSql = `
      LOAD icu;
      SET TimeZone = 'America/New_York';
      ATTACH ':memory:' AS local;
      ATTACH ':memory:' AS prod;
      CREATE SCHEMA prod.transit_v2;
      CREATE TABLE prod.transit_v2.dim_service_lines (line_id VARCHAR, agency_id VARCHAR, route_id VARCHAR, service_name VARCHAR, division VARCHAR, line_name VARCHAR, color_hex VARCHAR, geom_wkt VARCHAR, geom_geojson VARCHAR, shape_leng DOUBLE, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ, is_current BOOLEAN, raw_payload VARCHAR);
      CREATE VIEW prod.transit_v2.view_dim_service_lines AS SELECT line_id, agency_id, route_id, service_name, division, line_name, color_hex, geom_wkt, geom_geojson, shape_leng, raw_payload FROM prod.transit_v2.dim_service_lines WHERE is_current = true;
      CREATE TABLE prod.transit_v2.dim_micromobility_stations (station_id VARCHAR, agency_id VARCHAR, name VARCHAR, latitude DOUBLE, longitude DOUBLE, capacity INT, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ, is_current BOOLEAN, raw_payload VARCHAR);
      INSERT INTO prod.transit_v2.dim_micromobility_stations VALUES ('citibike_gc', 'CITIBIKE', 'Park Ave & E 42 St', 40.751873, -73.977706, 83, CURRENT_TIMESTAMP, NULL, true, '{}');
      CREATE VIEW prod.transit_v2.view_dim_micromobility_stations AS SELECT station_id, agency_id, name, latitude, longitude, capacity, raw_payload FROM prod.transit_v2.dim_micromobility_stations WHERE is_current = true;
      CREATE VIEW prod.transit_v2.view_m60_sbs_kinematics AS
      SELECT
        CURRENT_TIMESTAMP - INTERVAL '2 minutes' AS event_time,
        'MTA_BUS'::VARCHAR AS agency_id,
        'M60-SBS'::VARCHAR AS route_id,
        'M60_TEST_1'::VARCHAR AS trip_id,
        'MTA_BUS_5801'::VARCHAR AS vehicle_id,
        '401561'::VARCHAR AS station_id,
        'W 125 St / Lenox Av'::VARCHAR AS station_name,
        40.80775::DOUBLE AS latitude,
        -73.94548::DOUBLE AS longitude,
        118.0::DOUBLE AS bearing,
        16.4::DOUBLE AS speed_mph,
        'IN_TRANSIT_TO'::VARCHAR AS status;
      CREATE TABLE prod.transit_v2.dim_stations (station_id VARCHAR, agency_id VARCHAR, name VARCHAR, latitude DOUBLE, longitude DOUBLE, gtfs_stop_id VARCHAR, complex_id VARCHAR, borough VARCHAR, daytime_routes VARCHAR, structure VARCHAR, is_accessible BOOLEAN, valid_from TIMESTAMPTZ, is_current BOOLEAN);
      INSERT INTO prod.transit_v2.dim_stations VALUES
        ('402', 'MTA_NYCT_SUBWAY', 'Grand Central-42 St', 40.75178, -73.97675, '631', '610', 'Manhattan', '4 5 6 7 S', 'Subway', true, CURRENT_TIMESTAMP, true),
        ('368', 'MTA_NYCT_SUBWAY', 'Morrison Av-Soundview', 40.82952, -73.87452, '610', '368', 'Bronx', '6', 'Elevated', false, CURRENT_TIMESTAMP, true),
        ('280', 'MTA_NYCT_SUBWAY', 'Jackson Hts-Roosevelt Av', 40.74664, -73.89133, 'G19', '616', 'Queens', 'E F M R 7', 'Subway', true, CURRENT_TIMESTAMP, true),
        ('MNR_1', 'MTA_METRO_NORTH', 'Grand Central', 40.7529, -73.9772, '1', 'MNR_1', 'Manhattan', 'HUD HAR NH', 'Terminal', true, CURRENT_TIMESTAMP, true),
        ('LIRR_8', 'MTA_LIRR', 'Penn Station', 40.7506, -73.9935, '8', 'LIRR_8', 'Manhattan', 'BAB RON PW', 'Terminal', true, CURRENT_TIMESTAMP, true);
      CREATE VIEW prod.transit_v2.view_dim_stations AS SELECT station_id, agency_id, name, latitude, longitude, gtfs_stop_id, complex_id, borough, daytime_routes, structure, is_accessible, 1 AS route_count, false AS is_interlined_junction, '{}' AS raw_payload FROM prod.transit_v2.dim_stations WHERE is_current = true;
      CREATE VIEW prod.transit_v2.view_station_complexes AS SELECT complex_id, agency_id, max(name) AS complex_name, avg(latitude) AS latitude, avg(longitude) AS longitude, string_agg(DISTINCT daytime_routes, ' ') AS daytime_routes, true AS is_accessible, count(*) AS station_count, 1 AS route_count FROM prod.transit_v2.dim_stations GROUP BY complex_id, agency_id;
      CREATE TABLE prod.transit_v2.view_dim_routes (agency_id VARCHAR, route_id VARCHAR, route_name VARCHAR, color_hex VARCHAR, type VARCHAR);
      CREATE TABLE prod.transit_v2.fact_vehicle_positions (event_date DATE, event_time TIMESTAMPTZ, agency_id VARCHAR, route_id VARCHAR, trip_id VARCHAR, station_id VARCHAR, vehicle_id VARCHAR, status VARCHAR, latitude DOUBLE, longitude DOUBLE, bearing DOUBLE, speed DOUBLE, occupancy_status VARCHAR);
      INSERT INTO prod.transit_v2.fact_vehicle_positions
      WITH rush AS (
        SELECT (
          CASE EXTRACT(ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE)
            WHEN 1 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 3
            WHEN 7 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 2
            ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 1
          END
        )::DATE AS d
      )
      SELECT d, (d::TIMESTAMP + INTERVAL '8 hours') AT TIME ZONE 'America/New_York', 'MTA_NYCT_SUBWAY', '7', 'trip_7_1', '631S', 'v7_1', 'STOPPED_AT', 40.75178, -73.97675, 0, 0, 'EMPTY' FROM rush
      UNION ALL
      SELECT d, (d::TIMESTAMP + INTERVAL '8 hours 4 minutes') AT TIME ZONE 'America/New_York', 'MTA_NYCT_SUBWAY', '7X', 'trip_7x_1', '631S', 'v7x_1', 'STOPPED_AT', 40.75178, -73.97675, 0, 0, 'EMPTY' FROM rush
      UNION ALL
      SELECT d, (d::TIMESTAMP + INTERVAL '8 hours') AT TIME ZONE 'America/New_York', 'MTA_NYCT_SUBWAY', 'R', 'trip_r_1', 'G19S', 'vr_1', 'STOPPED_AT', 40.74664, -73.89133, 0, 0, 'EMPTY' FROM rush
      UNION ALL
      SELECT d, (d::TIMESTAMP + INTERVAL '8 hours 6 minutes') AT TIME ZONE 'America/New_York', 'MTA_NYCT_SUBWAY', 'R', 'trip_r_2', 'G19S', 'vr_2', 'STOPPED_AT', 40.74664, -73.89133, 0, 0, 'EMPTY' FROM rush
      UNION ALL
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE, CURRENT_TIMESTAMP - INTERVAL '2 minutes', 'MTA_METRO_NORTH', '1', 'mnr_hud_1', '1', 'mnr_v1', 'IN_TRANSIT_TO', 40.8255, -73.9301, 195, 18.0, 'MANY_SEATS_AVAILABLE'
      UNION ALL
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE, CURRENT_TIMESTAMP - INTERVAL '1 minute', 'MTA_LIRR', '1', 'lirr_bab_1', '8', 'lirr_v1', 'IN_TRANSIT_TO', 40.7002, -73.8075, 95, 22.0, 'MANY_SEATS_AVAILABLE'
      UNION ALL
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE, CURRENT_TIMESTAMP - INTERVAL '2 minutes', 'MTA_BUS', 'M60-SBS', 'M60_TEST_1', '401561', 'MTA_BUS_5801', 'IN_TRANSIT_TO', 40.80775, -73.94548, 118.0, 16.4, 'MANY_SEATS_AVAILABLE';
      CREATE TABLE prod.transit_v2.fact_schedules (event_date DATE, agency_id VARCHAR, route_id VARCHAR, station_id VARCHAR, trip_id VARCHAR, scheduled_arrival_time TIMESTAMPTZ, scheduled_departure_time TIMESTAMPTZ);
      CREATE TABLE prod.transit_v2.view_turnstile_flows (event_date DATE, agency_id VARCHAR, station_id VARCHAR, device_id VARCHAR, reading_time TIMESTAMPTZ, service_hour TIMESTAMPTZ, entry_count BIGINT, exit_count BIGINT, payment_method VARCHAR, fare_class_category VARCHAR);
      CREATE TABLE prod.transit_v2.fact_micromobility_status (event_date DATE, event_time TIMESTAMPTZ, agency_id VARCHAR, station_id VARCHAR, num_bikes_available INT, num_ebikes_available INT, num_docks_available INT, is_installed BOOLEAN, is_renting BOOLEAN, is_returning BOOLEAN);
      CREATE TABLE prod.transit_v2.fact_ridership (event_date DATE, event_time TIMESTAMPTZ, agency_id VARCHAR, origin_station_id VARCHAR, destination_station_id VARCHAR, passenger_count BIGINT);
      INSERT INTO prod.transit_v2.view_turnstile_flows VALUES
        (DATE '2026-10-29', 'MTA_NYCT_SUBWAY', '610', 'dev1', TIMESTAMPTZ '2026-10-29 08:00:00Z', TIMESTAMPTZ '2026-10-29 08:00:00Z', 1200, 300, 'OMNY', 'FULL'),
        ((CURRENT_DATE - INTERVAL '1 day')::DATE, 'MTA_NYCT_SUBWAY', '999', 'dev2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 999999, 100, 'OMNY', 'FULL');
      CREATE OR REPLACE VIEW local.main.live_mta_subway_positions AS
        SELECT NULL::DATE AS event_date, NULL::TIMESTAMPTZ AS event_time, NULL::VARCHAR AS agency_id, NULL::VARCHAR AS route_id, NULL::VARCHAR AS trip_id, NULL::VARCHAR AS vehicle_id, NULL::VARCHAR AS station_id, NULL::DOUBLE AS latitude, NULL::DOUBLE AS longitude, NULL::DOUBLE AS bearing, NULL::DOUBLE AS speed, NULL::VARCHAR AS status, NULL::VARCHAR AS occupancy_status WHERE 1 = 0;
      CREATE OR REPLACE VIEW local.main.live_mta_sir_positions AS
        SELECT * FROM local.main.live_mta_subway_positions;
      CREATE OR REPLACE VIEW local.main.live_mta_lirr_positions AS
        SELECT * FROM local.main.live_mta_subway_positions;
      CREATE OR REPLACE VIEW local.main.live_mta_mnr_positions AS
        SELECT * FROM local.main.live_mta_subway_positions;
      CREATE OR REPLACE VIEW local.main.live_mta_bus_positions AS
        SELECT * FROM local.main.live_mta_subway_positions;
      CREATE OR REPLACE VIEW local.main.live_mta_alerts AS
        SELECT NULL::VARCHAR AS alert_id, NULL::VARCHAR AS agency_id, NULL::DATE AS event_date, NULL::TIMESTAMPTZ AS detected_at, NULL::TIMESTAMPTZ AS last_seen_at, NULL::TIMESTAMPTZ AS active_period_start, NULL::TIMESTAMPTZ AS active_period_end, NULL::VARCHAR AS affected_route_ids, NULL::VARCHAR AS cause, NULL::VARCHAR AS effect, NULL::VARCHAR AS header_text, NULL::VARCHAR AS description_text, NULL::VARCHAR AS severity WHERE 1 = 0;
    `;

    let fullSql = schemaSql;
    for (const cell of STARTER_CELLS.filter(c => c.kind === 'question')) {
      let q = cell.sqlText.replace(/\{\{origin_station_id\}\}/g, '237');
      q = rewriteFastPathDimensionViews(expandOssieQueryCalls(q));
      fullSql += `\nCREATE TABLE local.main.res_${cell.cellId} AS ${q}`;
    }

    const unaliasedStationQuery = rewriteFastPathDimensionViews(
      `SELECT view_dim_stations.name FROM prod.transit_v2.view_dim_stations WHERE view_dim_stations.gtfs_stop_id = '631'`
    );
    const unqualifiedComplexQuery = rewriteFastPathDimensionViews(
      `SELECT view_station_complexes.complex_name FROM view_station_complexes WHERE view_station_complexes.complex_id = '610'`
    );

    fullSql += `
      SELECT
        (SELECT max(entry_count) FROM local.main.res_cell_multimodal_pulse_midtown) AS max_gc_entry,
        (SELECT count(*) FROM local.main.res_cell_basic_bar_turnstiles) AS bar_rows,
        (SELECT station_name FROM local.main.res_cell_basic_bar_turnstiles WHERE station_name != '999' LIMIT 1) AS top_bar_station,
        (SELECT count(*) FROM local.main.res_cell_basic_line_hourly) AS line_rows,
        (SELECT count(*) FROM local.main.res_cell_marey) AS marey_rows,
        (SELECT count(*) FROM local.main.res_cell_headway_horizon_rm) AS horizon_rows,
        (SELECT count(*) FROM local.main.res_cell_commuter_rail_map) AS commuter_rows,
        (SELECT count(*) FROM local.main.res_cell_bus_m60_map) AS m60_rows,
        (SELECT count(*) FROM local.main.res_cell_bus_m60_map WHERE route_id != 'M60-SBS') AS non_m60_rows,
        (${unaliasedStationQuery}) AS unaliased_station_name,
        (${unqualifiedComplexQuery}) AS unqualified_complex_name;
    `;

    const out = execFileSync('duckdb', ['-json', '-c', fullSql], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    expect(Number(parsed[0].max_gc_entry)).toBeLessThan(999999);
    expect(Number(parsed[0].bar_rows)).toBeGreaterThan(0);
    expect(parsed[0].top_bar_station).toBe('Grand Central-42 St');
    expect(Number(parsed[0].line_rows)).toBeGreaterThan(0);
    expect(Number(parsed[0].marey_rows)).toBeGreaterThan(0);
    expect(Number(parsed[0].horizon_rows)).toBeGreaterThan(0);
    expect(Number(parsed[0].commuter_rows)).toBe(2);
    expect(Number(parsed[0].m60_rows)).toBeGreaterThan(0);
    expect(Number(parsed[0].non_m60_rows)).toBe(0);
    expect(parsed[0].unaliased_station_name).toBe('Grand Central-42 St');
    expect(parsed[0].unqualified_complex_name).toBe('Grand Central-42 St');
  });

  it('pushes single-day CASE event_date and TIMESTAMPTZ zonemap filters directly into ossie_query WHERE without injecting redundant 7-day defaults', async () => {
    const { STARTER_CELLS } = await import('../src/state/local-state-schema.js');
    const { prepareExecutableCellSql } = await import('../src/data/duckdb-client.js');

    const headways = STARTER_CELLS.find(c => c.cellId === 'cell_headways')!;
    const expandedHeadways = expandOssieQueryCalls(headways.sqlText);
    expect(expandedHeadways).toContain("event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE");
    expect(expandedHeadways).toContain("EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 10");
    expect(expandedHeadways).toContain("route_id IN ('4', '5', '6')");
    expect(expandedHeadways).not.toContain('CASE EXTRACT(ISODOW');
    expect(expandedHeadways).not.toContain("INTERVAL '7 days'");

    const marey = STARTER_CELLS.find(c => c.cellId === 'cell_marey')!;
    const expandedMarey = expandOssieQueryCalls(marey.sqlText);
    expect(expandedMarey).toContain('event_date = (CASE EXTRACT(ISODOW');
    expect(expandedMarey).toContain("INTERVAL '6 hours 30 minutes') AT TIME ZONE 'America/New_York'");
    expect(expandedMarey).toContain("route_id IN ('7', '7X')");
    expect(expandedMarey).not.toContain("INTERVAL '7 days'");

    const trainMap = STARTER_CELLS.find(c => c.cellId === 'cell_train_position_map')!;
    const preparedLiveSql = prepareExecutableCellSql(expandOssieQueryCalls(trainMap.sqlText));
    expect(preparedLiveSql).toContain('prod.transit_v2.view_dim_service_lines');
    expect(preparedLiveSql).not.toContain('local.main.view_dim_service_lines');
  });

  it('compiles ergonomic chart-ready Lenses with zero-loss partition pruning and live GTFS-RT unions', () => {
    const turnstileRank = expandOssieQueryCalls(
      `SELECT * FROM ossie_query('dbtc', 'station_turnstile_ranking', '', 'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''latest_turnstiles''');`
    );
    expect(turnstileRank).toContain("t.event_date >= DATE '2026-10-29'");
    expect(turnstileRank).toContain("t.agency_id = 'MTA_NYCT_SUBWAY'");
    expect(turnstileRank).toContain('LIMIT 10');

    const hourlyProfile = expandOssieQueryCalls(
      `SELECT * FROM ossie_query('dbtc', 'hourly_turnstile_profile', '', 'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''latest_turnstiles''');`
    );
    expect(hourlyProfile).toContain('service_hour');
    expect(hourlyProfile).toContain('avg_hourly_entries');

    const fleetShare = expandOssieQueryCalls(
      `SELECT * FROM ossie_query('dbtc', 'fleet_route_share', '', 'agency_id = ''MTA_NYCT_SUBWAY'' AND window = ''yesterday''');`
    );
    expect(fleetShare).toContain("event_date = (CURRENT_DATE - INTERVAL '1 day')::DATE");
    expect(fleetShare).toContain("'Other Routes'");

    const liveSubway = expandOssieQueryCalls(
      `SELECT * FROM ossie_query('dbtc', 'live_subway_fleet', '', 'window = ''live_3h''');`
    );
    expect(liveSubway).toContain('FROM prod.transit_v2.fact_vehicle_positions');
    expect(liveSubway).toContain('FROM local.main.live_mta_subway_positions');
    expect(liveSubway).toContain('FROM local.main.live_mta_sir_positions');
  });

  it('formats Metric Builder configs into concise ossie_query(...) calls instead of expanded CTEs', async () => {
    const { formatOssieConfigAsQueryCall } = await import('../src/data/ossie-loader.js');
    const lensCall = formatOssieConfigAsQueryCall({
      theme: 'dbtc',
      factDataset: 'subway_station_headways',
      selectedMetrics: [],
      selectedDimensions: [],
      filters: [
        { field: 'window', operator: '=', value: 'yesterday_am_rush' },
        { field: 'subway_station_headways.route_id', operator: 'IN', value: ['4', '5', '6'] },
      ],
    });
    expect(lensCall).toContain("FROM ossie_query(");
    expect(lensCall).toContain("'subway_station_headways'");
    expect(lensCall).not.toContain('WITH pruned_fact AS');

    const expanded = expandOssieQueryCalls(lensCall);
    expect(expanded).toContain('FROM prod.transit_v2.fact_vehicle_positions');
    expect(expanded).toContain("route_id IN ('4', '5', '6')");
  });
});



