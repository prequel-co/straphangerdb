package dataplane

import (
	"context"
	"database/sql"
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

// AttachIcebergRESTCatalog initializes secrets and attaches Cloudflare R2 Data Catalog (or Lakekeeper) in-process via sqlx.DB.
func (e *DuckEngine) AttachIcebergRESTCatalog() error {
	if e.cfg.IcebergCatalogURI == "" && os.Getenv("CLOUDFLARE_API_TOKEN") == "" && os.Getenv("ICEBERG_TOKEN") == "" {
		return nil
	}
	if e.icebergAttached {
		return nil
	}

	var attachErr error
	e.icebergOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		conn, err := e.Connx(ctx)
		if err != nil {
			attachErr = err
			return
		}
		defer conn.Close()

		attachErr = e.attachIcebergCatalogOnConn(ctx, conn)
	})
	if attachErr != nil {
		e.icebergOnce = sync.Once{}
	}
	return attachErr
}

// attachIcebergCatalogOnConn attaches the Iceberg REST catalog and bootstraps its tables on an already-pinned connection,
// preventing re-entrancy deadlocks on the SetMaxOpenConns(1) pool.
func (e *DuckEngine) attachIcebergCatalogOnConn(ctx context.Context, conn *sqlx.Conn) error {
	if e.cfg.IcebergCatalogURI == "" && os.Getenv("CLOUDFLARE_API_TOKEN") == "" && os.Getenv("ICEBERG_TOKEN") == "" {
		return nil
	}
	if e.icebergAttached {
		return nil
	}

	headerSQL := e.buildIcebergHeader()
	if err := e.ExecuteScriptOnConn(ctx, conn, headerSQL); err != nil {
		e.logger.Warn("initial iceberg catalog attach note; flusher will retry", "error", err)
		return err
	}

	for _, ddl := range schema.GetBootstrapDDLWithCatalog("straphanger", e.GetIcebergNamespace()) {
		if _, err := conn.ExecContext(ctx, ddl); err != nil {
			e.logger.Debug("iceberg schema bootstrap note", "ddl", ddl, "error", err)
		}
	}
	e.ensureDimStationsSchemaOnConn(ctx, conn, "straphanger", e.GetIcebergNamespace())

	e.icebergAttached = true
	e.logger.Info("successfully attached iceberg catalog in-process via sqlx")
	return nil
}

