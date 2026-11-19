package benchmark

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"github.com/prequel-co/straphangerdb/pkg/schema"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/subway_gtfs"
)

// BenchmarkMicroBatchThroughput tests the throughput of micro-batch ingestion and unnesting
// with DuckDB memory limit enforced.
func BenchmarkMicroBatchThroughput(b *testing.B) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         2,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		b.Fatalf("failed initializing DuckEngine: %v", err)
	}
	defer duck.Close()

	// Bootstrap schema
	ddls := schema.GetBootstrapDDL(schema.CurrentSchemaVersion)
	for _, ddl := range ddls {
		if _, err := duck.DB().Exec(ddl); err != nil {
			b.Fatalf("ddl failed: %v", err)
		}
	}

	// Use actual subway GTFS-RT plugin for realistic benchmark
	subwayPlugin, ok := plugin.Get("mta_subway_gtfs_rt")
	if !ok {
		b.Fatalf("plugin mta_subway_gtfs_rt not found")
	}

	ctx := context.Background()
	subwayData, err := subwayPlugin.Fetch(ctx)
	if err != nil {
		b.Fatalf("subway fetch failed: %v", err)
	}

	events := make([]control.StreamEvent, 10)
	for i := 0; i < 10; i++ {
		events[i] = control.StreamEvent{
			ID:        int64(i + 1),
			Topic:     subwayPlugin.ID(),
			Payload:   subwayData,
			CreatedAt: time.Now(),
		}
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		tmpTable := fmt.Sprintf("stg_bench_subway_%d", i)
		if err := duck.StageEvents(ctx, tmpTable, events); err != nil {
			b.Fatalf("staging failed: %v", err)
		}

		selectQuery := subwayPlugin.TransformSelect(tmpTable)
		insertSQL := fmt.Sprintf("INSERT INTO %s.fact_vehicle_positions %s;", schema.CurrentSchemaVersion, selectQuery)
		if _, err := duck.DB().ExecContext(ctx, insertSQL); err != nil {
			b.Fatalf("insert failed: %v", err)
		}

		_, _ = duck.DB().Exec(fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTable))
	}
}

// BenchmarkStatefulMergeLatency benchmarks SCD Type II dimension upserts.
func BenchmarkStatefulMergeLatency(b *testing.B) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         2,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		b.Fatalf("failed initializing DuckEngine: %v", err)
	}
	defer duck.Close()

	ddls := schema.GetBootstrapDDL(schema.CurrentSchemaVersion)
	for _, ddl := range ddls {
		if _, err := duck.DB().Exec(ddl); err != nil {
			b.Fatalf("ddl failed: %v", err)
		}
	}

	// Pre-seed 1000 station dimension rows
	for i := 0; i < 1000; i++ {
		seedQuery := fmt.Sprintf(`INSERT INTO transit_v2.dim_stations (
			station_id, agency_id, name, latitude, longitude,
			gtfs_stop_id, complex_id, daytime_routes, structure, is_accessible,
			valid_from, valid_to, is_current, raw_payload
		) VALUES (
			'STATION_%d', 'MTA', 'Station %d', 40.7128, -74.0060,
			'STOP_%d', 'CPLX_%d', 'A C E', 'Subway', false,
			'2026-01-01 00:00:00+00'::TIMESTAMPTZ, NULL, true, '{"source": "seed"}'::VARIANT
		);`, i, i, i, i)
		if _, err := duck.DB().Exec(seedQuery); err != nil {
			b.Fatalf("seed failed: %v", err)
		}
	}

	b.ResetTimer()
	b.ReportAllocs()

	ctx := context.Background()
	for i := 0; i < b.N; i++ {
		// Simulate SCD Type II batch update: close previous version and insert updated version
		stgTable := fmt.Sprintf("stg_scd_bench_%d", i)
		_, err := duck.DB().Exec(fmt.Sprintf(`
			CREATE TEMP TABLE %s (
				station_id VARCHAR, agency_id VARCHAR, name VARCHAR,
				latitude DOUBLE, longitude DOUBLE, gtfs_stop_id VARCHAR,
				complex_id VARCHAR, daytime_routes VARCHAR, structure VARCHAR,
				is_accessible BOOLEAN, valid_from TIMESTAMPTZ,
				raw_payload VARIANT
			);
			INSERT INTO %s VALUES
				('STATION_10', 'MTA', 'Station 10 Renovated', 40.7130, -74.0065, 'STOP_10', 'CPLX_10', 'A C E L', 'Subway', true, CURRENT_TIMESTAMP, '{"status": "renovated"}'::VARIANT),
				('STATION_20', 'MTA', 'Station 20 Renovated', 40.7140, -74.0070, 'STOP_20', 'CPLX_20', '1 2 3', 'Subway', true, CURRENT_TIMESTAMP, '{"status": "renovated"}'::VARIANT);
		`, stgTable, stgTable))
		if err != nil {
			b.Fatalf("staging creation failed: %v", err)
		}

		// Close current versions
		closeQuery := fmt.Sprintf(`
			UPDATE transit_v2.dim_stations
			SET valid_to = CURRENT_TIMESTAMP, is_current = false
			WHERE station_id IN (SELECT station_id FROM %s)
			  AND is_current = true;
		`, stgTable)
		if _, err := duck.DB().ExecContext(ctx, closeQuery); err != nil {
			b.Fatalf("close versions failed: %v", err)
		}

		// Insert new versions
		insertQuery := fmt.Sprintf(`
			INSERT INTO transit_v2.dim_stations (
				station_id, agency_id, name, latitude, longitude,
				gtfs_stop_id, complex_id, daytime_routes, structure, is_accessible,
				valid_from, valid_to, is_current, raw_payload
			)
			SELECT
				station_id, agency_id, name, latitude, longitude,
				gtfs_stop_id, complex_id, daytime_routes, structure, is_accessible,
				valid_from, NULL, true, raw_payload
			FROM %s;
		`, stgTable)
		if _, err := duck.DB().ExecContext(ctx, insertQuery); err != nil {
			b.Fatalf("insert new versions failed: %v", err)
		}

		_, _ = duck.DB().Exec(fmt.Sprintf("DROP TABLE %s;", stgTable))
	}
}
