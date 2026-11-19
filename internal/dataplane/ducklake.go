package dataplane

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"github.com/prequel-co/straphangerdb/pkg/schema"
)

const ducklakeRemoteCatalogKey = "ducklake/catalog.db"

func (e *DuckEngine) buildDucklakeHeader() string {
	bucket := e.cfg.R2BucketName
	if bucket == "" {
		bucket = "straphanger-db-dev"
	}
	r2Key := os.Getenv("R2_ACCESS_KEY_ID")
	r2Secret := os.Getenv("R2_SECRET_ACCESS_KEY")
	accountID := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	s3Endpoint := e.cfg.S3Endpoint
	if s3Endpoint == "" && accountID != "" {
		s3Endpoint = fmt.Sprintf("%s.r2.cloudflarestorage.com", accountID)
	}
	s3Endpoint = strings.TrimPrefix(strings.TrimPrefix(s3Endpoint, "https://"), "http://")
	dataPath := fmt.Sprintf("s3://%s/ducklake/data/", bucket)
	if customDataPath := os.Getenv("DUCKLAKE_DATA_PATH"); customDataPath != "" {
		dataPath = customDataPath
	}

	var sb strings.Builder
	if r2Key != "" && r2Secret != "" {
		sb.WriteString(fmt.Sprintf(`CREATE SECRET IF NOT EXISTS r2_s3_secret (
    TYPE S3,
    KEY_ID '%s',
    SECRET '%s',
    ENDPOINT '%s',
    URL_STYLE 'path'
);
`, r2Key, r2Secret, s3Endpoint))
	}
	sb.WriteString(fmt.Sprintf(`ATTACH IF NOT EXISTS 'ducklake:%s' AS ducklake (
    DATA_PATH '%s'
);
`, e.ducklakeCatalogPath, dataPath))

	return sb.String()
}

// AttachDucklakeCatalog ensures S3 secrets are registered, downloads the remote catalog if present, and attaches DuckLake.
func (e *DuckEngine) AttachDucklakeCatalog(ctx context.Context) error {
	var err error
	e.ducklakeOnce.Do(func() {
		conn, cErr := e.Connx(ctx)
		if cErr != nil {
			err = cErr
			return
		}
		defer conn.Close()
		err = e.attachDucklakeCatalogLocked(ctx, conn)
	})
	if err != nil {
		e.ducklakeOnce = sync.Once{}
	}
	return err
}

