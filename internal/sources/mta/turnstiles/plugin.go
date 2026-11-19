package turnstiles

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/prequel-co/straphangerdb/pkg/plugin"
)

func init() {
	plugin.Register(&MTATurnstilesPlugin{})
}

type MTATurnstilesPlugin struct{}

func (p *MTATurnstilesPlugin) ID() string {
	return "mta_turnstiles"
}

func (p *MTATurnstilesPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTATurnstilesPlugin) TargetTable() string {
	return "fact_turnstile_counts"
}

func (p *MTATurnstilesPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeBatch
}

func (p *MTATurnstilesPlugin) DefaultInterval() time.Duration {
	return 24 * time.Hour
}

func (p *MTATurnstilesPlugin) Fetch(ctx context.Context) ([]byte, error) {
	url := os.Getenv("MTA_TURNSTILES_URL")
	if url == "" {
		// Live 2025/2026 MTA Hourly Subway Ridership & Turnstile counts (50,000 rows covers ~10 hours across all 428 subway complexes)
		cutoff := time.Now().UTC().AddDate(0, 0, -45).Format("2006-01-02T00:00:00")
		url = fmt.Sprintf(
			"https://data.ny.gov/resource/5wq4-mkjj.json?$select=station_complex_id,station_complex,transit_timestamp,payment_method,fare_class_category,ridership,transfers&$where=transit_timestamp>='%s'&$limit=50000&$order=transit_timestamp%%20DESC",
			cutoff,
		)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed creating mta turnstiles request: %w", err)
	}
	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/json, */*")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mta turnstiles fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mta turnstiles returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 || !json.Valid(body) {
		return nil, fmt.Errorf("failed reading valid mta turnstiles JSON body: %w", err)
	}
	return body, nil
}

func (p *MTATurnstilesPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH raw_turnstiles AS (
			SELECT unnest(from_json(decode(payload), '["STRUCT(station_complex_id VARCHAR, station_complex VARCHAR, transit_timestamp VARCHAR, payment_method VARCHAR, fare_class_category VARCHAR, ridership VARCHAR, transfers VARCHAR, station VARCHAR, station_name VARCHAR, c_a VARCHAR, unit VARCHAR, scp VARCHAR, date VARCHAR, time VARCHAR, entries BIGINT, exits BIGINT, entry_count BIGINT, exit_count BIGINT)"]')) as t
			FROM %s
		),
		normalized AS (
			SELECT 
				COALESCE(TRY_CAST(t.transit_timestamp AS DATE), TRY_CAST(t.date AS DATE), CURRENT_DATE) as event_date,
				'MTA_NYCT_SUBWAY' as agency_id,
				COALESCE(t.station_complex_id, t.station, t.station_name, t.station_complex, 'UNKNOWN') as station_id,
				COALESCE(
					t.c_a || '_' || t.unit || '_' || t.scp,
					CASE WHEN t.station_complex_id IS NOT NULL THEN 'COMPLEX_' || t.station_complex_id || '_' || COALESCE(t.fare_class_category, t.payment_method, 'ALL') ELSE NULL END,
					'UNKNOWN'
				) as device_id,
				COALESCE(
					TRY_CAST(t.transit_timestamp AS TIMESTAMPTZ),
					TRY_CAST(CAST(TRY_CAST(t.date AS DATE) AS VARCHAR) || ' ' || COALESCE(t.time, '00:00:00') AS TIMESTAMPTZ),
					TRY_CAST(t.date || ' ' || t.time AS TIMESTAMPTZ),
					TRY_CAST(t.date AS TIMESTAMPTZ),
					CURRENT_TIMESTAMP
				) as reading_time,
				COALESCE(TRY_CAST(TRY_CAST(t.ridership AS DOUBLE) AS BIGINT), t.entries, t.entry_count, 0) as entry_count,
				COALESCE(TRY_CAST(TRY_CAST(t.transfers AS DOUBLE) AS BIGINT), t.exits, t.exit_count, 0) as exit_count,
				to_json(t)::VARIANT as raw_payload
			FROM raw_turnstiles
		)
		SELECT event_date, agency_id, station_id, device_id, reading_time, entry_count, exit_count, raw_payload
		FROM normalized
		QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, station_id, device_id, event_date, reading_time ORDER BY entry_count DESC) = 1
	`, rawTable)
}

func (p *MTATurnstilesPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		INSERT INTO transit_v2.fact_turnstile_counts (
			event_date,
			agency_id,
			station_id,
			device_id,
			reading_time,
			entry_count,
			exit_count,
			raw_payload
		)
		%s;
	`, p.TransformSelect(rawTable))
}
