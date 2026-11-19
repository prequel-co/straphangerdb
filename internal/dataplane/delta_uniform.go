package dataplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// DeltaProtocolAction represents the min reader and writer protocol versions.
type DeltaProtocolAction struct {
	MinReaderVersion int `json:"minReaderVersion"`
	MinWriterVersion int `json:"minWriterVersion"`
}

// DeltaFormatAction specifies the storage format of Delta files.
type DeltaFormatAction struct {
	Provider string            `json:"provider"`
	Options  map[string]string `json:"options"`
}

// DeltaMetaDataAction defines the table metadata, schema, and partition columns.
type DeltaMetaDataAction struct {
	ID               string            `json:"id"`
	Format           DeltaFormatAction `json:"format"`
	SchemaString     string            `json:"schemaString"`
	PartitionColumns []string          `json:"partitionColumns"`
	Configuration    map[string]string `json:"configuration"`
	CreatedTime      int64             `json:"createdTime"`
}

// DeltaAddFileAction represents an added Parquet data file in the Delta log.
type DeltaAddFileAction struct {
	Path             string            `json:"path"`
	PartitionValues  map[string]string `json:"partitionValues"`
	Size             int64             `json:"size"`
	ModificationTime int64             `json:"modificationTime"`
	DataChange       bool              `json:"dataChange"`
	Stats            string            `json:"stats,omitempty"`
}

// DeltaRemoveFileAction represents a tombstoned/removed data file in the Delta log.
type DeltaRemoveFileAction struct {
	Path              string `json:"path"`
	DeletionTimestamp int64  `json:"deletionTimestamp"`
	DataChange        bool   `json:"dataChange"`
}

// DeltaCommitInfoAction contains provenance and metadata for a transaction commit.
type DeltaCommitInfoAction struct {
	Timestamp           int64             `json:"timestamp"`
	Operation           string            `json:"operation"`
	OperationParameters map[string]string `json:"operationParameters"`
	EngineInfo          string            `json:"engineInfo"`
	IsBlindAppend       bool              `json:"isBlindAppend"`
	IcebergSnapshotID   int64             `json:"icebergSnapshotId,omitempty"`
}

// DeltaUniFormSyncer synthesizes Delta Lake transaction logs from Iceberg Parquet files in pure Go.
type DeltaUniFormSyncer struct {
	s3Client            *S3OCCClient
	bucket              string
	namespace           string
	logger              *slog.Logger
	mu                  sync.Mutex
	lastSyncedSnapshots map[string]int64
}

// NewDeltaUniFormSyncer constructs a new DeltaUniFormSyncer.
func NewDeltaUniFormSyncer(s3Client *S3OCCClient, bucket, namespace string, logger *slog.Logger) *DeltaUniFormSyncer {
	if namespace == "" {
		namespace = "transit_v2"
	}
	return &DeltaUniFormSyncer{
		s3Client:            s3Client,
		bucket:              bucket,
		namespace:           namespace,
		logger:              logger,
		lastSyncedSnapshots: make(map[string]int64),
	}
}

// ExtractSnapshotIDFromDeltaLog parses the IcebergSnapshotID from a serialized Delta log JSONL payload.
func ExtractSnapshotIDFromDeltaLog(data []byte) int64 {
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	for _, line := range lines {
		var env struct {
			CommitInfo *DeltaCommitInfoAction `json:"commitInfo"`
		}
		if err := json.Unmarshal([]byte(line), &env); err == nil && env.CommitInfo != nil {
			if env.CommitInfo.IcebergSnapshotID > 0 {
				return env.CommitInfo.IcebergSnapshotID
			}
			if snapStr, ok := env.CommitInfo.OperationParameters["icebergSnapshotId"]; ok {
				if id, err := strconv.ParseInt(snapStr, 10, 64); err == nil && id > 0 {
					return id
				}
			}
		}
	}
	return 0
}

