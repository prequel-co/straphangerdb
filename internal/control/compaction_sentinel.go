package control

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
)

// TableCompactionStatus represents the persisted status of a table's compaction cycle.
type TableCompactionStatus struct {
	Table                 string    `json:"table"`
	Namespace             string    `json:"namespace"`
	State                 string    `json:"state"` // "idle", "paused", "compacting"
	NextEligibleAt        time.Time `json:"next_eligible_at"`
	InitialNextEligibleAt time.Time `json:"initial_next_eligible_at,omitempty"`
	PausedAt              time.Time `json:"paused_at,omitempty"`
	LastCheckedAt         time.Time `json:"last_checked_at"`
	Reason                string    `json:"reason,omitempty"`
}

// cfMaintenanceResponse models the Cloudflare maintenance config JSON response.
type cfMaintenanceResponse struct {
	Result struct {
		MaintenanceConfig struct {
			Interval   string `json:"interval"`
			Compaction struct {
				State          string `json:"state"`
				TargetSizeMB   string `json:"target_size_mb"`
				NextEligibleAt string `json:"next_eligible_at"`
			} `json:"compaction"`
			SnapshotExpiration struct {
				State              string `json:"state"`
				MinSnapshotsToKeep int    `json:"min_snapshots_to_keep"`
				MaxSnapshotAge     string `json:"max_snapshot_age"`
				NextEligibleAt     string `json:"next_eligible_at"`
			} `json:"snapshot_expiration"`
		} `json:"maintenance_config"`
	} `json:"result"`
	Success  bool     `json:"success"`
	Errors   []any    `json:"errors"`
	Messages []string `json:"messages"`
}

// R2CompactionSentinel monitors Cloudflare R2 table maintenance and coordinates flush pauses via Honker Pub/Sub.
type R2CompactionSentinel struct {
	logger       *slog.Logger
	pubsub       *SimplePubSub
	db           *sqlx.DB
	accountID    string
	catalogName  string
	apiToken     string
	icebergToken string
	pauseTimeout     time.Duration
	minPauseDuration time.Duration
	httpClient       *http.Client
	tables           []string

	mu          sync.Mutex
	tableStates map[string]*TableCompactionStatus
}

// NewR2CompactionSentinel creates a new sentinel instance for Cloudflare R2 Iceberg compaction.
func NewR2CompactionSentinel(
	logger *slog.Logger,
	pubsub *SimplePubSub,
	db *sqlx.DB,
	accountID string,
	catalogName string,
	apiToken string,
	icebergToken string,
	pauseTimeout time.Duration,
	tables []string,
) *R2CompactionSentinel {
	if accountID == "" {
		accountID = os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	}
	if catalogName == "" {
		catalogName = os.Getenv("R2_BUCKET_NAME")
	}
	if catalogName == "" {
		catalogName = "straphanger-db-dev"
	}
	if apiToken == "" {
		apiToken = os.Getenv("CLOUDFLARE_API_TOKEN")
	}
	if icebergToken == "" {
		icebergToken = os.Getenv("ICEBERG_TOKEN")
	}
	if pauseTimeout <= 0 {
		pauseTimeout = 20 * time.Minute
	}
	if len(tables) == 0 {
		tables = []string{"fact_vehicle_positions", "fact_alerts", "fact_micromobility_status", "dim_stations", "dim_routes"}
	}

	return &R2CompactionSentinel{
		logger:       logger,
		pubsub:       pubsub,
		db:           db,
		accountID:    accountID,
		catalogName:  catalogName,
		apiToken:     apiToken,
		icebergToken: icebergToken,
		pauseTimeout:     pauseTimeout,
		minPauseDuration: 3 * time.Minute,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		tables:      tables,
		tableStates: make(map[string]*TableCompactionStatus),
	}
}

// SetMinPauseDuration overrides the minimum pause duration (primarily used in tests).
func (s *R2CompactionSentinel) SetMinPauseDuration(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.minPauseDuration = d
}

