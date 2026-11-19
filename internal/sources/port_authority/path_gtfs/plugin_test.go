package path_gtfs

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"google.golang.org/protobuf/proto"
)

func TestParseRidePATHJSONDeduplicatesAndTracksAcrossPolls(t *testing.T) {
	now := time.Date(2026, 11, 12, 20, 0, 0, 0, time.UTC)

	// Poll 1:
	// - Train A (NWK-WTC ToNY) is 120s away from JSQ (on HAR->JSQ 450s block), and ALSO predicted at EXP in 480s and WTC in 690s.
	// - Train B (JSQ-33 ToNY) is 150s away from CHR (under Hudson River on NEW->CHR 300s block).
	// - Train C (HOB-WTC ToNJ) is 90s away from HOB (on NEW->HOB 210s block).
	poll1JSON := []byte(`{
		"results": [
			{
				"consideredStation": "JSQ",
				"destinations": [
					{
						"label": "ToNY",
						"messages": [
							{
								"target": "WTC",
								"secondsToArrival": "120",
								"arrivalTimeMessage": "2 min",
								"lineColor": "D93A30",
								"headSign": "World Trade Center",
								"lastUpdated": "2026-11-12T20:00:00Z"
							}
						]
					}
				]
			},
			{
				"consideredStation": "EXP",
				"destinations": [
					{
						"label": "ToNY",
						"messages": [
							{
								"target": "WTC",
								"secondsToArrival": "480",
								"arrivalTimeMessage": "8 min",
								"lineColor": "D93A30",
								"headSign": "World Trade Center",
								"lastUpdated": "2026-11-12T20:00:00Z"
							}
						]
					}
				]
			},
			{
				"consideredStation": "CHR",
				"destinations": [
					{
						"label": "ToNY",
						"messages": [
							{
								"target": "33S",
								"secondsToArrival": "150",
								"arrivalTimeMessage": "3 min",
								"lineColor": "F5A800",
								"headSign": "33rd Street",
								"lastUpdated": "2026-11-12T20:00:00Z"
							}
						]
					}
				]
			},
			{
				"consideredStation": "HOB",
				"destinations": [
					{
						"label": "ToNJ",
						"messages": [
							{
								"target": "HOB",
								"secondsToArrival": "90",
								"arrivalTimeMessage": "2 min",
								"lineColor": "009B3A",
								"headSign": "Hoboken",
								"lastUpdated": "2026-11-12T20:00:00Z"
							}
						]
					}
				]
			}
		]
	}`)

	recs1, err := ParseRidePATHJSON(poll1JSON, now)
	if err != nil {
		t.Fatalf("ParseRidePATHJSON poll1 failed: %v", err)
	}
	// Downstream prediction at EXP (480s > 150s+45s) must be filtered out so Train A is emitted once, yielding 3 active trains total.
	if len(recs1) != 3 {
		t.Fatalf("expected 3 deduplicated active trains, got %d: %+v", len(recs1), recs1)
	}

	byRoute1 := make(map[string]string)
	for _, r := range recs1 {
		byRoute1[r.RouteID] = r.VehicleID
		if r.Latitude == nil || r.Longitude == nil {
			t.Fatalf("expected non-nil coordinates for %+v", r)
		}
		if *r.Latitude < 40.70 || *r.Latitude > 40.76 || *r.Longitude < -74.18 || *r.Longitude > -73.98 {
			t.Fatalf("PATH train coordinate out of corridor bounds: (%f, %f)", *r.Latitude, *r.Longitude)
		}
	}

	// Poll 2 (20 seconds later): Train A is now 100s away from JSQ and must retain the exact same vehicle_id and advance eastward.
	now2 := now.Add(20 * time.Second)
	poll2JSON := []byte(`{
		"results": [
			{
				"consideredStation": "JSQ",
				"destinations": [
					{
						"label": "ToNY",
						"messages": [
							{
								"target": "WTC",
								"secondsToArrival": "100",
								"arrivalTimeMessage": "2 min",
								"lineColor": "D93A30",
								"headSign": "World Trade Center",
								"lastUpdated": "2026-11-12T20:00:20Z"
							}
						]
					}
				]
			}
		]
	}`)

	recs2, err := ParseRidePATHJSON(poll2JSON, now2)
	if err != nil {
		t.Fatalf("ParseRidePATHJSON poll2 failed: %v", err)
	}
	if len(recs2) != 1 {
		t.Fatalf("expected 1 train in poll2, got %d", len(recs2))
	}
	if recs2[0].VehicleID != byRoute1["NWK-WTC"] {
		t.Fatalf("expected stable vehicle_id across consecutive polls (%s), got %s", byRoute1["NWK-WTC"], recs2[0].VehicleID)
	}
}

