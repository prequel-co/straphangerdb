package integration

import (
	"context"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/prequel-co/straphangerdb/internal/config"
	"github.com/prequel-co/straphangerdb/internal/dataplane"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"github.com/prequel-co/straphangerdb/pkg/schema"

	"github.com/prequel-co/straphangerdb/internal/control"
	_ "github.com/prequel-co/straphangerdb/internal/sources/citibike/gbfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/citibike/stations"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/alerts"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/bus_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/colors"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/lirr_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/mnr_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/ridership"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/schedules"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/sir_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/stations"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/subway_gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/mta/turnstiles"
	_ "github.com/prequel-co/straphangerdb/internal/sources/njt/gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/nyc_ferry/gtfs"
	_ "github.com/prequel-co/straphangerdb/internal/sources/port_authority/airtrain"
	_ "github.com/prequel-co/straphangerdb/internal/sources/port_authority/path_gtfs"
)

func TestRealTimeTransformsInDuckDB(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "true")
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb: %v", err)
	}
	defer duck.Close()

	// Bootstrap schema
	ddls := schema.GetBootstrapDDL("transit_v2")
	for _, ddl := range ddls {
		if _, err := duck.DB().Exec(ddl); err != nil {
			t.Fatalf("failed executing ddl: %v", err)
		}
	}

	ctx := context.Background()

	// Test 1: Subway GTFS-RT (fact_vehicle_positions)
	subwayPlugin, ok := plugin.Get("mta_subway_gtfs_rt")
	if !ok {
		t.Fatalf("plugin mta_subway_gtfs_rt not found")
	}

	subwayData, err := subwayPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("subway Fetch failed: %v", err)
	}

	stagingTable := "temp_staging_subway"
	if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stagingTable)); err != nil {
		t.Fatalf("failed creating staging table: %v", err)
	}
	if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stagingTable, hex.EncodeToString(subwayData))); err != nil {
		t.Fatalf("failed inserting into staging table: %v", err)
	}

	subwayTransform := plugin.TransformQuery(subwayPlugin, stagingTable)
	if _, err := duck.DB().Exec(subwayTransform); err != nil {
		t.Fatalf("failed executing subway transform: %v", err)
	}

	var subwayCount int
	if err := duck.DB().QueryRow("SELECT COUNT(*) FROM transit_v2.fact_vehicle_positions WHERE agency_id = 'MTA_NYCT_SUBWAY'").Scan(&subwayCount); err != nil {
		t.Fatalf("failed counting vehicles: %v", err)
	}
	if subwayCount < 50 {
		t.Fatalf("expected >= 50 subway vehicles unnested, got %d", subwayCount)
	}
	t.Logf("Successfully unnested %d MTA Subway vehicles into fact_vehicle_positions", subwayCount)

	// Test 2: MTA Alerts (fact_alerts)
	alertPlugin, ok := plugin.Get("mta_alerts")
	if !ok {
		t.Fatalf("plugin mta_alerts not found")
	}

	alertData, err := alertPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("alerts Fetch failed: %v", err)
	}

	stagingAlerts := "temp_staging_alerts"
	if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stagingAlerts)); err != nil {
		t.Fatalf("failed creating alerts staging table: %v", err)
	}
	if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stagingAlerts, hex.EncodeToString(alertData))); err != nil {
		t.Fatalf("failed inserting into alerts staging: %v", err)
	}

	alertsTransform := plugin.TransformQuery(alertPlugin, stagingAlerts)
	if err := duck.ExecuteScript(ctx, alertsTransform); err != nil {
		t.Fatalf("failed executing alerts transform: %v", err)
	}

	var alertCount int
	if err := duck.DB().QueryRow("SELECT COUNT(*) FROM transit_v2.fact_alerts").Scan(&alertCount); err != nil {
		t.Fatalf("failed counting alerts: %v", err)
	}
	if alertCount < 1 {
		t.Fatalf("expected >= 1 alert unnested, got %d", alertCount)
	}
	t.Logf("Successfully unnested %d MTA alerts into fact_alerts", alertCount)

	// Test 3: Citi Bike GBFS (fact_micromobility_status)
	citiPlugin, ok := plugin.Get("citibike_gbfs")
	if !ok {
		t.Fatalf("plugin citibike_gbfs not found")
	}

	citiData, err := citiPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("citibike Fetch failed: %v", err)
	}

	stagingCiti := "temp_staging_citi"
	if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stagingCiti)); err != nil {
		t.Fatalf("failed creating citi staging table: %v", err)
	}
	if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stagingCiti, hex.EncodeToString(citiData))); err != nil {
		t.Fatalf("failed inserting into citi staging: %v", err)
	}

	citiTransform := plugin.TransformQuery(citiPlugin, stagingCiti)
	if _, err := duck.DB().Exec(citiTransform); err != nil {
		t.Fatalf("failed executing citi transform: %v", err)
	}

	var citiCount int
	if err := duck.DB().QueryRow("SELECT COUNT(*) FROM transit_v2.fact_micromobility_status").Scan(&citiCount); err != nil {
		t.Fatalf("failed counting micromobility status rows: %v", err)
	}
	if citiCount < 1 {
		t.Fatalf("expected >= 1 station unnested, got %d", citiCount)
	}
	t.Logf("Successfully unnested %d Citi Bike station records into fact_micromobility_status", citiCount)

	// Test 4: MTA Origin-Destination Ridership (fact_ridership)
	ridershipPlugin, ok := plugin.Get("mta_ridership")
	if !ok {
		t.Fatalf("plugin mta_ridership not found")
	}
	ridershipData, err := ridershipPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("ridership Fetch failed: %v", err)
	}
	stagingRidership := "temp_staging_ridership"
	if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stagingRidership)); err != nil {
		t.Fatalf("failed creating ridership staging table: %v", err)
	}
	if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stagingRidership, hex.EncodeToString(ridershipData))); err != nil {
		t.Fatalf("failed inserting into ridership staging: %v", err)
	}
	ridershipTransform := plugin.TransformQuery(ridershipPlugin, stagingRidership)
	if _, err := duck.DB().Exec(ridershipTransform); err != nil {
		t.Fatalf("failed executing ridership transform: %v", err)
	}
	var ridershipCount int
	if err := duck.DB().QueryRow("SELECT COUNT(*) FROM transit_v2.fact_ridership").Scan(&ridershipCount); err != nil {
		t.Fatalf("failed counting ridership rows: %v", err)
	}
	if ridershipCount < 1 {
		t.Fatalf("expected >= 1 ridership OD pair unnested, got %d", ridershipCount)
	}
	t.Logf("Successfully unnested %d MTA Origin-Destination records into fact_ridership", ridershipCount)

	// Test Remaining 8 Vehicle Position Plugins
	vehiclePlugins := []string{
		"mta_bus_gtfs_rt",
		"mta_lirr_gtfs_rt",
		"mta_mnr_gtfs_rt",
		"mta_sir_gtfs_rt",
		"njt_gtfs_rt",
		"nyc_ferry_gtfs",
		"airtrain_gtfs_rt",
		"path_gtfs_rt",
	}

	for _, pid := range vehiclePlugins {
		p, ok := plugin.Get(pid)
		if !ok {
			t.Fatalf("plugin %s not found", pid)
		}
		data, err := p.Fetch(ctx)
		if err != nil {
			t.Fatalf("plugin %s Fetch failed: %v", pid, err)
		}
		stg := "stg_" + pid
		if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stg)); err != nil {
			t.Fatalf("failed creating stg table for %s: %v", pid, err)
		}
		if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stg, hex.EncodeToString(data))); err != nil {
			t.Fatalf("failed inserting into stg table for %s: %v", pid, err)
		}
		transform := plugin.TransformInsert(p, "transit_v2", stg)
		if _, err := duck.DB().Exec(transform); err != nil {
			t.Fatalf("failed executing transform for %s: %v", pid, err)
		}
		var count int
		if err := duck.DB().QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM transit_v2.fact_vehicle_positions WHERE agency_id = '%s'", p.AgencyID())).Scan(&count); err != nil {
			t.Fatalf("failed counting vehicles for %s: %v", pid, err)
		}
		if count < 1 {
			t.Fatalf("expected >= 1 vehicle unnested for %s, got %d", pid, count)
		}
		t.Logf("Successfully unnested %d vehicles for plugin %s (%s)", count, pid, p.AgencyID())
	}
}

