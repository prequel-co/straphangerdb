package dataplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseDeltaLogVersion(t *testing.T) {
	tests := []struct {
		input   string
		want    int64
		wantErr bool
	}{
		{"00000000000000000000.json", 0, false},
		{"00000000000000000001.json", 1, false},
		{"00000000000000000123.json", 123, false},
		{"delta/transit_v2/fact_vehicle_positions/_delta_log/00000000000000000010.json", 10, false},
		{"invalid.txt", 0, true},
		{"0000000000000000000x.json", 0, true},
	}

	for _, tc := range tests {
		got, err := ParseDeltaLogVersion(tc.input)
		if (err != nil) != tc.wantErr {
			t.Errorf("ParseDeltaLogVersion(%q) error = %v, wantErr = %v", tc.input, err, tc.wantErr)
			continue
		}
		if !tc.wantErr && got != tc.want {
			t.Errorf("ParseDeltaLogVersion(%q) = %d, want %d", tc.input, got, tc.want)
		}
	}
}

func TestGetDeltaTableSchema(t *testing.T) {
	tables := []struct {
		name         string
		isFact       bool
		expectFields []string
	}{
		{"dim_stations", false, []string{"station_id", "agency_id", "name", "latitude", "longitude", "gtfs_stop_id", "complex_id", "daytime_routes", "structure", "is_accessible", "is_current"}},
		{"dim_routes", false, []string{"route_id", "agency_id", "route_name", "type"}},
		{"dim_micromobility_stations", false, []string{"station_id", "agency_id", "name", "capacity"}},
		{"fact_vehicle_positions", true, []string{"event_date", "event_time", "agency_id", "vehicle_id", "status"}},
		{"fact_alerts", true, []string{"alert_id", "agency_id", "event_date", "detected_at", "severity"}},
		{"fact_micromobility_status", true, []string{"event_date", "event_time", "num_bikes_available", "num_docks_available"}},
		{"fact_schedules", true, []string{"event_date", "route_id", "trip_id", "scheduled_arrival_time"}},
		{"fact_turnstile_counts", true, []string{"event_date", "device_id", "reading_time", "entry_count"}},
		{"fact_ridership", true, []string{"event_date", "origin_station_id", "destination_station_id", "passenger_count"}},
	}

	for _, tc := range tables {
		schemaStr, partCols := GetDeltaTableSchema(tc.name)
		if schemaStr == "" {
			t.Errorf("expected non-empty schema string for %s", tc.name)
		}

		// Verify schema JSON is valid
		var parsed map[string]any
		if err := json.Unmarshal([]byte(schemaStr), &parsed); err != nil {
			t.Fatalf("failed unmarshaling generated schema for %s: %v", tc.name, err)
		}

		if parsed["type"] != "struct" {
			t.Errorf("expected type=struct for %s, got %v", tc.name, parsed["type"])
		}

		// Verify expected fields exist in schema string
		for _, field := range tc.expectFields {
			if !strings.Contains(schemaStr, "\""+field+"\"") {
				t.Errorf("expected field %s in schema for %s", field, tc.name)
			}
		}

		if tc.name == "fact_ridership" && !strings.Contains(schemaStr, `"name":"passenger_count","type":"long"`) {
			t.Errorf("expected fact_ridership.passenger_count to have type=long, got %s", schemaStr)
		}

		// Verify partitioning
		if tc.isFact {
			if len(partCols) != 1 || partCols[0] != "event_date" {
				t.Errorf("expected partition columns [event_date] for %s, got %v", tc.name, partCols)
			}
		} else {
			if len(partCols) != 0 {
				t.Errorf("expected no partition columns for %s, got %v", tc.name, partCols)
			}
		}
	}
}

func TestFormatDeltaLogKey(t *testing.T) {
	syncer := NewDeltaUniFormSyncer(nil, "my-bucket", "transit_v2", nil)
	key := syncer.FormatDeltaLogKey("fact_vehicle_positions", 0)
	expected := "delta/transit_v2/fact_vehicle_positions/_delta_log/00000000000000000000.json"
	if key != expected {
		t.Errorf("expected %s, got %s", expected, key)
	}

	key5 := syncer.FormatDeltaLogKey("dim_stations", 5)
	expected5 := "delta/transit_v2/dim_stations/_delta_log/00000000000000000005.json"
	if key5 != expected5 {
		t.Errorf("expected %s, got %s", expected5, key5)
	}
}