func (e *DuckEngine) attachDucklakeCatalogLocked(ctx context.Context, conn *sqlx.Conn) error {
	if e.ducklakeAttached {
		return nil
	}

	bucket := e.cfg.R2BucketName
	if bucket == "" {
		bucket = "straphanger-db-dev"
	}

	// 1. Startup Resumption: Download remote catalog.db from R2 if present
	if e.s3OCC != nil && e.ducklakeETag == "" {
		_ = os.Remove(e.ducklakeCatalogPath + ".wal")
		etag, exists, err := e.s3OCC.DownloadCatalog(ctx, ducklakeRemoteCatalogKey, e.ducklakeCatalogPath)
		if err != nil {
			e.logger.Warn("ducklake startup resumption check note", "error", err)
		} else if exists {
			e.ducklakeETag = etag
			e.restoreLocalDataPath(ctx, conn)
			e.logger.Info("resumed ducklake state from R2 catalog", "etag", etag, "path", e.ducklakeCatalogPath)
		} else {
			e.logger.Info("no existing remote ducklake catalog found; starting fresh", "bucket", bucket)
		}
	}

	// 2. Attach DuckLake & Bootstrap tables on the already-pinned connection (avoiding SetMaxOpenConns(1) re-entrancy deadlock)
	var sb strings.Builder
	sb.WriteString(e.buildDucklakeHeader())
	// Drop deprecated historical schemas to prevent CHECKPOINT failures on unreferenced historical files
	sb.WriteString("DROP SCHEMA IF EXISTS ducklake.transit_v1 CASCADE;\n")
	sb.WriteString("DROP SCHEMA IF EXISTS ducklake.straphanger_db CASCADE;\n")
	for _, ddl := range schema.GetBootstrapDDLWithCatalog("ducklake", schema.CurrentSchemaVersion) {
		sb.WriteString(ddl)
		sb.WriteString("\n")
	}
	if err := e.ExecuteScriptOnConn(ctx, conn, sb.String()); err != nil {
		if strings.Contains(err.Error(), "ducklake") && (strings.Contains(err.Error(), "Extension") || strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "Unrecognized")) {
			e.ducklakeDisabled = true
			e.logger.Warn("ducklake extension not present in DuckDB runtime, disabling ducklake format writes")
			return nil
		}
		e.logger.Warn("failed attaching ducklake catalog, attempting fresh recreation", "path", e.ducklakeCatalogPath, "error", err)
		_ = os.Remove(e.ducklakeCatalogPath)
		_ = os.Remove(e.ducklakeCatalogPath + ".wal")
		if retryErr := e.ExecuteScriptOnConn(ctx, conn, sb.String()); retryErr != nil {
			if strings.Contains(retryErr.Error(), "ducklake") && (strings.Contains(retryErr.Error(), "Extension") || strings.Contains(retryErr.Error(), "not found") || strings.Contains(retryErr.Error(), "Unrecognized")) {
				e.ducklakeDisabled = true
				e.logger.Warn("ducklake extension not present in DuckDB runtime, disabling ducklake format writes")
				return nil
			}
			e.logger.Error("failed recreating ducklake catalog", "error", retryErr)
			return retryErr
		}
	}

	// 2b. Configure 64MB target_file_size and idempotent event_date partitioning on fact tables
	e.ensureDimStationsSchemaOnConn(ctx, conn, "ducklake", schema.CurrentSchemaVersion)
	e.ensureDucklakePartitioningAndOptionsOnConn(ctx, conn, "ducklake")

	// Gracefully attempt checkpoint; do not hard-fail cold boot if unreferenced legacy files return 404
	if cpErr := e.ExecuteScriptOnConn(ctx, conn, "CHECKPOINT ducklake;\n"); cpErr != nil {
		e.logger.Warn("ducklake startup checkpoint notice (unreferenced historical files skipped)", "error", cpErr)
	}
	if cpErr := e.ExecuteScriptOnConn(ctx, conn, "CHECKPOINT __ducklake_metadata_ducklake;\n"); cpErr != nil {
		e.logger.Warn("ducklake metadata checkpoint notice", "error", cpErr)
	}

	// 3. Sync catalog.db to R2 with bootstrapped schemas
	if e.s3OCC != nil {
		e.syncDucklakeCatalogOCC(ctx, conn, "bootstrap")
	}

	e.ducklakeAttached = true
	e.logger.Info("successfully attached and initialized ducklake catalog in-process", "catalog_path", e.ducklakeCatalogPath)
	return nil
}

// ensureDucklakePartitioningAndOptionsOnConn configures a 64MB target_file_size and ensures
// all DuckLake fact_* tables are partitioned by event_date so compaction is strictly bounded
// within daily partitions and never re-downloads historical files.
func (e *DuckEngine) ensureDucklakePartitioningAndOptionsOnConn(ctx context.Context, conn *sqlx.Conn, catalogName string) {
	if catalogName == "" {
		catalogName = "ducklake"
	}
	targetSize := "64MB"
	if e.cfg.MaxParquetFileSize != "" && e.cfg.MaxParquetFileSize != "256MB" {
		targetSize = e.cfg.MaxParquetFileSize
	}
	optSQL := fmt.Sprintf("CALL %s.set_option('target_file_size', '%s');", catalogName, targetSize)
	if _, err := conn.ExecContext(ctx, optSQL); err != nil {
		e.logger.Debug("ducklake target_file_size option note", "error", err)
	}

	factTables := []string{
		"fact_vehicle_positions",
		"fact_micromobility_status",
		"fact_alerts",
		"fact_schedules",
		"fact_turnstile_counts",
		"fact_ridership",
	}
	metaCatalog := fmt.Sprintf("__ducklake_metadata_%s", catalogName)
	for _, tbl := range factTables {
		var partCount int
		checkQuery := fmt.Sprintf(`
			SELECT COUNT(*)
			FROM %s.ducklake_partition_info pi
			JOIN %s.ducklake_table t ON pi.table_id = t.table_id
			WHERE t.table_name = '%s'
			  AND pi.end_snapshot IS NULL;
		`, metaCatalog, metaCatalog, tbl)
		if err := conn.QueryRowContext(ctx, checkQuery).Scan(&partCount); err == nil && partCount > 0 {
			continue
		}
		partSQL := fmt.Sprintf("ALTER TABLE %s.%s.%s SET PARTITIONED BY (event_date);", catalogName, schema.CurrentSchemaVersion, tbl)
		if _, err := conn.ExecContext(ctx, partSQL); err != nil {
			e.logger.Debug("ducklake partition configuration note", "table", tbl, "error", err)
		} else {
			e.logger.Info("configured ducklake event_date partitioning", "table", tbl)
		}
	}
}

