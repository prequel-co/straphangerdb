package gbfs

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&CitibikeGBFSPlugin{})
}

type CitibikeGBFSPlugin struct{}

func (p *CitibikeGBFSPlugin) ID() string {
	return "citibike_gbfs"
}

func (p *CitibikeGBFSPlugin) AgencyID() string {
	return "CITIBIKE"
}

func (p *CitibikeGBFSPlugin) TargetTable() string {
	return "fact_micromobility_status"
}

func (p *CitibikeGBFSPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *CitibikeGBFSPlugin) DefaultInterval() time.Duration {
	return 30 * time.Second
}

func (p *CitibikeGBFSPlugin) Fetch(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://gbfs.citibikenyc.com/gbfs/2.3/en/station_status.json", nil)
	if err != nil {
		return nil, fmt.Errorf("failed creating citibike request: %w", err)
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, */*")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("citibike station_status fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("citibike station_status returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 {
		return nil, fmt.Errorf("failed reading citibike response body: %w", err)
	}
	return body, nil
}

func (p *CitibikeGBFSPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		SELECT 
			CASE 
				WHEN s.last_reported > 1577836800 THEN CAST(to_timestamp(s.last_reported) AS DATE) 
				ELSE CURRENT_DATE 
			END as event_date,
			CASE 
				WHEN s.last_reported > 1577836800 THEN to_timestamp(s.last_reported) 
				ELSE CURRENT_TIMESTAMP 
			END as event_time,
			'CITIBIKE' as agency_id,
			s.station_id,
			COALESCE(s.num_bikes_available, 0) as num_bikes_available,
			COALESCE(s.num_ebikes_available, 0) as num_ebikes_available,
			COALESCE(s.num_docks_available, 0) as num_docks_available,
			COALESCE(s.is_installed = 1, true) as is_installed,
			COALESCE(s.is_renting = 1, true) as is_renting,
			COALESCE(s.is_returning = 1, true) as is_returning,
			to_json(s)::VARIANT as raw_payload
		FROM (
			SELECT unnest(from_json(decode(payload), '{"data": {"stations": ["STRUCT(station_id VARCHAR, num_bikes_available INT, num_ebikes_available INT, num_docks_available INT, is_installed INT, is_renting INT, is_returning INT, last_reported BIGINT)"]}}').data.stations) as s
			FROM %s
		)
		WHERE s.station_id IS NOT NULL
		QUALIFY ROW_NUMBER() OVER (
			PARTITION BY s.station_id, 
				CASE 
					WHEN s.last_reported > 1577836800 THEN to_timestamp(s.last_reported) 
					ELSE CURRENT_TIMESTAMP 
				END 
			ORDER BY s.num_bikes_available DESC
		) = 1
	`, rawTable)
}

func (p *CitibikeGBFSPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		INSERT INTO transit_v2.fact_micromobility_status (
			event_date,
			event_time,
			agency_id,
			station_id,
			num_bikes_available,
			num_ebikes_available,
			num_docks_available,
			is_installed,
			is_renting,
			is_returning,
			raw_payload
		)
		%s;
	`, p.TransformSelect(rawTable))
}
