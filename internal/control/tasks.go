package control

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/prequel-co/straphangerdb/internal/control/db/sqlc"
)

// TaskJob represents a claimed background task.
type TaskJob struct {
	ID        int64     `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Payload   string    `json:"payload" db:"payload"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// TaskQueue manages task queuing, claiming, and automatic completion purging.
type TaskQueue struct {
	db      *sqlx.DB
	queries *sqlc.Queries
	logger  *slog.Logger
}

func NewTaskQueue(logger *slog.Logger, db *sqlx.DB) *TaskQueue {
	return &TaskQueue{
		db:      db,
		queries: sqlc.New(db),
		logger:  logger,
	}
}

// InitTaskTable verifies the SQLite task queue table is initialized.
func (tq *TaskQueue) InitTaskTable() error {
	// Schema is automatically initialized by InitControlDB
	return nil
}

// Enqueue adds a task job to the queue.
func (tq *TaskQueue) Enqueue(name, payload string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return tq.queries.EnqueueTask(ctx, sqlc.EnqueueTaskParams{
		Name:    name,
		Payload: payload,
	})
}

// Claim claims a pending task for a worker instance atomically in a transaction.
func (tq *TaskQueue) Claim(workerID string) (*TaskJob, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := tq.db.Beginx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	qtx := tq.queries.WithTx(tx.Tx)
	jobRow, err := qtx.GetPendingTaskForClaim(ctx)
	if err != nil {
		return nil, err
	}

	err = qtx.ClaimTask(ctx, sqlc.ClaimTaskParams{
		ClaimedBy: sql.NullString{String: workerID, Valid: true},
		ID:        jobRow.ID,
	})
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &TaskJob{
		ID:        jobRow.ID,
		Name:      jobRow.Name,
		Payload:   jobRow.Payload,
		CreatedAt: jobRow.CreatedAt,
	}, nil
}

// ClaimSpecific claims a specific pending task by ID for a worker instance atomically in a transaction.
// If the task does not exist or is not pending, it returns (nil, nil).
func (tq *TaskQueue) ClaimSpecific(jobID int64, workerID string) (*TaskJob, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := tq.db.Beginx()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	qtx := tq.queries.WithTx(tx.Tx)
	jobRow, err := qtx.GetPendingTaskByID(ctx, jobID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	err = qtx.ClaimTask(ctx, sqlc.ClaimTaskParams{
		ClaimedBy: sql.NullString{String: workerID, Valid: true},
		ID:        jobRow.ID,
	})
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &TaskJob{
		ID:        jobRow.ID,
		Name:      jobRow.Name,
		Payload:   jobRow.Payload,
		CreatedAt: jobRow.CreatedAt,
	}, nil
}

// Ack deletes the completed task immediately (KeepResults = false behavior) to prevent SQLite bloat.
func (tq *TaskQueue) Ack(jobID int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return tq.queries.AckTask(ctx, jobID)
}

// Nack resets a task back to pending for retry on failure.
func (tq *TaskQueue) Nack(jobID int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return tq.queries.NackTask(ctx, jobID)
}