// reloadDucklakeCatalogOnConn safely detaches the active DuckLake catalog on the pinned connection,
// downloads the latest remote catalog file from S3/R2, and re-attaches it so DuckDB does not
// continue reading/writing an unlinked POSIX inode after an atomic os.Rename overwrite.
func (e *DuckEngine) reloadDucklakeCatalogOnConn(ctx context.Context, conn *sqlx.Conn) error {
	_ = e.ExecuteScriptOnConn(ctx, conn, "DETACH DATABASE IF EXISTS ducklake;\n")
	e.ducklakeAttached = false
	_ = os.Remove(e.ducklakeCatalogPath + ".wal")

	if e.s3OCC != nil {
		if rETag, exists, rErr := e.s3OCC.DownloadCatalog(ctx, ducklakeRemoteCatalogKey, e.ducklakeCatalogPath); rErr != nil {
			return fmt.Errorf("failed downloading ducklake catalog during OCC reload: %w", rErr)
		} else if exists {
			e.ducklakeETag = rETag
			e.restoreLocalDataPath(ctx, conn)
		}
	}

	if err := e.ExecuteScriptOnConn(ctx, conn, e.buildDucklakeHeader()); err != nil {
		return fmt.Errorf("failed re-attaching ducklake catalog after OCC reload: %w", err)
	}
	e.ducklakeAttached = true
	return nil
}

// WriteDucklakeBatch processes micro-batch events and commits them via DuckLake in-process.
// Catalog OCC upload to R2 runs at the beginning and end of each maintenance cycle.
func (e *DuckEngine) WriteDucklakeBatch(ctx context.Context, ds plugin.DataSource, events []control.StreamEvent) error {
	if len(events) == 0 || e.ducklakeDisabled {
		return nil
	}

	start := time.Now()
	e.logger.Info("writing ducklake micro-batch in-process", "plugin", ds.ID(), "count", len(events))

	// Acquire pinned connection handle from single-connection pool (FIFO queue)
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed acquiring duckdb connection for ducklake batch: %w", err)
	}
	defer conn.Close()

	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := e.executeDucklakeWrite(ctx, conn, ds, events)
		if err == nil {
			if e.s3OCC != nil {
				e.syncDucklakeCatalogOCC(ctx, conn, "batch_"+ds.ID())
			}
			e.logger.Info("successfully committed ducklake batch in-process", "plugin", ds.ID(), "attempts", attempt, "duration", time.Since(start))
			return nil
		}

		e.logger.Warn("ducklake write attempt failed", "plugin", ds.ID(), "attempt", attempt, "error", err)
		time.Sleep(time.Duration(attempt*100) * time.Millisecond)
	}

	return fmt.Errorf("failed ducklake write after %d retries", maxRetries)
}

func isStatefulUpsertTable(targetTable string) bool {
	switch targetTable {
	case "dim_stations", "dim_routes", "dim_micromobility_stations", "dim_boroughs", "dim_service_lines", "fact_alerts",
		"fact_vehicle_positions", "fact_micromobility_status", "fact_turnstile_counts", "fact_schedules", "fact_ridership":
		return true
	default:
		return false
	}
}