// ensureDimStationsSchemaOnConn migrates legacy dim_stations tables lacking the NY Open Data columns (gtfs_stop_id, etc.).
func (e *DuckEngine) ensureDimStationsSchemaOnConn(ctx context.Context, conn *sqlx.Conn, catalog, namespace string) {
	probeSQL := fmt.Sprintf("SELECT gtfs_stop_id FROM %s.%s.dim_stations LIMIT 0;", catalog, namespace)
	if _, err := conn.ExecContext(ctx, probeSQL); err != nil && strings.Contains(err.Error(), "gtfs_stop_id") {
		e.logger.Info("migrating legacy dim_stations table to NY Open Data schema", "catalog", catalog, "namespace", namespace)
		_, _ = conn.ExecContext(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s.%s.dim_stations;", catalog, namespace))
		for _, ddl := range schema.GetBootstrapDDLWithCatalog(catalog, namespace) {
			if strings.Contains(ddl, "dim_stations") {
				if _, createErr := conn.ExecContext(ctx, ddl); createErr != nil {
					e.logger.Warn("failed recreating dim_stations with updated schema", "catalog", catalog, "error", createErr)
				}
			}
		}
	}
}

// buildIcebergHeader generates the SQL script required to configure R2 S3 secrets and attach the Iceberg REST catalog.
func (e *DuckEngine) buildIcebergHeader() string {
	r2Key := os.Getenv("R2_ACCESS_KEY_ID")
	r2Secret := os.Getenv("R2_SECRET_ACCESS_KEY")
	cfToken := os.Getenv("CLOUDFLARE_API_TOKEN")
	if cfToken == "" {
		cfToken = os.Getenv("ICEBERG_TOKEN")
	}
	accountID := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	bucket := e.cfg.R2BucketName
	if bucket == "" {
		bucket = "straphanger-db-dev"
	}
	s3Endpoint := e.cfg.S3Endpoint
	if s3Endpoint == "" {
		s3Endpoint = fmt.Sprintf("%s.r2.cloudflarestorage.com", accountID)
	}
	s3Endpoint = strings.TrimPrefix(strings.TrimPrefix(s3Endpoint, "https://"), "http://")
	catalogURI := e.cfg.IcebergCatalogURI
	if catalogURI == "" {
		catalogURI = fmt.Sprintf("https://catalog.cloudflarestorage.com/%s/%s", accountID, bucket)
	}
	warehouseName := os.Getenv("ICEBERG_WAREHOUSE")
	if warehouseName == "" {
		if accountID != "" {
			warehouseName = fmt.Sprintf("%s_%s", accountID, bucket)
		} else {
			warehouseName = bucket
		}
	}

	var sb strings.Builder
	sb.WriteString("SET http_keep_alive = true;\n")
	sb.WriteString("SET http_timeout = 60000;\n")
	sb.WriteString("SET http_retries = 5;\n")
	sb.WriteString("SET http_retry_backoff = 1.5;\n")
	sb.WriteString("SET http_retry_wait_ms = 500;\n")

	sb.WriteString(fmt.Sprintf(`
CREATE SECRET IF NOT EXISTS r2_s3_secret (
    TYPE S3,
    KEY_ID '%s',
    SECRET '%s',
    ENDPOINT '%s',
    URL_STYLE 'path'
);
`, r2Key, r2Secret, s3Endpoint))

	if cfToken != "" {
		sb.WriteString(fmt.Sprintf(`
CREATE SECRET IF NOT EXISTS r2_iceberg_secret (
    TYPE ICEBERG,
    TOKEN '%s'
);
ATTACH IF NOT EXISTS '%s' AS straphanger (
    TYPE ICEBERG,
    ENDPOINT '%s',
    SECRET r2_iceberg_secret
);
`, cfToken, warehouseName, catalogURI))
	} else {
		sb.WriteString(fmt.Sprintf(`
ATTACH IF NOT EXISTS '%s' AS straphanger (
    TYPE ICEBERG,
    ENDPOINT '%s'
);
`, warehouseName, catalogURI))
	}

	return sb.String()
}

// extractMinBatchTimestamp computes the minimum timestamp in the staged microbatch in Go.
func (e *DuckEngine) extractMinBatchTimestamp(ctx context.Context, targetTable, tmpTable string) string {
	return e.extractMinBatchTimestampOnConn(ctx, nil, targetTable, tmpTable)
}

// extractMinBatchTimestampOnConn computes the minimum timestamp on a pinned connection handle.
// For high-frequency telemetry tables (fact_vehicle_positions, fact_micromobility_status), the
// lookback floor is clamped to at most 10 minutes so stale feed entries never widen the scan window.
func (e *DuckEngine) extractMinBatchTimestampOnConn(ctx context.Context, conn *sqlx.Conn, targetTable, tmpTable string) string {
	var query string
	switch targetTable {
	case "fact_vehicle_positions", "fact_micromobility_status":
		query = fmt.Sprintf(
			"SELECT CASE WHEN MIN(event_time) IS NULL THEN NULL ELSE GREATEST(MIN(event_time), CURRENT_TIMESTAMP - INTERVAL '10 minutes') END::VARCHAR FROM %s WHERE event_time IS NOT NULL;",
			tmpTable,
		)
	case "fact_alerts":
		query = fmt.Sprintf("SELECT MIN(last_seen_at)::VARCHAR FROM %s WHERE last_seen_at IS NOT NULL;", tmpTable)
	case "fact_turnstile_counts":
		query = fmt.Sprintf("SELECT MIN(reading_time)::VARCHAR FROM %s WHERE reading_time IS NOT NULL;", tmpTable)
	default:
		return ""
	}

	var val sql.NullString
	var err error
	if conn != nil {
		err = conn.QueryRowContext(ctx, query).Scan(&val)
	} else {
		err = e.db.QueryRowContext(ctx, query).Scan(&val)
	}
	if err == nil && val.Valid && val.String != "" {
		return val.String
	}
	return ""
}

// extractBatchBounds computes minTimeVal, minDate, and maxDate in the staged microbatch in Go.
func (e *DuckEngine) extractBatchBounds(ctx context.Context, targetTable, tmpTable string) (minTimeVal, minDate, maxDate string) {
	return e.extractBatchBoundsOnConn(ctx, nil, targetTable, tmpTable)
}

// extractBatchBoundsOnConn computes minTimeVal, minDate, and maxDate on a pinned connection handle.
func (e *DuckEngine) extractBatchBoundsOnConn(ctx context.Context, conn *sqlx.Conn, targetTable, tmpTable string) (minTimeVal, minDate, maxDate string) {
	minTimeVal = e.extractMinBatchTimestampOnConn(ctx, conn, targetTable, tmpTable)

	var minD, maxD sql.NullString
	var query string
	switch targetTable {
	case "fact_vehicle_positions", "fact_micromobility_status":
		query = fmt.Sprintf(
			"SELECT CASE WHEN MIN(event_date) IS NULL THEN NULL ELSE GREATEST(MIN(event_date), (CURRENT_TIMESTAMP - INTERVAL '10 minutes')::DATE) END::VARCHAR, MAX(event_date)::VARCHAR FROM %s WHERE event_date IS NOT NULL;",
			tmpTable,
		)
	default:
		query = fmt.Sprintf("SELECT MIN(event_date)::VARCHAR, MAX(event_date)::VARCHAR FROM %s WHERE event_date IS NOT NULL;", tmpTable)
	}
	var err error
	if conn != nil {
		err = conn.QueryRowContext(ctx, query).Scan(&minD, &maxD)
	} else {
		err = e.db.QueryRowContext(ctx, query).Scan(&minD, &maxD)
	}
	if err == nil {
		if minD.Valid && minD.String != "" {
			minDate = minD.String
		}
		if maxD.Valid && maxD.String != "" {
			maxDate = maxD.String
		}
	}
	return minTimeVal, minDate, maxDate
}

// GetIcebergNamespace returns the target Iceberg schema/namespace, defaulting to transit_v2.
func (e *DuckEngine) GetIcebergNamespace() string {
	if ns := os.Getenv("ICEBERG_NAMESPACE"); ns != "" {
		return ns
	}
	return "transit_v2"
}

// ARCHITECTURAL DIRECTIVE (BOUNDED-WINDOW MERGE PRUNING):
// Why StraphangerDB uses MERGE INTO instead of INSERT INTO on Iceberg fact tables:
// 1. Idempotency on Flusher Retries: Transient network blips or R2 REST catalog conflicts
//    can trigger micro-batch retries. MERGE INTO guarantees that duplicate vehicle positions
//    or alert records are never inserted twice, maintaining exact data integrity.
//
// 2. Zero-Growth Partition Scans (Bounded-Window Row-Group Pruning):
//    Standard lakehouse MERGE statements on daily partitions suffer from quadratic scan growth
//    as partitions accumulate data throughout the day. StraphangerDB prevents this by coupling
//    two synergistic mechanisms:
//      a. Linear Parquet Sorting (getParquetSortClause): Data is staged and written
//         ORDER BY agency_id, route_id, event_time. This guarantees that Parquet file and
//         row-group headers contain tight, non-overlapping min/max statistics for event_time.
//      b. Dynamic Batch Bounds (extractBatchBoundsOnConn): We extract minTimeVal (the minimum
//         timestamp in the incoming micro-batch) and inject `AND target.event_time >= minTimeVal::TIMESTAMPTZ`.
//    DuckDB's Iceberg reader pushes down this timestamp filter into Parquet metadata, skipping
//    all historical row groups where max(event_time) < minTimeVal. The merge scan is strictly
//    bounded to the active ~2-minute window. As daily partitions grow from 10MB to 500MB, merge
//    latency remains flat.
//
// buildIcebergUpsertSQL builds the MERGE INTO statement for Iceberg tables with partition and header pruning.
func buildIcebergUpsertSQL(namespace, targetTable, sourceParquet, minTimeVal string, dateBounds ...string) string {
	return buildCatalogUpsertSQL("straphanger", namespace, targetTable, sourceParquet, minTimeVal, dateBounds...)
}

// buildCatalogUpsertSQL builds the catalog-qualified MERGE INTO / SCD Type II statement for either Iceberg ("straphanger") or DuckLake ("ducklake").
func buildCatalogUpsertSQL(catalogName, namespace, targetTable, sourceParquet, minTimeVal string, dateBounds ...string) string {
	if catalogName == "" {
		catalogName = "straphanger"
	}
	if namespace == "" {
		namespace = "transit_v2"
	}
	var minDate, maxDate string
	if len(dateBounds) >= 2 {
		minDate = dateBounds[0]
		maxDate = dateBounds[1]
	}

	getPartitionFilter := func(defaultDays int) string {
		if minDate != "" && maxDate != "" {
			if defaultDays > 1 {
				return fmt.Sprintf("target.event_date >= ('%s'::DATE - INTERVAL %d DAY) AND target.event_date <= '%s'::DATE", minDate, defaultDays, maxDate)
			}
			return fmt.Sprintf("target.event_date >= '%s'::DATE AND target.event_date <= '%s'::DATE", minDate, maxDate)
		}
		return fmt.Sprintf("target.event_date >= CURRENT_DATE - INTERVAL %d DAY", defaultDays)
	}

	switch targetTable {
	case "fact_vehicle_positions":
		dateFilter := getPartitionFilter(1)
		timeFilter := ""
		if minTimeVal != "" {
			timeFilter = fmt.Sprintf("\n   AND target.event_time >= '%s'::TIMESTAMPTZ", minTimeVal)
		}
		return fmt.Sprintf(`MERGE INTO %s.%s.fact_vehicle_positions AS target
USING %s AS source
ON %s%s
   AND target.agency_id = source.agency_id
   AND target.vehicle_id = source.vehicle_id
   AND target.event_date = source.event_date
   AND target.event_time = source.event_time
WHEN NOT MATCHED THEN INSERT (
   event_date, event_time, agency_id, route_id, trip_id, station_id,
   vehicle_id, status, latitude, longitude, bearing, speed, occupancy_status, raw_payload
)
VALUES (
   source.event_date, source.event_time, source.agency_id, source.route_id, source.trip_id, source.station_id,
   source.vehicle_id, source.status, source.latitude, source.longitude, source.bearing, source.speed, source.occupancy_status, source.raw_payload
);`, catalogName, namespace, sourceParquet, dateFilter, timeFilter)

	case "fact_alerts":
		dateFilter := getPartitionFilter(7)
		return fmt.Sprintf(`UPDATE %s.%s.fact_alerts AS target
SET removed_at = CURRENT_TIMESTAMP
WHERE %s
  AND target.removed_at IS NULL
  AND target.agency_id IN (SELECT DISTINCT agency_id FROM %s)
  AND target.alert_id NOT IN (SELECT DISTINCT alert_id FROM %s WHERE alert_id IS NOT NULL);

MERGE INTO %s.%s.fact_alerts AS target
USING %s AS source
ON %s
   AND target.alert_id = source.alert_id
   AND target.agency_id = source.agency_id
WHEN MATCHED AND (
   target.removed_at IS NOT NULL
   OR target.header_text IS DISTINCT FROM source.header_text
   OR target.description_text IS DISTINCT FROM source.description_text
   OR target.severity IS DISTINCT FROM source.severity
   OR target.effect IS DISTINCT FROM source.effect
   OR target.cause IS DISTINCT FROM source.cause
   OR target.affected_route_ids IS DISTINCT FROM source.affected_route_ids
   OR target.active_period_end IS DISTINCT FROM source.active_period_end
   OR target.last_seen_at IS NULL
   OR source.last_seen_at >= target.last_seen_at + INTERVAL '5 minutes'
) THEN UPDATE SET
   last_seen_at = source.last_seen_at,
   removed_at = source.removed_at,
   active_period_start = source.active_period_start,
   active_period_end = source.active_period_end,
   affected_route_ids = source.affected_route_ids,
   cause = source.cause,
   effect = source.effect,
   header_text = source.header_text,
   description_text = source.description_text,
   severity = source.severity,
   raw_payload = source.raw_payload
WHEN NOT MATCHED THEN INSERT (
   alert_id, agency_id, event_date, detected_at, last_seen_at, removed_at,
   active_period_start, active_period_end, affected_route_ids, cause, effect,
   header_text, description_text, severity, raw_payload
)
VALUES (
   source.alert_id, source.agency_id, source.event_date, source.detected_at, source.last_seen_at, source.removed_at,
   source.active_period_start, source.active_period_end, source.affected_route_ids, source.cause, source.effect,
   source.header_text, source.description_text, source.severity, source.raw_payload
);`, catalogName, namespace, dateFilter, sourceParquet, sourceParquet, catalogName, namespace, sourceParquet, dateFilter)

	case "fact_micromobility_status":
		dateFilter := getPartitionFilter(1)
		timeFilter := ""
		if minTimeVal != "" {
			timeFilter = fmt.Sprintf("\n   AND target.event_time >= '%s'::TIMESTAMPTZ", minTimeVal)
		}
		return fmt.Sprintf(`MERGE INTO %s.%s.fact_micromobility_status AS target
USING %s AS source
ON %s%s
   AND target.agency_id = source.agency_id
   AND target.station_id = source.station_id
   AND target.event_date = source.event_date
   AND target.event_time = source.event_time
WHEN NOT MATCHED THEN INSERT (event_date, event_time, agency_id, station_id, num_bikes_available, num_ebikes_available, num_docks_available, is_installed, is_renting, is_returning, raw_payload)
VALUES (source.event_date, source.event_time, source.agency_id, source.station_id, source.num_bikes_available, source.num_ebikes_available, source.num_docks_available, source.is_installed, source.is_renting, source.is_returning, source.raw_payload);`, catalogName, namespace, sourceParquet, dateFilter, timeFilter)

	case "dim_stations":
		return fmt.Sprintf(`UPDATE %s.%s.dim_stations AS target
SET is_current = false, valid_to = CURRENT_TIMESTAMP
WHERE target.is_current = true
  AND (target.station_id LIKE '%%_STN_%%' OR target.station_id LIKE 'BUS_STOP_%%' OR target.station_id LIKE 'LANDING_%%');

UPDATE %s.%s.dim_stations AS target
SET is_current = false, valid_to = source.valid_from
FROM %s AS source
WHERE target.station_id = source.station_id
  AND target.agency_id = source.agency_id
  AND target.is_current = true
  AND (target.name IS DISTINCT FROM source.name OR target.latitude IS DISTINCT FROM source.latitude OR target.longitude IS DISTINCT FROM source.longitude OR target.gtfs_stop_id IS DISTINCT FROM source.gtfs_stop_id OR target.complex_id IS DISTINCT FROM source.complex_id OR target.daytime_routes IS DISTINCT FROM source.daytime_routes OR target.structure IS DISTINCT FROM source.structure OR target.is_accessible IS DISTINCT FROM source.is_accessible OR target.raw_payload::VARCHAR IS DISTINCT FROM source.raw_payload::VARCHAR);

MERGE INTO %s.%s.dim_stations AS target
USING %s AS source
ON target.station_id = source.station_id
   AND target.agency_id = source.agency_id
   AND target.is_current = true
WHEN NOT MATCHED THEN INSERT (station_id, agency_id, name, latitude, longitude, gtfs_stop_id, complex_id, daytime_routes, structure, is_accessible, valid_from, valid_to, is_current, raw_payload)
VALUES (source.station_id, source.agency_id, source.name, source.latitude, source.longitude, source.gtfs_stop_id, source.complex_id, source.daytime_routes, source.structure, source.is_accessible, source.valid_from, source.valid_to, source.is_current, source.raw_payload);`, catalogName, namespace, catalogName, namespace, sourceParquet, catalogName, namespace, sourceParquet)

	case "dim_routes":
		return fmt.Sprintf(`UPDATE %s.%s.dim_routes AS target
SET is_current = false, valid_to = source.valid_from
FROM %s AS source
WHERE target.route_id = source.route_id
  AND target.agency_id = source.agency_id
  AND target.is_current = true
  AND (target.route_name IS DISTINCT FROM source.route_name OR target.color_hex IS DISTINCT FROM source.color_hex OR target.type IS DISTINCT FROM source.type OR target.raw_payload::VARCHAR IS DISTINCT FROM source.raw_payload::VARCHAR);

MERGE INTO %s.%s.dim_routes AS target
USING %s AS source
ON target.route_id = source.route_id
   AND target.agency_id = source.agency_id
   AND target.is_current = true
WHEN NOT MATCHED THEN INSERT (route_id, agency_id, route_name, color_hex, type, valid_from, valid_to, is_current, raw_payload)
VALUES (source.route_id, source.agency_id, source.route_name, source.color_hex, source.type, source.valid_from, source.valid_to, source.is_current, source.raw_payload);`, catalogName, namespace, sourceParquet, catalogName, namespace, sourceParquet)

	case "dim_micromobility_stations":
		return fmt.Sprintf(`UPDATE %s.%s.dim_micromobility_stations AS target
SET is_current = false, valid_to = source.valid_from
FROM %s AS source
WHERE target.station_id = source.station_id
  AND target.agency_id = source.agency_id
  AND target.is_current = true
  AND (target.name IS DISTINCT FROM source.name OR target.latitude IS DISTINCT FROM source.latitude OR target.longitude IS DISTINCT FROM source.longitude OR target.capacity IS DISTINCT FROM source.capacity);

MERGE INTO %s.%s.dim_micromobility_stations AS target
USING %s AS source
ON target.station_id = source.station_id
   AND target.agency_id = source.agency_id
   AND target.is_current = true
WHEN NOT MATCHED THEN INSERT (station_id, agency_id, name, latitude, longitude, capacity, valid_from, valid_to, is_current, raw_payload)
VALUES (source.station_id, source.agency_id, source.name, source.latitude, source.longitude, source.capacity, source.valid_from, source.valid_to, source.is_current, source.raw_payload);`, catalogName, namespace, sourceParquet, catalogName, namespace, sourceParquet)

	case "dim_boroughs":
		return fmt.Sprintf(`UPDATE %s.%s.dim_boroughs AS target
SET is_current = false, valid_to = source.valid_from
FROM %s AS source
WHERE target.boro_code = source.boro_code
  AND target.is_current = true
  AND (target.boro_name IS DISTINCT FROM source.boro_name OR target.geom_wkt IS DISTINCT FROM source.geom_wkt OR target.raw_payload::VARCHAR IS DISTINCT FROM source.raw_payload::VARCHAR);

MERGE INTO %s.%s.dim_boroughs AS target
USING %s AS source
ON target.boro_code = source.boro_code
   AND target.is_current = true
WHEN NOT MATCHED THEN INSERT (boro_code, boro_name, geom_wkt, geom_geojson, shape_area, shape_leng, valid_from, valid_to, is_current, raw_payload)
VALUES (source.boro_code, source.boro_name, source.geom_wkt, source.geom_geojson, source.shape_area, source.shape_leng, source.valid_from, source.valid_to, source.is_current, source.raw_payload);`, catalogName, namespace, sourceParquet, catalogName, namespace, sourceParquet)

	case "dim_service_lines":
		return fmt.Sprintf(`UPDATE %s.%s.dim_service_lines AS target
SET is_current = false, valid_to = source.valid_from
FROM %s AS source
WHERE target.agency_id = source.agency_id
  AND target.route_id = source.route_id
  AND target.is_current = true
  AND (target.service_name IS DISTINCT FROM source.service_name OR target.division IS DISTINCT FROM source.division OR target.line_name IS DISTINCT FROM source.line_name OR target.color_hex IS DISTINCT FROM source.color_hex OR target.geom_wkt IS DISTINCT FROM source.geom_wkt OR target.raw_payload::VARCHAR IS DISTINCT FROM source.raw_payload::VARCHAR);

MERGE INTO %s.%s.dim_service_lines AS target
USING %s AS source
ON target.agency_id = source.agency_id
   AND target.route_id = source.route_id
   AND target.is_current = true
WHEN NOT MATCHED THEN INSERT (line_id, agency_id, route_id, service_name, division, line_name, color_hex, geom_wkt, geom_geojson, shape_leng, valid_from, valid_to, is_current, raw_payload)
VALUES (source.line_id, source.agency_id, source.route_id, source.service_name, source.division, source.line_name, source.color_hex, source.geom_wkt, source.geom_geojson, source.shape_leng, source.valid_from, source.valid_to, source.is_current, source.raw_payload);`, catalogName, namespace, sourceParquet, catalogName, namespace, sourceParquet)

	case "fact_schedules":
		dateFilter := getPartitionFilter(1)
		return fmt.Sprintf(`MERGE INTO %s.%s.fact_schedules AS target
USING %s AS source
ON %s
   AND target.agency_id = source.agency_id
   AND target.route_id = source.route_id
   AND target.station_id = source.station_id
   AND target.trip_id = source.trip_id
   AND target.event_date = source.event_date
WHEN NOT MATCHED THEN INSERT (event_date, agency_id, route_id, station_id, trip_id, scheduled_arrival_time, scheduled_departure_time, raw_payload)
VALUES (source.event_date, source.agency_id, source.route_id, source.station_id, source.trip_id, source.scheduled_arrival_time, source.scheduled_departure_time, source.raw_payload);`, catalogName, namespace, sourceParquet, dateFilter)

	case "fact_turnstile_counts":
		dateFilter := getPartitionFilter(1)
		timeFilter := ""
		if minTimeVal != "" {
			timeFilter = fmt.Sprintf("\n   AND target.reading_time >= '%s'::TIMESTAMPTZ", minTimeVal)
		}
		return fmt.Sprintf(`MERGE INTO %s.%s.fact_turnstile_counts AS target
USING %s AS source
ON %s%s
   AND target.agency_id = source.agency_id
   AND target.station_id = source.station_id
   AND target.device_id = source.device_id
   AND target.event_date = source.event_date
   AND target.reading_time = source.reading_time
WHEN NOT MATCHED THEN INSERT (event_date, agency_id, station_id, device_id, reading_time, entry_count, exit_count, raw_payload)
VALUES (source.event_date, source.agency_id, source.station_id, source.device_id, source.reading_time, source.entry_count, source.exit_count, source.raw_payload);`, catalogName, namespace, sourceParquet, dateFilter, timeFilter)

	case "fact_ridership":
		dateFilter := getPartitionFilter(1)
		return fmt.Sprintf(`DELETE FROM %s.%s.fact_ridership WHERE event_date < '2020-01-01'::DATE;
MERGE INTO %s.%s.fact_ridership AS target
USING %s AS source
ON %s
   AND target.agency_id = source.agency_id
   AND target.origin_station_id = source.origin_station_id
   AND target.destination_station_id = source.destination_station_id
   AND target.event_date = source.event_date
WHEN MATCHED AND target.passenger_count IS DISTINCT FROM source.passenger_count THEN UPDATE SET
   passenger_count = source.passenger_count,
   raw_payload = source.raw_payload
WHEN NOT MATCHED THEN INSERT (event_date, agency_id, origin_station_id, destination_station_id, passenger_count, raw_payload)
VALUES (source.event_date, source.agency_id, source.origin_station_id, source.destination_station_id, source.passenger_count, source.raw_payload);`, catalogName, namespace, catalogName, namespace, sourceParquet, dateFilter)

	default:
		return fmt.Sprintf("INSERT INTO %s.%s.%s SELECT * FROM %s;", catalogName, namespace, targetTable, sourceParquet)
	}
}

// getParquetSortClause returns the natural-key intra-batch deduplication (QUALIFY ROW_NUMBER() = 1)
// and linear sort specification for Option B table layouts to optimize Parquet min/max row group stats
// (leading with event_date and event_time so timestamp predicate pushdown prunes historical row groups)
// and guarantee that SQL MERGE INTO never inserts duplicate source keys from multi-poll microbatches.
func getParquetSortClause(targetTable string) string {
	switch targetTable {
	case "fact_vehicle_positions":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, vehicle_id, event_date, event_time ORDER BY event_time DESC) = 1 ORDER BY event_date, event_time, agency_id, route_id"
	case "fact_alerts":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, alert_id ORDER BY last_seen_at DESC) = 1 ORDER BY event_date, detected_at, agency_id"
	case "fact_micromobility_status":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, station_id, event_date, event_time ORDER BY event_time DESC) = 1 ORDER BY event_date, event_time, agency_id, station_id"
	case "fact_turnstile_counts":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, station_id, device_id, event_date, reading_time ORDER BY reading_time DESC) = 1 ORDER BY event_date, reading_time, agency_id, station_id"
	case "fact_schedules":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, route_id, station_id, trip_id, event_date ORDER BY scheduled_arrival_time DESC) = 1 ORDER BY event_date, scheduled_arrival_time, agency_id, route_id"
	case "dim_stations", "dim_micromobility_stations":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, station_id ORDER BY valid_from DESC) = 1 ORDER BY agency_id, station_id"
	case "dim_routes", "dim_service_lines":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, route_id ORDER BY valid_from DESC) = 1 ORDER BY agency_id, route_id"
	case "dim_boroughs":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY boro_code ORDER BY valid_from DESC) = 1 ORDER BY boro_code"
	case "fact_ridership":
		return " QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, origin_station_id, destination_station_id, event_date ORDER BY passenger_count DESC) = 1 ORDER BY event_date, agency_id"
	default:
		return ""
	}
}

