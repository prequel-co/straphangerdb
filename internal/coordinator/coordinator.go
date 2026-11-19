package coordinator

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/control"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"github.com/prequel-co/straphangerdb/pkg/schema"
)

// EngineCoordinator orchestrates data ingestion pollers, centralized table flushers,
// scheduled maintenance workflows, and compaction sentinel synchronization.
type EngineCoordinator struct {
	logger             *slog.Logger
	cfg                *config.Config
	sqliteDB           *sqlx.DB
	duck               *dataplane.DuckEngine
	pubsub             *control.SimplePubSub
	streamMgr          *control.StreamManager
	taskQueue          *control.TaskQueue
	workflowScheduler  *control.WorkflowScheduler
	compactionSentinel *control.R2CompactionSentinel
	streamTables       map[string]map[string]plugin.DataSource
	activeStreamsMu    sync.RWMutex
	activeStreams      []string
	flushedCounts      sync.Map
	deltaSyncRunning   sync.Map
	flushWg            sync.WaitGroup
}

// NewEngineCoordinator constructs a new EngineCoordinator instance.
func NewEngineCoordinator(
	logger *slog.Logger,
	cfg *config.Config,
	sqliteDB *sqlx.DB,
	duck *dataplane.DuckEngine,
) *EngineCoordinator {
	pubsub := control.NewPubSub(logger, sqliteDB)
	streamMgr := control.NewStreamManager(logger, sqliteDB)
	taskQueue := control.NewTaskQueue(logger, sqliteDB)
	if err := taskQueue.InitTaskTable(); err != nil {
		logger.Warn("honker task table init note", "error", err)
	}
	workflowScheduler := control.NewWorkflowScheduler(logger, taskQueue, pubsub)

	var compactionSentinel *control.R2CompactionSentinel
	if (cfg.OTFFormat == "iceberg" || cfg.OTFFormat == "all") && os.Getenv("CLOUDFLARE_API_TOKEN") != "" {
		compactionSentinel = control.NewR2CompactionSentinel(
			logger,
			pubsub,
			sqliteDB,
			os.Getenv("CLOUDFLARE_ACCOUNT_ID"),
			cfg.R2BucketName,
			os.Getenv("CLOUDFLARE_API_TOKEN"),
			os.Getenv("ICEBERG_TOKEN"),
			cfg.CompactionPauseTimeout,
			nil,
		)
	}

	return &EngineCoordinator{
		logger:             logger,
		cfg:                cfg,
		sqliteDB:           sqliteDB,
		duck:               duck,
		pubsub:             pubsub,
		streamMgr:          streamMgr,
		taskQueue:          taskQueue,
		workflowScheduler:  workflowScheduler,
		compactionSentinel: compactionSentinel,
		streamTables:       make(map[string]map[string]plugin.DataSource),
	}
}

// RegisterWorkflows schedules staggered maintenance workflows and the R2 compaction sentinel.
func (c *EngineCoordinator) RegisterWorkflows(ctx context.Context) {
	otf := c.cfg.OTFFormat
	if otf == "iceberg" || otf == "delta" || otf == "all" {
		c.workflowScheduler.RegisterWorkflow(ctx, control.WorkflowDefinition{
			Name:         "iceberg_maintenance",
			InitialDelay: 1 * time.Minute,
			Interval:     10 * time.Minute,
			Timeout:      10 * time.Minute,
			Handler:      c.duck.RunIcebergMaintenance,
		})
		c.workflowScheduler.RegisterWorkflow(ctx, control.WorkflowDefinition{
			Name:         "delta_maintenance",
			InitialDelay: 7 * time.Minute,
			Interval:     10 * time.Minute,
			Timeout:      10 * time.Minute,
			Handler:      c.duck.RunDeltaMaintenance,
		})
	}
	if otf == "ducklake" || otf == "all" || otf == "" {
		c.workflowScheduler.RegisterWorkflow(ctx, control.WorkflowDefinition{
			Name:         "ducklake_maintenance",
			InitialDelay: 4 * time.Minute,
			Interval:     10 * time.Minute,
			Timeout:      15 * time.Minute,
			Handler:      c.duck.RunDucklakeMaintenance,
		})
	}

	if c.compactionSentinel != nil {
		c.workflowScheduler.RegisterWorkflow(ctx, control.WorkflowDefinition{
			Name:         "r2_compaction_sentinel",
			InitialDelay: 15 * time.Second,
			Interval:     1 * time.Minute,
			Timeout:      30 * time.Second,
			Handler:      c.compactionSentinel.RunSentinelCheck,
		})
		c.logger.Info("registered honker r2 compaction sentinel workflow",
			"interval", "1m",
			"pause_timeout", c.cfg.CompactionPauseTimeout.String(),
		)
	}
}

