package coordinator

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

type stubStreamPlugin struct {
	id          string
	targetTable string
}

func (s *stubStreamPlugin) ID() string                          { return s.id }
func (s *stubStreamPlugin) AgencyID() string                    { return "TEST_AGENCY" }
func (s *stubStreamPlugin) TargetTable() string                 { return s.targetTable }
func (s *stubStreamPlugin) Mode() plugin.IngestionMode          { return plugin.ModeStream }
func (s *stubStreamPlugin) DefaultInterval() time.Duration      { return time.Hour }
func (s *stubStreamPlugin) Fetch(_ context.Context) ([]byte, error) {
	return []byte(`{}`), nil
}
func (s *stubStreamPlugin) TransformSelect(_ string) string {
	return `SELECT
		CURRENT_DATE::DATE AS event_date,
		CURRENT_TIMESTAMP::TIMESTAMP AS event_time,
		'TEST_AGENCY' AS agency_id,
		'R1' AS route_id,
		'T1' AS trip_id,
		'S1' AS station_id,
		'V1' AS vehicle_id,
		'IN_TRANSIT_TO' AS status,
		40.7128 AS latitude,
		-74.0060 AS longitude,
		0.0 AS bearing,
		0.0 AS speed,
		'EMPTY' AS occupancy_status,
		'{}' AS raw_payload`
}

func TestGracefulDrainMultiBatchLoop(t *testing.T) {
	ctx := context.Background()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "control.db")
	t.Setenv("DUCKLAKE_CATALOG_PATH", filepath.Join(tmpDir, "ducklake_catalog.db"))
	t.Setenv("DUCKLAKE_DATA_PATH", filepath.Join(tmpDir, "ducklake_data"))

	ctrlDB, err := control.InitControlDB(slog.Default(), dbPath)
	if err != nil {
		t.Fatalf("failed to create control db: %v", err)
	}
	defer ctrlDB.Close()

	cfg := &config.Config{
		MemoryLimit:    "256MB",
		Threads:        1,
		OTFFormat:      "ducklake",
		DrainBatchSize: 2,
	}

	duck, err := dataplane.NewDuckEngine(slog.Default(), cfg)
	if err != nil {
		t.Fatalf("failed to create duck engine: %v", err)
	}
	defer duck.Close()

	coord := NewEngineCoordinator(slog.Default(), cfg, ctrlDB, duck)
	ds := &stubStreamPlugin{id: "test_vp", targetTable: "fact_vehicle_positions"}
	coord.streamTables["fact_vehicle_positions"] = map[string]plugin.DataSource{
		"test_vp": ds,
	}

	streamName := "stream_fact_vehicle_positions"
	if err := coord.streamMgr.InitStreamTable(streamName); err != nil {
		t.Fatalf("failed to init stream: %v", err)
	}

	// Enqueue 5 events; with DrainBatchSize=2, GracefulDrain must loop 3 times (2 + 2 + 1) to drain all 5.
	for i := 0; i < 5; i++ {
		if _, err := coord.streamMgr.Append(streamName, "test_vp", []byte(`{"event":1}`)); err != nil {
			t.Fatalf("failed to append event %d: %v", i, err)
		}
	}

	coord.GracefulDrain(ctx, 15*time.Second)

	counts := coord.GetFlushedCounts()
	if got := counts["fact_vehicle_positions"]; got != 5 {
		t.Fatalf("expected GracefulDrain to flush all 5 events across multiple batches, got %d", got)
	}

	remaining, _, err := coord.streamMgr.ReadConsumerGroup(streamName, "duckdb_table_flusher", 10)
	if err != nil {
		t.Fatalf("ReadConsumerGroup failed after drain: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("expected 0 remaining events after GracefulDrain, got %d", len(remaining))
	}
}

func TestShouldEnablePATHPluginByDefault(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "")
	t.Setenv("PATH_GTFS_RT_URL", "")

	enabled, reason := shouldEnablePlugin("path_gtfs_rt")
	if !enabled {
		t.Fatalf("expected path_gtfs_rt to be enabled by default without env vars, got disabled (%s)", reason)
	}

	t.Setenv("MTA_BUS_API_KEY", "")
	t.Setenv("MTA_BUS_GTFS_RT_URL", "")
	busEnabled, busReason := shouldEnablePlugin("mta_bus_gtfs_rt")
	if !busEnabled {
		t.Fatalf("expected mta_bus_gtfs_rt to be enabled by default without env vars, got disabled (%s)", busReason)
	}
}
