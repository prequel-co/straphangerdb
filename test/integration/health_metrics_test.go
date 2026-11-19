package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/schema"
)

func TestHealthAndReadinessEndpoints(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	tmpFile, err := os.CreateTemp("", "health_test_*.db")
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

	streamMgr := control.NewStreamManager(logger, sqliteDB)

	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "512MB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb: %v", err)
	}
	defer duck.Close()

	// Verify PingProbe functions
	ctx := context.Background()
	if err := duck.PingProbe(ctx); err != nil {
		t.Fatalf("PingProbe failed: %v", err)
	}

	// Verify GetLag functions
	streamName := "stream_fact_vehicle_positions"
	consumerGroup := "duckdb_table_flusher"
	initialLag, err := streamMgr.GetLag(streamName, consumerGroup)
	if err != nil {
		t.Fatalf("initial GetLag failed: %v", err)
	}
	if initialLag != 0 {
		t.Fatalf("expected initial lag 0, got %d", initialLag)
	}

	// Append 5 events
	for i := 0; i < 5; i++ {
		_, err := streamMgr.Append(streamName, "mta_subway", []byte(fmt.Sprintf(`{"vehicle": %d}`, i)))
		if err != nil {
			t.Fatalf("append failed: %v", err)
		}
	}

	lagAfterAppend, err := streamMgr.GetLag(streamName, consumerGroup)
	if err != nil {
		t.Fatalf("GetLag after append failed: %v", err)
	}
	if lagAfterAppend != 5 {
		t.Fatalf("expected lag 5 after 5 appends, got %d", lagAfterAppend)
	}

	// Commit offset 3
	if err := streamMgr.CommitOffset(streamName, consumerGroup, 3); err != nil {
		t.Fatalf("CommitOffset failed: %v", err)
	}
	lagAfterCommit, err := streamMgr.GetLag(streamName, consumerGroup)
	if err != nil {
		t.Fatalf("GetLag after commit failed: %v", err)
	}
	if lagAfterCommit != 2 {
		t.Fatalf("expected lag 2 after committing offset 3, got %d", lagAfterCommit)
	}

	// Set up HTTP test router mirroring main.go
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK\n"))
	})
	mux.HandleFunc("/livez", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK\n"))
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		reqCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		checks := make(map[string]any)
		isReady := true

		if err := sqliteDB.PingContext(reqCtx); err != nil {
			isReady = false
			checks["sqlite"] = map[string]any{"status": "down", "error": err.Error()}
		} else {
			checks["sqlite"] = map[string]any{"status": "ok"}
		}

		if err := duck.PingProbe(reqCtx); err != nil {
			isReady = false
			checks["duckdb"] = map[string]any{"status": "down", "error": err.Error()}
		} else {
			checks["duckdb"] = map[string]any{"status": "ok"}
		}

		lag, err := streamMgr.GetLag(streamName, consumerGroup)
		if err != nil {
			checks[streamName] = map[string]any{"status": "error", "error": err.Error()}
		} else {
			checks[streamName] = map[string]any{"status": "ok", "lag": lag}
		}

		w.Header().Set("Content-Type", "application/json")
		if !isReady {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ready",
			"checks": checks,
		})
	})

	var flushedCount atomic.Int64
	flushedCount.Store(1500)

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var sb strings.Builder
		sb.WriteString("# HELP straphanger_ready Service readiness indicator\n")
		sb.WriteString("straphanger_ready 1\n\n")
		sb.WriteString(fmt.Sprintf("straphanger_schema_version{version=\"%s\"} 1\n\n", schema.CurrentSchemaVersion))
		lag, _ := streamMgr.GetLag(streamName, consumerGroup)
		sb.WriteString(fmt.Sprintf("straphanger_consumer_lag{stream=\"%s\"} %d\n\n", streamName, lag))
		sb.WriteString(fmt.Sprintf("straphanger_events_flushed_total{table=\"fact_vehicle_positions\",format=\"%s\"} %d\n", cfg.OTFFormat, flushedCount.Load()))
		_, _ = w.Write([]byte(sb.String()))
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	// Test /healthz
	resp, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected /healthz 200 OK, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "OK" {
		t.Fatalf("unexpected /healthz body: %s", string(body))
	}

	// Test /livez
	respLive, err := http.Get(server.URL + "/livez")
	if err != nil {
		t.Fatalf("GET /livez failed: %v", err)
	}
	defer respLive.Body.Close()
	if respLive.StatusCode != http.StatusOK {
		t.Fatalf("expected /livez 200 OK, got %d", respLive.StatusCode)
	}

	// Test /readyz
	resp, err = http.Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("GET /readyz failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected /readyz 200 OK, got %d", resp.StatusCode)
	}
	var readyJson map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&readyJson); err != nil {
		t.Fatalf("failed decoding /readyz json: %v", err)
	}
	if readyJson["status"] != "ready" {
		t.Fatalf("expected status 'ready', got %v", readyJson["status"])
	}

	// Test /metrics
	resp, err = http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatalf("GET /metrics failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected /metrics 200 OK, got %d", resp.StatusCode)
	}
	metricsBody, _ := io.ReadAll(resp.Body)
	metricsStr := string(metricsBody)
	if !strings.Contains(metricsStr, "straphanger_ready 1") {
		t.Errorf("missing straphanger_ready 1 in /metrics output")
	}
	if !strings.Contains(metricsStr, "straphanger_consumer_lag{stream=\"stream_fact_vehicle_positions\"} 2") {
		t.Errorf("missing straphanger_consumer_lag in /metrics output: %s", metricsStr)
	}
	if !strings.Contains(metricsStr, "straphanger_events_flushed_total{table=\"fact_vehicle_positions\",format=\"ducklake\"} 1500") {
		t.Errorf("missing straphanger_events_flushed_total in /metrics output: %s", metricsStr)
	}
}