func TestBatchedTableInsertToDuckDB(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "true")
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb: %v", err)
	}
	defer duck.Close()

	for _, ddl := range schema.GetBootstrapDDL("transit_v2") {
		if _, err := duck.DB().Exec(ddl); err != nil {
			t.Fatalf("failed executing ddl: %v", err)
		}
	}

	ctx := context.Background()
	vehiclePlugins := []string{
		"mta_subway_gtfs_rt",
		"mta_bus_gtfs_rt",
		"mta_lirr_gtfs_rt",
		"mta_mnr_gtfs_rt",
		"mta_sir_gtfs_rt",
		"njt_gtfs_rt",
		"nyc_ferry_gtfs",
		"airtrain_gtfs_rt",
		"path_gtfs_rt",
	}

	var insertHeader string
	var unionQueries []string

	for _, pid := range vehiclePlugins {
		p, ok := plugin.Get(pid)
		if !ok {
			t.Fatalf("plugin %s not found", pid)
		}
		data, err := p.Fetch(ctx)
		if err != nil {
			t.Fatalf("plugin %s fetch error: %v", pid, err)
		}
		stg := "stg_batch_" + pid
		if _, err := duck.DB().Exec(fmt.Sprintf("CREATE TEMP TABLE %s (payload BLOB);", stg)); err != nil {
			t.Fatalf("failed creating staging table: %v", err)
		}
		if _, err := duck.DB().Exec(fmt.Sprintf("INSERT INTO %s VALUES (from_hex('%s'));", stg, hex.EncodeToString(data))); err != nil {
			t.Fatalf("failed inserting into staging table: %v", err)
		}

		selectQuery := p.TransformSelect(stg)
		if selectQuery != "" {
			if insertHeader == "" {
				insertHeader = fmt.Sprintf("INSERT INTO transit_v2.%s", p.TargetTable())
			}
			unionQueries = append(unionQueries, "("+selectQuery+")")
		}
	}

	batchSQL := insertHeader + "\n" + strings.Join(unionQueries, "\nUNION ALL\n") + ";"
	if _, err := duck.DB().Exec(batchSQL); err != nil {
		t.Fatalf("failed executing combined batch SQL: %v\nSQL:\n%s", err, batchSQL)
	}

	var totalVehicles int
	if err := duck.DB().QueryRow("SELECT COUNT(*) FROM transit_v2.fact_vehicle_positions").Scan(&totalVehicles); err != nil {
		t.Fatalf("failed counting vehicles: %v", err)
	}

	t.Logf("Successfully executed single atomic batch insert of %d vehicles across all 9 feeds", totalVehicles)
	if totalVehicles < 100 {
		t.Fatalf("expected >= 100 vehicles, got %d", totalVehicles)
	}
}

