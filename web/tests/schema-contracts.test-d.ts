import { describe, it, expectTypeOf } from 'vitest';
import type { CellId, CellViewIdentifier, DuckLakeSnapshotId, ResolvedSql } from '../src/types/brands.js';
import type { DeepReactiveSafe } from '../src/types/cell-state.js';
import type {
  CurrentSchemaVersion,
  TransitBaseTableName,
  TransitViewName,
  TypedOssieConfig,
  OssieThemeName,
} from '../src/types/straphanger-schema.gen.js';

describe('Schema Contracts and Nominal Brand Enforcement', () => {
  it('statically enforces nominal brand separation between CellId, CellViewIdentifier, and ResolvedSql', () => {
    expectTypeOf<CellId>().not.toEqualTypeOf<CellViewIdentifier>();
    expectTypeOf<CellViewIdentifier>().not.toEqualTypeOf<CellId>();
    expectTypeOf<ResolvedSql>().not.toEqualTypeOf<CellId>();
    expectTypeOf<DuckLakeSnapshotId>().not.toEqualTypeOf<CellId>();
  });

  it('verifies DeepReactiveSafe rejects functions, Maps, Sets, TypedArrays, and bigint', () => {
    expectTypeOf<DeepReactiveSafe<() => void>>().toEqualTypeOf<never>();
    expectTypeOf<DeepReactiveSafe<Map<string, number>>>().toEqualTypeOf<never>();
    expectTypeOf<DeepReactiveSafe<Set<string>>>().toEqualTypeOf<never>();
    expectTypeOf<DeepReactiveSafe<Uint8Array>>().toEqualTypeOf<never>();
    expectTypeOf<DeepReactiveSafe<bigint>>().toEqualTypeOf<never>();
  });

  it('validates schema version and relation union contracts', () => {
    expectTypeOf<CurrentSchemaVersion>().toEqualTypeOf<'transit_v2'>();
    expectTypeOf<TypedOssieConfig['theme']>().toEqualTypeOf<OssieThemeName>();
    expectTypeOf<TransitBaseTableName>().not.toEqualTypeOf<TransitViewName>();
  });

  it('enforces nominal brand CellId on executeCellQuery', () => {
    // @ts-expect-error unbranded string is not assignable to CellId
    const _invalidCall = (conn: any) => executeCellQuery(conn, 'raw_string_not_cell_id');
    expectTypeOf(_invalidCall).toBeFunction();
  });
});