// BootstrapSchema initializes table schemas and publishes bootstrap completion signal.
func (c *EngineCoordinator) BootstrapSchema(ctx context.Context) {
	// Initialize schema DDLs synchronously in local DuckEngine
	for _, ddl := range schema.GetBootstrapDDL(schema.CurrentSchemaVersion) {
		if _, err := c.duck.DB().ExecContext(ctx, ddl); err != nil {
			c.logger.Warn("init ddl note", "ddl", ddl, "error", err)
		}
	}

	control.SafeGo(c.logger, "bootstrap_tables", func() {
		if !control.IsSchemaInitialized(c.sqliteDB) {
			c.logger.Info("executing table schema bootstrapping...", "version", schema.CurrentSchemaVersion)
			if err := control.SetSchemaInitialized(c.sqliteDB); err != nil {
				c.logger.Error("failed setting schema_initialized", "error", err)
			}
		}
		c.pubsub.Publish("sys:bootstrap", "initialized")
	})
}

// shouldEnablePlugin checks whether an opt-in feed requiring an API key or custom URL should be polled.
func shouldEnablePlugin(pluginID string) (bool, string) {
	if os.Getenv("STRAPHANGER_ALLOW_SYNTHETIC") == "true" {
		return true, ""
	}
	switch pluginID {
	case "njt_gtfs_rt":
		if os.Getenv("NJT_API_KEY") == "" && os.Getenv("NJT_GTFS_RT_URL") == "" {
			return false, "NJT_API_KEY or NJT_GTFS_RT_URL not set"
		}
	case "airtrain_gtfs_rt":
		if os.Getenv("AIRTRAIN_GTFS_RT_URL") == "" {
			return false, "AIRTRAIN_GTFS_RT_URL not set"
		}
	}
	return true, ""
}

