// Branded nominal primitive types for DBTC

declare const BrandSymbol: unique symbol;

export type Brand<T, B> = T & { readonly [BrandSymbol]: B };

export type CellId = Brand<string, 'CellId'>;

export type CellViewIdentifier = Brand<`local.main.cell_${string}`, 'CellViewIdentifier'>;

export type DuckLakeSnapshotId = Brand<string, 'DuckLakeSnapshotId'>;

export type ResolvedSql = Brand<string, 'ResolvedSql'>;

export type IsoDateString = Brand<string, 'IsoDateString'>;

export function asCellId(id: string): CellId {
  return id as CellId;
}

export function asCellViewIdentifier(view: string): CellViewIdentifier {
  if (!view.startsWith('local.main.cell_')) {
    throw new Error(`Invalid CellViewIdentifier: ${view}`);
  }
  return view as CellViewIdentifier;
}

export function asDuckLakeSnapshotId(id: string | number | bigint): DuckLakeSnapshotId {
  return String(id) as DuckLakeSnapshotId;
}

export function asResolvedSql(sql: string): ResolvedSql {
  return sql as ResolvedSql;
}

export function asIsoDateString(date: string): IsoDateString {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid IsoDateString: ${date}`);
  }
  return date as IsoDateString;
}
