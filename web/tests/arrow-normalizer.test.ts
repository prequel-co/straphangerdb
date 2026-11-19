import { describe, it, expect } from 'vitest';
import { tableFromArrays } from 'apache-arrow';
import {
  coerceArrowValue,
  normalizeArrowTable,
} from '../src/data/arrow-normalizer.js';

describe('Arrow Normalizer and Value Coercion', () => {
  it('coerces null and undefined into null', () => {
    expect(coerceArrowValue(null)).toBeNull();
    expect(coerceArrowValue(undefined)).toBeNull();
  });

  it('coerces safe BigInts to numbers, and identifiers to strings', () => {
    const safeBig = BigInt(42);
    expect(coerceArrowValue(safeBig, 'passenger_count')).toBe(42);

    const snapshotIdBig = BigInt(987654321012345);
    expect(coerceArrowValue(snapshotIdBig, 'ducklake_snapshot_id')).toBe('987654321012345');

    const hugeBig = BigInt('90071992547409999999');
    expect(coerceArrowValue(hugeBig, 'huge_val')).toBe('90071992547409999999');
  });

  it('converts Date objects to epoch millisecond timestamps', () => {
    const d = new Date('2026-10-28T12:00:00Z');
    expect(coerceArrowValue(d)).toBe(d.getTime());
  });

  it('extracts toJSON from custom decimal-like objects', () => {
    const mockDecimal = {
      value: 12.34,
      toJSON: () => 12.34,
    };
    expect(coerceArrowValue(mockDecimal)).toBe(12.34);
  });

  it('normalizes an Apache Arrow table into pure JavaScript records', () => {
    const arrowTable = tableFromArrays({
      route_id: ['1', '6', '7'],
      headway_sec: [180, 240, 150],
      is_active: [true, true, false],
    });

    const normalized = normalizeArrowTable(arrowTable);

    expect(normalized.totalRowCount).toBe(3);
    expect(normalized.columns).toHaveLength(3);
    expect(normalized.columns.map(c => c.name)).toEqual(['route_id', 'headway_sec', 'is_active']);

    expect(normalized.rows).toHaveLength(3);
    expect(normalized.rows[0]).toEqual({
      route_id: '1',
      headway_sec: 180,
      is_active: true,
    });
    expect(normalized.rows[1]).toEqual({
      route_id: '6',
      headway_sec: 240,
      is_active: true,
    });
    expect(normalized.rows[2]).toEqual({
      route_id: '7',
      headway_sec: 150,
      is_active: false,
    });
  });
});
