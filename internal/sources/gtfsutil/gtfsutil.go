package gtfsutil

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

// VehicleRecord is a normalized record for transit vehicles.
type VehicleRecord struct {
	VehicleID       string   `json:"vehicle_id"`
	RouteID         string   `json:"route_id"`
	TripID          string   `json:"trip_id,omitempty"`
	StationID       string   `json:"station_id"`
	Status          string   `json:"status"`
	Latitude        *float64 `json:"latitude"`
	Longitude       *float64 `json:"longitude"`
	Bearing         float64  `json:"bearing,omitempty"`
	Speed           float64  `json:"speed,omitempty"`
	OccupancyStatus string   `json:"occupancy_status,omitempty"`
	EventTime       string   `json:"event_time"`
}

func float64Ptr(v float64) *float64 {
	return &v
}

// VehiclesPayload wraps a list of vehicle records for DuckDB JSON unnesting.
type VehiclesPayload struct {
	Vehicles []VehicleRecord `json:"vehicles"`
}

// AlertRecord is a normalized transit alert record.
type AlertRecord struct {
	AlertID           string   `json:"alert_id"`
	AgencyID          string   `json:"agency_id"`
	DetectedAt        string   `json:"detected_at"`
	LastSeenAt        string   `json:"last_seen_at"`
	ActivePeriodStart string   `json:"active_period_start"`
	ActivePeriodEnd   string   `json:"active_period_end"`
	AffectedRouteIDs  []string `json:"affected_route_ids,omitempty"`
	AffectedStopIDs   []string `json:"affected_stop_ids,omitempty"`
	Cause             string   `json:"cause,omitempty"`
	Effect            string   `json:"effect,omitempty"`
	HeaderText        string   `json:"header_text"`
	DescriptionText   string   `json:"description_text"`
	Severity          string   `json:"severity"`
}

// AlertsPayload wraps a list of alert records for DuckDB JSON unnesting.
type AlertsPayload struct {
	Alerts []AlertRecord `json:"alerts"`
}

// FetchAndParseGTFSRealtime downloads a GTFS-RT Protobuf feed and extracts vehicle records.
// When STRAPHANGER_ALLOW_SYNTHETIC=true, it falls back to a simulated fleet on network/parsing error.
// Otherwise, it returns an explicit error to prevent corrupting storage with synthetic data.
func FetchAndParseGTFSRealtime(ctx context.Context, url string, agencyID string, fallbackGenerator func() []VehicleRecord) ([]byte, error) {
	allowSynthetic := os.Getenv("STRAPHANGER_ALLOW_SYNTHETIC") == "true"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("failed creating request for %s: %w", agencyID, err)
	}

	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/x-protobuf, application/octet-stream, */*")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("feed %s fetch failed: %w", agencyID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("feed %s returned HTTP %d", agencyID, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("failed reading body for %s: %w", agencyID, err)
	}

	if len(body) == 0 {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("feed %s returned empty response", agencyID)
	}

	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("failed unmarshaling protobuf for %s: %w", agencyID, err)
	}

	if len(feed.GetEntity()) == 0 {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("feed %s contained 0 entities", agencyID)
	}

	records := ParseGTFSVehiclePositions(&feed, agencyID)
	if len(records) == 0 {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		return nil, fmt.Errorf("feed %s produced 0 vehicle records", agencyID)
	}

	return json.Marshal(VehiclesPayload{Vehicles: records})
}

// FetchAndMergeGTFSRealtimeFeeds downloads multiple GTFS-RT Protobuf feeds (e.g., all 8 MTA subway line-group feeds)
// and merges their vehicle records into a single VehiclesPayload JSON document.
func FetchAndMergeGTFSRealtimeFeeds(ctx context.Context, urls []string, agencyID string, fallbackGenerator func() []VehicleRecord) ([]byte, error) {
	allowSynthetic := os.Getenv("STRAPHANGER_ALLOW_SYNTHETIC") == "true"
	client := &http.Client{Timeout: 8 * time.Second}

	var allRecords []VehicleRecord
	var lastErr error

	for _, url := range urls {
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			lastErr = fmt.Errorf("failed creating request for %s (%s): %w", agencyID, url, err)
			continue
		}
		req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
		req.Header.Set("Accept", "application/x-protobuf, application/octet-stream, */*")

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("feed %s (%s) fetch failed: %w", agencyID, url, err)
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("feed %s (%s) returned HTTP %d", agencyID, url, resp.StatusCode)
			continue
		}
		if readErr != nil || len(body) == 0 {
			lastErr = fmt.Errorf("feed %s (%s) returned empty or unreadable body: %v", agencyID, url, readErr)
			continue
		}

		var feed gtfs.FeedMessage
		if err := proto.Unmarshal(body, &feed); err != nil {
			lastErr = fmt.Errorf("failed unmarshaling protobuf for %s (%s): %w", agencyID, url, err)
			continue
		}

		records := ParseGTFSVehiclePositions(&feed, agencyID)
		allRecords = append(allRecords, records...)
	}

	if len(allRecords) == 0 {
		if allowSynthetic && fallbackGenerator != nil {
			records := fallbackGenerator()
			return json.Marshal(VehiclesPayload{Vehicles: records})
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("feeds for %s produced 0 vehicle records", agencyID)
	}

	return json.Marshal(VehiclesPayload{Vehicles: allRecords})
}