// StartPollers registers dataset plugins, starts high-frequency streaming ingest, and schedules batch plugins.
func (c *EngineCoordinator) StartPollers(ctx context.Context) {
	registeredPlugins := plugin.List()
	c.logger.Info("registered dataset plugins", "count", len(registeredPlugins))

	batchIdx := 0
	for _, ds := range registeredPlugins {
		p := ds
		if enabled, reason := shouldEnablePlugin(p.ID()); !enabled {
			c.logger.Info("skipping opt-in plugin", "plugin", p.ID(), "reason", reason)
			continue
		}
		if p.Mode() == plugin.ModeStream {
			control.IngestStream(ctx, c.logger, c.streamMgr, p)

			targetTable := p.TargetTable()
			if c.streamTables[targetTable] == nil {
				c.streamTables[targetTable] = make(map[string]plugin.DataSource)
			}
			c.streamTables[targetTable][p.ID()] = p
		} else if p.Mode() == plugin.ModeBatch {
			currentBatchIdx := batchIdx
			batchIdx++
			control.SafeGo(c.logger, "batch_worker_"+p.ID(), func() {
				if err := c.pubsub.WaitForBootstrap("sys:bootstrap", 30*time.Second); err != nil {
					c.logger.Error("batch worker timed out waiting for bootstrap signal", "plugin", p.ID())
					return
				}

				time.Sleep(time.Duration(currentBatchIdx*5+5) * time.Second)

				c.logger.Info("batch worker ready, executing load", "plugin", p.ID())
				runBatch := func() {
					data, err := p.Fetch(ctx)
					if err != nil {
						control.RecordFeedFetchError(p.ID())
						c.logger.Error("batch plugin fetch failed", "plugin", p.ID(), "error", err)
						return
					}
					event := control.StreamEvent{
						Topic:     p.ID(),
						Payload:   data,
						CreatedAt: time.Now(),
					}
					var batchErr error
					switch c.cfg.OTFFormat {
					case "iceberg":
						batchErr = c.duck.WriteIcebergBatch(ctx, p, []control.StreamEvent{event})
						if batchErr == nil {
							c.triggerDeltaUniFormSync(p.TargetTable())
						}
					case "delta":
						c.logger.Info("OTFFormat set to delta: writing batch to Iceberg; Delta metadata is synchronized asynchronously via Honker Delta UniForm sync", "plugin", p.ID(), "table", p.TargetTable())
						batchErr = c.duck.WriteIcebergBatch(ctx, p, []control.StreamEvent{event})
						if batchErr == nil {
							c.triggerDeltaUniFormSync(p.TargetTable())
						}
					case "ducklake":
						batchErr = c.duck.WriteDucklakeBatch(ctx, p, []control.StreamEvent{event})
					case "all":
						var errs []string
						if err := c.duck.WriteIcebergBatch(ctx, p, []control.StreamEvent{event}); err != nil {
							errs = append(errs, "iceberg: "+err.Error())
						} else {
							c.triggerDeltaUniFormSync(p.TargetTable())
						}
						if err := c.duck.WriteDucklakeBatch(ctx, p, []control.StreamEvent{event}); err != nil {
							errs = append(errs, "ducklake: "+err.Error())
						}
						if len(errs) > 0 {
							batchErr = errors.New(strings.Join(errs, "; "))
						}
					default:
						batchErr = c.duck.WriteDucklakeBatch(ctx, p, []control.StreamEvent{event})
					}
					if batchErr != nil {
						c.logger.Error("failed writing batch dataset to OTF", "plugin", p.ID(), "error", batchErr)
					} else {
						c.logger.Info("successfully wrote batch dataset to OTF", "plugin", p.ID())
					}
				}

				runBatch()

				ticker := time.NewTicker(p.DefaultInterval())
				defer ticker.Stop()

				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						runBatch()
					}
				}
			})
		}
	}

	// Initial stream retention cleanup on startup across all streams
	initialCutoff := time.Now().Add(-1 * c.cfg.StreamRetention)
	for tbl := range c.streamTables {
		streamName := "stream_" + tbl
		c.activeStreamsMu.Lock()
		c.activeStreams = append(c.activeStreams, streamName)
		c.activeStreamsMu.Unlock()
		if deleted, err := c.streamMgr.TruncateBeforeTime(streamName, initialCutoff); err == nil && deleted > 0 {
			c.logger.Info("purged expired stream events on startup", "stream", streamName, "deleted", deleted)
		}
	}
}

