import { describe, it, expect } from 'vitest';
import { splitSqlStatements } from '../src/data/sql-utils.js';
import { coerceArrowValue } from '../src/data/arrow-normalizer.js';
import {
  compileOssieConfigToSql,
  expandOssieQueryCalls,
  formatOssieConfigAsQueryCall,
} from '../src/data/ossie-loader.js';
import { renderMarkdownWithSafeHtml, sanitizeMarkdownHtml } from '../src/ui/markdown-renderer.js';
import { findCellDependencies, store, cancelCellQuery } from '../src/state/store.js';
import { buildStandardBiOption } from '../src/viz/standard-bi.js';

describe('Open-Source Readiness Bug Fixes', () => {
  describe('sql-utils: splitSqlStatements', () => {
    it('ignores semicolons inside -- line comments and nested /* /* */ */ block comments', () => {
      const sql = `
        -- comment; with semicolon
        /* outer /* nested ; semicolon */ still comment; */
        SELECT 1;
        SELECT 2;
      `;
      const stmts = splitSqlStatements(sql);
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toContain('SELECT 1');
      expect(stmts[1]).toBe('SELECT 2');
    });

    it('preserves semicolons inside "" escaped double quotes and $tag$...$tag$ dollar quotes', () => {
      const sql = `SELECT "col""semi;name", $body$hello;world$body$ AS msg; SELECT 99;`;
      const stmts = splitSqlStatements(sql);
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toBe(`SELECT "col""semi;name", $body$hello;world$body$ AS msg`);
      expect(stmts[1]).toBe('SELECT 99');
    });
  });

  describe('arrow-normalizer: coerceArrowValue', () => {
    it('scales 16-byte Decimal128 Uint32Array using decimalScale', () => {
      // 12345 in little-endian Uint32Array (4 x 32-bit words) with scale=2 -> 123.45
      const dec = new Uint32Array([12345, 0, 0, 0]);
      expect(coerceArrowValue(dec, 'fare_amount', 2)).toBeCloseTo(123.45, 6);
    });

    it('recursively coerces BigInts inside nested toJSON containers', () => {
      const obj = {
        toJSON() {
          return { nested: [BigInt(42), { id: BigInt(7) }] };
        },
      };
      expect(coerceArrowValue(obj, 'payload')).toEqual({ nested: [42, { id: 7 }] });
    });
  });

  describe('ossie-loader: guards, quoting, and BETWEEN', () => {
    it('blocks SQL injection in filter field names and operators', () => {
      const sql = compileOssieConfigToSql({
        theme: 'dbtc',
        factDataset: 'fact_vehicle_positions',
        selectedMetrics: ['active_vehicle_count'],
        selectedDimensions: [],
        filters: [
          { field: 'route_id = 1 OR 1=1 --', operator: '=', value: 'A' },
        ],
      } as any);
      expect(sql).not.toContain('OR 1=1');
      expect(sql).not.toContain('--');
    });

    it('preserves commas inside quoted IN(...) values during ossie_query expansion', () => {
      const sql = expandOssieQueryCalls(
        `SELECT * FROM ossie_query('subway_station_headways', filters := ['route_id IN (''A,B'', ''C'')'])`
      );
      expect(sql).toContain("'A,B'");
      expect(sql).toContain("'C'");
    });

    it('formats BETWEEN filters in formatOssieConfigAsQueryCall', () => {
      const call = formatOssieConfigAsQueryCall({
        theme: 'dbtc',
        factDataset: 'subway_station_headways',
        selectedMetrics: [],
        selectedDimensions: [],
        filters: [
          { field: 'headway_sec', operator: 'BETWEEN', value: [120, 600] },
        ],
      } as any);
      expect(call).toContain('BETWEEN 120 AND 600');
    });
  });

  describe('markdown-renderer: XSS & entity safety', () => {
    it('does not throw on out-of-range numeric HTML entities and blocks CSS backslash escapes', () => {
      expect(() => renderMarkdownWithSafeHtml('Test &#99999999; entity')).not.toThrow();
      const sanitized = sanitizeMarkdownHtml('<span style="color: red; b\\ackground: url(javascript:alert(1))">hi</span>');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).not.toContain('url(');
    });

    it('handles &amp; in href attributes without double-escaping into &amp;amp;', () => {
      const html = renderMarkdownWithSafeHtml('[Link](https://example.com/?a=1&b=2)');
      expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
      expect(html).not.toContain('&amp;amp;');
    });
  });

  describe('store: findCellDependencies & cancelCellQuery', () => {
    it('ignores local.main.cell_X inside SQL comments and string literals', () => {
      const sql = `
        -- SELECT * FROM local.main.cell_1
        SELECT 'local.main.cell_2' AS literal_ref
        FROM local.main.cell_3
      `;
      const deps = findCellDependencies(sql);
      expect(deps).toEqual(['cell_3']);
    });

    it('marks a running cell as cancelled via cancelCellQuery', () => {
      const createdTemp = store.cells.length === 0;
      const targetCell =
        store.cells.find(c => c.kind === 'question') ??
        ({
          cellId: 'cell_test_cancel' as any,
          ordinal: 1,
          kind: 'question',
          title: 'Test Cancel',
          sqlText: 'SELECT 1',
          params: {},
          chartType: 'table',
          chartConfig: {},
          ducklakeSnapshotId: null,
          snapshotState: { status: 'unpinned' },
          executionState: { status: 'idle' },
          showSqlEditor: false,
          showOssiePillBar: false,
          viewIdentifier: 'local.main.cell_test_cancel' as any,
        } as any);
      if (createdTemp) {
        store.cells = [targetCell];
      }
      const prevState = targetCell.executionState;
      targetCell.executionState = { status: 'running', startTime: Date.now() };
      cancelCellQuery(null, targetCell.cellId);
      const nextState = targetCell.executionState as { status: string; error?: string };
      expect(nextState.status).toBe('error');
      expect(nextState.error).toContain('cancelled');
      if (createdTemp) {
        store.cells = [];
      } else {
        targetCell.executionState = prevState;
      }
    });
  });

  describe('standard-bi: log-scale clamping and scatter series grouping', () => {
    it('clamps non-positive bar values when scaleType is log', () => {
      const opt = buildStandardBiOption(
        'bar',
        [
          { route_id: 'A', ridership: 0 },
          { route_id: 'C', ridership: -5 },
          { route_id: 'E', ridership: 120 },
        ],
        { scaleType: 'log' }
      ) as any;

      expect(opt.yAxis.type).toBe('log');
      expect(opt.yAxis.min).toBe(1);
      const data = opt.series[0].data as Array<number | { value: number }>;
      const valAt = (idx: number) =>
        typeof data[idx] === 'object' && data[idx] !== null ? (data[idx] as { value: number }).value : data[idx];
      expect(valAt(0)).toBe(1);
      expect(valAt(1)).toBe(1);
      expect(valAt(2)).toBe(120);
    });

    it('groups scatter points into separate series when colorColumn is configured', () => {
      const opt = buildStandardBiOption(
        'scatter',
        [
          { x_val: 1, y_val: 10, route_id: 'A' },
          { x_val: 2, y_val: 20, route_id: 'G' },
        ],
        { xColumn: 'x_val', yColumns: ['y_val'], colorColumn: 'route_id' }
      ) as any;

      expect(opt.series).toHaveLength(2);
      expect(opt.series.map((s: any) => s.name)).toEqual(['A', 'G']);
    });
  });
});