// WriteIcebergBatch processes micro-batch events from a single data source and upserts them into Iceberg format on R2 in-process.
func (e *DuckEngine) WriteIcebergBatch(ctx context.Context, ds plugin.DataSource, events []control.StreamEvent) error {
	if len(events) == 0 || e.icebergDisabled {
		return nil
	}

	start := time.Now()
	e.logger.Info("writing iceberg micro-batch to R2", "plugin", ds.ID(), "count", len(events))

	ts := time.Now().UnixNano()
	targetTable := ds.TargetTable()

	// 1. Acquire pinned connection from pool (SetMaxOpenConns(1) provides FIFO serialization)
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed acquiring duckdb connection for iceberg batch: %w", err)
	}
	defer conn.Close()

	tmpTable := fmt.Sprintf("tmp_staging_iceberg_%s_%d", ds.ID(), ts)
	if err := e.StageEventsOnConn(ctx, conn, tmpTable, events); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTable))

	bodyQuery := ds.TransformSelect(tmpTable)
	if bodyQuery == "" {
		return fmt.Errorf("empty select query from plugin %s", ds.ID())
	}

	tmpTransformed := fmt.Sprintf("tmp_transformed_iceberg_%s_%d", ds.ID(), ts)
	defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTransformed))

	createSQL := fmt.Sprintf("CREATE TEMP TABLE %s AS SELECT * FROM (%s)%s%s;\n",
		tmpTransformed, bodyQuery, e.getTelemetryWindowFilterClause(targetTable), getParquetSortClause(targetTable))

	if err := e.ExecuteScriptOnConn(ctx, conn, createSQL); err != nil {
		return fmt.Errorf("failed creating in-memory transformed table for iceberg merge: %w", err)
	}

	minTimeVal, minDate, maxDate := e.extractBatchBoundsOnConn(ctx, conn, targetTable, tmpTransformed)
	if (targetTable == "fact_vehicle_positions" || targetTable == "fact_micromobility_status") && minTimeVal == "" {
		e.logger.Info("skipping iceberg commit (all feed events preceded watermark or 10m window)", "plugin", ds.ID(), "table", targetTable)
		return nil
	}

	// 2. Commit to Iceberg catalog directly from in-memory staging table (zero-copy)
	sourceClause := tmpTransformed
	upsertSQL := buildIcebergUpsertSQL(e.GetIcebergNamespace(), targetTable, sourceClause, minTimeVal, minDate, maxDate)

	var lastErr error
	for attempt := 1; attempt <= 4; attempt++ {
		if !e.icebergAttached {
			_ = e.attachIcebergCatalogOnConn(ctx, conn)
		}

		if _, err := conn.ExecContext(ctx, upsertSQL); err != nil {
			lastErr = err
			e.logger.Warn("iceberg upsert commit conflict/error, retrying...", "plugin", ds.ID(), "attempt", attempt, "error", err)
			time.Sleep(time.Duration(attempt*1000) * time.Millisecond)
			continue
		}

		e.logger.Info("successfully committed iceberg batch to R2", "plugin", ds.ID(), "duration", time.Since(start))
		return nil
	}

	return fmt.Errorf("failed committing iceberg batch after 4 retries: %w", lastErr)
}