func TestFormatDeltaStats(t *testing.T) {
	// 1. Unpartitioned / dimension table stats
	unpartitionedStats := FormatDeltaStats(500, "")
	var parsed1 map[string]any
	if err := json.Unmarshal([]byte(unpartitionedStats), &parsed1); err != nil {
		t.Fatalf("failed unmarshaling unpartitioned stats: %v", err)
	}
	if parsed1["numRecords"].(float64) != 500 {
		t.Errorf("expected numRecords=500, got %v", parsed1["numRecords"])
	}
	if _, ok := parsed1["minValues"]; ok {
		t.Errorf("expected no minValues for unpartitioned stats, got %v", parsed1["minValues"])
	}

	// 2. Partitioned fact table stats
	partitionedStats := FormatDeltaStats(15420, "2026-10-09")
	var parsed2 map[string]any
	if err := json.Unmarshal([]byte(partitionedStats), &parsed2); err != nil {
		t.Fatalf("failed unmarshaling partitioned stats: %v", err)
	}
	if parsed2["numRecords"].(float64) != 15420 {
		t.Errorf("expected numRecords=15420, got %v", parsed2["numRecords"])
	}
	minVals, ok := parsed2["minValues"].(map[string]any)
	if !ok || minVals["event_date"] != "2026-10-09" {
		t.Errorf("expected minValues.event_date='2026-10-09', got %v", parsed2["minValues"])
	}
	maxVals, ok := parsed2["maxValues"].(map[string]any)
	if !ok || maxVals["event_date"] != "2026-10-09" {
		t.Errorf("expected maxValues.event_date='2026-10-09', got %v", parsed2["maxValues"])
	}
}

func TestExtractEventDateFromPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"s3://straphanger-db/iceberg/data/event_date=2026-10-09/00001.parquet", "2026-10-09"},
		{"/var/data/lakehouse/transit_v2/fact_vehicle_positions/event_date=2026-12-31/data.parquet", "2026-12-31"},
		{"s3://straphanger-db/iceberg/data/dim_stations/00001.parquet", ""},
		{"event_date=invalid-date/data.parquet", ""},
		{"", ""},
	}

	for _, tc := range tests {
		got := ExtractEventDateFromPath(tc.input)
		if got != tc.want {
			t.Errorf("ExtractEventDateFromPath(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestBuildDeltaCommitActionsAndSnapshotIdempotency(t *testing.T) {
	adds := []DeltaAddFileAction{
		{Path: "s3://b/iceberg/event_date=2026-10-13/002.parquet", Size: 4096, DataChange: true},
	}
	removes := []DeltaRemoveFileAction{
		{Path: "s3://b/iceberg/event_date=2026-10-13/001.parquet", DeletionTimestamp: 1700000000000, DataChange: true},
	}

	actions := BuildDeltaCommitActions("fact_vehicle_positions", 1, 1700000000000, 987654321, adds, removes)
	// Version 1 should have 1 remove + 1 add + 1 commitInfo = 3 actions
	if len(actions) != 3 {
		t.Fatalf("expected 3 actions for version 1, got %d", len(actions))
	}

	var lines []string
	for _, act := range actions {
		b, err := json.Marshal(act)
		if err != nil {
			t.Fatalf("failed marshaling action: %v", err)
		}
		lines = append(lines, string(b))
	}
	logPayload := []byte(strings.Join(lines, "\n") + "\n")

	if !strings.Contains(string(logPayload), `"remove":{"path":"s3://b/iceberg/event_date=2026-10-13/001.parquet"`) {
		t.Errorf("expected remove tombstone action in delta log payload, got:\n%s", string(logPayload))
	}
	if !strings.Contains(string(logPayload), `"add":{"path":"s3://b/iceberg/event_date=2026-10-13/002.parquet"`) {
		t.Errorf("expected add action in delta log payload, got:\n%s", string(logPayload))
	}

	snapID := ExtractSnapshotIDFromDeltaLog(logPayload)
	if snapID != 987654321 {
		t.Errorf("expected extracted snapshot ID 987654321, got %d", snapID)
	}

	syncer := NewDeltaUniFormSyncer(nil, "my-bucket", "transit_v2", nil)
	if syncer.HasSyncedSnapshot(context.Background(), "fact_vehicle_positions", 987654321) {
		t.Errorf("expected HasSyncedSnapshot to be false before recording")
	}
	syncer.RecordSyncedSnapshot("fact_vehicle_positions", 987654321)
	if !syncer.HasSyncedSnapshot(context.Background(), "fact_vehicle_positions", 987654321) {
		t.Errorf("expected HasSyncedSnapshot to be true after recording")
	}
	// SyncTableChanges should short-circuit and return -1, nil when snapshot is already synced
	ver, err := syncer.SyncTableChanges(context.Background(), "fact_vehicle_positions", 987654321, adds, removes)
	if err != nil || ver != -1 {
		t.Errorf("expected SyncTableChanges to short-circuit (-1, nil) on already synced snapshot, got (%d, %v)", ver, err)
	}
}