// HasSyncedSnapshot returns true if the given Iceberg snapshotID has already been committed to the Delta log.
func (s *DeltaUniFormSyncer) HasSyncedSnapshot(ctx context.Context, tableName string, snapshotID int64) bool {
	if snapshotID <= 0 {
		return false
	}

	s.mu.Lock()
	last := s.lastSyncedSnapshots[tableName]
	s.mu.Unlock()

	if last == snapshotID {
		return true
	}

	// Lazy hydrate from latest Delta log on S3 if not yet cached in memory
	if last == 0 && s.s3Client != nil {
		latestVer, exists, err := s.GetLatestVersion(ctx, tableName)
		if err == nil && exists && latestVer >= 0 {
			if data, err := s.s3Client.GetObjectBytes(ctx, s.FormatDeltaLogKey(tableName, latestVer)); err == nil {
				if remoteSnap := ExtractSnapshotIDFromDeltaLog(data); remoteSnap > 0 {
					s.mu.Lock()
					if s.lastSyncedSnapshots[tableName] == 0 {
						s.lastSyncedSnapshots[tableName] = remoteSnap
					}
					last = s.lastSyncedSnapshots[tableName]
					s.mu.Unlock()
				}
			}
		}
	}

	return last == snapshotID
}

// RecordSyncedSnapshot records the most recently committed Iceberg snapshot ID for a table.
func (s *DeltaUniFormSyncer) RecordSyncedSnapshot(tableName string, snapshotID int64) {
	if snapshotID <= 0 {
		return
	}
	s.mu.Lock()
	s.lastSyncedSnapshots[tableName] = snapshotID
	s.mu.Unlock()
}

// FormatDeltaLogKey generates the S3 object key for a given commit version.
func (s *DeltaUniFormSyncer) FormatDeltaLogKey(tableName string, version int64) string {
	return fmt.Sprintf("delta/%s/%s/_delta_log/%020d.json", s.namespace, tableName, version)
}

// WriteLastCheckpoint writes the _delta_log/_last_checkpoint pointer JSON for Delta readers.
func (s *DeltaUniFormSyncer) WriteLastCheckpoint(ctx context.Context, tableName string, version int64, numActions int64) error {
	if s.s3Client == nil || version < 0 {
		return nil
	}
	payload, err := json.Marshal(struct {
		Version int64 `json:"version"`
		Size    int64 `json:"size"`
	}{
		Version: version,
		Size:    numActions,
	})
	if err != nil {
		return err
	}
	key := fmt.Sprintf("delta/%s/%s/_delta_log/_last_checkpoint", s.namespace, tableName)
	_, err = s.s3Client.PutObjectBytesConditional(ctx, key, payload, false, "")
	return err
}

// ParseDeltaLogVersion parses the integer version from a Delta log filename or path.
func ParseDeltaLogVersion(filename string) (int64, error) {
	base := path.Base(filename)
	if !strings.HasSuffix(base, ".json") {
		return 0, fmt.Errorf("not a delta json log file: %s", filename)
	}
	verStr := strings.TrimSuffix(base, ".json")
	return strconv.ParseInt(verStr, 10, 64)
}

// GetLatestVersion scans the Delta log directory to find the latest committed version.
// If no commits exist yet, returns -1, false, nil.
func (s *DeltaUniFormSyncer) GetLatestVersion(ctx context.Context, tableName string) (int64, bool, error) {
	prefix := fmt.Sprintf("delta/%s/%s/_delta_log/", s.namespace, tableName)
	keys, err := s.s3Client.ListObjectsPrefix(ctx, prefix)
	if err != nil {
		return -1, false, fmt.Errorf("failed listing delta log for table %s: %w", tableName, err)
	}

	var maxVer int64 = -1
	found := false
	for _, k := range keys {
		ver, err := ParseDeltaLogVersion(k)
		if err == nil {
			found = true
			if ver > maxVer {
				maxVer = ver
			}
		}
	}

	return maxVer, found, nil
}