// StartTableFlushers launches centralized micro-batch flush loops for all target tables.
func (c *EngineCoordinator) StartTableFlushers(ctx context.Context) {
	for tbl, pluginsMap := range c.streamTables {
		targetTable := tbl
		plugins := pluginsMap
		streamName := "stream_" + targetTable

		control.SafeGo(c.logger, "flush_worker_"+targetTable, func() {
			if err := c.pubsub.WaitForBootstrap("sys:bootstrap", 30*time.Second); err != nil {
				c.logger.Error("flush worker timed out waiting for bootstrap signal", "table", targetTable)
				return
			}

			c.logger.Info("centralized table flush worker ready, entering micro-batch loop", "table", targetTable, "plugins_count", len(plugins))
			ticker := time.NewTicker(c.cfg.FlushInterval)
			defer ticker.Stop()

			compactionSub := c.pubsub.Subscribe("sys:compaction")
			isPaused := false
			pauseSignal := "pause:" + targetTable
			resumeSignal := "resume:" + targetTable

			drainBatchSize := c.cfg.DrainBatchSize
			if drainBatchSize <= 0 {
				drainBatchSize = 250000
			}

			drainBacklog := func() {
				c.flushWg.Add(1)
				defer c.flushWg.Done()

				batchNum := 0
				totalDrained := 0
				drainStart := time.Now()

				for {
					if ctx.Err() != nil {
						break
					}
					events, newOffset, err := c.streamMgr.ReadConsumerGroup(streamName, "duckdb_table_flusher", drainBatchSize)
					if err != nil {
						c.logger.Error("failed to read table consumer group", "table", targetTable, "stream", streamName, "error", err)
						break
					}
					if len(events) == 0 {
						if batchNum > 1 {
							c.logger.Info("completed backlog catch-up drain",
								"table", targetTable,
								"total_records", totalDrained,
								"batches", batchNum,
								"total_duration", time.Since(drainStart).Round(time.Millisecond).String(),
							)
						}
						break
					}

					batchNum++
					totalDrained += len(events)
					batchStart := time.Now()
					c.logger.Info("flushing centralized table batch",
						"table", targetTable,
						"batch_num", batchNum,
						"events_count", len(events),
					)

					flushErr := c.FlushTableBatch(ctx, targetTable, plugins, events)
					if flushErr != nil {
						c.logger.Error("failed flushing centralized table micro-batch to OTF",
							"table", targetTable,
							"batch_num", batchNum,
							"events_count", len(events),
							"error", flushErr,
						)
						break
					}

					if err := c.streamMgr.CommitOffset(streamName, "duckdb_table_flusher", newOffset); err != nil {
						c.logger.Error("failed committing stream offset", "stream", streamName, "offset", newOffset, "error", err)
					}

					val, _ := c.flushedCounts.LoadOrStore(targetTable, &atomic.Int64{})
					val.(*atomic.Int64).Add(int64(len(events)))

					c.logger.Info("flushed centralized table batch successfully",
						"table", targetTable,
						"batch_num", batchNum,
						"events_count", len(events),
						"batch_duration", time.Since(batchStart).Round(time.Millisecond).String(),
					)

					if len(events) < drainBatchSize {
						break
					}
				}

				committedOffset, err := c.streamMgr.GetOffset(streamName, "duckdb_table_flusher")
				if err == nil && committedOffset > 0 {
					cutoff := time.Now().Add(-1 * c.cfg.StreamRetention)
					if deleted, err := c.streamMgr.TruncateBeforeTimeSafely(streamName, committedOffset, cutoff); err == nil && deleted > 0 {
						c.logger.Info("truncated committed stream events safely", "stream", streamName, "deleted", deleted, "watermark", committedOffset)
					}
				}

				if batchNum > 1 {
					c.logger.Info("reclaiming duckdb memory after backlog catch-up drain",
						"table", targetTable,
						"batches", batchNum,
						"total_records", totalDrained,
					)
					if err := c.duck.ReclaimMemory(ctx); err != nil {
						c.logger.Warn("duckdb memory reclamation notice", "table", targetTable, "error", err)
					}
				}
			}

			for {
				select {
				case <-ctx.Done():
					return
				case msg := <-compactionSub:
					switch {
					case msg == pauseSignal || msg == "pause:*":
						if !isPaused {
							isPaused = true
							c.logger.Warn("table flush worker paused by honker compaction sentinel",
								"table", targetTable,
								"signal", msg,
							)
						}
					case msg == resumeSignal || msg == "resume:*":
						if isPaused {
							isPaused = false
							c.logger.Info("table flush worker resumed by honker compaction sentinel; draining backlog",
								"table", targetTable,
								"drain_batch_size", drainBatchSize,
							)
							drainBacklog()
						}
					}
				case <-ticker.C:
					if isPaused && (c.compactionSentinel == nil || !c.compactionSentinel.IsTablePaused(targetTable)) {
						c.logger.Info("table flusher detected sentinel is no longer paused; self-healing state", "table", targetTable)
						isPaused = false
					}
					if isPaused || (c.compactionSentinel != nil && c.compactionSentinel.IsTablePaused(targetTable)) {
						c.logger.Debug("table flusher paused for compaction, skipping scheduled tick", "table", targetTable)
						continue
					}
					drainBacklog()
				}
			}
		})
	}
}