func (e *DuckEngine) executeDucklakeWrite(ctx context.Context, conn *sqlx.Conn, ds plugin.DataSource, events []control.StreamEvent) error {
	if !e.ducklakeAttached {
		if err := e.attachDucklakeCatalogLocked(ctx, conn); err != nil {
			return fmt.Errorf("ducklake catalog attach error: %w", err)
		}
	}

	ts := time.Now().UnixNano()
	tmpTable := fmt.Sprintf("tmp_staging_ducklake_%s_%d", ds.ID(), ts)
	if err := e.StageEventsOnConn(ctx, conn, tmpTable, events); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTable))

	selectQuery := ds.TransformSelect(tmpTable)
	targetTable := ds.TargetTable()
	if isStatefulUpsertTable(targetTable) {
		tmpTransformed := fmt.Sprintf("tmp_transformed_ducklake_%s_%d", ds.ID(), ts)
		defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTransformed))

		createSQL := fmt.Sprintf("CREATE TEMP TABLE %s AS SELECT * FROM (%s)%s%s;\n",
			tmpTransformed, selectQuery, e.getTelemetryWindowFilterClause(targetTable), getParquetSortClause(targetTable))
		if err := e.ExecuteScriptOnConn(ctx, conn, createSQL); err != nil {
			return fmt.Errorf("failed creating transformed table for ducklake upsert: %w", err)
		}

		minTimeVal, minDate, maxDate := e.extractBatchBoundsOnConn(ctx, conn, targetTable, tmpTransformed)
		if (targetTable == "fact_vehicle_positions" || targetTable == "fact_micromobility_status") && minTimeVal == "" {
			e.logger.Info("skipping ducklake commit (all feed events preceded watermark or 10m window)", "plugin", ds.ID(), "table", targetTable)
			return nil
		}
		upsertSQL := buildCatalogUpsertSQL("ducklake", schema.CurrentSchemaVersion, targetTable, tmpTransformed, minTimeVal, minDate, maxDate) + "\nCALL ducklake_flush_inlined_data('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\n"
		return e.ExecuteScriptOnConn(ctx, conn, upsertSQL)
	}

	insertSQL := fmt.Sprintf("INSERT INTO ducklake.%s.%s\n%s;\nCALL ducklake_flush_inlined_data('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\n", schema.CurrentSchemaVersion, targetTable, selectQuery)

	return e.ExecuteScriptOnConn(ctx, conn, insertSQL)
}

// WriteTableBatchDucklake processes micro-batch events from multiple data sources targeting the same table and commits them via DuckLake in 1 transaction in-process.
// Catalog OCC upload to R2 runs at the beginning and end of each maintenance cycle.
func (e *DuckEngine) WriteTableBatchDucklake(ctx context.Context, targetTable string, pluginsMap map[string]plugin.DataSource, events []control.StreamEvent) error {
	if len(events) == 0 || e.ducklakeDisabled {
		return nil
	}

	start := time.Now()
	e.logger.Info("writing centralized table ducklake micro-batch in-process", "table", targetTable, "count", len(events))

	// Acquire pinned connection handle from single-connection pool (FIFO queue)
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed acquiring duckdb connection for table ducklake batch: %w", err)
	}
	defer conn.Close()

	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := e.executeTableDucklakeWrite(ctx, conn, targetTable, pluginsMap, events)
		if err == nil {
			e.logger.Info("successfully committed centralized table ducklake batch in-process", "table", targetTable, "attempts", attempt, "duration", time.Since(start))
			return nil
		}

		e.logger.Warn("ducklake table write attempt failed", "table", targetTable, "attempt", attempt, "error", err)
		time.Sleep(time.Duration(attempt*100) * time.Millisecond)
	}

	return fmt.Errorf("failed ducklake table write after %d retries", maxRetries)
}

