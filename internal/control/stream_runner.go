package control

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

var feedFetchErrors sync.Map

// RecordFeedFetchError increments the error count for a given plugin ID.
func RecordFeedFetchError(pluginID string) {
	val, _ := feedFetchErrors.LoadOrStore(pluginID, &atomic.Int64{})
	val.(*atomic.Int64).Add(1)
}

// GetFeedFetchErrors returns a snapshot of feed error counts per plugin.
func GetFeedFetchErrors() map[string]int64 {
	m := make(map[string]int64)
	feedFetchErrors.Range(func(key, val any) bool {
		m[key.(string)] = val.(*atomic.Int64).Load()
		return true
	})
	return m
}

// SafeGo executes a function in a background goroutine with panic recovery.
func SafeGo(logger *slog.Logger, name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("recovered from panic in background goroutine",
					"routine", name,
					"panic", fmt.Sprintf("%v", r),
					"stack", string(debug.Stack()),
				)
			}
		}()
		fn()
	}()
}

// IngestStream continuously fetches high-frequency feeds and appends raw payloads to Honker Streams.
func IngestStream(ctx context.Context, logger *slog.Logger, sm *StreamManager, ds plugin.DataSource) {
	streamName := "stream_" + ds.TargetTable()
	if err := sm.InitStreamTable(streamName); err != nil {
		logger.Error("failed to init stream table", "stream", streamName, "error", err)
		return
	}

	SafeGo(logger, "ingest_stream_"+ds.ID(), func() {
		fetchAndAppend := func() {
			payload, err := ds.Fetch(ctx)
			if err != nil {
				RecordFeedFetchError(ds.ID())
				logger.Error("failed to fetch stream feed", "plugin", ds.ID(), "error", err)
				return
			}

			eventID, err := sm.Append(streamName, ds.ID(), payload)
			if err != nil {
				logger.Error("failed to append to honker stream", "plugin", ds.ID(), "error", err)
			} else {
				logger.Info("appended feed to stream", "plugin", ds.ID(), "target_table", ds.TargetTable(), "event_id", eventID, "bytes", len(payload))
			}
		}

		// Immediate initial fetch on boot
		fetchAndAppend()

		ticker := time.NewTicker(ds.DefaultInterval())
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				fetchAndAppend()
			}
		}
	})
}
