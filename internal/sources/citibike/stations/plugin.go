package stations

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&CitibikeStationsPlugin{})
}

type CitibikeStationsPlugin struct{}

func (p *CitibikeStationsPlugin) ID() string {
	return "citibike_station_info"
}

func (p *CitibikeStationsPlugin) AgencyID() string {
	return "CITIBIKE"
}

func (p *CitibikeStationsPlugin) TargetTable() string {
	return "dim_micromobility_stations"
}

func (p *CitibikeStationsPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *CitibikeStationsPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

func (p *CitibikeStationsPlugin) Fetch(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://gbfs.citibikenyc.com/gbfs/en/station_information.json", nil)
	if err != nil {
		return nil, fmt.Errorf("failed creating citibike station_information request: %w", err)
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, */*")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("citibike station_information fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("citibike station_information returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 || !json.Valid(body) {
		return nil, fmt.Errorf("failed reading valid citibike station_information JSON body: %w", err)
	}
	return body, nil
}

func (p *CitibikeStationsPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '{"data": {"stations": ["STRUCT(station_id VARCHAR, name VARCHAR, lat DOUBLE, lon DOUBLE, capacity INT)"]}}').data.stations) as s
			FROM %s
		),
		staged AS (
			SELECT
				s.station_id,
				'CITIBIKE' as agency_id,
				COALESCE(s.name, 'Unknown Station') as name,
				s.lat as latitude,
				s.lon as longitude,
				COALESCE(s.capacity, 0) as capacity,
				to_json(s)::VARIANT as raw_payload,
				ROW_NUMBER() OVER (PARTITION BY s.station_id ORDER BY COALESCE(s.capacity, 0) DESC) as rn
			FROM parsed
		)
		SELECT
			src.station_id,
			src.agency_id,
			src.name,
			src.latitude,
			src.longitude,
			src.capacity,
			CURRENT_TIMESTAMP as valid_from,
			CAST(NULL AS TIMESTAMPTZ) as valid_to,
			true as is_current,
			src.raw_payload
		FROM staged src
		WHERE src.rn = 1
	`, rawTable)
}

func (p *CitibikeStationsPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.dim_micromobility_stations AS cur
		SET valid_to = CURRENT_TIMESTAMP,
			is_current = false
		FROM (
			WITH parsed AS (
				SELECT unnest(from_json(decode(payload), '{"data": {"stations": ["STRUCT(station_id VARCHAR, name VARCHAR, lat DOUBLE, lon DOUBLE, capacity INT)"]}}').data.stations) as s
				FROM %s
			)
			SELECT DISTINCT
				s.station_id,
				COALESCE(s.name, 'Unknown Station') as name,
				s.lat,
				s.lon,
				COALESCE(s.capacity, 0) as capacity
			FROM parsed
		) AS raw
		WHERE cur.station_id = raw.station_id
		  AND cur.agency_id = 'CITIBIKE'
		  AND cur.is_current = true
		  AND (
			  cur.name != raw.name
			  OR cur.latitude != raw.lat
			  OR cur.longitude != raw.lon
			  OR cur.capacity != raw.capacity
		  );

		INSERT INTO transit_v2.dim_micromobility_stations (
			station_id,
			agency_id,
			name,
			latitude,
			longitude,
			capacity,
			valid_from,
			valid_to,
			is_current,
			raw_payload
		)
		WITH staged_sel AS (
			%s
		)
		SELECT
			src.station_id,
			src.agency_id,
			src.name,
			src.latitude,
			src.longitude,
			src.capacity,
			src.valid_from,
			src.valid_to,
			src.is_current,
			src.raw_payload
		FROM staged_sel src
		LEFT JOIN transit_v2.dim_micromobility_stations cur
		  ON cur.station_id = src.station_id
		 AND cur.agency_id = src.agency_id
		 AND cur.is_current = true
		WHERE (
			  cur.station_id IS NULL
			  OR (
				  cur.name != src.name
				  OR cur.latitude != src.latitude
				  OR cur.longitude != src.longitude
				  OR cur.capacity != src.capacity
			  )
		  );
	`, rawTable, p.TransformSelect(rawTable))
}
