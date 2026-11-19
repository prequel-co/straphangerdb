package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"github.com/prequel-co/straphangerdb/internal/sources/gtfsutil"
	"github.com/prequel-co/straphangerdb/pkg/plugin"
	"google.golang.org/protobuf/proto"
)

func init() {
	plugin.Register(&MTAAlertsPlugin{})
}

type MTAAlertsPlugin struct{}

func (p *MTAAlertsPlugin) ID() string {
	return "mta_alerts"
}

func (p *MTAAlertsPlugin) AgencyID() string {
	return "MTA_NYCT_SUBWAY"
}

func (p *MTAAlertsPlugin) TargetTable() string {
	return "fact_alerts"
}

func (p *MTAAlertsPlugin) Mode() plugin.IngestionMode {
	return plugin.ModeStream
}

func (p *MTAAlertsPlugin) DefaultInterval() time.Duration {
	return 15 * time.Second
}

func (p *MTAAlertsPlugin) Fetch(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts", nil)
	if err != nil {
		return nil, fmt.Errorf("failed creating mta alerts request: %w", err)
	}

	req.Header.Set("User-Agent", "straphangerdb/1.0 (transit-data-collector)")
	req.Header.Set("Accept", "application/x-protobuf, application/octet-stream, */*")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mta alerts fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mta alerts returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil || len(body) == 0 {
		return nil, fmt.Errorf("failed reading mta alerts response body: %w", err)
	}

	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("failed unmarshaling mta alerts protobuf: %w", err)
	}

	var alerts []gtfsutil.AlertRecord
	now := time.Now().UTC().Format(time.RFC3339)
	for _, entity := range feed.GetEntity() {
		if alert := entity.GetAlert(); alert != nil {
			var header, desc string
			if len(alert.GetHeaderText().GetTranslation()) > 0 {
				header = alert.GetHeaderText().GetTranslation()[0].GetText()
			}
			if len(alert.GetDescriptionText().GetTranslation()) > 0 {
				desc = alert.GetDescriptionText().GetTranslation()[0].GetText()
			}
			start := now
			var end string
			if len(alert.GetActivePeriod()) > 0 {
				if s := alert.GetActivePeriod()[0].GetStart(); s > 0 {
					start = time.Unix(int64(s), 0).UTC().Format(time.RFC3339)
				}
				if e := alert.GetActivePeriod()[0].GetEnd(); e > 0 {
					end = time.Unix(int64(e), 0).UTC().Format(time.RFC3339)
				}
			}
			var routeIDs []string
			var stopIDs []string
			seenRoutes := make(map[string]bool)
			seenStops := make(map[string]bool)
			agencyID := ""
			for _, ie := range alert.GetInformedEntity() {
				if r := strings.TrimSpace(ie.GetRouteId()); r != "" && !seenRoutes[r] {
					seenRoutes[r] = true
					routeIDs = append(routeIDs, r)
				}
				if s := strings.TrimSpace(ie.GetStopId()); s != "" && !seenStops[s] {
					seenStops[s] = true
					stopIDs = append(stopIDs, s)
				}
				if a := strings.TrimSpace(ie.GetAgencyId()); a != "" {
					switch a {
					case "MTASBWY", "NYCT":
						agencyID = "MTA_NYCT_SUBWAY"
					case "MTA_BUS", "MTA NYCT", "MTABC":
						agencyID = "MTA_BUS"
					case "LI", "LIRR":
						agencyID = "MTA_LIRR"
					case "MNR", "Metro-North":
						agencyID = "MTA_METRO_NORTH"
					case "SI", "SIR":
						agencyID = "MTA_SIR"
					default:
						agencyID = a
					}
				}
			}
			if agencyID == "" {
				idLower := strings.ToLower(entity.GetId())
				switch {
				case strings.Contains(idLower, "lirr"):
					agencyID = "MTA_LIRR"
				case strings.Contains(idLower, "mnr"):
					agencyID = "MTA_METRO_NORTH"
				case strings.Contains(idLower, "mtabc") || strings.Contains(idLower, "bus"):
					agencyID = "MTA_BUS"
				default:
					agencyID = "MTA_NYCT_SUBWAY"
				}
			}
			cause := alert.GetCause().String()
			effect := alert.GetEffect().String()
			alerts = append(alerts, gtfsutil.AlertRecord{
				AlertID:           entity.GetId(),
				AgencyID:          agencyID,
				DetectedAt:        now,
				LastSeenAt:        now,
				ActivePeriodStart: start,
				ActivePeriodEnd:   end,
				AffectedRouteIDs:  routeIDs,
				AffectedStopIDs:   stopIDs,
				Cause:             cause,
				Effect:            effect,
				HeaderText:        header,
				DescriptionText:   desc,
				Severity:          alert.GetSeverityLevel().String(),
			})
		}
	}
	if len(alerts) > 0 {
		return json.Marshal(gtfsutil.AlertsPayload{Alerts: alerts})
	}

	return nil, fmt.Errorf("mta alerts feed contained 0 alert entities")
}

