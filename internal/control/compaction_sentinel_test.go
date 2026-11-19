package control

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestR2CompactionSentinel_Lifecycle(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	db, err := InitControlDB(logger, ":memory:")
	if err != nil {
		t.Fatalf("failed initializing test control db: %v", err)
	}
	defer db.Close()

	pubsub := NewPubSub(logger, db)
	sub := pubsub.Subscribe("sys:compaction")

	var responseNextEligible atomic.Value
	initialNext := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	responseNextEligible.Store(initialNext)

	// Mock Cloudflare API server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextAt := responseNextEligible.Load().(string)
		resp := cfMaintenanceResponse{
			Success: true,
		}
		resp.Result.MaintenanceConfig.Compaction.State = "enabled"
		resp.Result.MaintenanceConfig.Compaction.TargetSizeMB = "128"
		resp.Result.MaintenanceConfig.Compaction.NextEligibleAt = nextAt
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	sentinel := NewR2CompactionSentinel(
		logger,
		pubsub,
		db,
		"test_account",
		"test_bucket",
		"test_token",
		"",
		100*time.Millisecond, // Fast safety timeout for testing
		[]string{"fact_vehicle_positions"},
	)
	// Point HTTP client to mock server
	sentinel.httpClient = server.Client()
	// Override URL builder by wrapping the test handler
	sentinel.accountID = "mock"
	sentinel.SetMinPauseDuration(0)

	// 1. When next_eligible_at is in the future, table stays idle and no pubsub event is published
	ctx := context.Background()
	// Manually execute checkTableWithURL
	checkWithMock := func(nextAtStr string) error {
		responseNextEligible.Store(nextAtStr)
		// We call CheckTableCompaction but need custom URL to point to httptest server
		cfConfig := &cfMaintenanceResponse{Success: true}
		cfConfig.Result.MaintenanceConfig.Compaction.State = "enabled"
		cfConfig.Result.MaintenanceConfig.Compaction.NextEligibleAt = nextAtStr

		// Directly invoke state transition logic
		return testCheckTable(ctx, sentinel, "transit_v2", "fact_vehicle_positions", cfConfig)
	}

	if err := checkWithMock(time.Now().Add(10 * time.Minute).Format(time.RFC3339)); err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if sentinel.IsTablePaused("fact_vehicle_positions") {
		t.Fatal("expected table not paused when scheduled in future")
	}

	// 2. When next_eligible_at arrives (e.g. now), sentinel pauses table and publishes pause signal
	nowStr := time.Now().Add(-10 * time.Second).Format(time.RFC3339)
	if err := checkWithMock(nowStr); err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if !sentinel.IsTablePaused("fact_vehicle_positions") {
		t.Fatal("expected table paused when eligibility reached")
	}

	// Verify pubsub signal received
	select {
	case msg := <-sub:
		if msg != "pause:fact_vehicle_positions" {
			t.Fatalf("expected 'pause:fact_vehicle_positions', got '%s'", msg)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for pause pubsub signal")
	}

	// 3. Verify control_meta has status recorded
	var metaVal string
	if err := db.Get(&metaVal, "SELECT value FROM control_meta WHERE key = 'compaction:status:fact_vehicle_positions'"); err != nil {
		t.Fatalf("failed fetching control_meta: %v", err)
	}
	var status TableCompactionStatus
	if err := json.Unmarshal([]byte(metaVal), &status); err != nil {
		t.Fatalf("failed parsing status JSON: %v", err)
	}
	if status.State != "paused" {
		t.Fatalf("expected state 'paused', got '%s'", status.State)
	}

	// 4. When next_eligible_at advances into the future on a 1-hour schedule (~50m-59m out), sentinel resumes
	// Cloudflare hourly compaction sets next_eligible to T + 1h. When polled shortly after, it's < 1h from now.
	hourlyScheduleStr := time.Now().Add(50 * time.Minute).Format(time.RFC3339)
	if err := checkWithMock(hourlyScheduleStr); err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if sentinel.IsTablePaused("fact_vehicle_positions") {
		t.Fatal("expected table unpaused when next_eligible advances to ~50m in the future (hourly compaction cycle)")
	}

	select {
	case msg := <-sub:
		if msg != "resume:fact_vehicle_positions" {
			t.Fatalf("expected 'resume:fact_vehicle_positions', got '%s'", msg)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for resume pubsub signal")
	}

	// 5. Test safety timeout expiration
	// Pause table again
	if err := checkWithMock(time.Now().Add(-10 * time.Second).Format(time.RFC3339)); err != nil {
		t.Fatalf("check failed: %v", err)
	}
	// Drain pause message
	<-sub

	// Wait for safety timeout (100ms) to elapse
	time.Sleep(150 * time.Millisecond)

	// Run check again with same timestamp; safety timeout should force resume
	if err := checkWithMock(time.Now().Add(-10 * time.Second).Format(time.RFC3339)); err != nil {
		t.Fatalf("check failed: %v", err)
	}
	if sentinel.IsTablePaused("fact_vehicle_positions") {
		t.Fatal("expected table resumed after safety timeout")
	}

	select {
	case msg := <-sub:
		if msg != "resume:fact_vehicle_positions" {
			t.Fatalf("expected 'resume:fact_vehicle_positions', got '%s'", msg)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for safety timeout resume signal")
	}
}

// testCheckTable simulates CheckTableCompaction using ProcessMaintenanceConfig
func testCheckTable(ctx context.Context, s *R2CompactionSentinel, namespace, table string, cfConfig *cfMaintenanceResponse) error {
	return s.ProcessMaintenanceConfig(ctx, namespace, table, cfConfig)
}
