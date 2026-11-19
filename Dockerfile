# Build Stage
FROM golang:1.24-bookworm AS builder
ARG TARGETARCH=amd64

WORKDIR /src

RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://github.com/duckdb/duckdb/releases/download/v1.5.5/libduckdb-linux-${TARGETARCH}.zip -o /tmp/libduckdb.zip && \
    unzip /tmp/libduckdb.zip -d /tmp/libduckdb && \
    cp /tmp/libduckdb/libduckdb.so /usr/local/lib/ && \
    cp /tmp/libduckdb/duckdb.h /tmp/libduckdb/duckdb.hpp /usr/local/include/ && \
    ldconfig && \
    rm -rf /tmp/libduckdb*

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH} go build -tags duckdb_use_lib -ldflags="-s -w" -o /straphanger ./cmd/straphanger

# Litestream Stage
FROM litestream/litestream:latest AS litestream

# Final Production Stage
FROM debian:bookworm-slim
ARG TARGETARCH=amd64

ENV HOME=/root

RUN apt-get update && apt-get install -y ca-certificates sqlite3 curl unzip libsqlite3-0 && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://github.com/duckdb/duckdb/releases/download/v1.5.5/libduckdb-linux-${TARGETARCH}.zip -o /tmp/libduckdb.zip && \
    unzip /tmp/libduckdb.zip -d /tmp/libduckdb && \
    cp /tmp/libduckdb/libduckdb.so /usr/local/lib/ && \
    ldconfig && \
    rm -rf /tmp/libduckdb*

RUN curl -sSL https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-${TARGETARCH}.zip -o /tmp/duckdb.zip && \
    unzip /tmp/duckdb.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/duckdb && \
    rm -rf /tmp/duckdb.zip

RUN duckdb -c "INSTALL iceberg; INSTALL httpfs; INSTALL spatial; INSTALL delta; INSTALL ducklake;" && \
    chmod 755 /root && \
    mkdir -p /usr/local/lib/duckdb /tmp/.duckdb && \
    find /root/.duckdb -name "*.duckdb_extension" -exec cp -v {} /usr/local/lib/duckdb/ \; && \
    cp -r /root/.duckdb/* /tmp/.duckdb/ && \
    chmod -R 777 /usr/local/lib/duckdb /root/.duckdb /tmp/.duckdb

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=builder /straphanger /app/straphanger
COPY deploy/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh /app/straphanger

ENV HOME=/tmp

ENV SQLITE_DB_PATH=/data/control.db
ENV OTF_FORMAT=ducklake

VOLUME ["/data"]

ENTRYPOINT ["/entrypoint.sh"]