// CommitVersion serializes Delta actions into line-delimited JSON and atomically uploads with If-None-Match: *.
func (s *DeltaUniFormSyncer) CommitVersion(ctx context.Context, tableName string, version int64, actions []any) error {
	var lines []string
	for _, act := range actions {
		lineBytes, err := json.Marshal(act)
		if err != nil {
			return fmt.Errorf("failed marshaling delta action: %w", err)
		}
		lines = append(lines, string(lineBytes))
	}
	payload := []byte(strings.Join(lines, "\n") + "\n")

	key := s.FormatDeltaLogKey(tableName, version)
	_, err := s.s3Client.PutObjectBytesConditional(ctx, key, payload, true, "")
	if err != nil {
		if errors.Is(err, ErrOCCConflict) {
			return ErrOCCConflict
		}
		return fmt.Errorf("failed writing delta log commit %s: %w", key, err)
	}

	s.logger.Info("committed delta uniform transaction log", "table", tableName, "version", version, "actions_count", len(actions))
	return nil
}

// BuildDeltaCommitActions constructs the ordered list of Delta transaction log actions for a version commit.
func BuildDeltaCommitActions(tableName string, nextVer int64, nowMs int64, snapshotID int64, addedFiles []DeltaAddFileAction, removedFiles []DeltaRemoveFileAction) []any {
	var actions []any

	if nextVer == 0 || tableName == "dim_stations" {
		// Commit 0 initializes protocol and metadata; dim_stations also emits metaData to ensure schema evolution
		schemaStr, partCols := GetDeltaTableSchema(tableName)
		if nextVer == 0 {
			actions = append(actions, map[string]any{
				"protocol": DeltaProtocolAction{
					MinReaderVersion: 1,
					MinWriterVersion: 2,
				},
			})
		}
		actions = append(actions, map[string]any{
			"metaData": DeltaMetaDataAction{
				ID:               uuid.NewSHA1(uuid.NameSpaceOID, []byte("straphangerdb."+tableName)).String(),
				Format:           DeltaFormatAction{Provider: "parquet", Options: map[string]string{}},
				SchemaString:     schemaStr,
				PartitionColumns: partCols,
				Configuration:    map[string]string{},
				CreatedTime:      nowMs,
			},
		})
	}

	// Emit remove tombstones for replaced/compacted Parquet data files
	for _, rf := range removedFiles {
		actions = append(actions, map[string]any{
			"remove": rf,
		})
	}

	// Emit add actions for newly written Parquet data files
	for _, f := range addedFiles {
		actions = append(actions, map[string]any{
			"add": f,
		})
	}

	opParams := map[string]string{"mode": "Append"}
	if len(removedFiles) > 0 {
		opParams["mode"] = "Merge"
	}
	if snapshotID > 0 {
		opParams["icebergSnapshotId"] = strconv.FormatInt(snapshotID, 10)
	}

	actions = append(actions, map[string]any{
		"commitInfo": DeltaCommitInfoAction{
			Timestamp:           nowMs,
			Operation:           "MERGE",
			OperationParameters: opParams,
			EngineInfo:          "StraphangerDB/UniForm",
			IsBlindAppend:       len(removedFiles) == 0,
			IcebergSnapshotID:   snapshotID,
		},
	})

	return actions
}

// SyncTableCommit commits newly added Parquet files into the Delta transaction log with OCC retry logic.
func (s *DeltaUniFormSyncer) SyncTableCommit(ctx context.Context, tableName string, addedFiles []DeltaAddFileAction) (int64, error) {
	return s.SyncTableChanges(ctx, tableName, 0, addedFiles, nil)
}

// SyncTableChanges commits added and removed Parquet files from an Iceberg snapshot into the Delta transaction log with OCC retry logic.
func (s *DeltaUniFormSyncer) SyncTableChanges(ctx context.Context, tableName string, snapshotID int64, addedFiles []DeltaAddFileAction, removedFiles []DeltaRemoveFileAction) (int64, error) {
	if len(addedFiles) == 0 && len(removedFiles) == 0 {
		return -1, nil
	}

	if snapshotID > 0 && s.HasSyncedSnapshot(ctx, tableName, snapshotID) {
		return -1, nil
	}

	const maxAttempts = 5
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		latestVer, exists, err := s.GetLatestVersion(ctx, tableName)
		if err != nil {
			return -1, err
		}

		var nextVer int64
		if !exists || latestVer < 0 {
			nextVer = 0
		} else {
			nextVer = latestVer + 1
		}

		nowMs := time.Now().UnixMilli()
		actions := BuildDeltaCommitActions(tableName, nextVer, nowMs, snapshotID, addedFiles, removedFiles)

		err = s.CommitVersion(ctx, tableName, nextVer, actions)
		if err == nil {
			s.RecordSyncedSnapshot(tableName, snapshotID)
			return nextVer, nil
		}

		if errors.Is(err, ErrOCCConflict) {
			s.logger.Warn("delta uniform commit conflict, retrying...", "table", tableName, "attempt", attempt, "target_version", nextVer)
			time.Sleep(time.Duration(attempt*150) * time.Millisecond)
			continue
		}

		return -1, err
	}

	return -1, fmt.Errorf("failed to commit delta uniform log for %s after %d attempts due to write conflicts", tableName, maxAttempts)
}

