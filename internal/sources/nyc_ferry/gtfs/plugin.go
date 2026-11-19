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
	plugin.Register(&NYCFerryPlugin{})
}

type NYCFerryPlugin struct{}

func (p *NYCFerryPlugin) ID() string {
	return "nyc_ferry_gtfs"
}

func (p *NYCFerryPlugin) AgencyID() string {
	return "NYC_FERRY"
}

func (p *NYCFerryPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *NYCFerryPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *NYCFerryPlugin) DefaultInterval() time.Duration {
	return 30 * time.Second
}

func (p *NYCFerryPlugin) Fetch(ctx context.Context) ([]byte, error) {
	url := os.Getenv("NYC_FERRY_GTFS_RT_URL")
	if url == "" {
		url = "http://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition"
	}
	return gtfsutil.FetchAndParseGTFSRealtime(
		ctx,
		url,
		"NYC_FERRY",
		gtfsutil.GenerateFerryFleet,
	)
}

func (p *NYCFerryPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'NYC_FERRY' as agency_id,
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

func (p *NYCFerryPlugin) TransformQuery(rawTable string) string {
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

