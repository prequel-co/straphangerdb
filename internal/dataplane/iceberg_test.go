package dataplane

import (
	"context"
	"strings"
	"testing"

	"github.com/prequel-co/straphangerdb/internal/control"
)

func TestStageEventsOnConnTransactional(t *testing.T) {
	ctx := context.Background()
	engine, err := NewDuckEngine(nil, nil)
	if err != nil {
		t.Fatalf("failed to create DuckEngine: %v", err)
	}
	defer engine.Close()

	conn, err := engine.Connx(ctx)
	if err != nil {
		t.Fatalf("failed to acquire pinned connection: %v", err)
	}
	defer conn.Close()

	events := []control.StreamEvent{
		{ID: 1, Topic: "mta_subway_ace", Payload: []byte(`{"id":"1"}`)},
		{ID: 2, Topic: "mta_subway_ace", Payload: []byte(`{"id":"2"}`)},
		{ID: 3, Topic: "mta_subway_ace", Payload: []byte(`{"id":"3"}`)},
	}

	if err := engine.StageEventsOnConn(ctx, conn, "tmp_tx_test", events); err != nil {
		t.Fatalf("StageEventsOnConn failed: %v", err)
	}

	var count int
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*) FROM tmp_tx_test;").Scan(&count); err != nil {
		t.Fatalf("failed querying staged row count: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 staged rows, got %d", count)
	}
}

func TestBuildIcebergUpsertSQL(t *testing.T) {
	tables := []string{
		"fact_vehicle_positions",
		"fact_alerts",
		"fact_micromobility_status",
		"dim_stations",
		"dim_routes",
		"dim_micromobility_stations",
		"fact_schedules",
		"fact_turnstile_counts",
		"fact_ridership",
	}

	for _, tbl := range tables {
		sql := buildIcebergUpsertSQL("transit_v2", tbl, "'/tmp/test.parquet'", "2026-09-02 22:45:00")
		if !strings.Contains(sql, "MERGE INTO straphanger.transit_v2."+tbl) {
			t.Errorf("expected MERGE INTO straphanger.transit_v2.%s, got:\n%s", tbl, sql)
		}
		if !strings.Contains(sql, "WHEN NOT MATCHED THEN INSERT") {
			t.Errorf("expected WHEN NOT MATCHED THEN INSERT for %s, got:\n%s", tbl, sql)
		}
	}

	// Verify timestamp filter pushdown on fact_vehicle_positions
	vpSQL := buildIcebergUpsertSQL("transit_v2", "fact_vehicle_positions", "'/tmp/test.parquet'", "2026-09-02 22:45:00")
	if !strings.Contains(vpSQL, "AND target.event_time >= '2026-09-02 22:45:00'::TIMESTAMP") {
		t.Errorf("expected event_time filter pushdown for fact_vehicle_positions, got:\n%s", vpSQL)
	}

	// Verify without timestamp filter
	vpSQLNoTime := buildIcebergUpsertSQL("transit_v2", "fact_vehicle_positions", "'/tmp/test.parquet'", "")
	if strings.Contains(vpSQLNoTime, "::TIMESTAMP") {
		t.Errorf("expected no event_time filter when minTimeVal is empty, got:\n%s", vpSQLNoTime)
	}
	if !strings.Contains(vpSQLNoTime, "target.event_date >= CURRENT_DATE - INTERVAL 1 DAY") {
		t.Errorf("expected fallback partition pruning when dateBounds omitted, got:\n%s", vpSQLNoTime)
	}

	// Verify with dynamic date bounds pruning
	vpSQLDateBounds := buildIcebergUpsertSQL("transit_v2", "fact_vehicle_positions", "'/tmp/test.parquet'", "2026-09-02 22:45:00", "2026-09-01", "2026-09-02")
	if !strings.Contains(vpSQLDateBounds, "target.event_date >= '2026-09-01'::DATE AND target.event_date <= '2026-09-02'::DATE") {
		t.Errorf("expected dynamic partition bounds pruning [minDate, maxDate], got:\n%s", vpSQLDateBounds)
	}

	// Verify 7-day lookback partition filter pushdown for fact_alerts
	alertsSQLDateBounds := buildIcebergUpsertSQL("transit_v2", "fact_alerts", "'/tmp/test.parquet'", "", "2026-10-14", "2026-10-14")
	if !strings.Contains(alertsSQLDateBounds, "target.event_date >= ('2026-10-14'::DATE - INTERVAL 7 DAY) AND target.event_date <= '2026-10-14'::DATE") {
		t.Errorf("expected 7-day lookback partition pruning for fact_alerts, got:\n%s", alertsSQLDateBounds)
	}

	// Verify DuckLake catalog parameterization and SCD Type II / alert lifecycle SQL
	ducklakeStationsSQL := buildCatalogUpsertSQL("ducklake", "transit_v2", "dim_stations", "tmp_transformed", "")
	if !strings.Contains(ducklakeStationsSQL, "UPDATE ducklake.transit_v2.dim_stations AS target") || !strings.Contains(ducklakeStationsSQL, "MERGE INTO ducklake.transit_v2.dim_stations AS target") {
		t.Errorf("expected DuckLake SCD Type II UPDATE and MERGE for dim_stations, got:\n%s", ducklakeStationsSQL)
	}

	ducklakeAlertsSQL := buildCatalogUpsertSQL("ducklake", "transit_v2", "fact_alerts", "tmp_alerts", "")
	if !strings.Contains(ducklakeAlertsSQL, "SET removed_at = CURRENT_TIMESTAMP") || !strings.Contains(ducklakeAlertsSQL, "MERGE INTO ducklake.transit_v2.fact_alerts AS target") {
		t.Errorf("expected DuckLake alert lifecycle UPDATE and MERGE for fact_alerts, got:\n%s", ducklakeAlertsSQL)
	}
}