// SyncParquetFilesToDelta converts raw Parquet file paths into DeltaAddFileActions and commits to the Delta log.
func (s *DeltaUniFormSyncer) SyncParquetFilesToDelta(ctx context.Context, tableName string, parquetPaths []string, partitionDate string) (int64, error) {
	if len(parquetPaths) == 0 {
		return -1, nil
	}

	var added []DeltaAddFileAction
	nowMs := time.Now().UnixMilli()

	partValues := make(map[string]string)
	if partitionDate != "" && isPartitionedFactTable(tableName) {
		partValues["event_date"] = partitionDate
	}

	for _, p := range parquetPaths {
		added = append(added, DeltaAddFileAction{
			Path:             p,
			PartitionValues:  partValues,
			Size:             0, // S3 size resolved dynamically or during head verification
			ModificationTime: nowMs,
			DataChange:       true,
			Stats:            FormatDeltaStats(0, partitionDate),
		})
	}

	return s.SyncTableCommit(ctx, tableName, added)
}

// DeltaFileStats models the JSON statistics object stored in Delta log actions for query data skipping.
type DeltaFileStats struct {
	NumRecords int64             `json:"numRecords"`
	MinValues  map[string]string `json:"minValues,omitempty"`
	MaxValues  map[string]string `json:"maxValues,omitempty"`
}

// FormatDeltaStats formats a Delta-compliant JSON stats string for a data file.
func FormatDeltaStats(numRecords int64, partitionDate string) string {
	stats := DeltaFileStats{
		NumRecords: numRecords,
	}
	if partitionDate != "" {
		stats.MinValues = map[string]string{"event_date": partitionDate}
		stats.MaxValues = map[string]string{"event_date": partitionDate}
	}
	b, err := json.Marshal(stats)
	if err != nil {
		return ""
	}
	return string(b)
}

// ExtractEventDateFromPath parses the event_date=YYYY-MM-DD pattern from an S3 or Iceberg file path.
func ExtractEventDateFromPath(p string) string {
	idx := strings.Index(p, "event_date=")
	if idx != -1 && len(p) >= idx+21 {
		sub := p[idx+11 : idx+21]
		if len(sub) == 10 && sub[4] == '-' && sub[7] == '-' {
			return sub
		}
	}
	return ""
}

func isPartitionedFactTable(tableName string) bool {
	switch tableName {
	case "fact_vehicle_positions", "fact_alerts", "fact_micromobility_status",
		"fact_schedules", "fact_turnstile_counts", "fact_ridership":
		return true
	default:
		return false
	}
}

