import { describe, it, expect, beforeEach } from 'vitest';
import {
  store,
  findCellDependencies,
  markDownstreamCellsStale,
  expandCellSql,
  checkPartitionGuardrail,
} from '../src/state/store.js';
import { asCellId, asCellViewIdentifier } from '../src/types/brands.js';

describe('Cell DAG and Reactive Dependency Tracking', () => {
  beforeEach(() => {
    store.cells = [];
  });

  it('detects upstream cell dependencies from SQL text', () => {
    const sql = `
      SELECT station_complex_id, SUM(hourly_entries) AS entries
      FROM cell_lexington_hourly
      JOIN local.main.cell_weather_obs USING (obs_date)
      GROUP BY 1
    `;
    const deps = findCellDependencies(sql);
    expect(deps).toContain(asCellId('cell_lexington_hourly'));
    expect(deps).toContain(asCellId('cell_weather_obs'));
    expect(deps).toHaveLength(2);
  });

  it('marks downstream cells stale when upstream cell changes', () => {
    const parentId = asCellId('cell_parent');
    const childId = asCellId('cell_child');
    const siblingId = asCellId('cell_sibling');

    store.cells = [
      {
        cellId: parentId,
        ordinal: 0,
        viewName: asCellViewIdentifier('local.main.cell_parent'),
        kind: 'question',
        title: 'Parent',
        subtitle: '',
        sourceNote: '',
        markdownText: '',
        sqlText: 'SELECT 1 AS val',
        params: {},
        ossieConfig: null,
        chartType: 'kpi-metric',
        chartConfig: {},
        ducklakeSnapshotId: null,
        executionState: { status: 'success', rowCount: 1, executionMs: 5, executedAt: Date.now() },
        snapshotState: { status: 'unpinned' },
        showSqlEditor: true,
        showOssiePillBar: false,
      },
      {
        cellId: childId,
        ordinal: 1,
        viewName: asCellViewIdentifier('local.main.cell_child'),
        kind: 'question',
        title: 'Child',
        subtitle: '',
        sourceNote: '',
        markdownText: '',
        sqlText: 'SELECT * FROM cell_parent WHERE val > 0',
        params: {},
        ossieConfig: null,
        chartType: 'kpi-metric',
        chartConfig: {},
        ducklakeSnapshotId: null,
        executionState: { status: 'success', rowCount: 1, executionMs: 4, executedAt: Date.now() },
        snapshotState: { status: 'unpinned' },
        showSqlEditor: true,
        showOssiePillBar: false,
      },
      {
        cellId: siblingId,
        ordinal: 2,
        viewName: asCellViewIdentifier('local.main.cell_sibling'),
        kind: 'question',
        title: 'Sibling',
        subtitle: '',
        sourceNote: '',
        markdownText: '',
        sqlText: 'SELECT 42 AS answer',
        params: {},
        ossieConfig: null,
        chartType: 'kpi-metric',
        chartConfig: {},
        ducklakeSnapshotId: null,
        executionState: { status: 'success', rowCount: 1, executionMs: 3, executedAt: Date.now() },
        snapshotState: { status: 'unpinned' },
        showSqlEditor: true,
        showOssiePillBar: false,
      },
    ];

    markDownstreamCellsStale(parentId);

    const child = store.cells.find(c => c.cellId === childId)!;
    expect(child.executionState.status).toBe('stale-upstream');
    if (child.executionState.status === 'stale-upstream') {
      expect(child.executionState.upstreamCellId).toBe(parentId);
    }

    const sibling = store.cells.find(c => c.cellId === siblingId)!;
    expect(sibling.executionState.status).toBe('success');
  });

  it('interpolates SQL parameters correctly', () => {
    const template = 'SELECT * FROM fact_train_positions WHERE route_id = {{route}} AND speed > {{min_speed}};';
    const params = { route: "'6'", min_speed: '25' };
    const expanded = expandCellSql(template, params);
    expect(expanded).toBe("SELECT * FROM fact_train_positions WHERE route_id = '6' AND speed > 25;");
  });

  it('flags unpartitioned queries with a guardrail warning', () => {
    const unpartitionedQuery = 'SELECT COUNT(*) FROM straphanger.fact_vehicle_positions;';
    const check1 = checkPartitionGuardrail(unpartitionedQuery);
    expect(check1.ok).toBe(false);
    expect(check1.warning).toBeDefined();

    const partitionedQuery = "SELECT COUNT(*) FROM straphanger.fact_vehicle_positions WHERE event_date = '2026-10-28';";
    const check2 = checkPartitionGuardrail(partitionedQuery);
    expect(check2.ok).toBe(true);
  });
});
