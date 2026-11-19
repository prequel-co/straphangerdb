#!/bin/sh
set -e

# Auto-create S3 bucket if custom endpoint is specified (e.g. RustFS / MinIO)
if [ -n "$S3_ENDPOINT" ] && [ -n "$R2_BUCKET_NAME" ]; then
    curl -s -X PUT "${S3_ENDPOINT}/${R2_BUCKET_NAME}" || true
fi

# Configure and execute litestream if R2 credentials are provided
if [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ]; then
    R2_ENDPOINT="${S3_ENDPOINT:-https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com}"
    cat <<EOF > /etc/litestream.yml
dbs:
  - path: ${SQLITE_DB_PATH:-/data/control.db}
    replicas:
      - url: s3://${R2_BUCKET_NAME:-straphanger-db-data}/${BUCKET_PREFIX:-iceberg_catalog/}control_plane/control.db
        endpoint: ${R2_ENDPOINT}
        access-key-id: ${R2_ACCESS_KEY_ID}
        secret-access-key: ${R2_SECRET_ACCESS_KEY}
        sync-interval: ${LITESTREAM_SYNC_INTERVAL:-30s}
        snapshot-interval: 1h
        retention: 2h
EOF
    # Restore SQLite database from R2 replica if it exists and local DB is missing/empty.
    # Bound restore to 60s with high parallelism so bloated historical WALs never exceed Cloud Run's 240s startup probe.
    echo "Checking for existing Litestream replica in R2 to restore..."
    if ! timeout 60s litestream restore -parallelism 16 -if-replica-exists -config /etc/litestream.yml "${SQLITE_DB_PATH:-/data/control.db}"; then
        echo "Litestream restore timed out or failed; starting with clean local control.db"
        rm -f "${SQLITE_DB_PATH:-/data/control.db}" "${SQLITE_DB_PATH:-/data/control.db}-wal" "${SQLITE_DB_PATH:-/data/control.db}-shm"
    fi

    exec litestream replicate -config /etc/litestream.yml -exec "/app/straphanger --otf=${OTF_FORMAT:-all} --prefix=${BUCKET_PREFIX:-iceberg_catalog/} --db-path=${SQLITE_DB_PATH:-/data/control.db}"
else
    echo "R2 credentials not set. Running StraphangerDB directly without Litestream replication."
    exec /app/straphanger --otf=${OTF_FORMAT:-all} --prefix=${BUCKET_PREFIX:-iceberg_catalog/} --db-path=${SQLITE_DB_PATH:-/data/control.db}
fi
