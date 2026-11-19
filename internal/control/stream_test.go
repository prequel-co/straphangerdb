package control

import (
	"log/slog"
	"os"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestStreamManager_WatermarkSafeTruncation(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	db, err := InitControlDB(logger, ":memory:")
	if err != nil {
		t.Fatalf("failed initializing in-memory control DB: %v", err)
	}
	defer db.Close()

	sm := NewStreamManager(logger, db)
	streamName := "test_stream"

	// Insert 4 events with past timestamps (2 hours ago)
	pastTime := time.Now().Add(-2 * time.Hour).UTC().Format("2006-01-02 15:04:05")
	for i := 1; i <= 4; i++ {
		_, err := db.Exec(`
			INSERT INTO stream_events (stream_name, topic, payload, created_at)
			VALUES (?, ?, ?, ?)
		`, streamName, "vehicle_positions", []byte(`{"id": 1}`), pastTime)
		if err != nil {
			t.Fatalf("failed inserting event %d: %v", i, err)
		}
	}

	// Consumer commits offset = 2
	if err := sm.CommitOffset(streamName, "flusher", 2); err != nil {
		t.Fatalf("failed committing offset 2: %v", err)
	}

	// Verify GetMinCommittedOffset returns 2
	minOffset, err := sm.GetMinCommittedOffset(streamName)
	if err != nil {
		t.Fatalf("failed getting min offset: %v", err)
	}
	if minOffset != 2 {
		t.Fatalf("expected minOffset=2, got %d", minOffset)
	}

	// Truncate before 1 hour ago with watermark = 2
	cutoff := time.Now().Add(-1 * time.Hour)
	deleted, err := sm.TruncateBeforeTimeSafely(streamName, minOffset, cutoff)
	if err != nil {
		t.Fatalf("failed safe truncation: %v", err)
	}
	if deleted != 2 {
		t.Fatalf("expected 2 deleted rows (id <= 2), got %d", deleted)
	}

	// Verify that events 3 and 4 are still present (uncommitted) even though their timestamp is older than retention cutoff!
	var remainingCount int
	if err := db.QueryRow(`SELECT count(*) FROM stream_events WHERE stream_name = ?`, streamName).Scan(&remainingCount); err != nil {
		t.Fatalf("failed counting remaining stream events: %v", err)
	}
	if remainingCount != 2 {
		t.Fatalf("expected 2 remaining uncommitted events, got %d", remainingCount)
	}

	var remainingIDs []int64
	rows, err := db.Query(`SELECT id FROM stream_events WHERE stream_name = ? ORDER BY id ASC`, streamName)
	if err != nil {
		t.Fatalf("failed selecting remaining IDs: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("failed scanning id: %v", err)
		}
		remainingIDs = append(remainingIDs, id)
	}

	if len(remainingIDs) != 2 || remainingIDs[0] != 3 || remainingIDs[1] != 4 {
		t.Fatalf("expected remaining IDs [3, 4], got %v", remainingIDs)
	}
}

func TestStreamManager_StartupValidation(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	db, err := InitControlDB(logger, ":memory:")
	if err != nil {
		t.Fatalf("failed initializing in-memory control DB: %v", err)
	}
	defer db.Close()

	sm := NewStreamManager(logger, db)

	// No offsets exist initially; GetOffset should return 0, nil
	offset, err := sm.GetOffset("new_stream", "flusher")
	if err != nil {
		t.Fatalf("expected nil error on nonexistent offset, got %v", err)
	}
	if offset != 0 {
		t.Fatalf("expected offset=0, got %d", offset)
	}

	// No offsets exist; GetMinCommittedOffset should return 0, nil
	minOffset, err := sm.GetMinCommittedOffset("new_stream")
	if err != nil {
		t.Fatalf("expected nil error on nonexistent min offset, got %v", err)
	}
	if minOffset != 0 {
		t.Fatalf("expected minOffset=0, got %d", minOffset)
	}
}