// triggerDeltaUniFormSync enqueues an asynchronous Delta UniForm sync for targetTable if not already running.
func (c *EngineCoordinator) triggerDeltaUniFormSync(targetTable string) {
	if c.duck.GetDeltaSyncer() == nil {
		return
	}
	// Coalesce: avoid spawning concurrent overlapping syncs for the same table
	val, loaded := c.deltaSyncRunning.LoadOrStore(targetTable, true)
	if loaded && val.(bool) {
		c.logger.Debug("delta uniform sync already active for table, coalescing", "table", targetTable)
		return
	}

	control.SafeGo(c.logger, "delta_uniform_sync_"+targetTable, func() {
		defer c.deltaSyncRunning.Delete(targetTable)

		taskID, _ := c.taskQueue.Enqueue("delta_sync:"+targetTable, fmt.Sprintf(`{"table":"%s","enqueued_at":"%s"}`, targetTable, time.Now().UTC().Format(time.RFC3339)))
		if taskID > 0 {
			_, _ = c.taskQueue.ClaimSpecific(taskID, "delta_sync_worker")
			defer func() {
				_ = c.taskQueue.Ack(taskID)
			}()
		}

		syncCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		ver, err := c.duck.SyncTableFromIceberg(syncCtx, targetTable)
		if err != nil {
			c.logger.Debug("asynchronous delta uniform sync note", "table", targetTable, "error", err)
		} else if ver >= 0 {
			c.logger.Info("asynchronously synchronized delta uniform commit", "table", targetTable, "version", ver)
		}
	})
}

// FlushTableBatch executes the multi-OTF commit across target formats according to configuration.
func (c *EngineCoordinator) FlushTableBatch(ctx context.Context, targetTable string, plugins map[string]plugin.DataSource, events []control.StreamEvent) error {
	if c.streamMgr != nil && c.duck != nil {
		lastPullAt := c.streamMgr.GetLastCommittedPullTime("stream_"+targetTable, "duckdb_table_flusher")
		c.duck.SetTableLastPullTime(targetTable, lastPullAt)
	}

	switch c.cfg.OTFFormat {
	case "iceberg":
		if err := c.duck.WriteTableBatchIceberg(ctx, targetTable, plugins, events); err != nil {
			return err
		}
		c.triggerDeltaUniFormSync(targetTable)
		return nil
	case "delta":
		c.logger.Info("OTFFormat set to delta: writing to Iceberg; Delta metadata is synchronized asynchronously via Honker Delta UniForm sync", "table", targetTable)
		if err := c.duck.WriteTableBatchIceberg(ctx, targetTable, plugins, events); err != nil {
			return err
		}
		c.triggerDeltaUniFormSync(targetTable)
		return nil
	case "ducklake":
		return c.duck.WriteTableBatchDucklake(ctx, targetTable, plugins, events)
	case "all":
		var errs []string
		if err := c.duck.WriteTableBatchIceberg(ctx, targetTable, plugins, events); err != nil {
			errs = append(errs, "iceberg: "+err.Error())
		} else {
			c.triggerDeltaUniFormSync(targetTable)
		}
		if err := c.duck.WriteTableBatchDucklake(ctx, targetTable, plugins, events); err != nil {
			errs = append(errs, "ducklake: "+err.Error())
		}
		if len(errs) > 0 {
			return errors.New(strings.Join(errs, "; "))
		}
		return nil
	default:
		return c.duck.WriteTableBatchDucklake(ctx, targetTable, plugins, events)
	}
}