// WriteTableBatchIceberg processes micro-batch events from multiple data sources targeting the same table and upserts them into Iceberg format on R2 in-process.
func (e *DuckEngine) WriteTableBatchIceberg(ctx context.Context, targetTable string, pluginsMap map[string]plugin.DataSource, events []control.StreamEvent) error {
	if len(events) == 0 || e.icebergDisabled {
		return nil
	}

	start := time.Now()
	e.logger.Info("writing centralized table iceberg batch to R2", "table", targetTable, "events_count", len(events))

	grouped := make(map[string][]control.StreamEvent)
	for _, ev := range events {
		grouped[ev.Topic] = append(grouped[ev.Topic], ev)
	}

	ts := time.Now().UnixNano()

	// 1. Acquire pinned connection from pool (SetMaxOpenConns(1) provides FIFO serialization)
	conn, err := e.Connx(ctx)
	if err != nil {
		return fmt.Errorf("failed acquiring duckdb connection for table iceberg batch: %w", err)
	}
	defer conn.Close()

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

		tmpTable := fmt.Sprintf("tmp_staging_iceberg_%s_%d", ds.ID(), ts)
		if err := e.StageEventsOnConn(ctx, conn, tmpTable, evs); err != nil {
			return err
		}
		stagedTables = append(stagedTables, tmpTable)

		selectQuery := ds.TransformSelect(tmpTable)
		if selectQuery != "" {
			unionQueries = append(unionQueries, "("+selectQuery+")")
		}
	}

	if len(unionQueries) == 0 {
		return nil
	}

	tmpTransformed := fmt.Sprintf("tmp_transformed_iceberg_%s_%d", targetTable, ts)
	defer conn.ExecContext(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s;", tmpTransformed))

	createSQL := fmt.Sprintf("CREATE TEMP TABLE %s AS SELECT * FROM (%s)%s%s;\n",
		tmpTransformed, strings.Join(unionQueries, " UNION ALL "), e.getTelemetryWindowFilterClause(targetTable), getParquetSortClause(targetTable))

	if err := e.ExecuteScriptOnConn(ctx, conn, createSQL); err != nil {
		return fmt.Errorf("failed creating in-memory transformed table for iceberg merge: %w", err)
	}

	minTimeVal, minDate, maxDate := e.extractBatchBoundsOnConn(ctx, conn, targetTable, tmpTransformed)
	if (targetTable == "fact_vehicle_positions" || targetTable == "fact_micromobility_status") && minTimeVal == "" {
		e.logger.Info("skipping centralized iceberg table commit (all feed events preceded watermark or 10m window)", "table", targetTable, "events_count", len(events))
		return nil
	}

	// 2. Commit to Iceberg catalog directly from in-memory staging table (zero-copy)
	sourceClause := tmpTransformed
	upsertSQL := buildIcebergUpsertSQL(e.GetIcebergNamespace(), targetTable, sourceClause, minTimeVal, minDate, maxDate)

	var lastErr error
	for attempt := 1; attempt <= 4; attempt++ {
		if !e.icebergAttached {
			_ = e.attachIcebergCatalogOnConn(ctx, conn)
		}

		if _, err := conn.ExecContext(ctx, upsertSQL); err != nil {
			lastErr = err
			e.logger.Warn("iceberg table batch upsert conflict/error, retrying...", "table", targetTable, "attempt", attempt, "error", err)
			time.Sleep(time.Duration(attempt*1000) * time.Millisecond)
			continue
		}

		e.logger.Info("successfully committed centralized table iceberg batch to R2", "table", targetTable, "duration", time.Since(start), "events_count", len(events))
		return nil
	}

	return fmt.Errorf("failed committing table iceberg batch after 4 retries: %w", lastErr)
}

// RunIcebergMaintenance logs that Iceberg table maintenance is managed by Cloudflare R2 Data Catalog.
func (e *DuckEngine) RunIcebergMaintenance(ctx context.Context) error {
	if e.icebergDisabled {
		return nil
	}

	e.logger.Info("iceberg table maintenance is managed by Cloudflare R2 Data Catalog (target size 256MB)")
	return nil
}
