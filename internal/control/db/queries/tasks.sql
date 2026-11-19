-- name: EnqueueTask :one
INSERT INTO honker_tasks (name, payload, status, created_at)
VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)
RETURNING id;

-- name: GetPendingTaskForClaim :one
SELECT id, name, payload, created_at
FROM honker_tasks
WHERE status = 'pending'
ORDER BY id ASC
LIMIT 1;

-- name: GetPendingTaskByID :one
SELECT id, name, payload, created_at
FROM honker_tasks
WHERE id = ? AND status = 'pending';

-- name: ClaimTask :exec
UPDATE honker_tasks
SET status = 'claimed',
    claimed_by = ?,
    claimed_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: AckTask :exec
DELETE FROM honker_tasks WHERE id = ?;

-- name: NackTask :exec
UPDATE honker_tasks
SET status = 'pending',
    claimed_by = NULL,
    claimed_at = NULL
WHERE id = ?;
