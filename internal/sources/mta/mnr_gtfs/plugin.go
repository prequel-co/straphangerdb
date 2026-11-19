package mnr_gtfs

import (
	"context"
	"fmt"
	"time"

	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&MNRGTFSPlugin{})
}

type MNRGTFSPlugin struct{}

func (p *MNRGTFSPlugin) ID() string {
	return "mta_mnr_gtfs_rt"
}

func (p *MNRGTFSPlugin) AgencyID() string {
	return "MTA_METRO_NORTH"
}

func (p *MNRGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *MNRGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *MNRGTFSPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

func (p *MNRGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	return gtfsutil.FetchAndParseGTFSRealtime(
		ctx,
		"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr",
		"MTA_METRO_NORTH",
		func() []gtfsutil.VehicleRecord {
			return gtfsutil.GenerateCommuterRailFleet("MNR", []string{"HUDSON", "HARLEM", "NEW_HAVEN", "PASCACK_VALLEY", "PORT_JERVIS"}, 15)
		},
	)
}

func (p *MNRGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'MTA_METRO_NORTH' as agency_id,
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

func (p *MNRGTFSPlugin) TransformQuery(rawTable string) string {
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

