package integration

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"github.com/prequel-co/straphangerdb/pkg/schema"
	"github.com/prequel-co/straphangerdb/test/fixtures"
	"github.com/prequel-co/straphangerdb/test/mock"
)

func TestStatefulOperations(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	tmpFile, err := os.CreateTemp("", "control_*.db")
	if err != nil {
		t.Fatalf("failed creating temp sqlite file: %v", err)
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()
	defer os.Remove(tmpPath)

	sqliteDB, err := control.InitControlDB(logger, tmpPath)
	if err != nil {
		t.Fatalf("failed initializing control db: %v", err)
	}
	defer sqliteDB.Close()

	pubsub := control.NewPubSub(logger, sqliteDB)
	streamMgr := control.NewStreamManager(logger, sqliteDB)

	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb engine: %v", err)
	}
	defer duck.Close()

	// Test 1: Bootstrapping DDL
	ddls := schema.GetBootstrapDDL(schema.CurrentSchemaVersion)
	for _, ddl := range ddls {
		if _, err := duck.DB().Exec(ddl); err != nil {
			t.Fatalf("failed executing bootstrap ddl: %v", err)
		}
	}
	if err := control.SetSchemaInitialized(sqliteDB); err != nil {
		t.Fatalf("failed setting schema initialized: %v", err)
	}
	pubsub.Publish("sys:bootstrap", "initialized")

	if !control.IsSchemaInitialized(sqliteDB) {
		t.Errorf("expected schema_initialized to be true")
	}

	// Test 2: Stream Ingestion with Mock Plugin
	mockStreamPlugin := mock.NewMockPlugin("mock_subway_rt", "MTA_NYCT_SUBWAY", plugin.ModeStream, fixtures.GTFSPositionsV1)
	streamName := "stream_" + mockStreamPlugin.ID()

	if err := streamMgr.InitStreamTable(streamName); err != nil {
		t.Fatalf("failed initializing stream table: %v", err)
	}

	eventID, err := streamMgr.Append(streamName, mockStreamPlugin.AgencyID(), fixtures.GTFSPositionsV1)
	if err != nil || eventID == 0 {
		t.Fatalf("failed appending event to stream: %v", err)
	}

	// Read Consumer Group
	events, newOffset, err := streamMgr.ReadConsumerGroup(streamName, "test_group", 10)
	if err != nil || len(events) != 1 {
		t.Fatalf("failed reading consumer group stream events: %v, count: %d", err, len(events))
	}

	if err := streamMgr.CommitOffset(streamName, "test_group", newOffset); err != nil {
		t.Fatalf("failed committing offset: %v", err)
	}

	// Test 3: Time-based Stream Truncation
	cutoff := time.Now().Add(1 * time.Minute) // Cutoff in future to test purging
	deleted, err := streamMgr.TruncateBeforeTime(streamName, cutoff)
	if err != nil || deleted != 1 {
		t.Errorf("expected 1 row deleted during truncation, got %d, err: %v", deleted, err)
	}

	// Test 4: Centralized Table Stream Ingestion across multiple plugins
	targetTableStream := "stream_fact_vehicle_positions"
	if err := streamMgr.InitStreamTable(targetTableStream); err != nil {
		t.Fatalf("failed initializing target table stream: %v", err)
	}

	p1 := mock.NewMockPlugin("mta_subway_gtfs_rt", "MTA_NYCT_SUBWAY", plugin.ModeStream, fixtures.GTFSPositionsV1)
	p2 := mock.NewMockPlugin("mta_bus_gtfs_rt", "MTA_BUS", plugin.ModeStream, fixtures.GTFSPositionsV1)

	if _, err := streamMgr.Append(targetTableStream, p1.ID(), fixtures.GTFSPositionsV1); err != nil {
		t.Fatalf("failed appending p1 event: %v", err)
	}
	if _, err := streamMgr.Append(targetTableStream, p2.ID(), fixtures.GTFSPositionsV1); err != nil {
		t.Fatalf("failed appending p2 event: %v", err)
	}

	tableEvents, offset, err := streamMgr.ReadConsumerGroup(targetTableStream, "duckdb_table_flusher", 100)
	if err != nil || len(tableEvents) != 2 {
		t.Fatalf("expected 2 aggregated events in table stream, got %d, err: %v", len(tableEvents), err)
	}
	if err := streamMgr.CommitOffset(targetTableStream, "duckdb_table_flusher", offset); err != nil {
		t.Fatalf("failed committing table stream offset: %v", err)
	}
}

func TestDuckLakeBootstrapSchema(t *testing.T) {
	// Verify that GetBootstrapDDLWithCatalog for ducklake contains NO PRIMARY KEY constraints
	ddls := schema.GetBootstrapDDLWithCatalog("ducklake", schema.CurrentSchemaVersion)
	for _, ddl := range ddls {
		if strings.Contains(ddl, "PRIMARY KEY") {
			t.Fatalf("ducklake DDL must not contain PRIMARY KEY, but found in:\n%s", ddl)
		}
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg := &config.Config{
		OTFFormat:   "ducklake",
		MemoryLimit: "1GB",
		Threads:     1,
	}
	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb engine: %v", err)
	}
	defer duck.Close()

	// Verify executing in ducklake catalog
	tmpCatalog := "/tmp/test_ducklake_integration_catalog.db"
	tmpData := "/tmp/test_ducklake_integration_data"
	defer os.Remove(tmpCatalog)
	defer os.RemoveAll(tmpData)

	attachSQL := fmt.Sprintf("INSTALL ducklake; LOAD ducklake; ATTACH 'ducklake:%s' AS ducklake (DATA_PATH '%s');", tmpCatalog, tmpData)
	if err := duck.ExecuteScript(context.Background(), attachSQL); err != nil {
		t.Logf("skipping ducklake execution test if extension not installable: %v", err)
		return
	}

	for _, ddl := range ddls {
		if err := duck.ExecuteScript(context.Background(), ddl); err != nil {
			t.Fatalf("failed executing ducklake DDL: %v\nDDL: %s", err, ddl)
		}
	}
}

func TestDucklakeMaintenanceNonBlocking(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DUCKLAKE_CATALOG_PATH", tmpDir+"/ducklake_catalog.db")
	t.Setenv("DUCKLAKE_DATA_PATH", tmpDir+"/data")

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg := &config.Config{
		OTFFormat:   "ducklake",
		MemoryLimit: "512MB",
		Threads:     1,
	}
	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb engine: %v", err)
	}
	defer duck.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Prior to the fix, RunDucklakeMaintenance deadlocked because it checked out conn from Connx
	// and then invoked ExecuteScript which re-invoked Connx on the SetMaxOpenConns(1) pool.
	// With ExecuteScriptOnConn, this must execute smoothly without deadlocking the pool.
	done := make(chan error, 1)
	go func() {
		done <- duck.RunDucklakeMaintenance(ctx)
	}()

	select {
	case <-time.After(3 * time.Second):
		t.Fatal("RunDucklakeMaintenance deadlocked or blocked for > 3 seconds (connection pool re-entrancy bug)")
	case err := <-done:
		if err != nil {
			t.Logf("maintenance returned expected notice/error: %v", err)
		}
	}
}

