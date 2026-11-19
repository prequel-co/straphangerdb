import { describe, it, expect } from 'vitest';
import { injectPartitionFilter } from '../src/ui/cell-editor.js';
import { validateQueryGuardrails } from '../src/state/store.js';

describe('Partition Pushdown Guardrail & AST Injector', () => {
  const filterClause = "event_date >= CURRENT_DATE - INTERVAL '7 days'";

  it('flags unbounded queries touching partitioned relations without date filter', () => {
    const unbounded = 'SELECT * FROM prod.transit_v2.fact_schedules LIMIT 100;';
    const result = validateQueryGuardrails(unbounded);
    expect(result.ok).toBe(false);
    expect(result.warning).toContain('event_date or event_time filter');
  });

  it('flags queries that merely project or group by event_date without a filter', () => {
    const projOnly = 'SELECT event_date FROM prod.transit_v2.fact_schedules;';
    expect(validateQueryGuardrails(projOnly).ok).toBe(false);

    const groupByOnly = 'SELECT event_date, count(*) FROM prod.transit_v2.fact_schedules GROUP BY event_date;';
    expect(validateQueryGuardrails(groupByOnly).ok).toBe(false);

    const whereOtherCol = "SELECT event_date FROM prod.transit_v2.fact_schedules WHERE route_id = 'A';";
    expect(validateQueryGuardrails(whereOtherCol).ok).toBe(false);
  });

  it('allows queries that contain event_date or event_time filters in WHERE or ON predicates', () => {
    const withDate = "SELECT * FROM prod.transit_v2.fact_schedules WHERE event_date >= '2026-10-01';";
    expect(validateQueryGuardrails(withDate).ok).toBe(true);

    const withTime = "SELECT * FROM prod.transit_v2.view_vehicle_kinematics WHERE event_time > now() - INTERVAL 1 HOUR;";
    expect(validateQueryGuardrails(withTime).ok).toBe(true);

    const withJoin = "SELECT * FROM prod.transit_v2.fact_schedules JOIN prod.transit_v2.dim_routes ON fact_schedules.route_id = dim_routes.route_id AND fact_schedules.event_date = '2026-10-01';";
    expect(validateQueryGuardrails(withJoin).ok).toBe(true);
  });

  it('exempts pre-bounded live views from unbounded partition warnings', () => {
    const liveVehicle = 'SELECT * FROM prod.transit_v2.view_current_vehicle_positions;';
    expect(validateQueryGuardrails(liveVehicle).ok).toBe(true);

    const liveAlerts = 'SELECT * FROM prod.transit_v2.view_active_alerts;';
    expect(validateQueryGuardrails(liveAlerts).ok).toBe(true);
  });

  it('appends WHERE clause to plain SQL queries without WHERE', () => {
    const sql = 'SELECT * FROM prod.transit_v2.fact_schedules;';
    const injected = injectPartitionFilter(sql, filterClause);
    expect(injected).toBe("SELECT * FROM prod.transit_v2.fact_schedules WHERE event_date >= CURRENT_DATE - INTERVAL '7 days';");
  });

  it('merges with existing top-level WHERE clause using AND', () => {
    const sql = "SELECT * FROM prod.transit_v2.fact_schedules WHERE route_id = 'A';";
    const injected = injectPartitionFilter(sql, filterClause);
    expect(injected).toBe("SELECT * FROM prod.transit_v2.fact_schedules WHERE route_id = 'A' AND (event_date >= CURRENT_DATE - INTERVAL '7 days');");
  });

  it('inserts WHERE clause before GROUP BY, ORDER BY, and LIMIT', () => {
    const sql = 'SELECT route_id, count(*) FROM prod.transit_v2.fact_schedules GROUP BY route_id ORDER BY count(*) DESC LIMIT 10;';
    const injected = injectPartitionFilter(sql, filterClause);
    expect(injected).toBe(
      "SELECT route_id, count(*) FROM prod.transit_v2.fact_schedules WHERE event_date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY route_id ORDER BY count(*) DESC LIMIT 10;"
    );
  });

  it('ignores WHERE and ORDER BY inside subqueries and CTEs', () => {
    const sql = "SELECT * FROM (SELECT * FROM prod.transit_v2.dim_routes WHERE route_id = '6') AS sub;";
    const injected = injectPartitionFilter(sql, filterClause);
    expect(injected).toBe(
      "SELECT * FROM (SELECT * FROM prod.transit_v2.dim_routes WHERE route_id = '6') AS sub WHERE event_date >= CURRENT_DATE - INTERVAL '7 days';"
    );
  });

  it('ignores WHERE keywords inside string literals', () => {
    const sql = "SELECT 'WHERE is my train' AS question, count(*) FROM prod.transit_v2.fact_schedules GROUP BY 1;";
    const injected = injectPartitionFilter(sql, filterClause);
    expect(injected).toBe(
      "SELECT 'WHERE is my train' AS question, count(*) FROM prod.transit_v2.fact_schedules WHERE event_date >= CURRENT_DATE - INTERVAL '7 days' GROUP BY 1;"
    );
  });

  it('handles empty query gracefully', () => {
    const injected = injectPartitionFilter('', filterClause);
    expect(injected).toBe(`${filterClause};`);
  });
});