func TestBatchPluginsAndSCDType2(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "true")
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}

	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing duckdb: %v", err)
	}
	defer duck.Close()

	// Bootstrap schema
	ddls := schema.GetBootstrapDDL("transit_v2")
	for _, ddl := range ddls {
		if _, err := duck.DB().Exec(ddl); err != nil {
			t.Fatalf("failed executing ddl: %v", err)
		}
	}

	ctx := context.Background()

	// 1. Test MTA Stations (SCD Type II)
	stPlugin, ok := plugin.Get("mta_stations")
	if !ok {
		t.Fatalf("plugin mta_stations not found")
	}

	initialStations := []byte(`[
		{"station_id":"L01","complex_id":"601","stop_name":"8th Ave - 14th St","gtfs_latitude":"40.7397","gtfs_longitude":"-74.0025","ada":"1"},
		{"station_id":"L02","complex_id":"602","stop_name":"6th Ave - 14th St","gtfs_latitude":"40.7373","gtfs_longitude":"-73.9968","ada":"0"}
	]`)

	stgTable1 := "stg_stations_v1"
	if err := duck.StageEvents(ctx, stgTable1, []control.StreamEvent{{Payload: initialStations}}); err != nil {
		t.Fatalf("failed staging stations v1: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(stPlugin, stgTable1)); err != nil {
		t.Fatalf("failed executing stations transform v1: %v", err)
	}

	var activeStationsCount, totalStationsCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.dim_stations WHERE is_current = true").Scan(&activeStationsCount); err != nil {
		t.Fatalf("failed querying active stations: %v", err)
	}
	if activeStationsCount != 2 {
		t.Fatalf("expected 2 active stations, got %d", activeStationsCount)
	}

	// Update station L01 name (triggering SCD Type II invalidation + new row insert)
	updatedStations := []byte(`[
		{"station_id":"L01","complex_id":"601","stop_name":"8th Ave - 14th St (Renovated)","gtfs_latitude":"40.7397","gtfs_longitude":"-74.0025","ada":"1"},
		{"station_id":"L02","complex_id":"602","stop_name":"6th Ave - 14th St","gtfs_latitude":"40.7373","gtfs_longitude":"-73.9968","ada":"0"}
	]`)

	stgTable2 := "stg_stations_v2"
	if err := duck.StageEvents(ctx, stgTable2, []control.StreamEvent{{Payload: updatedStations}}); err != nil {
		t.Fatalf("failed staging stations v2: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(stPlugin, stgTable2)); err != nil {
		t.Fatalf("failed executing stations transform v2: %v", err)
	}

	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.dim_stations").Scan(&totalStationsCount); err != nil {
		t.Fatalf("failed querying total stations: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.dim_stations WHERE is_current = true").Scan(&activeStationsCount); err != nil {
		t.Fatalf("failed querying active stations: %v", err)
	}

	// Total should be 3 (1 closed + 2 active), active should be 2
	if totalStationsCount != 3 || activeStationsCount != 2 {
		t.Fatalf("expected 3 total and 2 active stations after SCD Type II update, got total=%d, active=%d", totalStationsCount, activeStationsCount)
	}
	t.Logf("MTA Stations SCD Type II verified: %d total rows, %d active rows", totalStationsCount, activeStationsCount)

	// 2. Test MTA Colors / Routes (SCD Type II)
	colorPlugin, ok := plugin.Get("mta_colors")
	if !ok {
		t.Fatalf("plugin mta_colors not found")
	}

	initialRoutes := []byte(`[
		{"line":"L","name":"14 St-Canarsie Local","color":"#A7A9AC","type":"subway"},
		{"line":"G","name":"Brooklyn-Queens Crosstown","color":"#6CBE45","type":"subway"}
	]`)

	stgRoutes1 := "stg_routes_v1"
	if err := duck.StageEvents(ctx, stgRoutes1, []control.StreamEvent{{Payload: initialRoutes}}); err != nil {
		t.Fatalf("failed staging routes v1: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(colorPlugin, stgRoutes1)); err != nil {
		t.Fatalf("failed executing routes transform v1: %v", err)
	}

	var activeRoutesCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.dim_routes WHERE is_current = true").Scan(&activeRoutesCount); err != nil {
		t.Fatalf("failed querying active routes: %v", err)
	}
	if activeRoutesCount != 2 {
		t.Fatalf("expected 2 active routes, got %d", activeRoutesCount)
	}
	t.Logf("MTA Routes verified: %d active routes", activeRoutesCount)

	// 3. Test Citi Bike Stations (SCD Type II)
	citiPlugin, ok := plugin.Get("citibike_station_info")
	if !ok {
		t.Fatalf("plugin citibike_station_info not found")
	}

	citiData := []byte(`{"data":{"stations":[
		{"station_id":"66db2932-0e01-11e9-869e-2a86e4085839","name":"E 17 St & Broadway","lat":40.7371,"lon":-73.9901,"capacity":30},
		{"station_id":"66db2b8a-0e01-11e9-869e-2a86e4085839","name":"W 21 St & 6 Ave","lat":40.7417,"lon":-73.9942,"capacity":25}
	]}}`)

	stgCiti := "stg_citi_v1"
	if err := duck.StageEvents(ctx, stgCiti, []control.StreamEvent{{Payload: citiData}}); err != nil {
		t.Fatalf("failed staging citibike: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(citiPlugin, stgCiti)); err != nil {
		t.Fatalf("failed executing citibike transform: %v", err)
	}

	var citiCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.dim_micromobility_stations WHERE is_current = true").Scan(&citiCount); err != nil {
		t.Fatalf("failed querying active micromobility stations: %v", err)
	}
	if citiCount != 2 {
		t.Fatalf("expected 2 active micromobility stations, got %d", citiCount)
	}
	t.Logf("Citi Bike station info verified: %d active stations", citiCount)

	// 4. Test Turnstiles (Dynamic JSON unnesting)
	tsPlugin, ok := plugin.Get("mta_turnstiles")
	if !ok {
		t.Fatalf("plugin mta_turnstiles not found")
	}
	tsData, err := tsPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("failed fetching turnstiles: %v", err)
	}
	stgTS := "stg_turnstiles"
	if err := duck.StageEvents(ctx, stgTS, []control.StreamEvent{{Payload: tsData}}); err != nil {
		t.Fatalf("failed staging turnstiles: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(tsPlugin, stgTS)); err != nil {
		t.Fatalf("failed executing turnstiles transform: %v", err)
	}
	var tsCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_turnstile_counts").Scan(&tsCount); err != nil {
		t.Fatalf("failed querying turnstiles: %v", err)
	}
	if tsCount == 0 {
		t.Fatalf("expected > 0 turnstile records, got 0")
	}
	t.Logf("MTA Turnstiles dynamic unnesting verified: %d rows", tsCount)

	// 5. Test Schedules (Dynamic JSON unnesting)
	schedPlugin, ok := plugin.Get("mta_schedules")
	if !ok {
		t.Fatalf("plugin mta_schedules not found")
	}
	schedData, err := schedPlugin.Fetch(ctx)
	if err != nil {
		t.Fatalf("failed fetching schedules: %v", err)
	}
	stgSched := "stg_schedules"
	if err := duck.StageEvents(ctx, stgSched, []control.StreamEvent{{Payload: schedData}}); err != nil {
		t.Fatalf("failed staging schedules: %v", err)
	}
	if _, err := duck.DB().Exec(plugin.TransformQuery(schedPlugin, stgSched)); err != nil {
		t.Fatalf("failed executing schedules transform: %v", err)
	}
	var schedCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_schedules").Scan(&schedCount); err != nil {
		t.Fatalf("failed querying schedules: %v", err)
	}
	if schedCount == 0 {
		t.Fatalf("expected > 0 schedule records, got 0")
	}
	t.Logf("MTA Schedules dynamic unnesting verified: %d rows", schedCount)
}