func TestParsePATHGTFSRealtimeTripUpdates(t *testing.T) {
	now := time.Date(2026, 11, 12, 20, 0, 0, 0, time.UTC)
	hdrTs := uint64(now.Unix())
	version := "2.0"
	entityID := "trip_entity_1"
	tripID := "TRIP_862_WTC"
	routeID := "862"
	stopHAR := "26729"
	stopJSQ := "26731"
	stopWTC := "26734"
	depHAR := now.Add(-200 * time.Second).Unix()
	arrJSQ := now.Add(250 * time.Second).Unix()
	arrWTC := now.Add(820 * time.Second).Unix()

	feed := &gtfs.FeedMessage{
		Header: &gtfs.FeedHeader{
			GtfsRealtimeVersion: &version,
			Timestamp:           &hdrTs,
		},
		Entity: []*gtfs.FeedEntity{
			{
				Id: &entityID,
				TripUpdate: &gtfs.TripUpdate{
					Trip: &gtfs.TripDescriptor{
						TripId:  &tripID,
						RouteId: &routeID,
					},
					StopTimeUpdate: []*gtfs.TripUpdate_StopTimeUpdate{
						{
							StopId:    &stopHAR,
							Departure: &gtfs.TripUpdate_StopTimeEvent{Time: &depHAR},
						},
						{
							StopId:  &stopJSQ,
							Arrival: &gtfs.TripUpdate_StopTimeEvent{Time: &arrJSQ},
						},
						{
							StopId:  &stopWTC,
							Arrival: &gtfs.TripUpdate_StopTimeEvent{Time: &arrWTC},
						},
					},
				},
			},
		},
	}

	raw, err := proto.Marshal(feed)
	if err != nil {
		t.Fatalf("proto.Marshal failed: %v", err)
	}

	recs, err := ParsePATHGTFSRealtime(raw, now)
	if err != nil {
		t.Fatalf("ParsePATHGTFSRealtime failed: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 active train from TripUpdate, got %d", len(recs))
	}
	if recs[0].RouteID != "NWK-WTC" {
		t.Fatalf("expected canonical route_id NWK-WTC, got %s", recs[0].RouteID)
	}
	if recs[0].StationID != "JSQ" {
		t.Fatalf("expected upcoming station_id JSQ, got %s", recs[0].StationID)
	}
	if recs[0].Latitude == nil || recs[0].Longitude == nil {
		t.Fatalf("expected interpolated coordinates")
	}
	// Halfway between Harrison (-74.15587) and Journal Square (-74.06289)
	if *recs[0].Longitude <= -74.155 || *recs[0].Longitude >= -74.063 {
		t.Fatalf("expected longitude interpolated between HAR and JSQ, got %f", *recs[0].Longitude)
	}
}

func TestFetchLivePATHFeed(t *testing.T) {
	if os.Getenv("TEST_LIVE_PATH") != "1" {
		t.Skip("set TEST_LIVE_PATH=1 to run live network verification")
	}
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "false")
	p := &PATHGTFSPlugin{}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	raw, err := p.Fetch(ctx)
	if err != nil {
		t.Fatalf("live PATH Fetch failed: %v", err)
	}
	var payload gtfsutil.VehiclesPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("failed unmarshaling live PATH payload: %v", err)
	}
	if len(payload.Vehicles) == 0 {
		t.Fatalf("expected >= 1 live PATH vehicles")
	}
	t.Logf("fetched %d live PATH vehicles; sample[0]=%+v (lat=%v, lon=%v)",
		len(payload.Vehicles), payload.Vehicles[0], *payload.Vehicles[0].Latitude, *payload.Vehicles[0].Longitude)
}
