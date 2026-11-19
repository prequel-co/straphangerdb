package control

import (
	"context"
	"log/slog"
	"os"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestControlPlaneWithSqlc(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	db, err := InitControlDB(logger, ":memory:")
	if err != nil {
		t.Fatalf("failed initializing control db: %v", err)
	}
	defer db.Close()

	// 1. Test Metadata
	if IsSchemaInitialized(db) {
		t.Fatal("expected schema not initialized initially")
	}
	if err := SetSchemaInitialized(db); err != nil {
		t.Fatalf("failed setting schema initialized: %v", err)
	}
	if !IsSchemaInitialized(db) {
		t.Fatal("expected schema initialized to be true")
	}

	// 2. Test TaskQueue
	tq := NewTaskQueue(logger, db)
	taskID, err := tq.Enqueue("test_task", `{"key":"value"}`)
	if err != nil {
		t.Fatalf("failed to enqueue task: %v", err)
	}
	if taskID <= 0 {
		t.Fatalf("invalid task id: %d", taskID)
	}

	job, err := tq.Claim("worker_1")
	if err != nil {
		t.Fatalf("failed to claim task: %v", err)
	}
	if job.ID != taskID || job.Name != "test_task" {
		t.Fatalf("unexpected job claimed: %+v", job)
	}

	if err := tq.Ack(job.ID); err != nil {
		t.Fatalf("failed to ack task: %v", err)
	}

	// 3. Test StreamManager
	sm := NewStreamManager(logger, db)
	streamName := "stream_fact_vehicle_positions"
	if err := sm.InitStreamTable(streamName); err != nil {
		t.Fatalf("failed init stream table: %v", err)
	}

	ev1, err := sm.Append(streamName, "mta_subway", []byte("event_1"))
	if err != nil {
		t.Fatalf("failed append ev1: %v", err)
	}
	if ev1 <= 0 {
		t.Fatalf("invalid ev1 id: %d", ev1)
	}
	ev2, err := sm.Append(streamName, "mta_bus", []byte("event_2"))
	if err != nil {
		t.Fatalf("failed append ev2: %v", err)
	}

	events, maxID, err := sm.ReadConsumerGroup(streamName, "group_flusher", 10)
	if err != nil {
		t.Fatalf("failed reading consumer group: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if maxID != ev2 {
		t.Fatalf("expected maxID %d, got %d", ev2, maxID)
	}

	if err := sm.CommitOffset(streamName, "group_flusher", maxID); err != nil {
		t.Fatalf("failed committing offset: %v", err)
	}

	// Verify unread events is 0
	unread, _, err := sm.ReadConsumerGroup(streamName, "group_flusher", 10)
	if err != nil {
		t.Fatalf("failed reading unread: %v", err)
	}
	if len(unread) != 0 {
		t.Fatalf("expected 0 unread events, got %d", len(unread))
	}

	// 4. Test WorkflowScheduler
	pubsub := NewPubSub(logger, db)
	scheduler := NewWorkflowScheduler(logger, tq, pubsub)

	var runs int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler.RegisterWorkflow(ctx, WorkflowDefinition{
		Name:     "test_maintenance",
		Interval: 100 * time.Millisecond,
		Handler: func(ctx context.Context) error {
			atomic.AddInt32(&runs, 1)
			return nil
		},
	})

	// Trigger manual execution via executeWorkflow
	scheduler.executeWorkflow(ctx, WorkflowDefinition{
		Name:     "test_direct_maintenance",
		Interval: 1 * time.Minute,
		Handler: func(ctx context.Context) error {
			atomic.AddInt32(&runs, 1)
			return nil
		},
	})

	if atomic.LoadInt32(&runs) != 1 {
		t.Fatalf("expected 1 run, got %d", atomic.LoadInt32(&runs))
	}
}

func TestTaskQueueClaimSpecific(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	db, err := InitControlDB(logger, ":memory:")
	if err != nil {
		t.Fatalf("failed initializing control db: %v", err)
	}
	defer db.Close()

	tq := NewTaskQueue(logger, db)

	// Enqueue task 1 and task 2
	id1, err := tq.Enqueue("task_one", `{"n":1}`)
	if err != nil {
		t.Fatalf("failed enqueuing task 1: %v", err)
	}
	id2, err := tq.Enqueue("task_two", `{"n":2}`)
	if err != nil {
		t.Fatalf("failed enqueuing task 2: %v", err)
	}

	// Claim task 2 specifically out of FIFO order
	job2, err := tq.ClaimSpecific(id2, "worker_b")
	if err != nil {
		t.Fatalf("failed to claim task 2 specifically: %v", err)
	}
	if job2 == nil || job2.ID != id2 || job2.Name != "task_two" {
		t.Fatalf("unexpected claimed job for id2: %+v", job2)
	}

	// Verify task 1 remains pending and can still be claimed
	job1, err := tq.ClaimSpecific(id1, "worker_a")
	if err != nil {
		t.Fatalf("failed to claim task 1 specifically: %v", err)
	}
	if job1 == nil || job1.ID != id1 || job1.Name != "task_one" {
		t.Fatalf("unexpected claimed job for id1: %+v", job1)
	}

	// Verify claiming a non-pending task returns nil
	jobAgain, err := tq.ClaimSpecific(id1, "worker_c")
	if err != nil {
		t.Fatalf("unexpected error claiming already-claimed task: %v", err)
	}
	if jobAgain != nil {
		t.Fatalf("expected nil when claiming already-claimed task, got: %+v", jobAgain)
	}
}

