package lirr_gtfs

import (
	"context"
	"fmt"
	"time"

	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&LIRRGTFSPlugin{})
}

type LIRRGTFSPlugin struct{}

func (p *LIRRGTFSPlugin) ID() string {
	return "mta_lirr_gtfs_rt"
}

func (p *LIRRGTFSPlugin) AgencyID() string {
	return "MTA_LIRR"
}

func (p *LIRRGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *LIRRGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *LIRRGTFSPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

func (p *LIRRGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	return gtfsutil.FetchAndParseGTFSRealtime(
		ctx,
		"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr",
		"MTA_LIRR",
		func() []gtfsutil.VehicleRecord {
			return gtfsutil.GenerateCommuterRailFleet("LIRR", []string{"BABYLON", "RONKONKOMA", "PORT_WASHINGTON", "LONG_BEACH", "HUNTINGTON", "MONTAUK", "PORT_JEFFERSON", "HEMPSTEAD"}, 15)
		},
	)
}

func (p *LIRRGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'MTA_LIRR' as agency_id,
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

func (p *LIRRGTFSPlugin) TransformQuery(rawTable string) string {
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

