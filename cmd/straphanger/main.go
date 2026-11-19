package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/coordinator"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/schema"
	"github.com/prequel-co/straphangerdb/pkg/semantic"

	// Register all agency plugins via init()
	_ "github.com/prequel-co/straphangerdb/internal/sources/citibike/gbfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/citibike/stations"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/alerts"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/boroughs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/bus_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/colors"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/lirr_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/mnr_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/ridership"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/schedules"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/service_lines"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/sir_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/stations"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/subway_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/turnstiles"
	_ "github.com/prequel-co/straphangerdb/internal/sources/njt/gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/nyc_ferry/gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/port_authority/airtrain"
	_ "github.com/prequel-co/straphangerdb/internal/sources/port_authority/path_gtfs"
)

func main() {
	cfg := config.LoadConfig()

	// Initialize root JSON logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})).With(
		slog.String("app", "straphangerdb"),
		slog.String("otf_format", cfg.OTFFormat),
		slog.String("bucket_prefix", cfg.BucketPrefix),
	)

	if err := cfg.ValidateCredentials(); err != nil {
		logger.Error("configuration validation failed", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Intercept SIGINT/SIGTERM for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigChan
		logger.Info("received termination signal, initiating graceful drain...", "signal", sig.String())
		cancel()
	}()

	// Initialize SQLite control plane database
	sqliteDB, initErr := control.InitControlDB(logger, cfg.SQLiteDBPath)
	if initErr != nil {
		logger.Error("failed initializing SQLite control DB", "path", cfg.SQLiteDBPath, "error", initErr)
		os.Exit(1)
	}
	defer sqliteDB.Close()

	// Initialize DuckDB data plane engine
	duck, initErr := dataplane.NewDuckEngine(logger, cfg)
	if initErr != nil {
		logger.Error("failed initializing DuckDB engine", "error", initErr)
		os.Exit(1)
	}
	defer duck.Close()

	// Initialize EngineCoordinator
	coord := coordinator.NewEngineCoordinator(logger, cfg, sqliteDB, duck)

	// Start HTTP health, readiness, and metrics server
	httpServer := startHTTPServer(logger, cfg, sqliteDB, duck, coord)

	// Attach OTF catalogs
	if cfg.OTFFormat == "all" || cfg.OTFFormat == "iceberg" {
		if err := duck.AttachIcebergRESTCatalog(); err != nil {
			logger.Warn("initial iceberg catalog attach note; flusher will attach per-batch", "error", err)
		}
	}
	if cfg.OTFFormat == "all" || cfg.OTFFormat == "ducklake" {
		if err := duck.AttachDucklakeCatalog(ctx); err != nil {
			logger.Warn("initial ducklake catalog attach note", "error", err)
		}
		if err := duck.ConfigureDucklakeCatalogOptions("ducklake"); err != nil {
			logger.Debug("ducklake catalog options note", "error", err)
		}
	}

	// Bootstrap schema and initialize workflow tasks
	coord.BootstrapSchema(ctx)
	coord.RegisterWorkflows(ctx)

	// Upload Apache Ossie semantic models to Cloudflare R2
	if duck.S3OCC() != nil {
		uploadOssieModels(ctx, logger, duck.S3OCC())
	}

	// ARCHITECTURAL NOTE (SCHEMA GOVERNANCE):
	// StraphangerDB's Go plugins statically govern all feed schemas via typed structs.
	// Ingestion models are deterministic and do not dynamically drift; defensive DLQ
	// branching for schema changes is intentionally omitted.
	coord.StartPollers(ctx)
	coord.StartTableFlushers(ctx)

	logger.Info("StraphangerDB initialization complete. Service running.")
	<-ctx.Done()
	logger.Info("received termination signal (SIGTERM/SIGINT), executing graceful shutdown sequence...")

	// Execute graceful drain of pending batches with a 30-second bounded context
	// Grounded in production benchmarks: accommodates Iceberg commit latency (p50: 22s, p90: 58s, avg: 27.9s)
	coord.GracefulDrain(context.Background(), 30*time.Second)

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)

	logger.Info("final shutdown flush complete. closing database handles for Litestream WAL replication...")
}

