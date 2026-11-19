-- Control plane metadata table
CREATE TABLE IF NOT EXISTS control_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Honker task queue table
CREATE TABLE IF NOT EXISTS honker_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    claimed_by TEXT,
    claimed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_honker_tasks_status_id ON honker_tasks(status, id ASC);

-- Honker stream events table
CREATE TABLE IF NOT EXISTS stream_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_name TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload BLOB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stream_events_lookup ON stream_events(stream_name, id ASC);
CREATE INDEX IF NOT EXISTS idx_stream_events_created ON stream_events(created_at);
CREATE INDEX IF NOT EXISTS idx_stream_events_purge ON stream_events(stream_name, id ASC, created_at);

-- Honker stream consumer group offsets table
CREATE TABLE IF NOT EXISTS stream_offsets (
    stream_name TEXT NOT NULL,
    consumer_group TEXT NOT NULL,
    last_offset INTEGER NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (stream_name, consumer_group)
);