func (p *MTAAlertsPlugin) TransformSelect(rawTable string) string {
	return fmt.Sprintf(`
		WITH parsed AS (
			SELECT unnest(from_json(decode(payload), '{"alerts": ["STRUCT(alert_id VARCHAR, agency_id VARCHAR, detected_at VARCHAR, last_seen_at VARCHAR, active_period_start VARCHAR, active_period_end VARCHAR, affected_route_ids VARCHAR[], affected_stop_ids VARCHAR[], cause VARCHAR, effect VARCHAR, header_text VARCHAR, description_text VARCHAR, severity VARCHAR)"]}').alerts) as a
			FROM %s
		),
		staged AS (
			SELECT
				a.alert_id,
				COALESCE(a.agency_id, 'MTA_NYCT_SUBWAY') as agency_id,
				COALESCE(try_cast(a.detected_at AS DATE), CURRENT_DATE) as event_date,
				COALESCE(try_cast(a.detected_at AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as detected_at,
				COALESCE(try_cast(a.last_seen_at AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as last_seen_at,
				COALESCE(try_cast(a.active_period_start AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as active_period_start,
				try_cast(a.active_period_end AS TIMESTAMPTZ) as active_period_end,
				CASE WHEN a.affected_route_ids IS NOT NULL THEN array_to_string(a.affected_route_ids, ',') ELSE NULL END as affected_route_ids,
				a.cause,
				a.effect,
				a.header_text,
				a.description_text,
				COALESCE(a.severity, 'INFO') as severity,
				to_json(a)::VARIANT as raw_payload,
				ROW_NUMBER() OVER (PARTITION BY a.alert_id, COALESCE(a.agency_id, 'MTA_NYCT_SUBWAY') ORDER BY COALESCE(try_cast(a.detected_at AS TIMESTAMPTZ), CURRENT_TIMESTAMP) ASC) as rn
			FROM parsed
			WHERE a.alert_id IS NOT NULL
		)
		SELECT
			src.alert_id,
			src.agency_id,
			src.event_date,
			src.detected_at,
			src.last_seen_at,
			CAST(NULL AS TIMESTAMPTZ) as removed_at,
			src.active_period_start,
			src.active_period_end,
			src.affected_route_ids,
			src.cause,
			src.effect,
			src.header_text,
			src.description_text,
			src.severity,
			src.raw_payload
		FROM staged src
		WHERE src.rn = 1
	`, rawTable)
}