// GetDeltaTableSchema returns the Spark/Delta struct schema string and partition columns for all 9 transit tables.
func GetDeltaTableSchema(tableName string) (string, []string) {
	type StructField struct {
		Name     string         `json:"name"`
		Type     string         `json:"type"`
		Nullable bool           `json:"nullable"`
		Metadata map[string]any `json:"metadata"`
	}

	type StructType struct {
		Type   string        `json:"type"`
		Fields []StructField `json:"fields"`
	}

	f := func(name, t string, nullable bool) StructField {
		return StructField{Name: name, Type: t, Nullable: nullable, Metadata: map[string]any{}}
	}

	var fields []StructField
	var partCols []string

	switch tableName {
	case "dim_stations":
		fields = []StructField{
			f("station_id", "string", false),
			f("agency_id", "string", false),
			f("name", "string", false),
			f("latitude", "double", true),
			f("longitude", "double", true),
			f("gtfs_stop_id", "string", true),
			f("complex_id", "string", true),
			f("daytime_routes", "string", true),
			f("structure", "string", true),
			f("is_accessible", "boolean", true),
			f("valid_from", "timestamp", false),
			f("valid_to", "timestamp", true),
			f("is_current", "boolean", true),
			f("raw_payload", "string", true),
		}
	case "dim_routes":
		fields = []StructField{
			f("route_id", "string", false),
			f("agency_id", "string", false),
			f("route_name", "string", false),
			f("color_hex", "string", true),
			f("type", "string", false),
			f("valid_from", "timestamp", false),
			f("valid_to", "timestamp", true),
			f("is_current", "boolean", true),
			f("raw_payload", "string", true),
		}
	case "dim_micromobility_stations":
		fields = []StructField{
			f("station_id", "string", false),
			f("agency_id", "string", false),
			f("name", "string", false),
			f("latitude", "double", true),
			f("longitude", "double", true),
			f("capacity", "integer", true),
			f("valid_from", "timestamp", false),
			f("valid_to", "timestamp", true),
			f("is_current", "boolean", true),
			f("raw_payload", "string", true),
		}
	case "fact_vehicle_positions":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("event_date", "date", false),
			f("event_time", "timestamp", false),
			f("agency_id", "string", false),
			f("route_id", "string", true),
			f("trip_id", "string", true),
			f("station_id", "string", true),
			f("vehicle_id", "string", false),
			f("status", "string", true),
			f("latitude", "double", true),
			f("longitude", "double", true),
			f("bearing", "double", true),
			f("speed", "double", true),
			f("occupancy_status", "string", true),
			f("raw_payload", "string", true),
		}
	case "fact_alerts":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("alert_id", "string", false),
			f("agency_id", "string", false),
			f("event_date", "date", false),
			f("detected_at", "timestamp", false),
			f("last_seen_at", "timestamp", false),
			f("removed_at", "timestamp", true),
			f("active_period_start", "timestamp", true),
			f("active_period_end", "timestamp", true),
			f("affected_route_ids", "string", true),
			f("cause", "string", true),
			f("effect", "string", true),
			f("header_text", "string", true),
			f("description_text", "string", true),
			f("severity", "string", true),
			f("raw_payload", "string", true),
		}
	case "fact_micromobility_status":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("event_date", "date", false),
			f("event_time", "timestamp", false),
			f("agency_id", "string", false),
			f("station_id", "string", false),
			f("num_bikes_available", "integer", true),
			f("num_ebikes_available", "integer", true),
			f("num_docks_available", "integer", true),
			f("is_installed", "boolean", true),
			f("is_renting", "boolean", true),
			f("is_returning", "boolean", true),
			f("raw_payload", "string", true),
		}
	case "fact_schedules":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("event_date", "date", false),
			f("agency_id", "string", false),
			f("route_id", "string", false),
			f("station_id", "string", false),
			f("trip_id", "string", false),
			f("scheduled_arrival_time", "timestamp", true),
			f("scheduled_departure_time", "timestamp", true),
			f("raw_payload", "string", true),
		}
	case "fact_turnstile_counts":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("event_date", "date", false),
			f("agency_id", "string", false),
			f("station_id", "string", false),
			f("device_id", "string", false),
			f("reading_time", "timestamp", false),
			f("entry_count", "long", true),
			f("exit_count", "long", true),
			f("raw_payload", "string", true),
		}
	case "fact_ridership":
		partCols = []string{"event_date"}
		fields = []StructField{
			f("event_date", "date", false),
			f("agency_id", "string", false),
			f("origin_station_id", "string", false),
			f("destination_station_id", "string", false),
			f("passenger_count", "long", true),
			f("raw_payload", "string", true),
		}
	default:
		fields = []StructField{
			f("id", "string", false),
			f("payload", "string", true),
		}
	}

	st := StructType{
		Type:   "struct",
		Fields: fields,
	}

	b, _ := json.Marshal(st)
	return string(b), partCols
}
