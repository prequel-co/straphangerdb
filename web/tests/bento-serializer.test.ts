import { describe, it, expect } from 'vitest';
import {
  compressGzip,
  decompressGzip,
  uint8ArrayToBase64,
  base64ToUint8Array,
  escapeScriptJson,
  scheduleDraftAutosave,
  cancelDraftAutosave,
  type BentoDocPayload,
} from '../src/state/bento-serializer.js';

describe('Bento Serializer and Compression', () => {
  it('escapes less-than signs in JSON strings to prevent script tag injection', () => {
    const raw = '{"text": "<script>alert(1)</script>", "sql": "SELECT * WHERE val < 100"}';
    const escaped = escapeScriptJson(raw);
    expect(escaped).not.toContain('<script');
    expect(escaped).not.toContain('< 100');
    expect(escaped).toContain('\\u003cscript');
    expect(escaped).toContain('\\u003c 100');

    // Parsing after JSON.parse restores the exact original string
    const parsed = JSON.parse(escaped);
    expect(parsed.text).toBe('<script>alert(1)</script>');
    expect(parsed.sql).toBe('SELECT * WHERE val < 100');
  });

  it('roundtrips binary buffers through Base64 conversion', () => {
    const sample = new Uint8Array([0, 1, 2, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
    const encoded = uint8ArrayToBase64(sample);
    const decoded = base64ToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(sample));
  });

  it('roundtrips data through Gzip compression and decompression', async () => {
    const text = 'Subway ridership and headway analysis for the Lexington Avenue trunk line.';
    const encoder = new TextEncoder();
    const original = encoder.encode(text);

    const compressed = await compressGzip(original);
    const decompressed = await decompressGzip(compressed);

    const decoder = new TextDecoder();
    expect(decoder.decode(decompressed)).toBe(text);
  });

  it('validates Bento document payload structure', () => {
    const payload: BentoDocPayload = {
      format: 'bento/dbtc',
      version: 1,
      embeddedDuckDbBase64: 'GZIPPED_DATA_SAMPLE',
      exportedAt: new Date().toISOString(),
      mode: 'offline',
    };

    expect(payload.format).toBe('bento/dbtc');
    expect(payload.version).toBe(1);
    expect(payload.mode).toBe('offline');
    expect(typeof payload.exportedAt).toBe('string');
  });

  it('debounces and cancels draft autosaves cleanly', () => {
    // Calling schedule and cancel should not throw even if IndexedDB is not in node
    expect(() => {
      scheduleDraftAutosave(null, null, 100);
      cancelDraftAutosave();
    }).not.toThrow();
  });

  it('safely ignores corrupt 1-byte buffers without attempting DuckDB ATTACH', async () => {
    const { importBentoDocument } = await import('../src/state/bento-serializer.js');
    const oneByteCompressed = await compressGzip(new Uint8Array([0]));
    const payload: BentoDocPayload = {
      format: 'bento/dbtc',
      version: 1,
      embeddedDuckDbBase64: uint8ArrayToBase64(oneByteCompressed),
      exportedAt: new Date().toISOString(),
      mode: 'standard',
    };

    let registerCalled = false;
    const mockDb = {
      registerFileBuffer: async () => {
        registerCalled = true;
      },
      dropFile: async () => {},
    } as never;

    const mockConn = {
      query: async () => ({
        numRows: 0,
        schema: { fields: [] },
        getChildAt: () => null,
      }),
    } as never;

    await importBentoDocument(mockDb, mockConn, JSON.stringify(payload));
    expect(registerCalled).toBe(false);
  });

  it('skips seeded topology tables (dim_routes, dim_service_lines, dim_stations) in restoreDatabaseFromBuffer and never runs DROP VIEW on a BASE TABLE', async () => {
    const { restoreDatabaseFromBuffer } = await import('../src/state/bento-serializer.js');

    const snapshot = {
      format: 'dbtc/local-snapshot-v1',
      tables: [
        {
          tableName: '_dbtc_notebook',
          columns: [{ name: 'doc_id', dataType: 'VARCHAR' }, { name: 'mode', dataType: 'VARCHAR' }],
          rows: [{ doc_id: 'dbtc_starter_nyc', mode: 'standard' }],
        },
        {
          tableName: '_dbtc_sources',
          columns: [{ name: 'source_name', dataType: 'VARCHAR' }],
          rows: [{ source_name: 'custom_upload' }],
        },
        {
          tableName: '_dbtc_cells',
          columns: [{ name: 'cell_id', dataType: 'VARCHAR' }, { name: 'kind', dataType: 'VARCHAR' }],
          rows: [{ cell_id: 'cell_multimodal_pulse_midtown', kind: 'question' }],
        },
        {
          tableName: 'dim_routes',
          columns: [{ name: 'route_id', dataType: 'VARCHAR' }],
          rows: [{ route_id: '1' }],
        },
        {
          tableName: 'dim_service_lines',
          columns: [{ name: 'route_id', dataType: 'VARCHAR' }],
          rows: [{ route_id: '1' }],
        },
        {
          tableName: 'dim_stations',
          columns: [{ name: 'station_id', dataType: 'VARCHAR' }],
          rows: [{ station_id: '101' }],
        },
        {
          tableName: 'cell_multimodal_pulse_midtown',
          columns: [{ name: 'hour_of_day', dataType: 'INTEGER' }],
          rows: [{ hour_of_day: 11 }],
        },
        {
          tableName: 'custom_upload',
          columns: [{ name: 'id', dataType: 'VARCHAR' }],
          rows: [{ id: 'row_1' }],
        },
      ],
    };

    const executedQueries: string[] = [];
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
        executedQueries.push(sql);
        if (sql.includes('DROP VIEW') && (sql.includes('dim_') || sql.includes('custom_upload') || sql.includes('cell_multimodal_pulse_midtown'))) {
          throw new Error('Catalog Error: Existing object is of type Table, trying to drop type View');
        }
        if (sql.includes('FROM information_schema.tables')) {
          return makeArrowMock([
            { table_name: 'dim_routes', table_type: 'BASE TABLE' },
            { table_name: 'dim_service_lines', table_type: 'BASE TABLE' },
            { table_name: 'dim_stations', table_type: 'BASE TABLE' },
            { table_name: 'cell_multimodal_pulse_midtown', table_type: 'BASE TABLE' },
            { table_name: 'custom_upload', table_type: 'BASE TABLE' },
          ]);
        }
        return makeArrowMock([]);
      },
    } as never;

    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const ok = await restoreDatabaseFromBuffer({} as never, mockConn, bytes);
    expect(ok).toBe(true);

    // Must not attempt to restore or drop dim_routes, dim_service_lines, or dim_stations
    expect(executedQueries.some(q => q.includes('"dim_routes"'))).toBe(false);
    expect(executedQueries.some(q => q.includes('"dim_service_lines"'))).toBe(false);
    expect(executedQueries.some(q => q.includes('"dim_stations"'))).toBe(false);

    // Must drop stale question cell BASE TABLE in standard mode and not recreate it as a static table
    expect(executedQueries.some(q => q.includes('DROP TABLE IF EXISTS local.main."cell_multimodal_pulse_midtown"'))).toBe(true);
    expect(executedQueries.some(q => q.includes('CREATE TABLE local.main."cell_multimodal_pulse_midtown"'))).toBe(false);

    // Must restore custom_upload using DROP TABLE IF EXISTS (never DROP VIEW IF EXISTS)
    expect(executedQueries.some(q => q.includes('DROP TABLE IF EXISTS local.main."custom_upload"'))).toBe(true);
    expect(executedQueries.some(q => q.includes('CREATE TABLE local.main."custom_upload"'))).toBe(true);
  });

  it('prevents @arrow-js/core TypeError: s[o] is not a function when watchReactive is stopped synchronously after a reactive mutation', async () => {
    const { store, watchReactive, seedStarterCellsInStore } = await import('../src/state/store.js');
    seedStarterCellsInStore('idle');
    const cell = store.cells.find(c => c.cellId === 'cell_headways')!;
    expect(cell).toBeDefined();

    // 1. Create a watcher reading cell.executionState.status (just like renderEditorialCard / renderBottomBar)
    const [, stopWatcher] = watchReactive(
      () => [cell.executionState.status, cell.chartType],
      () => {}
    );

    // 2. Mutate cell.executionState synchronously (queues runEffect in @arrow-js/core queueStack)
    cell.executionState = { status: 'running', startTime: Date.now() };

    // 3. Immediately stop the watcher BEFORE the microtask queue drains (just like renderBody() in main.ts)
    stopWatcher();

    // 4. Wait for microtasks to flush
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    // 5. Mutating cell.executionState afterwards must NEVER throw TypeError: s[o] is not a function
    expect(() => {
      cell.executionState = {
        status: 'success',
        executionMs: 42,
        rowCount: 100,
        executedAt: Date.now(),
        executedMode: 'standard',
      };
    }).not.toThrow();
  });

  it('normalizes Arrow type strings (Utf8, Date32<DAY>, Timestamp<...>, Int64) into valid DuckDB SQL types during offline restore and prehydration', async () => {
    const {
      normalizeDuckDbSqlType,
      restoreDatabaseFromBuffer,
      prehydrateFromEmbeddedBentoJson,
      compressGzip,
      uint8ArrayToBase64,
    } = await import('../src/state/bento-serializer.js');
    const { store, CellRuntimeRegistry } = await import('../src/state/store.js');
    const { asCellId } = await import('../src/types/brands.js');

    expect(normalizeDuckDbSqlType('Utf8')).toBe('VARCHAR');
    expect(normalizeDuckDbSqlType('Date32<DAY>')).toBe('DATE');
    expect(normalizeDuckDbSqlType('Timestamp<MICROSECOND, America/New_York>')).toBe('TIMESTAMPTZ');
    expect(normalizeDuckDbSqlType('Int64')).toBe('BIGINT');
    expect(normalizeDuckDbSqlType('Float64')).toBe('DOUBLE');

    const offlineSnapshot = {
      format: 'dbtc/local-snapshot-v1',
      tables: [
        {
          tableName: '_dbtc_notebook',
          columns: [
            { name: 'doc_id', dataType: 'VARCHAR' },
            { name: 'title', dataType: 'VARCHAR' },
            { name: 'mode', dataType: 'VARCHAR' },
          ],
          rows: [{ doc_id: 'dbtc_saved_test', title: 'Saved Transit Notebook', mode: 'offline' }],
        },
        {
          tableName: '_dbtc_cells',
          columns: [
            { name: 'cell_id', dataType: 'VARCHAR' },
            { name: 'ordinal', dataType: 'INTEGER' },
            { name: 'kind', dataType: 'VARCHAR' },
            { name: 'title', dataType: 'VARCHAR' },
            { name: 'chart_type', dataType: 'VARCHAR' },
          ],
          rows: [
            {
              cell_id: 'cell_basic_bar_turnstiles',
              ordinal: 1,
              kind: 'question',
              title: 'Saved Turnstiles',
              chart_type: 'bar',
            },
          ],
        },
        {
          tableName: 'cell_basic_bar_turnstiles',
          columns: [
            { name: 'station_name', dataType: 'Utf8' },
            { name: 'event_date', dataType: 'Date32<DAY>' },
            { name: 'event_time', dataType: 'Timestamp<MICROSECOND, America/New_York>' },
            { name: 'total_entries', dataType: 'Int64' },
          ],
          rows: [
            {
              station_name: 'Times Sq-42 St',
              event_date: '2026-11-08',
              event_time: '2026-11-08T08:00:00.000Z',
              total_entries: 145000,
            },
          ],
        },
      ],
    };

    const rawBytes = new TextEncoder().encode(JSON.stringify(offlineSnapshot));
    const compressed = await compressGzip(rawBytes);
    const bentoPayload: BentoDocPayload = {
      format: 'bento/dbtc',
      version: 1,
      embeddedDuckDbBase64: uint8ArrayToBase64(compressed),
      exportedAt: new Date().toISOString(),
      mode: 'offline',
    };

    CellRuntimeRegistry.clear();
    const prehydratedOk = await prehydrateFromEmbeddedBentoJson(JSON.stringify(bentoPayload));
    expect(prehydratedOk).toBe(true);
    expect(store.notebook.mode).toBe('offline');
    expect(store.notebook.title).toBe('Saved Transit Notebook');
    const prehydratedCell = store.cells.find(c => c.cellId === 'cell_basic_bar_turnstiles');
    expect(prehydratedCell?.executionState.status).toBe('success');
    expect(CellRuntimeRegistry.get(asCellId('cell_basic_bar_turnstiles'))?.normalized?.rows.length).toBe(1);

    const executedSql: string[] = [];
    const mockConn = {
      query: async (sql: string) => {
        executedSql.push(sql);
        return { numRows: 0, schema: { fields: [] }, getChildAt: () => null };
      },
    } as never;

    const restoredOk = await restoreDatabaseFromBuffer({} as never, mockConn, rawBytes);
    expect(restoredOk).toBe(true);

    const createTableQuery = executedSql.find(q =>
      q.includes('CREATE TABLE local.main."cell_basic_bar_turnstiles"')
    );
    expect(createTableQuery).toBeDefined();
    expect(createTableQuery).toContain('"station_name" VARCHAR');
    expect(createTableQuery).toContain('"event_date" DATE');
    expect(createTableQuery).toContain('"event_time" TIMESTAMPTZ');
    expect(createTableQuery).toContain('"total_entries" BIGINT');
    expect(createTableQuery).not.toContain('Utf8');
    expect(createTableQuery).not.toContain('Date32');

    const insertQuery = executedSql.find(q =>
      q.includes('INSERT INTO local.main."cell_basic_bar_turnstiles"')
    );
    expect(insertQuery).toBeDefined();
    expect(insertQuery).toContain("CAST('2026-11-08' AS DATE)");
    expect(insertQuery).toContain("CAST('2026-11-08T08:00:00.000Z' AS TIMESTAMPTZ)");
  });
});


