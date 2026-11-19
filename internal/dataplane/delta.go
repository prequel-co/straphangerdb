package dataplane

import (
	"context"
	"fmt"
	"time"

	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

// ARCHITECTURAL DIRECTIVE (DELTA UNIFORM SYNC):
// Direct Delta Lake runtime writes via naive Parquet APPEND have been eliminated.
// Parquet files dumped directly into S3 without Delta log entries (_delta_log/*.json)
// create unreadable, corrupt Delta tables that fail delta_scan() and crash Spark/Databricks readers.
//
// TODO(arch): Implement an asynchronous Honker workflow task for pure-Go Delta UniForm metadata sync.
// Workflow Specification:
// 1. Triggered asynchronously after an Iceberg table commit completes (or on a scheduled maintenance interval).
// 2. Reads the committed Iceberg metadata JSON and manifest list from Cloudflare R2 / S3.
// 3. Extracts added/deleted Parquet data file URIs, schema schema-ids, and partition specs.
// 4. Synthesizes a valid Delta transaction log commit (_delta_log/0000000000000000000X.json) pointing
//    to the EXACT SAME underlying Parquet data files without copying, rewriting, or re-encoding bytes.
// 5. Commits the transaction log atomically using S3 conditional PUTs (OCC).
//
// This achieves true Delta UniForm compatibility entirely in pure Go, zero Java/Spark dependency,
// and zero dual-write write amplification on the hot ingestion path.

// WriteDeltaBatch is deprecated. Ingestion writes exclusively to Iceberg; Delta metadata is synchronized asynchronously.
func (e *DuckEngine) WriteDeltaBatch(ctx context.Context, ds plugin.DataSource, events []control.StreamEvent) error {
	e.logger.Warn("direct Delta Lake batch write skipped; Delta UniForm sync will generate Delta transaction logs asynchronously from Iceberg commits",
		"plugin", ds.ID(),
		"events_count", len(events),
	)
	return nil
}

// WriteTableBatchDelta is deprecated. Ingestion writes exclusively to Iceberg; Delta metadata is synchronized asynchronously.
func (e *DuckEngine) WriteTableBatchDelta(ctx context.Context, targetTable string, pluginsMap map[string]plugin.DataSource, events []control.StreamEvent) error {
	e.logger.Warn("direct Delta Lake table batch write skipped; Delta UniForm sync will generate Delta transaction logs asynchronously from Iceberg commits",
		"table", targetTable,
		"events_count", len(events),
	)
	return nil
}

// RunDeltaMaintenance audits and synchronizes Delta UniForm transaction logs across all transit tables.
func (e *DuckEngine) RunDeltaMaintenance(ctx context.Context) error {
	if e.deltaSyncer == nil {
		e.logger.Info("Delta Lake maintenance skipped (Delta UniForm syncer not configured or missing R2 credentials)")
		return nil
	}

	tables := []string{
		"dim_stations", "dim_routes", "dim_micromobility_stations",
		"fact_vehicle_positions", "fact_alerts", "fact_micromobility_status",
		"fact_schedules", "fact_turnstile_counts", "fact_ridership",
	}

	for _, tbl := range tables {
		ver, exists, err := e.deltaSyncer.GetLatestVersion(ctx, tbl)
		if err != nil {
			e.logger.Warn("failed checking delta uniform version", "table", tbl, "error", err)
			continue
		}
		if exists {
			e.logger.Info("audited delta uniform table status", "table", tbl, "latest_version", ver)
			if ver > 0 && ver%10 == 0 {
				_ = e.deltaSyncer.WriteLastCheckpoint(ctx, tbl, ver, 1)
			}
		} else {
			e.logger.Debug("delta uniform table not yet initialized", "table", tbl)
		}

		// Reconcile with Iceberg active files if attached
		if e.icebergAttached {
			if _, err := e.SyncTableFromIceberg(ctx, tbl); err != nil {
				e.logger.Debug("iceberg-to-delta uniform reconciliation note", "table", tbl, "error", err)
			}
		}
	}
	return nil
}

// SyncTableFromIceberg inspects Iceberg committed files for targetTable and commits newly added/removed files to the Delta log.
func (e *DuckEngine) SyncTableFromIceberg(ctx context.Context, targetTable string) (int64, error) {
	if e.deltaSyncer == nil {
		return -1, fmt.Errorf("delta uniform syncer not initialized")
	}

	// 1. Query Iceberg $entries for files added (status = 1) or deleted (status = 2) in the latest snapshot.
	// ARCHITECTURAL NOTE (Connection Pool Safety & Query Performance):
	// Queries against Iceberg metadata views ($entries, $snapshots, $files) inspect cached manifest lists
	// and complete in < 1ms. Under ADR-003, SetMaxOpenConns(1) serializes execution through Go's database/sql
	// connection pool as a fair FIFO queue. Because this read-only metadata inspection executes in sub-millisecond
	// time and does not create connection-scoped temporary tables, executing via e.db.QueryContext borrows and
	// releases the connection immediately upon rows.Close() without risking contention or state collisions.
	incrementalQuery := fmt.Sprintf(`
		SELECT 
			COALESCE(snapshot_id, 0),
			COALESCE(status, 1),
			data_file.file_path, 
			data_file.file_size_in_bytes,
			COALESCE(data_file.record_count, 0)
		FROM straphanger.%s.%s$entries
		WHERE status IN (1, 2)
		  AND snapshot_id = (
		      SELECT snapshot_id 
		      FROM straphanger.%s.%s$snapshots 
		      ORDER BY committed_at DESC 
		      LIMIT 1
		  )`, e.GetIcebergNamespace(), targetTable, e.GetIcebergNamespace(), targetTable)

	rows, err := e.db.QueryContext(ctx, incrementalQuery)
	if err != nil {
		// Fallback for catalog/extension versions that flatten or do not support nested snapshot subqueries
		fallbackQuery := fmt.Sprintf(`
			SELECT 
				COALESCE(snapshot_id, 0),
				COALESCE(status, 1),
				file_path, 
				file_size_in_bytes,
				COALESCE(record_count, 0)
			FROM straphanger.%s.%s$entries
			WHERE status IN (1, 2)
			ORDER BY sequence_number DESC
			LIMIT 100`, e.GetIcebergNamespace(), targetTable)
		rows, err = e.db.QueryContext(ctx, fallbackQuery)
		if err != nil {
			// Final fallback to $files if $entries metadata view is unsupported
			rows, err = e.db.QueryContext(ctx, fmt.Sprintf("SELECT 0 AS snapshot_id, 1 AS status, file_path, file_size_in_bytes, COALESCE(record_count, 0) FROM straphanger.%s.%s$files", e.GetIcebergNamespace(), targetTable))
			if err != nil {
				e.logger.Debug("iceberg metadata views not available, skipping delta uniform sync", "table", targetTable, "error", err)
				return -1, nil
			}
		}
	}

	var snapshotID int64
	var adds []DeltaAddFileAction
	var removes []DeltaRemoveFileAction
	nowMs := time.Now().UnixMilli()
	isFact := isPartitionedFactTable(targetTable)
	for rows.Next() {
		var entrySnapID int64
		var status int
		var filePath string
		var fileSize int64
		var recordCount int64
		if err := rows.Scan(&entrySnapID, &status, &filePath, &fileSize, &recordCount); err == nil && filePath != "" {
			if entrySnapID > 0 && snapshotID == 0 {
				snapshotID = entrySnapID
			}
			if status == 2 {
				removes = append(removes, DeltaRemoveFileAction{
					Path:              filePath,
					DeletionTimestamp: nowMs,
					DataChange:        true,
				})
				continue
			}

			partValues := make(map[string]string)
			partDate := ""
			if isFact {
				partDate = ExtractEventDateFromPath(filePath)
				if partDate == "" {
					partDate = time.Now().UTC().Format("2006-01-02")
				}
				partValues["event_date"] = partDate
			}

			adds = append(adds, DeltaAddFileAction{
				Path:             filePath,
				PartitionValues:  partValues,
				Size:             fileSize,
				ModificationTime: nowMs,
				DataChange:       true,
				Stats:            FormatDeltaStats(recordCount, partDate),
			})
		}
	}
	rows.Close()

	if len(adds) == 0 && len(removes) == 0 {
		return -1, nil
	}
	return e.deltaSyncer.SyncTableChanges(ctx, targetTable, snapshotID, adds, removes)
}
