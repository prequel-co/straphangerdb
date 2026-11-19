package ridership

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
	plugin.Register(&MTARidershipPlugin{})
}

type MTARidershipPlugin struct{}

func (p *MTARidershipPlugin) ID() string {
	return "mta_ridership"
}

func (p *MTARidershipPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTARidershipPlugin) TargetTable() string {
	return "fact_ridership"
}

func (p *MTARidershipPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *MTARidershipPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

func (p *MTARidershipPlugin) Fetch(ctx context.Context) ([]byte, error) {
	// NY Open Data SODA API: MTA Subway Origin-Destination Ridership Estimates aggregated across all 24 hours of the service day
	req, err := http.NewRequestWithContext(ctx, "GET", "https://data.ny.gov/resource/y2qv-fytt.json?$select=origin_station_complex_id,origin_station_complex_name,destination_station_complex_id,destination_station_complex_name,min(timestamp)%20as%20timestamp,sum(estimated_average_ridership)%20as%20estimated_average_ridership&$where=timestamp%3E='2025-04-07T00:00:00.000'%20AND%20timestamp%3C='2025-04-07T23:59:59.999'&$group=origin_station_complex_id,origin_station_complex_name,destination_station_complex_id,destination_station_complex_name&$order=sum(estimated_average_ridership)%20DESC&$limit=50000", nil)
	if err != nil {
		return nil, fmt.Errorf("failed creating mta ridership request: %w", err)
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, */*")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mta ridership fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mta ridership returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 || !json.Valid(body) {
		return nil, fmt.Errorf("failed reading valid mta ridership JSON body: %w", err)
	}
	return body, nil
}

func (p *MTARidershipPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(origin_station_complex_id VARCHAR, origin_station_complex_name VARCHAR, destination_station_complex_id VARCHAR, destination_station_complex_name VARCHAR, estimated_average_ridership VARCHAR, estimated_trips DOUBLE, ridership BIGINT, timestamp VARCHAR, year VARCHAR, month VARCHAR)"]')) as r
			FROM %s
		),
		normalized AS (
			SELECT 
				COALESCE(
					TRY_CAST(r.timestamp AS DATE),
					TRY_CAST(r.year || '-' || LPAD(r.month, 2, '0') || '-01' AS DATE),
					CURRENT_DATE
				) as event_date,
				'MTA_NYCT_SUBWAY' as agency_id,
				COALESCE(r.origin_station_complex_id, r.origin_station_complex_name, 'UNKNOWN') as origin_station_id,
				COALESCE(r.destination_station_complex_id, r.destination_station_complex_name, 'UNKNOWN') as destination_station_id,
				COALESCE(
					TRY_CAST(r.estimated_average_ridership AS DOUBLE),
					r.estimated_trips,
					TRY_CAST(r.ridership AS DOUBLE),
					0.0
				) as est_trips,
				to_json(r)::VARIANT as raw_payload
			FROM parsed
			WHERE COALESCE(r.origin_station_complex_id, r.origin_station_complex_name) IS NOT NULL
			  AND COALESCE(r.destination_station_complex_id, r.destination_station_complex_name) IS NOT NULL
		)
		SELECT
			event_date,
			agency_id,
			origin_station_id,
			destination_station_id,
			GREATEST(1, CAST(ROUND(SUM(est_trips)) AS BIGINT)) as passenger_count,
			ANY_VALUE(raw_payload) as raw_payload
		FROM normalized
		GROUP BY event_date, agency_id, origin_station_id, destination_station_id
	`, rawTable)
}

func (p *MTARidershipPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		INSERT INTO transit_v2.fact_ridership (
			event_date,
			agency_id,
			origin_station_id,
			destination_station_id,
			passenger_count,
			raw_payload
		)
		%s;
	`, p.TransformSelect(rawTable))
}