func startHTTPServer(
	logger *slog.Logger,
	cfg *config.Config,
	sqliteDB *sqlx.DB,
	duck *dataplane.DuckEngine,
	coord *coordinator.EngineCoordinator,
) *http.Server {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Liveness probe
	livenessHandler := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK\n"))
	}
	mux.HandleFunc("/healthz", livenessHandler)
	mux.HandleFunc("/livez", livenessHandler)
	mux.HandleFunc("/health", livenessHandler)

	// Readiness probe
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()

		type CheckDetail struct {
			Status string `json:"status"`
			Error  string `json:"error,omitempty"`
			Detail string `json:"detail,omitempty"`
			Lag    int64  `json:"lag,omitempty"`
		}

		checks := make(map[string]CheckDetail)
		isReady := true

		// 1. SQLite Control Plane DB
		if sqliteDB == nil {
			isReady = false
			checks["sqlite"] = CheckDetail{Status: "down", Error: "initializing"}
		} else if err := sqliteDB.PingContext(ctx); err != nil {
			isReady = false
			checks["sqlite"] = CheckDetail{Status: "down", Error: err.Error()}
		} else {
			checks["sqlite"] = CheckDetail{Status: "ok"}
		}

		// 2. Dedicated DuckDB Probe Connection
		if duck == nil {
			isReady = false
			checks["duckdb"] = CheckDetail{Status: "down", Error: "initializing"}
		} else if err := duck.PingProbe(ctx); err != nil {
			isReady = false
			checks["duckdb"] = CheckDetail{Status: "down", Error: err.Error()}
		} else {
			checks["duckdb"] = CheckDetail{Status: "ok"}
		}

		// 3. Active Stream Consumer Group Lags
		streamMgr := coord.GetStreamManager()
		if streamMgr != nil {
			for _, stream := range coord.GetActiveStreams() {
				lag, err := streamMgr.GetLag(stream, "duckdb_table_flusher")
				if err != nil {
					checks[stream] = CheckDetail{Status: "error", Error: err.Error()}
				} else {
					status := "ok"
					if lag > 1000000 {
						isReady = false
						status = "degraded_backlog"
					}
					checks[stream] = CheckDetail{Status: status, Lag: lag}
				}
			}
		}

		// 4. Cloudflare R2 Compaction Sentinel
		if sentinel := coord.GetCompactionSentinel(); sentinel != nil {
			paused := sentinel.GetPausedTables()
			if len(paused) > 0 {
				checks["compaction"] = CheckDetail{Status: "paused", Detail: strings.Join(paused, ", ")}
			} else {
				checks["compaction"] = CheckDetail{Status: "idle"}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		statusStr := "ready"
		if !isReady {
			statusStr = "degraded"
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":    statusStr,
			"checks":    checks,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Prometheus metrics exposition
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		var sb strings.Builder

		sb.WriteString("# HELP straphanger_ready Service readiness indicator (1 = ready, 0 = degraded)\n")
		sb.WriteString("# TYPE straphanger_ready gauge\n")
		readyVal := 0
		if sqliteDB != nil && duck != nil && sqliteDB.Ping() == nil && duck.PingProbe(r.Context()) == nil {
			readyVal = 1
		}
		fmt.Fprintf(&sb, "straphanger_ready %d\n\n", readyVal)

		sb.WriteString("# HELP straphanger_schema_version Deployed transit lakehouse schema version\n")
		sb.WriteString("# TYPE straphanger_schema_version gauge\n")
		fmt.Fprintf(&sb, "straphanger_schema_version{version=\"%s\"} 1\n\n", schema.CurrentSchemaVersion)

		activeStreams := coord.GetActiveStreams()
		streamMgr := coord.GetStreamManager()

		sb.WriteString("# HELP straphanger_consumer_lag Estimated consumer backlog per stream\n")
		sb.WriteString("# TYPE straphanger_consumer_lag gauge\n")
		if streamMgr != nil {
			for _, s := range activeStreams {
				lag, _ := streamMgr.GetLag(s, "duckdb_table_flusher")
				fmt.Fprintf(&sb, "straphanger_consumer_lag{stream=\"%s\"} %d\n", s, lag)
			}
		}
		sb.WriteString("\n")

		sb.WriteString("# HELP straphanger_events_flushed_total Total records committed to OTF per table\n")
		sb.WriteString("# TYPE straphanger_events_flushed_total counter\n")
		for table, count := range coord.GetFlushedCounts() {
			fmt.Fprintf(&sb, "straphanger_events_flushed_total{table=\"%s\",format=\"%s\"} %d\n", table, cfg.OTFFormat, count)
		}
		sb.WriteString("\n")

		sb.WriteString("# HELP straphanger_compaction_paused Compaction pause status (1 = paused, 0 = idle)\n")
		sb.WriteString("# TYPE straphanger_compaction_paused gauge\n")
		sentinel := coord.GetCompactionSentinel()
		for _, s := range activeStreams {
			table := strings.TrimPrefix(s, "stream_")
			paused := 0
			if sentinel != nil && sentinel.IsTablePaused(table) {
				paused = 1
			}
			fmt.Fprintf(&sb, "straphanger_compaction_paused{table=\"%s\"} %d\n", table, paused)
		}
		sb.WriteString("\n")

		sb.WriteString("# HELP straphanger_feed_fetch_errors_total Total failed fetches per dataset plugin\n")
		sb.WriteString("# TYPE straphanger_feed_fetch_errors_total counter\n")
		for pluginID, count := range control.GetFeedFetchErrors() {
			fmt.Fprintf(&sb, "straphanger_feed_fetch_errors_total{plugin=\"%s\"} %d\n", pluginID, count)
		}
		sb.WriteString("\n")

		_, _ = w.Write([]byte(sb.String()))
	})

	// Ossie semantic models exposition endpoint with CORS
	ossieHandler := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		trimmedPath := strings.TrimPrefix(r.URL.Path, "/")
		if trimmedPath == "ossie" || trimmedPath == "ossie/" {
			trimmedPath = "ossie/index.json"
		}
		data, err := semantic.OssieFS.ReadFile(trimmedPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}

		if strings.HasSuffix(trimmedPath, ".json") {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		} else if strings.HasSuffix(trimmedPath, ".yaml") || strings.HasSuffix(trimmedPath, ".yml") {
			w.Header().Set("Content-Type", "application/x-yaml; charset=utf-8")
		} else {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	}
	mux.HandleFunc("/ossie", ossieHandler)
	mux.HandleFunc("/ossie/", ossieHandler)

	// Root path
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("StraphangerDB Transit Lakehouse Engine\n"))
	})

	httpServer := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}
	go func() {
		logger.Info("starting HTTP health check server", "port", port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("health http server error", "error", err)
		}
	}()

	return httpServer
}

func uploadOssieModels(ctx context.Context, logger *slog.Logger, s3OCC *dataplane.S3OCCClient) {
	files, err := semantic.GetAllEmbeddedFiles()
	if err != nil {
		logger.Error("failed enumerating embedded ossie models", "error", err)
		return
	}
	for path, data := range files {
		contentType := "text/plain; charset=utf-8"
		if strings.HasSuffix(path, ".json") {
			contentType = "application/json; charset=utf-8"
		} else if strings.HasSuffix(path, ".yaml") || strings.HasSuffix(path, ".yml") {
			contentType = "application/x-yaml; charset=utf-8"
		}
		if err := s3OCC.PutStaticObject(ctx, path, data, contentType); err != nil {
			logger.Warn("failed uploading static ossie model to R2", "path", path, "error", err)
		} else {
			logger.Info("uploaded ossie semantic model to R2", "path", path, "bytes", len(data))
		}
	}
}

