-- name: AppendStreamEvent :one
INSERT INTO stream_events (stream_name, topic, payload, created_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
RETURNING id;

-- name: GetStreamOffset :one
SELECT last_offset
FROM stream_offsets
WHERE stream_name = ? AND consumer_group = ?;

-- name: CommitStreamOffset :exec
INSERT INTO stream_offsets (stream_name, consumer_group, last_offset, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(stream_name, consumer_group) DO UPDATE SET
    last_offset = excluded.last_offset,
    updated_at = CURRENT_TIMESTAMP;

-- name: ReadStreamEvents :many
SELECT id, topic, payload, created_at
FROM stream_events
WHERE stream_name = ? AND id > ?
ORDER BY id ASC
LIMIT ?;

-- name: TruncateStreamEvents :execrows
DELETE FROM stream_events
WHERE created_at < sqlc.arg(cutoff_time);

-- name: TruncateStreamEventsByName :execrows
DELETE FROM stream_events
WHERE stream_name = sqlc.arg(stream_name) AND created_at < sqlc.arg(cutoff_time);

-- name: TruncateStreamEventsSafely :execrows
DELETE FROM stream_events
WHERE stream_name = sqlc.arg(stream_name)
  AND id <= sqlc.arg(min_offset)
  AND created_at < sqlc.arg(cutoff_time);

-- name: GetMinCommittedStreamOffset :one
SELECT CAST(COALESCE(MIN(last_offset), 0) AS INTEGER) AS min_offset
FROM stream_offsets
WHERE stream_name = ?;

-- name: GetMaxStreamEventID :one
SELECT CAST(COALESCE(MAX(id), 0) AS INTEGER) AS max_id
FROM stream_events
WHERE stream_name = ?;