// ParseGTFSVehiclePositions extracts vehicle records from a GTFS-RT FeedMessage.
// TripUpdate entities are first indexed so VehiclePosition entities that omit route_id
// (such as LIRR, Metro-North, and NYC Ferry) inherit route_id from their TripUpdate.
func ParseGTFSVehiclePositions(feed *gtfs.FeedMessage, defaultAgency string) []VehicleRecord {
	var records []VehicleRecord
	now := time.Now().UTC().Format(time.RFC3339)

	tripRouteMap := make(map[string]string)
	for _, entity := range feed.GetEntity() {
		if tu := entity.GetTripUpdate(); tu != nil {
			tID := tu.GetTrip().GetTripId()
			rID := tu.GetTrip().GetRouteId()
			if tID != "" && rID != "" {
				tripRouteMap[tID] = rID
			}
		}
	}

	for _, entity := range feed.GetEntity() {
		if vp := entity.GetVehicle(); vp != nil {
			vehID := vp.GetVehicle().GetId()
			tripID := vp.GetTrip().GetTripId()
			if vehID == "" {
				if tripID != "" {
					vehID = tripID
				} else {
					vehID = entity.GetId()
				}
			}
			routeID := vp.GetTrip().GetRouteId()
			if routeID == "" && tripID != "" {
				routeID = tripRouteMap[tripID]
			}
			stopID := vp.GetStopId()
			status := vp.GetCurrentStatus().String()
			if status == "" || status == "0" {
				status = "IN_TRANSIT_TO"
			}
			var lat, lon *float64
			var bearing, speed float64
			if pos := vp.GetPosition(); pos != nil {
				latVal := float64(pos.GetLatitude())
				lonVal := float64(pos.GetLongitude())
				// Filter (0.0, 0.0) Null Island and require valid transit coordinates
				if latVal != 0 && lonVal != 0 && latVal >= 35.0 && latVal <= 48.0 && lonVal >= -82.0 && lonVal <= -68.0 {
					lat = float64Ptr(latVal)
					lon = float64Ptr(lonVal)
				}
				bearing = float64(pos.GetBearing())
				speed = float64(pos.GetSpeed())
			}
			occupancy := vp.GetOccupancyStatus().String()
			if occupancy == "0" {
				occupancy = ""
			}
			nowTime := time.Now().UTC()
			evTime := now
			if ts := vp.GetTimestamp(); ts > 0 && int64(ts) <= nowTime.Unix()+60 {
				evTime = time.Unix(int64(ts), 0).UTC().Format(time.RFC3339)
			}
			records = append(records, VehicleRecord{
				VehicleID:       vehID,
				RouteID:         routeID,
				TripID:          tripID,
				StationID:       stopID,
				Status:          status,
				Latitude:        lat,
				Longitude:       lon,
				Bearing:         bearing,
				Speed:           speed,
				OccupancyStatus: occupancy,
				EventTime:       evTime,
			})
		}
	}
	return records
}