func TestAlertsLifecycleAndUpsert(t *testing.T) {
	ctx := context.Background()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg := &config.Config{
		OTFFormat:       "ducklake",
		MemoryLimit:     "1GB",
		Threads:         1,
		StreamRetention: 1 * time.Hour,
	}
	duck, err := dataplane.NewDuckEngine(logger, cfg)
	if err != nil {
		t.Fatalf("failed initializing DuckEngine: %v", err)
	}
	defer duck.Close()

	if err := duck.BootstrapInMemorySchema(); err != nil {
		t.Fatalf("failed schema bootstrap: %v", err)
	}

	alertPlugin, ok := plugin.Get("mta_alerts")
	if !ok {
		t.Fatalf("plugin mta_alerts not found")
	}

	// Batch 1: Initial alerts A1, A2, A3
	batch1 := []byte(`{"alerts": [
		{"alert_id":"A1","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:00:00Z","header_text":"L Train Delays","description_text":"Signal problems at 8th Ave","severity":"WARNING"},
		{"alert_id":"A2","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:00:00Z","header_text":"7 Train Express","description_text":"Track maintenance","severity":"INFO"},
		{"alert_id":"A3","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:00:00Z","header_text":"Elevator Outage","description_text":"Elevator 124 out of service","severity":"INFO"}
	]}`)

	stg1 := "stg_alerts_b1"
	if err := duck.StageEvents(ctx, stg1, []control.StreamEvent{{Payload: batch1}}); err != nil {
		t.Fatalf("failed staging alerts b1: %v", err)
	}
	if err := duck.ExecuteScript(ctx, plugin.TransformQuery(alertPlugin, stg1)); err != nil {
		t.Fatalf("failed executing alerts b1 transform: %v", err)
	}

	var totalCount, activeCount, removedCount int
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts").Scan(&totalCount); err != nil {
		t.Fatalf("failed querying total alerts b1: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts WHERE removed_at IS NULL").Scan(&activeCount); err != nil {
		t.Fatalf("failed querying active alerts b1: %v", err)
	}
	if totalCount != 3 || activeCount != 3 {
		t.Fatalf("expected 3 total and 3 active alerts in b1, got total=%d, active=%d", totalCount, activeCount)
	}
	t.Logf("Alerts Batch 1 verified: %d total, %d active", totalCount, activeCount)

	// Batch 2: A3 cleared/resolved (only A1 and A2 present)
	batch2 := []byte(`{"alerts": [
		{"alert_id":"A1","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:02:00Z","header_text":"L Train Delays Updated","description_text":"Signal problems clearing","severity":"INFO"},
		{"alert_id":"A2","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:02:00Z","header_text":"7 Train Express","description_text":"Track maintenance","severity":"INFO"}
	]}`)

	stg2 := "stg_alerts_b2"
	if err := duck.StageEvents(ctx, stg2, []control.StreamEvent{{Payload: batch2}}); err != nil {
		t.Fatalf("failed staging alerts b2: %v", err)
	}
	if err := duck.ExecuteScript(ctx, plugin.TransformQuery(alertPlugin, stg2)); err != nil {
		t.Fatalf("failed executing alerts b2 transform: %v", err)
	}

	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts").Scan(&totalCount); err != nil {
		t.Fatalf("failed querying total alerts b2: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts WHERE removed_at IS NULL").Scan(&activeCount); err != nil {
		t.Fatalf("failed querying active alerts b2: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts WHERE removed_at IS NOT NULL").Scan(&removedCount); err != nil {
		t.Fatalf("failed querying removed alerts b2: %v", err)
	}
	// Total count must remain 3 (no duplicate rows added), 2 active, 1 removed (A3)
	if totalCount != 3 || activeCount != 2 || removedCount != 1 {
		t.Fatalf("expected 3 total, 2 active, 1 removed in b2, got total=%d, active=%d, removed=%d", totalCount, activeCount, removedCount)
	}

	var a1Header string
	if err := duck.DB().QueryRow("SELECT header_text FROM transit_v2.fact_alerts WHERE alert_id = 'A1' AND removed_at IS NULL").Scan(&a1Header); err != nil {
		t.Fatalf("failed querying A1 header: %v", err)
	}
	if a1Header != "L Train Delays Updated" {
		t.Fatalf("expected A1 header updated, got %s", a1Header)
	}
	t.Logf("Alerts Batch 2 verified: A3 marked removed_at, A1 updated, total rows remained 3")

	// Batch 3: New alert A4 arrives (A1, A2, A4)
	batch3 := []byte(`{"alerts": [
		{"alert_id":"A1","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:04:00Z","header_text":"L Train Delays Updated","description_text":"Signal problems clearing","severity":"INFO"},
		{"alert_id":"A2","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:04:00Z","header_text":"7 Train Express","description_text":"Track maintenance","severity":"INFO"},
		{"alert_id":"A4","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:04:00Z","last_seen_at":"2026-09-01T20:04:00Z","header_text":"Q Train Rerouted","description_text":"Switch trouble at Canal St","severity":"WARNING"}
	]}`)

	stg3 := "stg_alerts_b3"
	if err := duck.StageEvents(ctx, stg3, []control.StreamEvent{{Payload: batch3}}); err != nil {
		t.Fatalf("failed staging alerts b3: %v", err)
	}
	if err := duck.ExecuteScript(ctx, plugin.TransformQuery(alertPlugin, stg3)); err != nil {
		t.Fatalf("failed executing alerts b3 transform: %v", err)
	}

	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts").Scan(&totalCount); err != nil {
		t.Fatalf("failed querying total alerts b3: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts WHERE removed_at IS NULL").Scan(&activeCount); err != nil {
		t.Fatalf("failed querying active alerts b3: %v", err)
	}
	// Total count should now be 4 (A1, A2, A3 closed, A4 newly added), 3 active (A1, A2, A4)
	if totalCount != 4 || activeCount != 3 {
		t.Fatalf("expected 4 total, 3 active in b3, got total=%d, active=%d", totalCount, activeCount)
	}
	t.Logf("Alerts Batch 3 verified: A4 newly inserted, total rows=4, active=3")

	// Batch 4: Re-activation of A3 (A1, A3 present, A2 and A4 dropped)
	batch4 := []byte(`{"alerts": [
		{"alert_id":"A1","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:00:00Z","last_seen_at":"2026-09-01T20:06:00Z","header_text":"L Train Delays","description_text":"Almost clear","severity":"INFO"},
		{"alert_id":"A3","agency_id":"MTA_NYCT_SUBWAY","detected_at":"2026-09-01T20:06:00Z","last_seen_at":"2026-09-01T20:06:00Z","header_text":"Elevator Outage Recurring","description_text":"Elevator 124 out of service again","severity":"INFO"}
	]}`)

	stg4 := "stg_alerts_b4"
	if err := duck.StageEvents(ctx, stg4, []control.StreamEvent{{Payload: batch4}}); err != nil {
		t.Fatalf("failed staging alerts b4: %v", err)
	}
	if err := duck.ExecuteScript(ctx, plugin.TransformQuery(alertPlugin, stg4)); err != nil {
		t.Fatalf("failed executing alerts b4 transform: %v", err)
	}

	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts").Scan(&totalCount); err != nil {
		t.Fatalf("failed querying total alerts b4: %v", err)
	}
	if err := duck.DB().QueryRow("SELECT count(*) FROM transit_v2.fact_alerts WHERE removed_at IS NULL").Scan(&activeCount); err != nil {
		t.Fatalf("failed querying active alerts b4: %v", err)
	}
	// Total count should remain 4 (A1 active, A2 closed, A3 re-activated in place, A4 closed), 2 active (A1, A3)
	if totalCount != 4 || activeCount != 2 {
		t.Fatalf("expected 4 total, 2 active in b4, got total=%d, active=%d", totalCount, activeCount)
	}
	t.Logf("Alerts Batch 4 verified: A3 cleanly re-activated in place with removed_at=NULL, A2/A4 marked removed, total rows=4, active=2")
}
