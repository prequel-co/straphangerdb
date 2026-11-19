import type { Table } from 'apache-arrow';

export interface NormalizedColumnMeta {
  readonly name: string;
  readonly type: string;
}

export interface NormalizedQueryResult {
  readonly columns: readonly NormalizedColumnMeta[];
  readonly rows: readonly Record<string, unknown>[];
  readonly totalRowCount: number;
}

function coerceNestedContainer(val: unknown, columnName?: string): unknown {
  if (Array.isArray(val)) {
    return val.map(item => coerceArrowValue(item, columnName));
  }
  if (val instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of val.entries()) {
      obj[String(k)] = coerceArrowValue(v, columnName);
    }
    return obj;
  }
  if (val && typeof val === 'object' && !(val instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = coerceArrowValue(v, columnName);
    }
    return out;
  }
  return val;
}

export function coerceArrowValue(val: unknown, columnName?: string, decimalScale?: number): unknown {
  if (val === null || val === undefined) {
    return null;
  }

  // Handle BigInt values
  if (typeof val === 'bigint') {
    if (columnName && (columnName.toLowerCase().includes('snapshot_id') || columnName.toLowerCase().includes('device_id'))) {
      return val.toString();
    }
    // Safe conversion to number if within safe bounds
    if (val >= BigInt(Number.MIN_SAFE_INTEGER) && val <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(val);
    }
    return val.toString();
  }

  // Handle Date objects or objects with getTime
  if (val instanceof Date) {
    return val.getTime();
  }

  // Arrow Timestamp / Date numbers
  if (typeof val === 'number') {
    return val;
  }

  if (typeof val === 'boolean' || typeof val === 'string') {
    return val;
  }

  // Handle 128-bit integers (HugeInt / Decimal128) in Arrow TypedArrays
  if (ArrayBuffer.isView(val) && val.byteLength === 16) {
    const view = new DataView(val.buffer, val.byteOffset, 16);
    const low = view.getBigUint64(0, true);
    const high = view.getBigInt64(8, true);
    const bi = (high << 64n) | low;
    if (typeof decimalScale === 'number' && decimalScale > 0) {
      return Number(bi) / Math.pow(10, decimalScale);
    }
    if (bi >= BigInt(Number.MIN_SAFE_INTEGER) && bi <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(bi);
    }
    return bi.toString();
  }

  // JSON or object payloads
  if (typeof val === 'object') {
    // Check if it's an Arrow decimal or structure
    if ('toJSON' in (val as Record<string, unknown>) && typeof (val as { toJSON: () => unknown }).toJSON === 'function') {
      return coerceNestedContainer((val as { toJSON: () => unknown }).toJSON(), columnName);
    }
    return coerceNestedContainer(val, columnName);
  }

  return val;
}

export function normalizeArrowTable(table: Table): NormalizedQueryResult {
  const fields = table.schema.fields;
  const columns: NormalizedColumnMeta[] = fields.map(f => ({
    name: f.name,
    type: f.type.toString(),
  }));

  const rows: Record<string, unknown>[] = [];
  const numRows = table.numRows;

  for (let i = 0; i < numRows; i++) {
    const rowObj: Record<string, unknown> = {};
    for (let c = 0; c < fields.length; c++) {
      const field = fields[c];
      if (!field) continue;
      const colVector = table.getChildAt(c);
      const rawVal = colVector ? colVector.get(i) : null;
      const decimalScale =
        typeof (field.type as { scale?: number })?.scale === 'number'
          ? (field.type as { scale?: number }).scale
          : undefined;
      rowObj[field.name] = coerceArrowValue(rawVal, field.name, decimalScale);
    }
    rows.push(rowObj);
  }

  return {
    columns,
    rows,
    totalRowCount: numRows,
  };
}