// GracefulDrain drains all pending micro-batches before application shutdown within the timeout context.
func (c *EngineCoordinator) GracefulDrain(ctx context.Context, timeout time.Duration) {
	drainCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Wait for any in-flight table flusher iterations to finish committing their current offset
	// so GracefulDrain does not read and flush the same consumer group batch twice.
	inflightDone := make(chan struct{})
	go func() {
		c.flushWg.Wait()
		close(inflightDone)
	}()
	select {
	case <-inflightDone:
	case <-drainCtx.Done():
		c.logger.Warn("timed out waiting for in-flight table flushers during shutdown drain")
		return
	}

	batchSize := 5000
	if c.cfg != nil && c.cfg.DrainBatchSize > 0 {
		batchSize = c.cfg.DrainBatchSize
	}

	for tbl, pluginsMap := range c.streamTables {
		targetTable := tbl
		streamName := "stream_" + targetTable
		for drainCtx.Err() == nil {
			events, newOffset, err := c.streamMgr.ReadConsumerGroup(streamName, "duckdb_table_flusher", batchSize)
			if err != nil || len(events) == 0 {
				break
			}
			c.logger.Info("executing final shutdown micro-batch flush", "table", targetTable, "events_count", len(events))
			if flushErr := c.FlushTableBatch(drainCtx, targetTable, pluginsMap, events); flushErr == nil {
				c.streamMgr.CommitOffset(streamName, "duckdb_table_flusher", newOffset)
				val, _ := c.flushedCounts.LoadOrStore(targetTable, &atomic.Int64{})
				val.(*atomic.Int64).Add(int64(len(events)))
			} else {
				c.logger.Warn("final shutdown flush failed", "table", targetTable, "error", flushErr)
				break
			}
		}
		if c.cfg != nil {
			if committedOffset, err := c.streamMgr.GetOffset(streamName, "duckdb_table_flusher"); err == nil && committedOffset > 0 {
				cutoff := time.Now().Add(-1 * c.cfg.StreamRetention)
				_, _ = c.streamMgr.TruncateBeforeTimeSafely(streamName, committedOffset, cutoff)
			}
		}
	}

	// Post-drain memory compaction to release OS pages before final container shutdown
	if err := c.duck.ReclaimMemory(drainCtx); err != nil {
		c.logger.Debug("post-drain memory reclamation note", "error", err)
	}
}

// GetFlushedCounts returns a snapshot map of total records flushed per target table.
func (c *EngineCoordinator) GetFlushedCounts() map[string]int64 {
	counts := make(map[string]int64)
	c.flushedCounts.Range(func(key, value any) bool {
		tbl, ok := key.(string)
		if !ok {
			return true
		}
		counter, ok := value.(*atomic.Int64)
		if !ok {
			return true
		}
		counts[tbl] = counter.Load()
		return true
	})
	return counts
}

// GetActiveStreams returns the list of stream table names registered.
func (c *EngineCoordinator) GetActiveStreams() []string {
	c.activeStreamsMu.RLock()
	defer c.activeStreamsMu.RUnlock()
	copied := make([]string, len(c.activeStreams))
	copy(copied, c.activeStreams)
	return copied
}

// GetStreamManager returns the StreamManager.
func (c *EngineCoordinator) GetStreamManager() *control.StreamManager {
	return c.streamMgr
}

// GetCompactionSentinel returns the R2CompactionSentinel, if active.
func (c *EngineCoordinator) GetCompactionSentinel() *control.R2CompactionSentinel {
	return c.compactionSentinel
}