func TestSCDType2AndAlertsUpsertExecution(t *testing.T) {
	ctx := context.Background()
	engine, err := NewDuckEngine(nil, nil)
	if err != nil {
		t.Fatalf("failed to create DuckEngine: %v", err)
	}
	defer engine.Close()

	conn, err := engine.Connx(ctx)
	if err != nil {
		t.Fatalf("failed to acquire pinned connection: %v", err)
	}
	defer conn.Close()

	// NewDuckEngine already initializes memory.transit_v2.dim_stations and memory.transit_v2.fact_alerts
	if _, err := conn.ExecContext(ctx, "DELETE FROM memory.transit_v2.dim_stations; DELETE FROM memory.transit_v2.fact_alerts;"); err != nil {
		t.Fatalf("failed clearing test tables: %v", err)
	}

	// 1. Test dim_stations SCD Type II with intra-batch duplicates and repeated polls
	sortStations := getParquetSortClause("dim_stations")
	batch1SQL := `
		CREATE OR REPLACE TEMP TABLE raw_stations_batch AS
		SELECT '101' AS station_id, 'MTA_SUBWAY' AS agency_id, 'Van Cortlandt Park' AS name,
		       40.8892 AS latitude, -73.8985 AS longitude,
		       '101' AS gtfs_stop_id, '101' AS complex_id, '1' AS daytime_routes, 'Elevated' AS structure, false AS is_accessible,
		       '2026-10-13 12:00:00'::TIMESTAMP AS valid_from, NULL::TIMESTAMP AS valid_to, true AS is_current, '{}' AS raw_payload
		UNION ALL
		SELECT '101', 'MTA_SUBWAY', 'Van Cortlandt Park',
		       40.8892, -73.8985,
		       '101', '101', '1', 'Elevated', false,
		       '2026-10-13 12:01:00'::TIMESTAMP, NULL::TIMESTAMP, true, '{}';
		CREATE OR REPLACE TEMP TABLE dedup_stations_batch AS SELECT * FROM raw_stations_batch ` + sortStations + `;`
	if _, err := conn.ExecContext(ctx, batch1SQL); err != nil {
		t.Fatalf("failed creating dedup_stations_batch: %v", err)
	}

	upsertStationsSQL := buildCatalogUpsertSQL("memory", "transit_v2", "dim_stations", "dedup_stations_batch", "")
	if _, err := conn.ExecContext(ctx, upsertStationsSQL); err != nil {
		t.Fatalf("first dim_stations upsert failed: %v", err)
	}

	// Poll 2: Unchanged attributes, later valid_from timestamp -> should NOT insert a duplicate row
	batch2SQL := `
		CREATE OR REPLACE TEMP TABLE dedup_stations_batch AS
		SELECT '101' AS station_id, 'MTA_SUBWAY' AS agency_id, 'Van Cortlandt Park' AS name,
		       40.8892 AS latitude, -73.8985 AS longitude,
		       '101' AS gtfs_stop_id, '101' AS complex_id, '1' AS daytime_routes, 'Elevated' AS structure, false AS is_accessible,
		       '2026-10-13 13:00:00'::TIMESTAMP AS valid_from, NULL::TIMESTAMP AS valid_to, true AS is_current, '{}' AS raw_payload;
	`
	if _, err := conn.ExecContext(ctx, batch2SQL); err != nil {
		t.Fatalf("failed creating batch2: %v", err)
	}
	if _, err := conn.ExecContext(ctx, upsertStationsSQL); err != nil {
		t.Fatalf("second dim_stations upsert failed: %v", err)
	}

	var totalRows, currentRows int
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*), SUM(CASE WHEN is_current THEN 1 ELSE 0 END) FROM memory.transit_v2.dim_stations").Scan(&totalRows, &currentRows); err != nil {
		t.Fatalf("failed counting dim_stations: %v", err)
	}
	if totalRows != 1 || currentRows != 1 {
		t.Fatalf("expected 1 total and 1 current row after unchanged poll, got total=%d current=%d", totalRows, currentRows)
	}

	// Poll 3: Changed is_accessible -> should expire old row (is_current=false) and insert 1 new row (is_current=true)
	batch3SQL := `
		CREATE OR REPLACE TEMP TABLE dedup_stations_batch AS
		SELECT '101' AS station_id, 'MTA_SUBWAY' AS agency_id, 'Van Cortlandt Park' AS name,
		       40.8892 AS latitude, -73.8985 AS longitude,
		       '101' AS gtfs_stop_id, '101' AS complex_id, '1' AS daytime_routes, 'Elevated' AS structure, true AS is_accessible,
		       '2026-10-13 14:00:00'::TIMESTAMP AS valid_from, NULL::TIMESTAMP AS valid_to, true AS is_current, '{}' AS raw_payload;
	`
	if _, err := conn.ExecContext(ctx, batch3SQL); err != nil {
		t.Fatalf("failed creating batch3: %v", err)
	}
	if _, err := conn.ExecContext(ctx, upsertStationsSQL); err != nil {
		t.Fatalf("third dim_stations upsert failed: %v", err)
	}

	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*), SUM(CASE WHEN is_current THEN 1 ELSE 0 END) FROM memory.transit_v2.dim_stations").Scan(&totalRows, &currentRows); err != nil {
		t.Fatalf("failed counting dim_stations after update: %v", err)
	}
	if totalRows != 2 || currentRows != 1 {
		t.Fatalf("expected 2 total and 1 current row after attribute change, got total=%d current=%d", totalRows, currentRows)
	}

	// 2. Test fact_alerts conditional MERGE, intra-batch deduplication, midnight rollover, and reactivation
	sortAlerts := getParquetSortClause("fact_alerts")
	alertsBatch1 := `
		CREATE OR REPLACE TEMP TABLE raw_alerts_batch AS
		SELECT 'alert-1' AS alert_id, 'MTA' AS agency_id, '2026-10-13'::DATE AS event_date,
		       '2026-10-13 10:05:00'::TIMESTAMP AS detected_at, '2026-10-13 10:05:00'::TIMESTAMP AS last_seen_at, NULL::TIMESTAMP AS removed_at,
		       '2026-10-13 10:00:00'::TIMESTAMP AS active_period_start, '2026-10-13 18:00:00'::TIMESTAMP AS active_period_end,
		       ['A']::VARCHAR[] AS affected_route_ids, 'MAINTENANCE' AS cause, 'DELAYS' AS effect,
		       'Delays on A' AS header_text, 'Desc 1' AS description_text, 'WARNING' AS severity, '{}' AS raw_payload
		UNION ALL
		SELECT 'alert-1', 'MTA', '2026-10-13'::DATE,
		       '2026-10-13 10:06:00'::TIMESTAMP, '2026-10-13 10:06:00'::TIMESTAMP, NULL::TIMESTAMP,
		       '2026-10-13 10:00:00'::TIMESTAMP, '2026-10-13 18:00:00'::TIMESTAMP,
		       ['A']::VARCHAR[], 'MAINTENANCE', 'DELAYS',
		       'Delays on A', 'Desc 1', 'WARNING', '{}';
		CREATE OR REPLACE TEMP TABLE dedup_alerts_batch AS SELECT * FROM raw_alerts_batch ` + sortAlerts + `;`
	if _, err := conn.ExecContext(ctx, alertsBatch1); err != nil {
		t.Fatalf("failed creating dedup_alerts_batch: %v", err)
	}

	upsertAlertsSQL1 := buildCatalogUpsertSQL("memory", "transit_v2", "fact_alerts", "dedup_alerts_batch", "", "2026-10-13", "2026-10-13")
	if _, err := conn.ExecContext(ctx, upsertAlertsSQL1); err != nil {
		t.Fatalf("first fact_alerts upsert failed: %v", err)
	}

	var alertCount int
	var lastSeen string
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*), MAX(last_seen_at)::VARCHAR FROM memory.transit_v2.fact_alerts").Scan(&alertCount, &lastSeen); err != nil {
		t.Fatalf("failed querying fact_alerts: %v", err)
	}
	if alertCount != 1 || !strings.HasPrefix(lastSeen, "2026-10-13 10:06:00") {
		t.Fatalf("expected 1 deduplicated alert with latest last_seen_at, got count=%d lastSeen=%s", alertCount, lastSeen)
	}

	// Poll 2 with identical alert attributes but newer last_seen_at within 5 minutes -> should NOT overwrite last_seen_at (avoids position-delete churn)
	alertsBatch2 := `
		CREATE OR REPLACE TEMP TABLE dedup_alerts_batch AS
		SELECT 'alert-1' AS alert_id, 'MTA' AS agency_id, '2026-10-13'::DATE AS event_date,
		       '2026-10-13 10:07:00'::TIMESTAMP AS detected_at, '2026-10-13 10:07:00'::TIMESTAMP AS last_seen_at, NULL::TIMESTAMP AS removed_at,
		       '2026-10-13 10:00:00'::TIMESTAMP AS active_period_start, '2026-10-13 18:00:00'::TIMESTAMP AS active_period_end,
		       ['A']::VARCHAR[] AS affected_route_ids, 'MAINTENANCE' AS cause, 'DELAYS' AS effect,
		       'Delays on A' AS header_text, 'Desc 1' AS description_text, 'WARNING' AS severity, '{}' AS raw_payload;
	`
	if _, err := conn.ExecContext(ctx, alertsBatch2); err != nil {
		t.Fatalf("failed creating alertsBatch2: %v", err)
	}
	if _, err := conn.ExecContext(ctx, upsertAlertsSQL1); err != nil {
		t.Fatalf("second fact_alerts upsert failed: %v", err)
	}
	if err := conn.QueryRowxContext(ctx, "SELECT MAX(last_seen_at)::VARCHAR FROM memory.transit_v2.fact_alerts").Scan(&lastSeen); err != nil {
		t.Fatalf("failed querying fact_alerts after unchanged poll: %v", err)
	}
	if !strings.HasPrefix(lastSeen, "2026-10-13 10:06:00") {
		t.Fatalf("expected unchanged alert to skip update and keep last_seen_at=2026-10-13 10:06:00, got %s", lastSeen)
	}

	// Poll 3: Midnight rollover! Next day (2026-10-14), batch has event_date='2026-10-14' and minDate/maxDate='2026-10-14'
	// The 7-day lookback partition filter ensures alert-1 matches the existing 2026-10-13 row and DOES NOT insert a duplicate!
	alertsBatch3 := `
		CREATE OR REPLACE TEMP TABLE dedup_alerts_batch AS
		SELECT 'alert-1' AS alert_id, 'MTA' AS agency_id, '2026-10-14'::DATE AS event_date,
		       '2026-10-14 00:02:00'::TIMESTAMP AS detected_at, '2026-10-14 00:02:00'::TIMESTAMP AS last_seen_at, NULL::TIMESTAMP AS removed_at,
		       '2026-10-13 10:00:00'::TIMESTAMP AS active_period_start, '2026-10-14 18:00:00'::TIMESTAMP AS active_period_end,
		       ['A']::VARCHAR[] AS affected_route_ids, 'MAINTENANCE' AS cause, 'DELAYS' AS effect,
		       'Delays on A' AS header_text, 'Desc 1' AS description_text, 'WARNING' AS severity, '{}' AS raw_payload;
	`
	if _, err := conn.ExecContext(ctx, alertsBatch3); err != nil {
		t.Fatalf("failed creating alertsBatch3: %v", err)
	}
	upsertAlertsSQLMidnight := buildCatalogUpsertSQL("memory", "transit_v2", "fact_alerts", "dedup_alerts_batch", "", "2026-10-14", "2026-10-14")
	if _, err := conn.ExecContext(ctx, upsertAlertsSQLMidnight); err != nil {
		t.Fatalf("midnight fact_alerts upsert failed: %v", err)
	}
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*) FROM memory.transit_v2.fact_alerts").Scan(&alertCount); err != nil {
		t.Fatalf("failed querying fact_alerts after midnight rollover: %v", err)
	}
	if alertCount != 1 {
		t.Fatalf("expected 1 alert after midnight rollover (0 duplicates), got count=%d", alertCount)
	}

	// Poll 4: Removal and Re-activation (Flapping)
	// Simulate alert disappearing from feed (removal)
	if _, err := conn.ExecContext(ctx, "UPDATE memory.transit_v2.fact_alerts SET removed_at = '2026-10-14 01:00:00' WHERE alert_id = 'alert-1'"); err != nil {
		t.Fatalf("failed marking alert removed: %v", err)
	}
	var removedAt *string
	if err := conn.QueryRowxContext(ctx, "SELECT removed_at::VARCHAR FROM memory.transit_v2.fact_alerts WHERE alert_id = 'alert-1'").Scan(&removedAt); err != nil || removedAt == nil {
		t.Fatalf("expected alert to be removed, got: %v", removedAt)
	}

	// Alert reappears on next poll: should reactivate in place (removed_at = NULL) and NOT insert a duplicate row
	if _, err := conn.ExecContext(ctx, upsertAlertsSQLMidnight); err != nil {
		t.Fatalf("reactivation fact_alerts upsert failed: %v", err)
	}
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*), removed_at FROM memory.transit_v2.fact_alerts GROUP BY removed_at").Scan(&alertCount, &removedAt); err != nil {
		t.Fatalf("failed querying reactivated alert: %v", err)
	}
	if alertCount != 1 || removedAt != nil {
		t.Fatalf("expected 1 reactivated alert with removed_at=nil, got count=%d removedAt=%v", alertCount, removedAt)
	}
}

