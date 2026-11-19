package subway_gtfs

import (
	"context"
	"fmt"
	"time"

	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&SubwayGTFSPlugin{})
}

type SubwayGTFSPlugin struct{}

func (p *SubwayGTFSPlugin) ID() string {
	return "mta_subway_gtfs_rt"
}

func (p *SubwayGTFSPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *SubwayGTFSPlugin) TargetTable() string {
	return "fact_vehicle_positions"
}

func (p *SubwayGTFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *SubwayGTFSPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

var mtaSubwayFeedURLs = []string{
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
	"https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-7",
}

func (p *SubwayGTFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	return gtfsutil.FetchAndMergeGTFSRealtimeFeeds(
		ctx,
		mtaSubwayFeedURLs,
		"MTA_NYCT_SUBWAY",
		gtfsutil.GenerateSubwayFleet,
	)
}

func (p *SubwayGTFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			COALESCE(try_cast(v.event_time AS DATE), CURRENT_DATE) as event_date,
			COALESCE(try_cast(v.event_time AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as event_time,
			'MTA_NYCT_SUBWAY' as agency_id,
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

func (p *SubwayGTFSPlugin) TransformQuery(rawTable string) string {
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

