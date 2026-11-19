package gtfsutil

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

func TestFleetGenerators(t *testing.T) {
	subway := GenerateSubwayFleet()
	if len(subway) < 400 {
		t.Fatalf("expected >= 400 subway trains, got %d", len(subway))
	}

	bus := GenerateBusFleet()
	if len(bus) < 800 {
		t.Fatalf("expected >= 800 buses, got %d", len(bus))
	}

	lirr := GenerateCommuterRailFleet("LIRR", []string{"BABYLON", "RONKONKOMA"}, 15)
	if len(lirr) < 30 {
		t.Fatalf("expected >= 30 LIRR trains, got %d", len(lirr))
	}

	ferry := GenerateFerryFleet()
	if len(ferry) < 20 {
		t.Fatalf("expected >= 20 ferry vessels, got %d", len(ferry))
	}

	airtrain := GenerateAirTrainFleet()
	if len(airtrain) < 15 {
		t.Fatalf("expected >= 15 AirTrain vehicles, got %d", len(airtrain))
	}

	path := GeneratePATHFleet()
	if len(path) < 25 {
		t.Fatalf("expected >= 25 PATH trains, got %d", len(path))
	}

	alerts := GenerateMTAAlerts()
	if len(alerts) < 3 {
		t.Fatalf("expected >= 3 alerts, got %d", len(alerts))
	}
}

func TestFetchAndParseFallback(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "true")
	data, err := FetchAndParseGTFSRealtime(context.Background(), "http://invalid-transit-domain.local/gtfs", "MTA_TEST", GenerateSubwayFleet)
	if err != nil {
		t.Fatalf("unexpected error on fallback: %v", err)
	}

	var payload VehiclesPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("failed unmarshaling json payload: %v", err)
	}
	if len(payload.Vehicles) < 400 {
		t.Fatalf("expected >= 400 fallback vehicles, got %d", len(payload.Vehicles))
	}
}

func TestFetchAndParseErrorWhenSyntheticDisabled(t *testing.T) {
	t.Setenv("STRAPHANGER_ALLOW_SYNTHETIC", "false")
	data, err := FetchAndParseGTFSRealtime(context.Background(), "http://invalid-transit-domain.local/gtfs", "MTA_TEST", GenerateSubwayFleet)
	if err == nil {
		t.Fatalf("expected error when STRAPHANGER_ALLOW_SYNTHETIC=false, got data: %s", string(data))
	}
}

func TestParseGTFSVehiclePositionsSkipsTripUpdatesAndNullsMissingCoords(t *testing.T) {
	feed := &gtfs.FeedMessage{
		Entity: []*gtfs.FeedEntity{
			{
				Id: proto.String("tu-only"),
				TripUpdate: &gtfs.TripUpdate{
					Trip: &gtfs.TripDescriptor{
						TripId:  proto.String("T1"),
						RouteId: proto.String("1"),
					},
				},
			},
			{
				Id: proto.String("vp-no-pos"),
				Vehicle: &gtfs.VehiclePosition{
					Trip: &gtfs.TripDescriptor{
						TripId:  proto.String("T1"),
						RouteId: proto.String("1"),
					},
					StopId: proto.String("101N"),
				},
			},
			{
				Id: proto.String("vp-with-pos"),
				Vehicle: &gtfs.VehiclePosition{
					Trip: &gtfs.TripDescriptor{
						TripId:  proto.String("T2"),
						RouteId: proto.String("A"),
					},
					Position: &gtfs.Position{
						Latitude:  proto.Float32(40.75),
						Longitude: proto.Float32(-73.99),
					},
				},
			},
		},
	}

	records := ParseGTFSVehiclePositions(feed, "MTA_NYCT_SUBWAY")
	if len(records) != 2 {
		t.Fatalf("expected 2 VehiclePosition records (skipping TripUpdate), got %d", len(records))
	}
	if records[0].Latitude != nil || records[0].Longitude != nil {
		t.Errorf("expected nil lat/lon when Position is omitted, got %v / %v", records[0].Latitude, records[0].Longitude)
	}
	if records[1].Latitude == nil || records[1].Longitude == nil {
		t.Fatalf("expected non-nil lat/lon when Position is present")
	}
}