func (e *DuckEngine) executeTableDucklakeWrite(ctx context.Context, conn *sqlx.Conn, targetTable string, pluginsMap map[string]plugin.DataSource, events []control.StreamEvent) error {
	if !e.ducklakeAttached {
		if err := e.attachDucklakeCatalogLocked(ctx, conn); err != nil {
			return fmt.Errorf("ducklake catalog attach error: %w", err)
		}
	}

	grouped := make(map[string][]control.StreamEvent)
	for _, ev := range events {
		grouped[ev.Topic] = append(grouped[ev.Topic], ev)
	}

	ts := time.Now().UnixNano()
	var insertHeader string
	var unionQueries []string
	var stagedTables []string

	defer func() {
		for _, tbl := range stagedTables {
			_, _ = conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tbl))
		}
	}()

	for topic, evs := range grouped {
		ds, ok := pluginsMap[topic]
		if !ok {
			for _, p := range pluginsMap {
				if p.ID() == topic {
					ds = p
					break
				}
			}
		}
		if ds == nil {
			continue
		}

		tmpTable := fmt.Sprintf("tmp_staging_ducklake_%s_%d", ds.ID(), ts)
		if err := e.StageEventsOnConn(ctx, conn, tmpTable, evs); err != nil {
			return err
		}
		stagedTables = append(stagedTables, tmpTable)

		selectQuery := ds.TransformSelect(tmpTable)
		if selectQuery != "" {
			if insertHeader == "" {
				insertHeader = fmt.Sprintf("INSERT INTO ducklake.%s.%s", schema.CurrentSchemaVersion, targetTable)
			}
			unionQueries = append(unionQueries, "("+selectQuery+")")
		}
	}

	if len(unionQueries) == 0 || insertHeader == "" {
		return nil
	}

	if isStatefulUpsertTable(targetTable) {
		tmpTransformed := fmt.Sprintf("tmp_transformed_ducklake_%s_%d", targetTable, ts)
		defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTransformed))

		createSQL := fmt.Sprintf("CREATE TEMP TABLE %s AS SELECT * FROM (%s)%s%s;\n",
			tmpTransformed, strings.Join(unionQueries, " UNION ALL "), e.getTelemetryWindowFilterClause(targetTable), getParquetSortClause(targetTable))
		if err := e.ExecuteScriptOnConn(ctx, conn, createSQL); err != nil {
			return fmt.Errorf("failed creating transformed table for ducklake table upsert: %w", err)
		}

		minTimeVal, minDate, maxDate := e.extractBatchBoundsOnConn(ctx, conn, targetTable, tmpTransformed)
		if (targetTable == "fact_vehicle_positions" || targetTable == "fact_micromobility_status") && minTimeVal == "" {
			e.logger.Info("skipping centralized ducklake table commit (all feed events preceded watermark or 10m window)", "table", targetTable, "events_count", len(events))
			return nil
		}
		upsertSQL := buildCatalogUpsertSQL("ducklake", schema.CurrentSchemaVersion, targetTable, tmpTransformed, minTimeVal, minDate, maxDate) + "\nCALL ducklake_flush_inlined_data('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\n"
		return e.ExecuteScriptOnConn(ctx, conn, upsertSQL)
	}

	var sb strings.Builder
	sb.WriteString(insertHeader)
	sb.WriteString("\n")
	sb.WriteString(strings.Join(unionQueries, "\nUNION ALL\n"))
	sb.WriteString(";\n")
	sb.WriteString("CALL ducklake_flush_inlined_data('ducklake');\n")
	sb.WriteString("CHECKPOINT __ducklake_metadata_ducklake;\n")

	return e.ExecuteScriptOnConn(ctx, conn, sb.String())
}

// prepareUploadCatalog creates a temporary copy of the catalog, updates data_path to the public CDN URL if configured, and returns the path.
func (e *DuckEngine) prepareUploadCatalog(ctx context.Context, conn *sqlx.Conn) (string, func(), error) {
	if e.cfg.PublicCDNURL == "" {
		return e.ducklakeCatalogPath, func() {}, nil
	}

	uploadPath := e.ducklakeCatalogPath + ".upload"
	_ = os.Remove(uploadPath)
	_ = os.Remove(uploadPath + ".wal")

	srcBytes, err := os.ReadFile(e.ducklakeCatalogPath)
	if err != nil {
		return "", nil, fmt.Errorf("failed reading catalog for upload prep: %w", err)
	}
	if err := os.WriteFile(uploadPath, srcBytes, 0644); err != nil {
		return "", nil, fmt.Errorf("failed writing upload catalog prep: %w", err)
	}

	cleanup := func() {
		_ = os.Remove(uploadPath)
		_ = os.Remove(uploadPath + ".wal")
	}

	cdnDataPath := strings.TrimRight(e.cfg.PublicCDNURL, "/") + "/ducklake/data/"
	prepSQL := fmt.Sprintf(`
		ATTACH '%s' AS upload_cat;
		UPDATE upload_cat.ducklake_metadata SET value = '%s' WHERE key = 'data_path';
		CHECKPOINT upload_cat;
		DETACH upload_cat;
	`, uploadPath, cdnDataPath)

	if err := e.ExecuteScriptOnConn(ctx, conn, prepSQL); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("failed rewriting data_path in upload catalog: %w", err)
	}

	return uploadPath, cleanup, nil
}

// restoreLocalDataPath ensures the local catalog uses s3://<bucket>/ducklake/data/ so in-container writes succeed.
func (e *DuckEngine) restoreLocalDataPath(ctx context.Context, conn *sqlx.Conn) {
	bucket := e.cfg.R2BucketName
	if bucket == "" {
		bucket = "straphanger-db-prod"
	}
	localDataPath := fmt.Sprintf("s3://%s/ducklake/data/", bucket)
	restoreSQL := fmt.Sprintf(`
		ATTACH '%s' AS local_restore_cat;
		UPDATE local_restore_cat.ducklake_metadata SET value = '%s' WHERE key = 'data_path';
		CHECKPOINT local_restore_cat;
		DETACH local_restore_cat;
	`, e.ducklakeCatalogPath, localDataPath)

	_ = e.ExecuteScriptOnConn(ctx, conn, restoreSQL)
}

