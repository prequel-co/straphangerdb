package dataplane

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/duckdb/duckdb-go/v2"
	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/pkg/schema"
)

// DuckEngine manages the DuckDB connection pool, extensions, serialization, and OCC.
type DuckEngine struct {
	db                  *sqlx.DB
	probeDB             *sql.DB
	logger              *slog.Logger
	cfg                 *config.Config
	s3OCC               *S3OCCClient
	deltaSyncer         *DeltaUniFormSyncer
	ducklakeETag        string
	ducklakeCatalogPath string
	ducklakeOnce        sync.Once
	ducklakeAttached    bool
	ducklakeDisabled    bool
	icebergOnce         sync.Once
	icebergAttached     bool
	icebergDisabled     bool
	tableLastPullMu     sync.RWMutex
	tableLastPull       map[string]time.Time
	lastOrphanCleanup   time.Time
}

// NewDuckEngine initializes DuckDB, loads extensions, and applies memory/thread PRAGMAs.
func NewDuckEngine(logger *slog.Logger, cfg *config.Config) (*DuckEngine, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg == nil {
		cfg = &config.Config{
			MemoryLimit: "1GB",
			Threads:     1,
		}
	}
	rawDB, err := sql.Open("duckdb", "")
	if err != nil {
		return nil, fmt.Errorf("failed to open in-memory duckdb: %w", err)
	}

	db := sqlx.NewDb(rawDB, "duckdb")

	// DuckDB single-connection pool: guarantees connection affinity for temporary tables
	// and natively provides FIFO serialization across flusher workers without an application mutex.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	catalogPath := "/data/ducklake_catalog.db"
	if customCatalogPath := os.Getenv("DUCKLAKE_CATALOG_PATH"); customCatalogPath != "" {
		catalogPath = customCatalogPath
	} else if err := os.MkdirAll("/data", 0755); err != nil {
		catalogPath = "ducklake_catalog.db"
	}

	bucket := cfg.R2BucketName
	if bucket == "" {
		bucket = "straphanger-db-dev"
	}

	var s3Client *S3OCCClient
	if os.Getenv("R2_ACCESS_KEY_ID") != "" && os.Getenv("R2_SECRET_ACCESS_KEY") != "" {
		client, err := NewS3OCCClient(logger, bucket)
		if err != nil {
			logger.Warn("s3 occ client initialization warning", "error", err)
		} else {
			s3Client = client
		}
	}

	probeDB, err := sql.Open("duckdb", "")
	if err != nil {
		logger.Warn("failed to open duckdb probe connection, falling back to primary pool", "error", err)
	}

	var deltaSyncer *DeltaUniFormSyncer
	if s3Client != nil {
		deltaSyncer = NewDeltaUniFormSyncer(s3Client, bucket, os.Getenv("ICEBERG_NAMESPACE"), logger)
	}

	engine := &DuckEngine{
		db:                  db,
		probeDB:             probeDB,
		logger:              logger,
		cfg:                 cfg,
		s3OCC:               s3Client,
		deltaSyncer:         deltaSyncer,
		ducklakeCatalogPath: catalogPath,
		tableLastPull:       make(map[string]time.Time),
	}

	if err := engine.applyPragmas(); err != nil {
		db.Close()
		return nil, err
	}

	if err := engine.loadExtensions(); err != nil {
		logger.Warn("some duckdb extensions failed to load; continuing with built-ins", "error", err)
	}

	if err := engine.BootstrapInMemorySchema(); err != nil {
		logger.Warn("in-memory schema bootstrap note", "error", err)
	}

	if cfg.OTFFormat == "iceberg" || cfg.OTFFormat == "all" || os.Getenv("ICEBERG_CATALOG_URI") != "" || os.Getenv("CLOUDFLARE_API_TOKEN") != "" {
		if err := engine.AttachIcebergRESTCatalog(); err != nil {
			logger.Warn("iceberg catalog attach note at startup", "error", err)
		}
	}

	return engine, nil
}

// GetDeltaSyncer returns the Delta UniForm syncer instance, if initialized.
func (e *DuckEngine) GetDeltaSyncer() *DeltaUniFormSyncer {
	return e.deltaSyncer
}

// SetTableLastPullTime updates the Honker last-committed pull timestamp for a target table.
// Used to filter out stale/unchanged feed records that predate the last pull cycle.
func (e *DuckEngine) SetTableLastPullTime(targetTable string, lastPullAt time.Time) {
	e.tableLastPullMu.Lock()
	defer e.tableLastPullMu.Unlock()
	if e.tableLastPull == nil {
		e.tableLastPull = make(map[string]time.Time)
	}
	e.tableLastPull[targetTable] = lastPullAt
}

