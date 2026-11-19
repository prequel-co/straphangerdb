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

// StreamEvent represents an event record in a Honker-compatible SQLite stream.
type StreamEvent struct {
	ID        int64     `json:"id" db:"id"`
	Topic     string    `json:"topic" db:"topic"`
	Payload   []byte    `json:"payload" db:"payload"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// StreamManager manages appending, reading consumer offsets, and truncating SQLite stream tables.
type StreamManager struct {
	db      *sqlx.DB
	queries *sqlc.Queries
	logger  *slog.Logger
}

func NewStreamManager(logger *slog.Logger, db *sqlx.DB) *StreamManager {
	return &StreamManager{
		db:      db,
		queries: sqlc.New(db),
		logger:  logger,
	}
}

// InitStreamTable ensures the SQLite stream tables are ready.
func (sm *StreamManager) InitStreamTable(streamName string) error {
	// Schema is automatically initialized by InitControlDB
	return nil
}

// Append appends a raw byte event to the stream.
func (sm *StreamManager) Append(streamName, topic string, payload []byte) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return sm.queries.AppendStreamEvent(ctx, sqlc.AppendStreamEventParams{
		StreamName: streamName,
		Topic:      topic,
		Payload:    payload,
	})
}

// ReadConsumerGroup reads uncommitted events for a consumer group starting after its saved offset.
func (sm *StreamManager) ReadConsumerGroup(streamName, group string, limit int) ([]StreamEvent, int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	lastOffset, err := sm.queries.GetStreamOffset(ctx, sqlc.GetStreamOffsetParams{
		StreamName:    streamName,
		ConsumerGroup: group,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		sm.logger.Warn("could not fetch consumer group offset", "stream", streamName, "group", group, "error", err)
	}

	rows, err := sm.queries.ReadStreamEvents(ctx, sqlc.ReadStreamEventsParams{
		StreamName: streamName,
		ID:         lastOffset,
		Limit:      int64(limit),
	})
	if err != nil {
		return nil, lastOffset, err
	}

	events := make([]StreamEvent, 0, len(rows))
	maxID := lastOffset
	for _, r := range rows {
		events = append(events, StreamEvent{
			ID:        r.ID,
			Topic:     r.Topic,
			Payload:   r.Payload,
			CreatedAt: r.CreatedAt,
		})
		if r.ID > maxID {
			maxID = r.ID
		}
	}

	return events, maxID, nil
}

// CommitOffset updates the last committed offset for a consumer group.
func (sm *StreamManager) CommitOffset(streamName, group string, offset int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return sm.queries.CommitStreamOffset(ctx, sqlc.CommitStreamOffsetParams{
		StreamName:    streamName,
		ConsumerGroup: group,
		LastOffset:    offset,
	})
}

// GetOffset retrieves the last committed offset for a consumer group.
func (sm *StreamManager) GetOffset(streamName, group string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	offset, err := sm.queries.GetStreamOffset(ctx, sqlc.GetStreamOffsetParams{
		StreamName:    streamName,
		ConsumerGroup: group,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return offset, nil
}

// GetLastCommittedPullTime retrieves the UTC timestamp of the last committed stream event
// for the given stream and consumer group via Honker's SQLite control plane.
// Returns zero time if no offset has been committed yet.
func (sm *StreamManager) GetLastCommittedPullTime(streamName, group string) time.Time {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	offset, err := sm.GetOffset(streamName, group)
	if err != nil || offset <= 0 {
		return time.Time{}
	}

	var createdAt time.Time
	err = sm.db.QueryRowContext(
		ctx,
		"SELECT created_at FROM stream_events WHERE stream_name = ? AND id <= ? ORDER BY id DESC LIMIT 1",
		streamName,
		offset,
	).Scan(&createdAt)
	if err == nil && !createdAt.IsZero() {
		return createdAt.UTC()
	}

	var updatedAt time.Time
	err = sm.db.QueryRowContext(
		ctx,
		"SELECT updated_at FROM stream_offsets WHERE stream_name = ? AND consumer_group = ?",
		streamName,
		group,
	).Scan(&updatedAt)
	if err == nil && !updatedAt.IsZero() {
		return updatedAt.UTC()
	}

	return time.Time{}
}

// TruncateBeforeTime purges stream events created before cutoff time (driven by --stream-retention flag).
func (sm *StreamManager) TruncateBeforeTime(streamName string, cutoff time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	utcCutoff := cutoff.UTC()
	rowsDeleted, err := sm.queries.TruncateStreamEventsByName(ctx, sqlc.TruncateStreamEventsByNameParams{
		StreamName: streamName,
		CutoffTime: utcCutoff,
	})
	if err != nil {
		return 0, err
	}
	if rowsDeleted > 0 {
		_, _ = sm.db.ExecContext(ctx, "PRAGMA incremental_vacuum(1000); PRAGMA wal_checkpoint(PASSIVE);")
		sm.logger.Info("truncated stream events", "stream", streamName, "deleted", rowsDeleted, "cutoff", utcCutoff.Format("2006-01-02 15:04:05"))
	}
	return rowsDeleted, nil
}

// TruncateBeforeTimeSafely purges stream events created before cutoff time ONLY IF they are <= minOffset.
// This guarantees zero data loss by never purging events that have not been committed to lakehouse storage.
func (sm *StreamManager) TruncateBeforeTimeSafely(streamName string, minOffset int64, cutoff time.Time) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	utcCutoff := cutoff.UTC()
	rowsDeleted, err := sm.queries.TruncateStreamEventsSafely(ctx, sqlc.TruncateStreamEventsSafelyParams{
		StreamName: streamName,
		MinOffset:  minOffset,
		CutoffTime: utcCutoff,
	})
	if err != nil {
		return 0, err
	}
	if rowsDeleted > 0 {
		_, _ = sm.db.ExecContext(ctx, "PRAGMA incremental_vacuum(1000); PRAGMA wal_checkpoint(PASSIVE);")
		sm.logger.Info("truncated stream events safely", "stream", streamName, "deleted", rowsDeleted, "min_offset", minOffset, "cutoff", utcCutoff.Format("2006-01-02 15:04:05"))
	}
	return rowsDeleted, nil
}

// GetMinCommittedOffset returns the minimum committed offset across all consumer groups for a stream.
func (sm *StreamManager) GetMinCommittedOffset(streamName string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return sm.queries.GetMinCommittedStreamOffset(ctx, streamName)
}

// GetLag returns the consumer lag (max stream event ID minus committed offset) for a consumer group.
func (sm *StreamManager) GetLag(streamName, group string) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	maxID, err := sm.queries.GetMaxStreamEventID(ctx, streamName)
	if err != nil {
		return 0, err
	}

	offset, err := sm.GetOffset(streamName, group)
	if err != nil {
		return 0, err
	}

	lag := maxID - offset
	if lag < 0 {
		lag = 0
	}
	return lag, nil
}