// syncDucklakeCatalogOCC uploads the local DuckLake catalog SQLite/DuckDB file to R2/S3 using conditional OCC headers,
// rewriting data_path to the public CDN domain if configured.
func (e *DuckEngine) syncDucklakeCatalogOCC(ctx context.Context, conn *sqlx.Conn, phase string) {
	if e.s3OCC == nil {
		return
	}

	uploadFile := e.ducklakeCatalogPath
	cleanup := func() {}
	if conn != nil && e.cfg.PublicCDNURL != "" {
		if prepPath, prepCleanup, prepErr := e.prepareUploadCatalog(ctx, conn); prepErr == nil {
			uploadFile = prepPath
			cleanup = prepCleanup
		} else {
			e.logger.Warn("ducklake public CDN catalog preparation warning", "phase", phase, "error", prepErr)
		}
	}
	defer cleanup()

	newETag, occErr := e.s3OCC.UploadCatalogOCC(ctx, ducklakeRemoteCatalogKey, uploadFile, e.ducklakeETag)
	if errors.Is(occErr, ErrOCCConflict) {
		e.logger.Warn("ducklake OCC conflict on catalog upload, refreshing remote ETag and retrying", "phase", phase)
		if remoteETag, headErr := e.s3OCC.CheckRemoteETag(ctx, ducklakeRemoteCatalogKey); headErr == nil && remoteETag != "" {
			e.ducklakeETag = remoteETag
			if retryETag, retryErr := e.s3OCC.UploadCatalogOCC(ctx, ducklakeRemoteCatalogKey, uploadFile, e.ducklakeETag); retryErr == nil {
				e.ducklakeETag = retryETag
				e.logger.Info("synced ducklake catalog.db to R2 after ETag refresh", "phase", phase, "etag", retryETag)
			}
		}
	} else if occErr != nil {
		e.logger.Warn("ducklake OCC catalog upload warning", "phase", phase, "error", occErr)
	} else {
		e.ducklakeETag = newETag
		e.logger.Info("synced ducklake catalog.db to R2", "phase", phase, "etag", newETag)
	}
}

// withDucklakeConn borrows the single-pool DuckDB connection for a bounded maintenance step and releases it immediately,
// allowing real-time stream flushers to interleave between maintenance steps.
func (e *DuckEngine) withDucklakeConn(ctx context.Context, fn func(conn *sqlx.Conn) error) error {
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed acquiring duckdb connection for maintenance: %w", err)
	}
	defer conn.Close()

	if !e.ducklakeAttached {
		if err := e.attachDucklakeCatalogLocked(ctx, conn); err != nil {
			return fmt.Errorf("ducklake catalog attach error during maintenance: %w", err)
		}
	}
	return fn(conn)
}