// GenerateSubwayFleet generates ~500 active trains across NYC subway lines.
func GenerateSubwayFleet() []VehicleRecord {
	lines := []string{"1", "2", "3", "4", "5", "6", "7", "A", "C", "E", "B", "D", "F", "M", "G", "J", "Z", "L", "N", "Q", "R", "W", "S"}
	now := time.Now().UTC().Format(time.RFC3339)
	var records []VehicleRecord

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for _, line := range lines {
		// ~20-25 active trains per line
		trainCount := 20 + r.Intn(6)
		for i := 1; i <= trainCount; i++ {
			vehID := fmt.Sprintf("SUB_%s_%03d", line, i)
			stopID := fmt.Sprintf("%s%02d", line, r.Intn(35)+1)
			lat := 40.55 + r.Float64()*(40.90-40.55)
			lon := -74.05 + r.Float64()*(-73.75 - -74.05)
			status := "IN_TRANSIT_TO"
			if i%3 == 0 {
				status = "STOPPED_AT"
			} else if i%3 == 1 {
				status = "INCOMING_AT"
			}

			records = append(records, VehicleRecord{
				VehicleID: vehID,
				RouteID:   line,
				StationID: stopID,
				Status:    status,
				Latitude:  float64Ptr(lat),
				Longitude: float64Ptr(lon),
				EventTime: now,
			})
		}
	}
	return records
}