func TestTelemetryWindowAndParquetSortOrder(t *testing.T) {
	ctx := context.Background()
	engine, err := NewDuckEngine(nil, nil)
	if err != nil {
		t.Fatalf("failed to create DuckEngine: %v", err)
	}
	defer engine.Close()

	// 1. Verify Parquet sort order leads with event_date and event_time on telemetry tables
	vpSort := getParquetSortClause("fact_vehicle_positions")
	if !strings.Contains(vpSort, "ORDER BY event_date, event_time, agency_id, route_id") {
		t.Fatalf("expected fact_vehicle_positions sort order to lead with event_date, event_time, got: %s", vpSort)
	}
	mmSort := getParquetSortClause("fact_micromobility_status")
	if !strings.Contains(mmSort, "ORDER BY event_date, event_time, agency_id, station_id") {
		t.Fatalf("expected fact_micromobility_status sort order to lead with event_date, event_time, got: %s", mmSort)
	}

	// 2. Verify telemetry window filter drops rows older than 10 minutes or preceding Honker last pull
	conn, err := engine.Connx(ctx)
	if err != nil {
		t.Fatalf("failed acquiring connection: %v", err)
	}
	defer conn.Close()

	rawSQL := `
		CREATE OR REPLACE TEMP TABLE raw_vp AS
		SELECT CURRENT_DATE - INTERVAL '1 day' AS event_date,
		       CURRENT_TIMESTAMP - INTERVAL '18 hours' AS event_time,
		       'NJT' AS agency_id, 'NEC' AS route_id, 't1' AS trip_id, 's1' AS station_id,
		       'v_stale' AS vehicle_id, 'STOPPED_AT' AS status, 40.7 AS latitude, -74.0 AS longitude,
		       0.0 AS bearing, 0.0 AS speed, 'EMPTY' AS occupancy_status, '{}' AS raw_payload
		UNION ALL
		SELECT CURRENT_DATE AS event_date,
		       CURRENT_TIMESTAMP - INTERVAL '1 minute' AS event_time,
		       'MTA_SUBWAY' AS agency_id, 'A' AS route_id, 't2' AS trip_id, 's2' AS station_id,
		       'v_fresh' AS vehicle_id, 'IN_TRANSIT_TO' AS status, 40.75 AS latitude, -73.99 AS longitude,
		       90.0 AS bearing, 12.5 AS speed, 'MANY_SEATS_AVAILABLE' AS occupancy_status, '{}' AS raw_payload
	`
	if _, err := conn.ExecContext(ctx, rawSQL); err != nil {
		t.Fatalf("failed creating raw_vp: %v", err)
	}

	transformedSQL := "CREATE OR REPLACE TEMP TABLE tmp_vp_filtered AS SELECT * FROM (SELECT * FROM raw_vp)" +
		engine.getTelemetryWindowFilterClause("fact_vehicle_positions") +
		getParquetSortClause("fact_vehicle_positions") + ";"
	if _, err := conn.ExecContext(ctx, transformedSQL); err != nil {
		t.Fatalf("failed creating tmp_vp_filtered: %v", err)
	}

	var kept int
	if err := conn.QueryRowxContext(ctx, "SELECT COUNT(*) FROM tmp_vp_filtered").Scan(&kept); err != nil {
		t.Fatalf("failed counting tmp_vp_filtered: %v", err)
	}
	if kept != 1 {
		t.Fatalf("expected 1 fresh row kept after 10-minute window filter, got %d", kept)
	}

	minTimeVal, minDate, maxDate := engine.extractBatchBoundsOnConn(ctx, conn, "fact_vehicle_positions", "tmp_vp_filtered")
	if minTimeVal == "" || minDate == "" || maxDate == "" {
		t.Fatalf("expected non-empty batch bounds on fresh row, got minTime=%q minDate=%q maxDate=%q", minTimeVal, minDate, maxDate)
	}
	if minDate != maxDate {
		t.Fatalf("expected minDate == maxDate (today only, 18h stale row excluded), got minDate=%s maxDate=%s", minDate, maxDate)
	}
}


