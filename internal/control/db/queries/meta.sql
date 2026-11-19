-- name: GetMeta :one
SELECT value FROM control_meta WHERE key = ?;

-- name: SetMeta :exec
INSERT INTO control_meta (key, value, updated_at)
VALUES (?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP;