// GenerateBusFleet generates ~1,000 active buses across borough routes.
func GenerateBusFleet() []VehicleRecord {
	routes := []string{
		"M15", "M15-SBS", "M34-SBS", "M101", "M4", "M7", "M86-SBS",
		"B44-SBS", "B46-SBS", "B41", "B6", "B35", "B82-SBS", "B25",
		"Q44-SBS", "Q53-SBS", "Q58", "Q10", "Q70-SBS", "Q27", "Q32",
		"Bx12-SBS", "Bx1", "Bx19", "Bx6-SBS", "Bx41-SBS", "Bx9",
		"S79-SBS", "S53", "S78", "S40", "S59",
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var records []VehicleRecord

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for _, route := range routes {
		busCount := 25 + r.Intn(10)
		for i := 1; i <= busCount; i++ {
			vehID := fmt.Sprintf("BUS_%s_%04d", route, 1000+r.Intn(8999))
			stopID := fmt.Sprintf("BUS_STOP_%d", 100000+r.Intn(900000))
			lat := 40.55 + r.Float64()*(40.90-40.55)
			lon := -74.05 + r.Float64()*(-73.75 - -74.05)
			status := "IN_TRANSIT_TO"
			if i%2 == 0 {
				status = "STOPPED_AT"
			}
			records = append(records, VehicleRecord{
				VehicleID: vehID,
				RouteID:   route,
				StationID: stopID,
				Status:    status,
				Latitude:  float64Ptr(lat),
				Longitude: float64Ptr(lon),
				EventTime: now,
			})
		}
	}
	return records
}

// GenerateCommuterRailFleet generates active trains for LIRR, MNR, or NJT.
func GenerateCommuterRailFleet(agency string, branches []string, avgPerBranch int) []VehicleRecord {
	now := time.Now().UTC().Format(time.RFC3339)
	var records []VehicleRecord

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for _, branch := range branches {
		count := avgPerBranch + r.Intn(5)
		for i := 1; i <= count; i++ {
			vehID := fmt.Sprintf("%s_%s_%03d", agency, branch, 100+i)
			stopID := fmt.Sprintf("%s_STN_%d", branch, 1+r.Intn(20))
			lat := 40.60 + r.Float64()*(41.20-40.60)
			lon := -74.30 + r.Float64()*(-72.00 - -74.30)
			status := "IN_TRANSIT_TO"
			if i%4 == 0 {
				status = "STOPPED_AT"
			}
			records = append(records, VehicleRecord{
				VehicleID: vehID,
				RouteID:   branch,
				StationID: stopID,
				Status:    status,
				Latitude:  float64Ptr(lat),
				Longitude: float64Ptr(lon),
				EventTime: now,
			})
		}
	}
	return records
}

// GenerateFerryFleet generates active vessels across NYC Ferry routes.
func GenerateFerryFleet() []VehicleRecord {
	routes := []string{"EAST_RIVER", "ASTORIA", "SOUTH_BROOKLYN", "ROCKAWAY", "SOUNDVIEW", "ST_GEORGE"}
	now := time.Now().UTC().Format(time.RFC3339)
	var records []VehicleRecord

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for _, route := range routes {
		count := 5 + r.Intn(4)
		for i := 1; i <= count; i++ {
			vehID := fmt.Sprintf("FERRY_%s_%02d", route, i)
			stopID := fmt.Sprintf("LANDING_%s_%d", route, 1+r.Intn(6))
			lat := 40.56 + r.Float64()*(40.82-40.56)
			lon := -74.08 + r.Float64()*(-73.80 - -74.08)
			records = append(records, VehicleRecord{
				VehicleID: vehID,
				RouteID:   route,
				StationID: stopID,
				Status:    "IN_TRANSIT_TO",
				Latitude:  float64Ptr(lat),
				Longitude: float64Ptr(lon),
				EventTime: now,
			})
		}
	}
	return records
}

// GenerateAirTrainFleet generates active AirTrain vehicles.
func GenerateAirTrainFleet() []VehicleRecord {
	routes := []string{"JFK_AIRTRAIN_JAMAICA", "JFK_AIRTRAIN_HOWARD_BEACH", "EWR_AIRTRAIN"}
	now := time.Now().UTC().Format(time.RFC3339)
	var records []VehicleRecord

	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	for _, route := range routes {
		for i := 1; i <= 6; i++ {
			vehID := fmt.Sprintf("AIRTRAIN_%s_%d", route, i)
			stopID := fmt.Sprintf("TERM_%d", 1+r.Intn(8))
			records = append(records, VehicleRecord{
				VehicleID: vehID,
				RouteID:   route,
				StationID: stopID,
				Status:    "IN_TRANSIT_TO",
				Latitude:  float64Ptr(40.64 + r.Float64()*0.05),
				Longitude: float64Ptr(-73.78 - r.Float64()*0.05),
				EventTime: now,
			})
		}
	}
	return records
}

// GeneratePATHFleet generates active PATH trains along the 4 official trans-Hudson corridors.
func GeneratePATHFleet() []VehicleRecord {
	type pathSpot struct {
		route   string
		stopID  string
		lat     float64
		lon     float64
		bearing float64
	}
	spots := []pathSpot{
		{"NWK-WTC", "NWK", 40.73454, -74.16417, 65},
		{"NWK-WTC", "HAR", 40.73942, -74.15587, 92},
		{"NWK-WTC", "HAR", 40.74180, -74.12200, 98},
		{"NWK-WTC", "JSQ", 40.73850, -74.09200, 105},
		{"NWK-WTC", "JSQ", 40.73301, -74.06289, 128},
		{"NWK-WTC", "GRV", 40.71966, -74.04312, 110},
		{"NWK-WTC", "EXP", 40.71676, -74.03238, 105},
		{"NWK-WTC", "WTC", 40.71450, -74.02250, 102},
		{"NWK-WTC", "WTC", 40.71271, -74.01193, 285},
		{"JSQ-33", "JSQ", 40.73301, -74.06289, 125},
		{"JSQ-33", "GRV", 40.72520, -74.05180, 125},
		{"JSQ-33", "GRV", 40.71966, -74.04312, 48},
		{"JSQ-33", "NEW", 40.72699, -74.03383, 72},
		{"JSQ-33", "CHR", 40.73050, -74.02050, 76},
		{"JSQ-33", "CHR", 40.73295, -74.00707, 78},
		{"JSQ-33", "09S", 40.73424, -73.99910, 29},
		{"JSQ-33", "14S", 40.73735, -73.99684, 29},
		{"JSQ-33", "23S", 40.74290, -73.99278, 29},
		{"JSQ-33", "33S", 40.74912, -73.98827, 209},
		{"HOB-33", "HOB", 40.73586, -74.02793, 108},
		{"HOB-33", "CHR", 40.73220, -74.01850, 86},
		{"HOB-33", "09S", 40.73424, -73.99910, 29},
		{"HOB-33", "14S", 40.73735, -73.99684, 209},
		{"HOB-33", "23S", 40.74290, -73.99278, 29},
		{"HOB-33", "33S", 40.74912, -73.98827, 209},
		{"HOB-WTC", "HOB", 40.73586, -74.02793, 200},
		{"HOB-WTC", "NEW", 40.72699, -74.03383, 185},
		{"HOB-WTC", "EXP", 40.71676, -74.03238, 105},
		{"HOB-WTC", "WTC", 40.71271, -74.01193, 285},
	}
	now := time.Now().UTC().Format(time.RFC3339)
	records := make([]VehicleRecord, 0, len(spots))
	for i, sp := range spots {
		vehID := fmt.Sprintf("PATH_%s_%d", sp.route, 101+i)
		records = append(records, VehicleRecord{
			VehicleID: vehID,
			RouteID:   sp.route,
			TripID:    vehID,
			StationID: sp.stopID,
			Status:    "IN_TRANSIT_TO",
			Latitude:  float64Ptr(sp.lat),
			Longitude: float64Ptr(sp.lon),
			Bearing:   sp.bearing,
			Speed:     13.4,
			EventTime: now,
		})
	}
	return records
}

// GenerateMTAAlerts generates active service alerts.
func GenerateMTAAlerts() []AlertRecord {
	now := time.Now().UTC().Format(time.RFC3339)
	return []AlertRecord{
		{
			AlertID:           "MTA_ALERT_101",
			AgencyID:          "MTA_NYCT_SUBWAY",
			DetectedAt:        now,
			LastSeenAt:        now,
			ActivePeriodStart: now,
			ActivePeriodEnd:   time.Now().UTC().Add(4 * time.Hour).Format(time.RFC3339),
			AffectedRouteIDs:  []string{"L"},
			AffectedStopIDs:   []string{"L01", "L02", "L03"},
			Cause:             "MAINTENANCE",
			Effect:            "SIGNIFICANT_DELAYS",
			HeaderText:        "Delays on L Train",
			DescriptionText:   "L Train service is experiencing minor delays due to track maintenance between 8th Ave and 6th Ave.",
			Severity:          "WARNING",
		},
		{
			AlertID:           "MTA_ALERT_102",
			AgencyID:          "MTA_NYCT_SUBWAY",
			DetectedAt:        now,
			LastSeenAt:        now,
			ActivePeriodStart: now,
			ActivePeriodEnd:   time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
			AffectedRouteIDs:  []string{"A", "C"},
			AffectedStopIDs:   []string{"A24N", "A24S"},
			Cause:             "TECHNICAL_PROBLEM",
			Effect:            "SIGNIFICANT_DELAYS",
			HeaderText:        "Signal Problems on A/C Lines",
			DescriptionText:   "Northbound A and C trains are running with residual delays following earlier signal work at 59 St-Columbus Circle.",
			Severity:          "WARNING",
		},
		{
			AlertID:           "MTA_ALERT_103",
			AgencyID:          "MTA_BUS",
			DetectedAt:        now,
			LastSeenAt:        now,
			ActivePeriodStart: now,
			ActivePeriodEnd:   time.Now().UTC().Add(6 * time.Hour).Format(time.RFC3339),
			AffectedRouteIDs:  []string{"M15-SBS"},
			AffectedStopIDs:   []string{"BUS_STOP_100001"},
			Cause:             "CONSTRUCTION",
			Effect:            "DETOUR",
			HeaderText:        "M15-SBS Detour in Lower Manhattan",
			DescriptionText:   "M15-SBS buses are detoured from Water St between Wall St and Fulton St due to road construction.",
			Severity:          "INFO",
		},
		{
			AlertID:           "MTA_ALERT_104",
			AgencyID:          "MTA_LIRR",
			DetectedAt:        now,
			LastSeenAt:        now,
			ActivePeriodStart: now,
			ActivePeriodEnd:   time.Now().UTC().Add(3 * time.Hour).Format(time.RFC3339),
			AffectedRouteIDs:  []string{"Babylon"},
			AffectedStopIDs:   []string{"BABYLON_STN_1"},
			Cause:             "MAINTENANCE",
			Effect:            "MODIFIED_SERVICE",
			HeaderText:        "Babylon Branch Signal Modernization",
			DescriptionText:   "Eastbound Babylon branch trains are operating on single track between Rockville Centre and Freeport.",
			Severity:          "INFO",
		},
	}
}
