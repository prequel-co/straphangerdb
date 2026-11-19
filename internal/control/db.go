package control

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/prequel-co/straphangerdb/internal/control/db/sqlc"
)

//go:embed db/schema/001_control.sql
var controlSchemaSQL string

// InitControlDB opens the SQLite database for Honker, applies required WAL & performance PRAGMAs, and initializes the control schema.
func InitControlDB(logger *slog.Logger, dbPath string) (*sqlx.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		if dbPath == "/data/control.db" {
			logger.Warn("unable to create /data directory; falling back to local ./control.db", "error", err)
			dbPath = "control.db"
		} else {
			return nil, fmt.Errorf("failed to create directory for control db: %w", err)
		}
	}

	db, err := sqlx.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&parseTime=true")
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA auto_vacuum = INCREMENTAL;",
	}

	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			logger.Warn("failed to execute PRAGMA", "pragma", p, "error", err)
		}
	}

	// Apply control plane schema migrations
	if _, err := db.Exec(controlSchemaSQL); err != nil {
		return nil, fmt.Errorf("failed to apply control plane schema: %w", err)
	}

	logger.Info("initialized control database", "path", dbPath)
	return db, nil
}

// IsSchemaInitialized checks if bootstrap_tables_task has completed.
func IsSchemaInitialized(db *sqlx.DB) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	q := sqlc.New(db)
	val, err := q.GetMeta(ctx, "schema_initialized")
	return err == nil && val == "1"
}

// SetSchemaInitialized marks bootstrapping as complete in SQLite.
func SetSchemaInitialized(db *sqlx.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	q := sqlc.New(db)
	return q.SetMeta(ctx, sqlc.SetMetaParams{
		Key:   "schema_initialized",
		Value: "1",
	})
}