func (p *MTAAlertsPlugin) TransformQuery(rawTable string) string {
	return fmt.Sprintf(`
		UPDATE transit_v2.fact_alerts AS cur
		SET removed_at = CURRENT_TIMESTAMP
		WHERE cur.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_BUS', 'MTA_LIRR', 'MTA_METRO_NORTH', 'MTA_SIR')
		  AND cur.removed_at IS NULL
		  AND cur.alert_id NOT IN (
			  SELECT alert_id FROM (
				  SELECT DISTINCT a.alert_id
				  FROM (
					  SELECT unnest(from_json(decode(payload), '{"alerts": ["STRUCT(alert_id VARCHAR, agency_id VARCHAR, detected_at VARCHAR, last_seen_at VARCHAR, active_period_start VARCHAR, active_period_end VARCHAR, affected_route_ids VARCHAR[], affected_stop_ids VARCHAR[], cause VARCHAR, effect VARCHAR, header_text VARCHAR, description_text VARCHAR, severity VARCHAR)"]}').alerts) as a
					  FROM %s
				  )
				  WHERE a.alert_id IS NOT NULL
			  )
		  );

		UPDATE transit_v2.fact_alerts AS cur
		SET last_seen_at = inc.last_seen_at,
			removed_at = NULL,
			active_period_end = inc.active_period_end,
			affected_route_ids = inc.affected_route_ids,
			cause = inc.cause,
			effect = inc.effect,
			header_text = inc.header_text,
			description_text = inc.description_text,
			severity = inc.severity,
			raw_payload = inc.raw_payload
		FROM (
			WITH parsed AS (
				SELECT unnest(from_json(decode(payload), '{"alerts": ["STRUCT(alert_id VARCHAR, agency_id VARCHAR, detected_at VARCHAR, last_seen_at VARCHAR, active_period_start VARCHAR, active_period_end VARCHAR, affected_route_ids VARCHAR[], affected_stop_ids VARCHAR[], cause VARCHAR, effect VARCHAR, header_text VARCHAR, description_text VARCHAR, severity VARCHAR)"]}').alerts) as a
				FROM %s
			),
			incoming AS (
				SELECT
					a.alert_id,
					COALESCE(a.agency_id, 'MTA_NYCT_SUBWAY') as agency_id,
					COALESCE(try_cast(a.last_seen_at AS TIMESTAMPTZ), CURRENT_TIMESTAMP) as last_seen_at,
					try_cast(a.active_period_end AS TIMESTAMPTZ) as active_period_end,
					a.affected_route_ids,
					a.cause,
					a.effect,
					a.header_text,
					a.description_text,
					COALESCE(a.severity, 'INFO') as severity,
					to_json(a)::VARIANT as raw_payload,
					ROW_NUMBER() OVER (PARTITION BY a.alert_id, COALESCE(a.agency_id, 'MTA_NYCT_SUBWAY') ORDER BY COALESCE(try_cast(a.last_seen_at AS TIMESTAMPTZ), CURRENT_TIMESTAMP) DESC) as rn
				FROM parsed
				WHERE a.alert_id IS NOT NULL
			)
			SELECT * FROM incoming WHERE rn = 1
		) AS inc
		WHERE cur.alert_id = inc.alert_id
		  AND cur.agency_id = inc.agency_id;

		INSERT INTO transit_v2.fact_alerts (
			alert_id,
			agency_id,
			event_date,
			detected_at,
			last_seen_at,
			removed_at,
			active_period_start,
			active_period_end,
			affected_route_ids,
			cause,
			effect,
			header_text,
			description_text,
			severity,
			raw_payload
		)
		WITH staged_sel AS (
			%s
		)
		SELECT
			src.alert_id,
			src.agency_id,
			src.event_date,
			src.detected_at,
			src.last_seen_at,
			NULL as removed_at,
			src.active_period_start,
			src.active_period_end,
			src.affected_route_ids,
			src.cause,
			src.effect,
			src.header_text,
			src.description_text,
			src.severity,
			src.raw_payload
		FROM staged_sel src
		LEFT JOIN transit_v2.fact_alerts cur
		  ON cur.alert_id = src.alert_id
		 AND cur.agency_id = src.agency_id
		WHERE cur.alert_id IS NULL;
	`, rawTable, rawTable, p.TransformSelect(rawTable))
}
