import { describe, it, expect, vi } from 'vitest';
import { splitSqlStatements, executeSqlScript } from '../src/data/sql-utils.js';
import { LOCAL_STATE_DDL } from '../src/state/local-state-schema.js';

describe('SQL Utils - Multi-statement Script Execution', () => {
  it('splits multiple SQL statements separated by semicolons', () => {
    const sql = 'CREATE TABLE a(x INT); CREATE TABLE b(y VARCHAR);';
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe('CREATE TABLE a(x INT)');
    expect(stmts[1]).toBe('CREATE TABLE b(y VARCHAR)');
  });

  it('preserves semicolons within string literals and JSON payloads', () => {
    const sql = "INSERT INTO t VALUES ('semi;colon', '{\"key\": \"val;ue\"}'); SELECT 1;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe("INSERT INTO t VALUES ('semi;colon', '{\"key\": \"val;ue\"}')");
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('preserves escaped single quotes within strings', () => {
    const sql = "SELECT 'it''s a station; stop' AS desc; SELECT 2;";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toBe("SELECT 'it''s a station; stop' AS desc");
    expect(stmts[1]).toBe('SELECT 2');
  });

  it('correctly splits LOCAL_STATE_DDL into 3 table definitions', () => {
    const stmts = splitSqlStatements(LOCAL_STATE_DDL);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toContain('_dbtc_notebook');
    expect(stmts[1]).toContain('_dbtc_cells');
    expect(stmts[2]).toContain('_dbtc_sources');
  });

  it('executes each statement sequentially via executeSqlScript', async () => {
    const executed: string[] = [];
    const mockConn = {
      query: vi.fn(async (stmt: string) => {
        executed.push(stmt);
        return {} as any;
      }),
    };

    await executeSqlScript(mockConn as any, 'CREATE TABLE t1(x INT); CREATE TABLE t2(y INT);');
    expect(mockConn.query).toHaveBeenCalledTimes(2);
    expect(executed).toEqual(['CREATE TABLE t1(x INT)', 'CREATE TABLE t2(y INT)']);
  });
});