// getTelemetryWindowFilterClause returns a WHERE clause for high-frequency telemetry tables
// (fact_vehicle_positions, fact_micromobility_status) that keeps only events created/updated
// since the last Honker pull and strictly limits the lookback window to 10 minutes.
func (e *DuckEngine) getTelemetryWindowFilterClause(targetTable string) string {
	switch targetTable {
	case "fact_vehicle_positions", "fact_micromobility_status":
		e.tableLastPullMu.RLock()
		lastPull := e.tableLastPull[targetTable]
		e.tableLastPullMu.RUnlock()
		if !lastPull.IsZero() {
			// Subtract 2s grace for HTTP in-flight / clock skew around the previous pull boundary
			cutoff := lastPull.UTC().Add(-2 * time.Second).Format("2006-01-02 15:04:05")
			return fmt.Sprintf(" WHERE event_time >= GREATEST('%s'::TIMESTAMPTZ, CURRENT_TIMESTAMP - INTERVAL '10 minutes')", cutoff)
		}
		return " WHERE event_time >= CURRENT_TIMESTAMP - INTERVAL '10 minutes'"
	default:
		return ""
	}
}

// BootstrapInMemorySchema creates all generic transit tables under CurrentSchemaVersion in memory.
func (e *DuckEngine) BootstrapInMemorySchema() error {
	_, _ = e.db.Exec(fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s;", schema.CurrentSchemaVersion))
	for _, ddl := range schema.GetBootstrapDDL(schema.CurrentSchemaVersion) {
		if strings.HasPrefix(strings.TrimSpace(ddl), "COMMENT ON") {
			continue
		}
		if _, err := e.db.Exec(ddl); err != nil {
			e.logger.Warn("in-memory schema bootstrap notice", "ddl", ddl, "error", err)
		}
	}
	_, _ = e.db.Exec(fmt.Sprintf("SET search_path = '%s,main';", schema.CurrentSchemaVersion))
	return nil
}

// ARCHITECTURAL NOTE (DISK & MEMORY SIZING):
// Micro-batch flushes execute frequently (every 2m), maintaining a small temporary
// disk footprint in /tmp. If analytical throughput increases, allocate additional container
// memory/disk in Cloud Run rather than prematurely restricting in-process engine buffers.
func (e *DuckEngine) applyPragmas() error {
	_, _ = e.db.Exec(fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s;", schema.CurrentSchemaVersion))
	pragmas := []string{
		fmt.Sprintf("SET memory_limit = '%s';", e.cfg.MemoryLimit),
		fmt.Sprintf("SET threads = %d;", e.cfg.Threads),
		"SET preserve_insertion_order = false;",
		"SET temp_directory = '/tmp/duckdb_spill';",
		"SET autoinstall_known_extensions = true;",
		"SET autoload_known_extensions = true;",
		fmt.Sprintf("SET search_path = '%s,main';", schema.CurrentSchemaVersion),
	}

	for _, p := range pragmas {
		start := time.Now()
		if _, err := e.db.Exec(p); err != nil {
			return fmt.Errorf("failed executing duckdb pragma %s: %w", p, err)
		}
		e.logger.Debug("executed duckdb pragma", "pragma", p, "duration", time.Since(start))
	}

	return nil
}

func (e *DuckEngine) loadExtensions() error {
	extensions := []string{"httpfs", "spatial", "iceberg", "delta", "ducklake"}
	for _, ext := range extensions {
		_, _ = e.db.Exec(fmt.Sprintf("INSTALL %s;", ext))
		if _, err := e.db.Exec(fmt.Sprintf("LOAD %s;", ext)); err != nil {
			altPath := fmt.Sprintf("/usr/local/lib/duckdb/%s.duckdb_extension", ext)
			if _, errAlt := e.db.Exec(fmt.Sprintf("LOAD '%s';", altPath)); errAlt != nil {
				e.logger.Error("extension load error", "extension", ext, "error", err)
			} else {
				e.logger.Info("successfully loaded duckdb extension from custom path", "extension", ext, "path", altPath)
			}
		} else {
			e.logger.Info("successfully loaded duckdb extension", "extension", ext)
		}
	}
	return nil
}

// StageEvents creates a temporary DuckDB staging table and inserts stream events via in-process prepared statements.
// ARCHITECTURAL NOTE (ADR-003 Connection Pinning):
// For production flusher pipelines, StageEventsOnConn is the primary, preferred method because DuckDB temporary
// tables are strictly connection-scoped. StageEvents delegates to StageEventsOnConn on the single-connection pool.
func (e *DuckEngine) StageEvents(ctx context.Context, tmpTable string, events []control.StreamEvent) error {
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire duckdb connection for staging table %s: %w", tmpTable, err)
	}
	defer conn.Close()
	return e.StageEventsOnConn(ctx, conn, tmpTable, events)
}

// StageEventsOnConn creates a temporary DuckDB staging table and inserts stream events on a pinned connection handle
// wrapped in a single explicit transaction. This guarantees strict connection affinity under ADR-003 SetMaxOpenConns(1)
// FIFO pool serialization and avoids per-row autocommit overhead during large backlog drains.
func (e *DuckEngine) StageEventsOnConn(ctx context.Context, conn *sqlx.Conn, tmpTable string, events []control.StreamEvent) error {
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", tmpTable)); err != nil {
		return fmt.Errorf("failed to create staging table %s: %w", tmpTable, err)
	}

	if len(events) == 0 {
		return nil
	}

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction for staging table %s: %w", tmpTable, err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, fmt.Sprintf("INSERT INTO %s VALUES (?);", tmpTable))
	if err != nil {
		return fmt.Errorf("failed to prepare insert into staging table %s: %w", tmpTable, err)
	}
	defer stmt.Close()

	for _, ev := range events {
		if _, err := stmt.ExecContext(ctx, ev.Payload); err != nil {
			return fmt.Errorf("failed staging event into %s: %w", tmpTable, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed committing staged events into %s: %w", tmpTable, err)
	}
	return nil
}

// ExecuteScript executes a multi-statement SQL script statement-by-statement.
func (e *DuckEngine) ExecuteScript(ctx context.Context, sqlScript string) error {
	conn, err := e.Connx(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return e.ExecuteScriptOnConn(ctx, conn, sqlScript)
}

// ExecuteScriptOnConn executes a multi-statement SQL script statement-by-statement on a pinned connection handle.
func (e *DuckEngine) ExecuteScriptOnConn(ctx context.Context, conn *sqlx.Conn, sqlScript string) error {
	statements := strings.Split(sqlScript, ";")
	for _, stmt := range statements {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := conn.ExecContext(ctx, stmt+";"); err != nil {
			return fmt.Errorf("duckdb in-process execution error on [%s]: %w", stmt, err)
		}
	}
	return nil
}

// ReclaimMemory triggers memory compaction and checkpointing to free pages back to the OS.
func (e *DuckEngine) ReclaimMemory(ctx context.Context) error {
	conn, err := e.Connx(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	return e.ExecuteScriptOnConn(ctx, conn, "PRAGMA shrink_memory; CHECKPOINT;\n")
}

// Connx returns a pinned connection handle from the single-connection pool.
// Because SetMaxOpenConns(1) is configured, this provides native FIFO serialization.
func (e *DuckEngine) Connx(ctx context.Context) (*sqlx.Conn, error) {
	return e.db.Connx(ctx)
}

// DB returns the underlying *sqlx.DB handle.
func (e *DuckEngine) DB() *sqlx.DB {
	return e.db
}

// S3OCC returns the underlying S3 OCC client if initialized.
func (e *DuckEngine) S3OCC() *S3OCCClient {
	return e.s3OCC
}

// Lock is deprecated and retained for backwards compatibility; DuckDB concurrency is managed natively by SetMaxOpenConns(1).
func (e *DuckEngine) Lock() {}

// Unlock is deprecated and retained for backwards compatibility; DuckDB concurrency is managed natively by SetMaxOpenConns(1).
func (e *DuckEngine) Unlock() {}

// PingProbe executes a lightweight health probe query using an independent probeDB handle.
// This ensures that /readyz and /healthz checks respond instantaneously even while
// heavy background micro-batch flushes or Iceberg Parquet sorting are underway,
// completely bypassing the primary single-connection pool queue.
func (e *DuckEngine) PingProbe(ctx context.Context) error {
	var one int
	if e.probeDB != nil {
		return e.probeDB.QueryRowContext(ctx, "SELECT 1").Scan(&one)
	}
	return e.db.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}

// Close closes the DuckDB connection pool and dedicated probe handle.
func (e *DuckEngine) Close() error {
	if e.probeDB != nil {
		_ = e.probeDB.Close()
	}
	return e.db.Close()
}

// ExtractInsertParts parses a plugin's transform SQL into its pre-insert statements, header, and body.
// Deprecated: DataSource plugins now provide TransformSelect(rawTable) string directly.
func ExtractInsertParts(transformSQL string) (preStatements string, insertHeader string, bodyQuery string) {
	upper := strings.ToUpper(transformSQL)
	insertIdx := strings.LastIndex(upper, "INSERT INTO")
	if insertIdx == -1 {
		return "", "", strings.TrimRight(strings.TrimSpace(transformSQL), ";")
	}

	preStatements = strings.TrimSpace(transformSQL[:insertIdx])
	postInsert := transformSQL[insertIdx:]

	parenIdx := strings.Index(postInsert, ")")
	if parenIdx != -1 {
		insertHeader = strings.TrimSpace(postInsert[:parenIdx+1])
		bodyQuery = strings.TrimRight(strings.TrimSpace(postInsert[parenIdx+1:]), ";")
	} else {
		selectIdx := strings.Index(strings.ToUpper(postInsert), "SELECT")
		if selectIdx != -1 {
			insertHeader = strings.TrimSpace(postInsert[:selectIdx])
			bodyQuery = strings.TrimRight(strings.TrimSpace(postInsert[selectIdx:]), ";")
		} else {
			insertHeader = postInsert
			bodyQuery = ""
		}
	}
	return preStatements, insertHeader, bodyQuery
}