// RunSentinelCheck is the entry point designed to be registered as a Honker recurring maintenance workflow.
func (s *R2CompactionSentinel) RunSentinelCheck(ctx context.Context) error {
	if s.apiToken == "" {
		s.logger.Debug("r2 compaction sentinel skipped; no cloudflare api token configured")
		return nil
	}

	namespace := os.Getenv("ICEBERG_NAMESPACE")
	if namespace == "" {
		namespace = "transit_v2"
	}
	for _, table := range s.tables {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			if err := s.CheckTableCompaction(ctx, namespace, table); err != nil {
				s.logger.Warn("r2 compaction check error for table", "table", table, "error", err)
			}
		}
	}
	return nil
}

// CheckTableCompaction polls Cloudflare's maintenance configuration for a single table and executes pause/resume transitions.
func (s *R2CompactionSentinel) CheckTableCompaction(ctx context.Context, namespace, table string) error {
	cfConfig, err := s.fetchMaintenanceConfig(ctx, namespace, table)
	if err != nil {
		return fmt.Errorf("failed to fetch cloudflare maintenance config: %w", err)
	}
	return s.ProcessMaintenanceConfig(ctx, namespace, table, cfConfig)
}

// ProcessMaintenanceConfig processes a table maintenance configuration and executes state machine transitions.
func (s *R2CompactionSentinel) ProcessMaintenanceConfig(ctx context.Context, namespace, table string, cfConfig *cfMaintenanceResponse) error {
	compaction := cfConfig.Result.MaintenanceConfig.Compaction
	if compaction.State != "enabled" {
		s.logger.Debug("compaction disabled for table in cloudflare", "table", table)
		return nil
	}

	var nextEligible time.Time
	if compaction.NextEligibleAt != "" {
		t, err := time.Parse(time.RFC3339Nano, compaction.NextEligibleAt)
		if err == nil {
			nextEligible = t
		} else {
			// Try standard RFC3339
			t, err = time.Parse(time.RFC3339, compaction.NextEligibleAt)
			if err == nil {
				nextEligible = t
			}
		}
	}

	s.mu.Lock()
	status, exists := s.tableStates[table]
	if !exists {
		status = &TableCompactionStatus{
			Table:          table,
			Namespace:      namespace,
			State:          "idle",
			NextEligibleAt: nextEligible,
		}
		s.tableStates[table] = status
	}
	status.NextEligibleAt = nextEligible
	status.LastCheckedAt = time.Now()
	currentState := status.State
	pausedAt := status.PausedAt
	initialNext := status.InitialNextEligibleAt
	s.mu.Unlock()

	now := time.Now()

	switch currentState {
	case "idle":
		// Enter compaction window if within 1 minute of eligibility or past eligibility
		if !nextEligible.IsZero() && now.After(nextEligible.Add(-1*time.Minute)) {
			// If next_eligible is ancient (e.g. over 2 hours in the past) and nothing ran, Cloudflare might have skipped it
			if now.Sub(nextEligible) > 2*time.Hour {
				s.logger.Debug("next_eligible_at is stale, awaiting cloudflare reschedule", "table", table, "next_eligible_at", nextEligible)
				return nil
			}

			s.logger.Warn("entering r2 compaction eligibility window, requesting flush pause",
				"table", table,
				"next_eligible_at", nextEligible.UTC().Format(time.RFC3339),
				"pause_timeout", s.pauseTimeout.String(),
			)

			s.mu.Lock()
			status.State = "paused"
			status.PausedAt = now
			status.InitialNextEligibleAt = nextEligible
			status.Reason = "eligibility_window_reached"
			s.mu.Unlock()

			s.persistStatus(status)
			s.pubsub.Publish("sys:compaction", fmt.Sprintf("pause:%s", table))
		} else {
			s.logger.Debug("table compaction scheduled",
				"table", table,
				"next_eligible_at", nextEligible.UTC().Format(time.RFC3339),
				"time_until_window", time.Until(nextEligible).Round(time.Second).String(),
			)
		}

	case "paused":
		elapsed := now.Sub(pausedAt)

		// Condition A: Safety timeout reached
		if elapsed >= s.pauseTimeout {
			s.logger.Warn("r2 compaction pause safety timeout reached, forcing flusher resume",
				"table", table,
				"elapsed", elapsed.Round(time.Second).String(),
				"timeout", s.pauseTimeout.String(),
			)
			s.resumeTable(status, "safety_timeout_exceeded")
			return nil
		}

		// Condition B: Cloudflare rescheduled next_eligible_at to the future.
		// Cloudflare maintenance runs on an hourly schedule: when compaction finishes, next_eligible_at is advanced by ~1 hour.
		// If checked shortly after completion, nextEligible - now is ~59m, so checking > 1 hour misses the advance.
		// We detect Cloudflare advancing the schedule when nextEligible is >= 10 minutes in the future,
		// or at least 5 minutes beyond the initial eligibility marker that triggered the pause.
		// We enforce a minimum pause duration (minPauseDuration, default 3m) so the sentinel does not
		// prematurely resume before the compaction cycle metadata settles.
		rescheduled := !nextEligible.IsZero() && (nextEligible.After(now.Add(10*time.Minute)) || (!initialNext.IsZero() && nextEligible.After(initialNext.Add(5*time.Minute))))
		if rescheduled {
			if s.minPauseDuration > 0 && elapsed < s.minPauseDuration {
				s.logger.Info("cloudflare advanced next_eligible_at, holding pause for minimum maintenance window",
					"table", table,
					"elapsed", elapsed.Round(time.Second).String(),
					"min_pause", s.minPauseDuration.String(),
				)
				return nil
			}
			s.logger.Info("r2 compaction cycle finished in cloudflare, next window scheduled; resuming flusher",
				"table", table,
				"new_next_eligible_at", nextEligible.UTC().Format(time.RFC3339),
				"paused_duration", elapsed.Round(time.Second).String(),
			)
			s.resumeTable(status, "compaction_completed_or_rescheduled")
			return nil
		}

		// Heartbeat while paused
		s.logger.Info("r2 compaction pause active heartbeat",
			"table", table,
			"elapsed_pause", elapsed.Round(time.Second).String(),
			"remaining_timeout", (s.pauseTimeout - elapsed).Round(time.Second).String(),
			"next_eligible_at", nextEligible.UTC().Format(time.RFC3339),
		)
	}

	return nil
}

