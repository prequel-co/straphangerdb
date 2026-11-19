package control

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// WorkflowHandler is the function executed when a workflow task fires.
type WorkflowHandler func(ctx context.Context) error

// WorkflowDefinition describes a scheduled recurring maintenance workflow.
type WorkflowDefinition struct {
	Name         string
	InitialDelay time.Duration
	Interval     time.Duration
	Timeout      time.Duration
	Handler      WorkflowHandler
}

// WorkflowScheduler manages recurring workflow timers backed by Honker TaskQueue in SQLite.
type WorkflowScheduler struct {
	logger    *slog.Logger
	taskQueue *TaskQueue
	pubsub    *SimplePubSub
	workerID  string
}

// NewWorkflowScheduler creates a new workflow scheduler instance.
func NewWorkflowScheduler(logger *slog.Logger, taskQueue *TaskQueue, pubsub *SimplePubSub) *WorkflowScheduler {
	hostname, _ := os.Hostname()
	workerID := fmt.Sprintf("straphanger_%s_%d", hostname, time.Now().UnixNano())
	return &WorkflowScheduler{
		logger:    logger,
		taskQueue: taskQueue,
		pubsub:    pubsub,
		workerID:  workerID,
	}
}

// RegisterWorkflow schedules a recurring workflow task that executes only after system bootstrap succeeds.
func (ws *WorkflowScheduler) RegisterWorkflow(ctx context.Context, wf WorkflowDefinition) {
	SafeGo(ws.logger, "workflow_"+wf.Name, func() {
		// Guard: only run if table setups/bootstrapping succeed
		if err := ws.pubsub.WaitForBootstrap("sys:bootstrap", 30*time.Second); err != nil {
			ws.logger.Error("workflow scheduler timed out waiting for bootstrap signal", "workflow", wf.Name, "error", err)
			return
		}

		ws.logger.Info("workflow scheduler registered and ready", "workflow", wf.Name, "interval", wf.Interval.String(), "initial_delay", wf.InitialDelay.String())

		// Execute initial run after the configured initial stagger delay
		initialDelay := wf.InitialDelay
		if initialDelay <= 0 {
			initialDelay = 30 * time.Second
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(initialDelay):
			ws.executeWorkflow(ctx, wf)
		}

		ticker := time.NewTicker(wf.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ws.executeWorkflow(ctx, wf)
			}
		}
	})
}

func (ws *WorkflowScheduler) executeWorkflow(ctx context.Context, wf WorkflowDefinition) {
	ws.logger.Info("triggering scheduled workflow execution", "workflow", wf.Name)

	jobID, err := ws.taskQueue.Enqueue(wf.Name, fmt.Sprintf(`{"scheduled_at":"%s"}`, time.Now().UTC().Format(time.RFC3339)))
	if err != nil {
		ws.logger.Error("failed to enqueue workflow task", "workflow", wf.Name, "error", err)
		return
	}

	job, err := ws.taskQueue.ClaimSpecific(jobID, ws.workerID)
	if err != nil || job == nil {
		// Task was claimed or already in progress
		return
	}

	timeout := wf.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	start := time.Now()
	if err := wf.Handler(execCtx); err != nil {
		ws.logger.Error("workflow execution failed", "workflow", wf.Name, "duration", time.Since(start), "error", err)
		_ = ws.taskQueue.Ack(job.ID)
		return
	}

	_ = ws.taskQueue.Ack(job.ID)
	ws.logger.Info("workflow execution completed successfully", "workflow", wf.Name, "duration", time.Since(start))
}
