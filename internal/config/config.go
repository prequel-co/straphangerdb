package config

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// Config holds all environment and CLI flag configurations.
type Config struct {
	OTFFormat          string        // "iceberg", "delta", or "ducklake"
	BucketPrefix       string        // e.g. "iceberg_catalog/"
	R2BucketName       string        // e.g. "straphanger-db-prod"
	S3Endpoint         string        // e.g. "https://<account_id>.r2.cloudflarestorage.com" or "http://localhost:9000"
	IcebergCatalogURI  string        // e.g. "http://lakekeeper:8181/catalog"
	SQLiteDBPath       string        // Path to local SQLite file for Honker control plane
	PublicCDNURL       string        // Public CDN URL for remote DuckLake / Iceberg read attachment (e.g. https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev)
	StreamRetention    time.Duration // Time-based window for Honker stream truncation
	FlushInterval      time.Duration // OTF flush interval
	MemoryLimit            string        // DuckDB memory limit PRAGMA (default "2.5GB")
	MaxParquetFileSize     string        // Max Parquet file size constraint (default "256MB")
	Threads                int           // DuckDB threads PRAGMA (default 4)
	DrainBatchSize         int           // Max events per post-compaction catch-up drain batch (default 250000, ~64MB target)
	CompactionPauseTimeout time.Duration // Max duration to pause OTF flushes during active compaction (default 20m)
}

// LoadConfig parses flags and environment variables.
func LoadConfig() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.OTFFormat, "otf", getEnv("OTF_FORMAT", "all"), "Open Table Format target: all, iceberg, delta, or ducklake")
	flag.StringVar(&cfg.BucketPrefix, "prefix", getEnv("BUCKET_PREFIX", "iceberg_catalog/"), "R2 bucket key prefix")
	flag.StringVar(&cfg.R2BucketName, "bucket", getEnv("R2_BUCKET_NAME", "straphanger-db-data"), "R2 bucket name")
	flag.StringVar(&cfg.S3Endpoint, "s3-endpoint", getEnv("S3_ENDPOINT", ""), "Custom S3 endpoint for R2 or local mock")
	flag.StringVar(&cfg.IcebergCatalogURI, "iceberg-catalog-uri", getEnv("ICEBERG_CATALOG_URI", "http://lakekeeper:8181/catalog"), "Iceberg REST catalog URI")
	flag.StringVar(&cfg.SQLiteDBPath, "db-path", getEnv("SQLITE_DB_PATH", "/data/control.db"), "Path to local SQLite control database")
	flag.StringVar(&cfg.PublicCDNURL, "public-cdn-url", getEnv("PUBLIC_CDN_URL", ""), "Public CDN URL for remote DuckLake / Iceberg read attachment")
	flag.StringVar(&cfg.MemoryLimit, "memory-limit", getEnv("DUCKDB_MEMORY_LIMIT", "2.5GB"), "DuckDB memory limit PRAGMA")
	flag.StringVar(&cfg.MaxParquetFileSize, "max-parquet-size", getEnv("MAX_PARQUET_FILE_SIZE", "256MB"), "Max Parquet file size cap")

	flag.IntVar(&cfg.Threads, "threads", getEnvInt("DUCKDB_THREADS", 4), "DuckDB thread count")
	flag.IntVar(&cfg.DrainBatchSize, "drain-batch-size", getEnvInt("DRAIN_BATCH_SIZE", 250000), "Post-compaction catch-up drain batch size (~64MB target)")

	retentionStr := getEnv("STREAM_RETENTION", "1h")
	retention, err := time.ParseDuration(retentionStr)
	if err != nil {
		retention = 1 * time.Hour
	}
	flag.DurationVar(&cfg.StreamRetention, "stream-retention", retention, "Honker stream time-based retention window")

	flushStr := getEnv("FLUSH_INTERVAL", "2m")
	flushInterval, err := time.ParseDuration(flushStr)
	if err != nil {
		flushInterval = 2 * time.Minute
	}
	flag.DurationVar(&cfg.FlushInterval, "flush-interval", flushInterval, "Micro-batch OTF flush interval")

	pauseTimeoutStr := getEnv("COMPACTION_PAUSE_TIMEOUT", "20m")
	pauseTimeout, err := time.ParseDuration(pauseTimeoutStr)
	if err != nil {
		pauseTimeout = 20 * time.Minute
	}
	flag.DurationVar(&cfg.CompactionPauseTimeout, "compaction-pause-timeout", pauseTimeout, "Max duration to pause flushes during active compaction")

	if !flag.Parsed() {
		flag.Parse()
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		var i int
		if _, err := fmt.Sscanf(val, "%d", &i); err == nil && i > 0 {
			return i
		}
	}
	return fallback
}

// ValidateCredentials checks that required cloud credentials are provided when targeting cloud storage.
func (cfg *Config) ValidateCredentials() error {
	// If custom local endpoint is provided (e.g. MinIO or localhost mock), allow local dev
	isLocal := strings.Contains(cfg.S3Endpoint, "localhost") || strings.Contains(cfg.S3Endpoint, "127.0.0.1") || strings.Contains(cfg.S3Endpoint, "minio")
	if isLocal {
		return nil
	}

	// For cloud environments targeting Iceberg, Delta UniForm, or Cloudflare R2
	if cfg.OTFFormat == "all" || cfg.OTFFormat == "iceberg" || cfg.OTFFormat == "delta" || strings.Contains(cfg.S3Endpoint, "r2.cloudflarestorage.com") {
		if os.Getenv("R2_ACCESS_KEY_ID") == "" || os.Getenv("R2_SECRET_ACCESS_KEY") == "" {
			return fmt.Errorf("missing required cloud storage credentials: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set")
		}
		if os.Getenv("CLOUDFLARE_ACCOUNT_ID") == "" {
			return fmt.Errorf("missing required configuration: CLOUDFLARE_ACCOUNT_ID must be set")
		}
		if os.Getenv("CLOUDFLARE_API_TOKEN") == "" && os.Getenv("ICEBERG_TOKEN") == "" {
			return fmt.Errorf("missing required catalog authentication: CLOUDFLARE_API_TOKEN or ICEBERG_TOKEN must be set")
		}
	}
	return nil
}
