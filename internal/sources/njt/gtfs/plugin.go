package gtfs

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&NJTGTFSPlugin{})
}

type NJTGTFSPlugin struct{}

func (p *NJTGTFSPlugin) ID() string {
	return "njt_gtfs_rt"
}

func (p *NJTGTFSPlugin) AgencyID() string {
	return "NJ_TRANSIT"
}

func (p *NJTGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *NJTGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *NJTGTFSPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

func (p *NJTGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	url := os.Getenv("NJT_GTFS_RT_URL")
	if url == "" {
		url = "https://njtransit.com/gtfsrt/vehiclePositions"
		if apiKey := os.Getenv("NJT_API_KEY"); apiKey != "" {
			url = fmt.Sprintf("https://njtransit.com/gtfsrt/vehiclePositions?token=%s", apiKey)
		}
	}
	return gtfsutil.FetchAndParseGTFSRealtime(
		ctx,
		url,
		"NJ_TRANSIT",
		func() []gtfsutil.VehicleRecord {
			return gtfsutil.GenerateCommuterRailFleet("NJT", []string{"NEC", "NJCL", "MORRIS_ESSEX", "RARITAN_VALLEY", "MAIN_BERGEN", "PASCACK", "BUS_126", "BUS_158"}, 15)
		},
	)
}

func (p *NJTGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'NJ_TRANSIT' as agency_id,
			v.route_id,
			v.trip_id,
			v.station_id,
			v.vehicle_id,
			COALESCE(v.status, 'IN_TRANSIT_TO') as status,
			v.latitude,
			v.longitude,
			v.bearing,
			v.speed,
			v.occupancy_status,
			to_json(v)::VARIANT as raw_payload
		FROM (
			SELECT unnest(from_json(decode(payload), '{"vehicles": ["STRUCT(vehicle_id VARCHAR, route_id VARCHAR, trip_id VARCHAR, station_id VARCHAR, status VARCHAR, latitude DOUBLE, longitude DOUBLE, bearing DOUBLE, speed DOUBLE, occupancy_status VARCHAR, event_time VARCHAR)"]}').vehicles) as v
			FROM %s
		)
		WHERE v.vehicle_id IS NOT NULL
	`, rawTable)
}

func (p *NJTGTFSPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		INSERT INTO transit_v2.fact_vehicle_positions (
			event_date,
			event_time,
			agency_id,
			route_id,
			trip_id,
			station_id,
			vehicle_id,
			status,
			latitude,
			longitude,
			bearing,
			speed,
			occupancy_status,
			raw_payload
		)
		%s;
	`, p.TransformSelect(rawTable))
}

