package sir_gtfs

import (
	"context"
	"fmt"
	"time"

	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&SIRGTFSPlugin{})
}

type SIRGTFSPlugin struct{}

func (p *SIRGTFSPlugin) ID() string {
	return "mta_sir_gtfs_rt"
}

func (p *SIRGTFSPlugin) AgencyID() string {
	return "MTA_NYCT_SIR"
}

func (p *SIRGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *SIRGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *SIRGTFSPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

func (p *SIRGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	return gtfsutil.FetchAndParseGTFSRealtime(
		ctx,
		"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
		"MTA_NYCT_SIR",
		func() []gtfsutil.VehicleRecord {
			return gtfsutil.GenerateCommuterRailFleet("SIR", []string{"SIR"}, 20)
		},
	)
}

func (p *SIRGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'MTA_NYCT_SIR' as agency_id,
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

func (p *SIRGTFSPlugin) TransformQuery(rawTable string) string {
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