// RunDucklakeMaintenance executes bounded DuckLake maintenance routines in-process,
// acquiring and releasing the DuckDB connection per step/table so real-time flushers are never starved.
func (e *DuckEngine) RunDucklakeMaintenance(ctx context.Context) error {
	if e.ducklakeDisabled {
		return nil
	}

	start := time.Now()
	e.logger.Info("starting scheduled ducklake maintenance workflow in-process...")

	maintCtx, maintCancel := context.WithTimeout(ctx, 14*time.Minute)
	defer maintCancel()

	// 0. Pre-maintenance setup, snapshot expiration, and expired file cleanup
	err := e.withDucklakeConn(maintCtx, func(conn *sqlx.Conn) error {
		e.ensureDucklakePartitioningAndOptionsOnConn(maintCtx, conn, "ducklake")
		_ = e.ExecuteScriptOnConn(maintCtx, conn, "CALL ducklake_flush_inlined_data('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\n")
		e.syncDucklakeCatalogOCC(maintCtx, conn, "pre-maintenance")

		// 1. Expire snapshots older than 7 days
		expireSQL := e.buildDucklakeHeader() + "CALL ducklake_expire_snapshots('ducklake', older_than => now() - INTERVAL '7 days');\nCHECKPOINT __ducklake_metadata_ducklake;\n"
		if err := e.ExecuteScriptOnConn(maintCtx, conn, expireSQL); err != nil {
			e.logger.Warn("ducklake snapshot expiration warning", "error", err)
		} else {
			e.logger.Info("ducklake expired snapshots older than 7 days")
		}

		// 2. Physically purge expired files from R2 (safe snapshot-tracked cleanup; avoids cleanup_all orphan sweep race)
		cleanupSQL := e.buildDucklakeHeader() + "CALL ducklake_cleanup_old_files('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\n"
		if err := e.ExecuteScriptOnConn(maintCtx, conn, cleanupSQL); err != nil {
			e.logger.Warn("ducklake cleanup old files warning", "error", err)
		} else {
			e.logger.Info("ducklake physically cleaned up unreferenced data files from R2")
		}
		e.syncDucklakeCatalogOCC(maintCtx, conn, "snapshot-cleanup")
		return nil
	})
	if err != nil {
		return err
	}

	// 3. Per-table bounded merge (last 1 day, <50MB files, max 64MB output, max 50 files/run) and delete-file rewrite.
	// Connection is acquired and released per table so real-time flushers can interleave.
	tables := []string{
		"dim_stations",
		"dim_routes",
		"dim_micromobility_stations",
		"dim_boroughs",
		"dim_service_lines",
		"fact_schedules",
		"fact_vehicle_positions",
		"fact_alerts",
		"fact_ridership",
		"fact_turnstile_counts",
		"fact_micromobility_status",
	}
	for _, t := range tables {
		if maintCtx.Err() != nil {
			e.logger.Warn("ducklake maintenance context deadline reached, stopping table loop to checkpoint completed work", "table", t)
			break
		}

		tbl := t
		_ = e.withDucklakeConn(maintCtx, func(conn *sqlx.Conn) error {
			mutated := false

			// Only run ducklake_merge_adjacent_files if the table has >= 2 active small files (<50MB) created within the last 1 day
			var recentSmallFiles int
			smallCheckQuery := fmt.Sprintf(`
				SELECT COUNT(*)
				FROM __ducklake_metadata_ducklake.ducklake_data_file df
				JOIN __ducklake_metadata_ducklake.ducklake_table tbl ON df.table_id = tbl.table_id
				JOIN __ducklake_metadata_ducklake.ducklake_snapshot s ON df.begin_snapshot = s.snapshot_id
				WHERE tbl.table_name = '%s'
				  AND df.end_snapshot IS NULL
				  AND df.file_size_bytes < 50000000
				  AND s.snapshot_time >= CURRENT_TIMESTAMP - INTERVAL '1 day';
			`, tbl)
			if err := conn.QueryRowContext(maintCtx, smallCheckQuery).Scan(&recentSmallFiles); err != nil {
				recentSmallFiles = 2
			}

			if recentSmallFiles >= 2 {
				mergeSQL := fmt.Sprintf(
					"CALL ducklake_merge_adjacent_files('ducklake', '%s', schema => '%s', max_file_size => 64000000, max_compacted_files => 50);",
					tbl, schema.CurrentSchemaVersion,
				)
				if _, err := conn.ExecContext(maintCtx, mergeSQL); err != nil {
					e.logger.Warn("ducklake merge table note (continuing on missing or uncompactable files)", "table", tbl, "error", err)
				} else {
					_ = e.ExecuteScriptOnConn(maintCtx, conn, "CHECKPOINT __ducklake_metadata_ducklake;\n")
					mutated = true
					e.logger.Info("ducklake merged table data files", "table", tbl, "candidate_small_files_1d", recentSmallFiles)
				}
			}

			// Only run ducklake_rewrite_data_files if the table has > 0 active delete files
			var activeDeleteFiles int
			deleteCheckQuery := fmt.Sprintf(`
				SELECT COUNT(*)
				FROM __ducklake_metadata_ducklake.ducklake_delete_file del
				JOIN __ducklake_metadata_ducklake.ducklake_table tbl ON del.table_id = tbl.table_id
				WHERE tbl.table_name = '%s'
				  AND del.end_snapshot IS NULL;
			`, tbl)
			if err := conn.QueryRowContext(maintCtx, deleteCheckQuery).Scan(&activeDeleteFiles); err != nil {
				activeDeleteFiles = 0
			}

			if activeDeleteFiles > 0 {
				rewriteSQL := fmt.Sprintf("CALL ducklake_rewrite_data_files('ducklake', '%s', schema => '%s');", tbl, schema.CurrentSchemaVersion)
				if _, err := conn.ExecContext(maintCtx, rewriteSQL); err != nil {
					e.logger.Warn("ducklake table rewrite note (continuing on missing or uncompactable files)", "table", tbl, "error", err)
					if tbl == "fact_alerts" {
						e.logger.Info("ducklake applying atomic table compaction fallback", "table", tbl)
						compactSQL := fmt.Sprintf(`
							CREATE TEMP TABLE __compact_%s AS 
							SELECT * FROM ducklake.%s.%s 
							QUALIFY ROW_NUMBER() OVER (
								PARTITION BY agency_id, alert_id 
								ORDER BY (removed_at IS NULL) DESC, last_seen_at DESC NULLS LAST, detected_at DESC NULLS LAST
							) = 1;
							DELETE FROM ducklake.%s.%s;
							INSERT INTO ducklake.%s.%s SELECT * FROM __compact_%s;
							DROP TABLE __compact_%s;
						`, tbl, schema.CurrentSchemaVersion, tbl, schema.CurrentSchemaVersion, tbl, schema.CurrentSchemaVersion, tbl, tbl, tbl)
						if errComp := e.ExecuteScriptOnConn(maintCtx, conn, compactSQL); errComp != nil {
							e.logger.Warn("ducklake atomic table compaction fallback error", "table", tbl, "error", errComp)
						} else {
							_ = e.ExecuteScriptOnConn(maintCtx, conn, "CHECKPOINT __ducklake_metadata_ducklake;\n")
							mutated = true
							e.logger.Info("ducklake atomic table compaction fallback completed successfully", "table", tbl)
						}
					}
				} else {
					_ = e.ExecuteScriptOnConn(maintCtx, conn, "CHECKPOINT __ducklake_metadata_ducklake;\n")
					mutated = true
					e.logger.Info("ducklake rewrote table data files", "table", tbl, "active_delete_files", activeDeleteFiles)
				}
			}

			if mutated {
				e.syncDucklakeCatalogOCC(maintCtx, conn, "table-"+tbl)
			}
			return nil
		})
	}

	// 4. Final checkpoint and OCC upload on an independent context so completed compaction work is always persisted to R2
	syncCtx, syncCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer syncCancel()

	_ = e.withDucklakeConn(syncCtx, func(conn *sqlx.Conn) error {
		if maintCtx.Err() == nil && e.icebergAttached {
			icebergCleanSQL := fmt.Sprintf(`
				UPDATE straphanger.%s.fact_alerts AS target
				SET removed_at = CURRENT_TIMESTAMP
				WHERE target.event_date < CURRENT_DATE
				  AND target.removed_at IS NULL
				  AND EXISTS (
				      SELECT 1 FROM straphanger.%s.fact_alerts d 
				      WHERE d.agency_id = target.agency_id 
				        AND d.alert_id = target.alert_id 
				        AND d.event_date >= CURRENT_DATE
				  );
			`, schema.CurrentSchemaVersion, schema.CurrentSchemaVersion)
			if _, err := conn.ExecContext(syncCtx, icebergCleanSQL); err != nil {
				e.logger.Debug("iceberg fact_alerts cross-day duplicate cleanup notice", "error", err)
			} else {
				e.logger.Info("iceberg fact_alerts cross-day duplicates successfully marked removed")
			}
		}

		_ = e.ExecuteScriptOnConn(syncCtx, conn, "CALL ducklake_flush_inlined_data('ducklake');\nCHECKPOINT __ducklake_metadata_ducklake;\nPRAGMA shrink_memory;\n")
		e.syncDucklakeCatalogOCC(syncCtx, conn, "post-maintenance")
		return nil
	})

	e.logger.Info("ducklake maintenance workflow finished", "duration", time.Since(start))
	return nil
}

// ConfigureDucklakeCatalogOptions configures catalog-level settings like target_file_size and event_date partitioning in DuckLake and persists them to R2.
func (e *DuckEngine) ConfigureDucklakeCatalogOptions(catalogName string) error {
	if e.ducklakeDisabled {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	conn, err := e.Connx(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	if !e.ducklakeAttached {
		if err := e.attachDucklakeCatalogLocked(ctx, conn); err != nil {
			return err
		}
	}
	e.ensureDucklakePartitioningAndOptionsOnConn(ctx, conn, catalogName)
	_ = e.ExecuteScriptOnConn(ctx, conn, "CHECKPOINT __ducklake_metadata_ducklake;\n")
	if e.s3OCC != nil {
		e.syncDucklakeCatalogOCC(ctx, conn, "options-config")
	}
	return nil
}
