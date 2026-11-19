package plugin

import (
	"context"
	"time"
)

// IngestionMode defines whether a DataSource operates as a high-frequency stream or a scheduled batch.
type IngestionMode string

const (
	ModeStream IngestionMode = "stream" // High-frequency polling -> Honker Stream
	ModeBatch  IngestionMode = "batch"  // Low-frequency/Cron -> Direct DuckDB / Honker Task
)

// DataSource represents a generic, pluggable transit dataset provider.
type DataSource interface {
	ID() string                                // e.g. "mta_nyct_subway_gtfs_rt"
	AgencyID() string                          // e.g. "MTA_NYCT_SUBWAY"
	TargetTable() string                       // e.g. "fact_vehicle_positions"
	Mode() IngestionMode                       // ModeStream or ModeBatch
	DefaultInterval() time.Duration            // e.g., 15s for RT, 24h for static
	Fetch(ctx context.Context) ([]byte, error) // Pulls raw payload (Protobuf, JSON, CSV)
	// TransformSelect returns a pure SELECT query projecting raw staging table rows into target table schema columns.
	// Production OTF writers (Iceberg and DuckLake) consume TransformSelect and wrap it in catalog-qualified
	// MERGE INTO / SCD Type II / UNION ALL batch statements via buildCatalogUpsertSQL.
	TransformSelect(rawTable string) string
}

// TransformInsert generates an INSERT statement targeting schema.targetTable from a plugin's TransformSelect.
func TransformInsert(p DataSource, targetSchema, rawTable string) string {
	if targetSchema == "" {
		targetSchema = "transit_v2"
	}
	return "INSERT INTO " + targetSchema + "." + p.TargetTable() + "\n" + p.TransformSelect(rawTable) + ";"
}

// TransformQuery returns a standalone executable SQL script targeting the local in-memory schema (e.g. transit_v2.<table>).
// Note: Production OTF writers (WriteIcebergBatch / WriteDucklakeBatch) do NOT call TransformQuery; they call
// TransformSelect and apply catalog-qualified upserts via buildCatalogUpsertSQL. TransformQuery is provided for
// local in-memory DuckDB execution and integration testing.
// If the plugin implements a custom TransformQuery(string) string, that is invoked; otherwise it falls back to TransformInsert.
func TransformQuery(p DataSource, rawTable string) string {
	if qp, ok := p.(interface{ TransformQuery(string) string }); ok {
		return qp.TransformQuery(rawTable)
	}
	return TransformInsert(p, "transit_v2", rawTable)
}
