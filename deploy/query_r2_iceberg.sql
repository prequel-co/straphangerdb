-- DuckDB Iceberg REST Catalog Query File for StraphangerDB
-- Usage: duckdb < query_r2_iceberg.sql
-- Note: Replace R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY below with your Cloudflare R2 S3 API tokens if accessing raw S3 files.

INSTALL iceberg;
LOAD iceberg;
INSTALL httpfs;
LOAD httpfs;

-- Configure S3 Storage Secret for Cloudflare R2
CREATE SECRET IF NOT EXISTS r2_s3_secret (
    TYPE S3,
    KEY_ID '${R2_ACCESS_KEY_ID}',
    SECRET '${R2_SECRET_ACCESS_KEY}',
    ENDPOINT 'https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com',
    URL_STYLE 'path'
);

-- Configure Iceberg REST Catalog Secret
CREATE SECRET IF NOT EXISTS r2_iceberg_secret (
    TYPE ICEBERG,
    TOKEN '${CLOUDFLARE_API_TOKEN}'
);

-- Attach Cloudflare R2 Iceberg REST Catalog
ATTACH '${CLOUDFLARE_ACCOUNT_ID}_${R2_BUCKET_NAME}' AS straphanger (
    TYPE ICEBERG,
    ENDPOINT 'https://catalog.cloudflarestorage.com/${CLOUDFLARE_ACCOUNT_ID}/${R2_BUCKET_NAME}',
    SECRET r2_iceberg_secret
);

-- Query the newest 10 real-time vehicle position records
SELECT 
    event_date,
    event_time,
    agency_id,
    route_id,
    station_id,
    vehicle_id,
    status,
    latitude,
    longitude,
    raw_payload
FROM straphanger.transit_v2.fact_vehicle_positions
ORDER BY event_time DESC
LIMIT 10;