// resumeTable transitions a table from paused back to idle and publishes a resume signal.
func (s *R2CompactionSentinel) resumeTable(status *TableCompactionStatus, reason string) {
	s.mu.Lock()
	status.State = "idle"
	status.Reason = reason
	status.PausedAt = time.Time{}
	status.InitialNextEligibleAt = time.Time{}
	s.mu.Unlock()

	s.persistStatus(status)
	s.pubsub.Publish("sys:compaction", fmt.Sprintf("resume:%s", status.Table))
}

// IsTablePaused checks if a specific table is currently marked as paused for compaction.
func (s *R2CompactionSentinel) IsTablePaused(table string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st, ok := s.tableStates[table]; ok {
		return st.State == "paused"
	}
	return false
}

// GetPausedTables returns a list of table names currently paused for compaction.
func (s *R2CompactionSentinel) GetPausedTables() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var paused []string
	for tbl, st := range s.tableStates {
		if st.State == "paused" {
			paused = append(paused, tbl)
		}
	}
	return paused
}


// fetchMaintenanceConfig queries Cloudflare's REST API for a table's maintenance configs.
func (s *R2CompactionSentinel) fetchMaintenanceConfig(ctx context.Context, namespace, table string) (*cfMaintenanceResponse, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/r2-catalog/%s/namespaces/%s/tables/%s/maintenance-configs",
		s.accountID, s.catalogName, namespace, table)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("cloudflare api returned HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var parsed cfMaintenanceResponse
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse cloudflare response: %w", err)
	}

	if !parsed.Success {
		return nil, fmt.Errorf("cloudflare api returned success=false: %v", parsed.Errors)
	}

	return &parsed, nil
}

// persistStatus stores the compaction status in SQLite control_meta table for cross-session and SQL visibility.
func (s *R2CompactionSentinel) persistStatus(status *TableCompactionStatus) {
	if s.db == nil {
		return
	}

	data, err := json.Marshal(status)
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	query := `
INSERT INTO control_meta (key, value, updated_at) 
VALUES (?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
`
	key := fmt.Sprintf("compaction:status:%s", status.Table)
	if _, err := s.db.ExecContext(ctx, query, key, string(data)); err != nil {
		s.logger.Debug("failed to persist compaction status to control_meta", "key", key, "error", err)
	}
}
