use std::collections::{BTreeSet, HashMap};

use prost::Message;

use crate::proto::{FeedMessage, TranslatedString};

#[derive(Debug, Clone)]
pub struct VehiclePositionRow {
    pub event_date_days: i32,
    pub event_time_us: i64,
    pub agency_id: String,
    pub route_id: Option<String>,
    pub trip_id: Option<String>,
    pub station_id: Option<String>,
    pub vehicle_id: String,
    pub status: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub bearing: Option<f64>,
    pub speed: Option<f64>,
    pub occupancy_status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AlertRow {
    pub alert_id: String,
    pub agency_id: String,
    pub event_date_days: i32,
    pub detected_at_us: i64,
    pub last_seen_at_us: i64,
    pub active_period_start_us: Option<i64>,
    pub active_period_end_us: Option<i64>,
    pub affected_route_ids: Option<String>,
    pub cause: Option<String>,
    pub effect: Option<String>,
    pub header_text: Option<String>,
    pub description_text: Option<String>,
    pub severity: Option<String>,
}

/// Convert Unix seconds (UTC) to DuckDB `DATE` (days since 1970-01-01) in `America/New_York`.
/// Uses US DST rules (second Sunday in March 07:00 UTC to first Sunday in November 06:00 UTC).
pub fn nyc_date_days(unix_secs: i64) -> i32 {
    let offset = if is_us_eastern_dst(unix_secs) {
        -4 * 3600
    } else {
        -5 * 3600
    };
    (unix_secs + offset).div_euclid(86400) as i32
}

fn is_us_eastern_dst(unix_secs: i64) -> bool {
    let days = unix_secs.div_euclid(86400);
    let (_year, month, day) = civil_from_days(days);
    let sec_of_day = unix_secs.rem_euclid(86400);

    if month < 3 || month > 11 {
        return false;
    }
    if month > 3 && month < 11 {
        return true;
    }
    // Day of week: 1970-01-01 was Thursday (4). 0=Sun..6=Sat
    let dow = (days + 4).rem_euclid(7);
    if month == 3 {
        // Second Sunday in March: March 8..14
        let prev_sunday = day - dow;
        // Find second Sunday of March: first Sunday is in 1..=7, second is in 8..=14
        let first_sunday = ((1 + (7 - ((days - (day - 1) + 4).rem_euclid(7))) % 7)) as i64;
        let second_sunday = first_sunday + 7;
        let _ = prev_sunday;
        if day > second_sunday {
            return true;
        }
        if day < second_sunday {
            return false;
        }
        // Transition at 02:00 EST = 07:00 UTC
        return sec_of_day >= 7 * 3600;
    }
    // month == 11: First Sunday in November: Nov 1..7
    let first_sunday = ((1 + (7 - ((days - (day - 1) + 4).rem_euclid(7))) % 7)) as i64;
    if day < first_sunday {
        return true;
    }
    if day > first_sunday {
        return false;
    }
    // Transition at 02:00 EDT = 06:00 UTC
    sec_of_day < 6 * 3600
}

/// Howard Hinnant's civil_from_days algorithm.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

fn current_status_str(status: Option<i32>) -> &'static str {
    match status {
        Some(0) => "INCOMING_AT",
        Some(1) => "STOPPED_AT",
        Some(2) => "IN_TRANSIT_TO",
        _ => "IN_TRANSIT_TO",
    }
}

fn occupancy_status_str(occ: Option<i32>) -> Option<String> {
    match occ {
        Some(0) => Some("EMPTY".to_string()),
        Some(1) => Some("MANY_SEATS_AVAILABLE".to_string()),
        Some(2) => Some("FEW_SEATS_AVAILABLE".to_string()),
        Some(3) => Some("STANDING_ROOM_ONLY".to_string()),
        Some(4) => Some("CRUSHED_STANDING_ROOM_ONLY".to_string()),
        Some(5) => Some("FULL".to_string()),
        Some(6) => Some("NOT_ACCEPTING_PASSENGERS".to_string()),
        Some(7) => Some("NO_DATA_AVAILABLE".to_string()),
        Some(8) => Some("NOT_BOARDABLE".to_string()),
        _ => None,
    }
}

fn alert_cause_str(cause: Option<i32>) -> Option<String> {
    match cause {
        Some(1) => Some("UNKNOWN_CAUSE".to_string()),
        Some(2) => Some("OTHER_CAUSE".to_string()),
        Some(3) => Some("TECHNICAL_PROBLEM".to_string()),
        Some(4) => Some("STRIKE".to_string()),
        Some(5) => Some("DEMONSTRATION".to_string()),
        Some(6) => Some("ACCIDENT".to_string()),
        Some(7) => Some("HOLIDAY".to_string()),
        Some(8) => Some("WEATHER".to_string()),
        Some(9) => Some("MAINTENANCE".to_string()),
        Some(10) => Some("CONSTRUCTION".to_string()),
        Some(11) => Some("POLICE_ACTIVITY".to_string()),
        Some(12) => Some("MEDICAL_EMERGENCY".to_string()),
        _ => None,
    }
}

fn alert_effect_str(effect: Option<i32>) -> Option<String> {
    match effect {
        Some(1) => Some("NO_SERVICE".to_string()),
        Some(2) => Some("REDUCED_SERVICE".to_string()),
        Some(3) => Some("SIGNIFICANT_DELAYS".to_string()),
        Some(4) => Some("DETOUR".to_string()),
        Some(5) => Some("ADDITIONAL_SERVICE".to_string()),
        Some(6) => Some("MODIFIED_SERVICE".to_string()),
        Some(7) => Some("OTHER_EFFECT".to_string()),
        Some(8) => Some("UNKNOWN_EFFECT".to_string()),
        Some(9) => Some("STOP_MOVED".to_string()),
        Some(10) => Some("NO_EFFECT".to_string()),
        Some(11) => Some("ACCESSIBILITY_ISSUE".to_string()),
        _ => None,
    }
}

fn alert_severity_str(sev: Option<i32>) -> Option<String> {
    match sev {
        Some(1) => Some("UNKNOWN_SEVERITY".to_string()),
        Some(2) => Some("INFO".to_string()),
        Some(3) => Some("WARNING".to_string()),
        Some(4) => Some("SEVERE".to_string()),
        _ => None,
    }
}

fn pick_translated_text(ts: Option<&TranslatedString>) -> Option<String> {
    let ts = ts?;
    if ts.translation.is_empty() {
        return None;
    }
    if let Some(en) = ts
        .translation
        .iter()
        .find(|t| t.language.as_deref() == Some("en") || t.language.as_deref() == Some("EN"))
    {
        return Some(en.text.clone());
    }
    Some(ts.translation[0].text.clone())
}

pub fn decode_vehicle_positions(
    bytes: &[u8],
    default_agency: &str,
    now_unix_secs: i64,
) -> Result<Vec<VehiclePositionRow>, String> {
    let feed = FeedMessage::decode(bytes).map_err(|e| format!("protobuf decode error: {}", e))?;
    let header_ts = feed.header.timestamp.map(|t| t as i64);

    let mut trip_route_map: HashMap<String, String> = HashMap::new();
    for entity in &feed.entity {
        if let Some(tu) = &entity.trip_update {
            if let (Some(tid), Some(rid)) = (&tu.trip.trip_id, &tu.trip.route_id) {
                if !tid.is_empty() && !rid.is_empty() {
                    trip_route_map.insert(tid.clone(), rid.clone());
                }
            }
        }
    }

    let mut rows = Vec::new();
    for entity in &feed.entity {
        if entity.is_deleted.unwrap_or(false) {
            continue;
        }
        let Some(vp) = &entity.vehicle else {
            continue;
        };

        let trip_id = vp
            .trip
            .as_ref()
            .and_then(|t| t.trip_id.as_ref())
            .filter(|s| !s.is_empty())
            .cloned();

        let nyct_train_id = vp
            .trip
            .as_ref()
            .and_then(|t| t.nyct_trip_descriptor.as_ref())
            .and_then(|n| n.train_id.as_ref())
            .filter(|s| !s.is_empty())
            .cloned();

        let vehicle_id = vp
            .vehicle
            .as_ref()
            .and_then(|v| v.id.as_ref())
            .filter(|s| !s.is_empty())
            .cloned()
            .or_else(|| nyct_train_id)
            .or_else(|| trip_id.clone())
            .unwrap_or_else(|| entity.id.clone());

        let mut route_id = vp
            .trip
            .as_ref()
            .and_then(|t| t.route_id.as_ref())
            .filter(|s| !s.is_empty())
            .cloned();
        if route_id.is_none() {
            if let Some(tid) = &trip_id {
                route_id = trip_route_map.get(tid).cloned();
            }
        }

        let station_id = vp.stop_id.as_ref().filter(|s| !s.is_empty()).cloned();
        let status = current_status_str(vp.current_status).to_string();

        let (latitude, longitude, bearing, speed) = if let Some(pos) = &vp.position {
            let lat_v = pos.latitude as f64;
            let lon_v = pos.longitude as f64;
            let valid_coords = lat_v != 0.0
                && lon_v != 0.0
                && (-90.0..=90.0).contains(&lat_v)
                && (-180.0..=180.0).contains(&lon_v);
            (
                if valid_coords { Some(lat_v) } else { None },
                if valid_coords { Some(lon_v) } else { None },
                pos.bearing.map(|b| b as f64),
                pos.speed.map(|s| s as f64),
            )
        } else {
            (None, None, None, None)
        };

        let occupancy_status = occupancy_status_str(vp.occupancy_status);

        let raw_ts = vp
            .timestamp
            .map(|t| t as i64)
            .or(header_ts)
            .unwrap_or(now_unix_secs);
        let ev_secs = if raw_ts > 0 && raw_ts <= now_unix_secs + 60 {
            raw_ts
        } else {
            now_unix_secs
        };

        rows.push(VehiclePositionRow {
            event_date_days: nyc_date_days(ev_secs),
            event_time_us: ev_secs * 1_000_000,
            agency_id: default_agency.to_string(),
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
        });
    }

    Ok(rows)
}

pub fn decode_alerts(
    bytes: &[u8],
    default_agency: &str,
    now_unix_secs: i64,
) -> Result<Vec<AlertRow>, String> {
    let feed = FeedMessage::decode(bytes).map_err(|e| format!("protobuf decode error: {}", e))?;
    let header_ts = feed
        .header
        .timestamp
        .map(|t| t as i64)
        .filter(|&t| t > 0 && t <= now_unix_secs + 60)
        .unwrap_or(now_unix_secs);

    let mut rows = Vec::new();
    for entity in &feed.entity {
        if entity.is_deleted.unwrap_or(false) {
            continue;
        }
        let Some(alert) = &entity.alert else {
            continue;
        };

        let agency_id = alert
            .informed_entity
            .iter()
            .find_map(|ie| ie.agency_id.as_ref().filter(|s| !s.is_empty()))
            .cloned()
            .unwrap_or_else(|| default_agency.to_string());

        let mut routes = BTreeSet::new();
        for ie in &alert.informed_entity {
            if let Some(r) = &ie.route_id {
                if !r.is_empty() {
                    routes.insert(r.clone());
                }
            }
            if let Some(t) = &ie.trip {
                if let Some(r) = &t.route_id {
                    if !r.is_empty() {
                        routes.insert(r.clone());
                    }
                }
            }
        }
        let affected_route_ids = if routes.is_empty() {
            None
        } else {
            Some(routes.into_iter().collect::<Vec<_>>().join(","))
        };

        let first_period = alert.active_period.first();
        let active_period_start_us = first_period.and_then(|p| p.start).map(|s| (s as i64) * 1_000_000);
        let active_period_end_us = first_period.and_then(|p| p.end).map(|e| (e as i64) * 1_000_000);

        rows.push(AlertRow {
            alert_id: entity.id.clone(),
            agency_id,
            event_date_days: nyc_date_days(header_ts),
            detected_at_us: header_ts * 1_000_000,
            last_seen_at_us: header_ts * 1_000_000,
            active_period_start_us,
            active_period_end_us,
            affected_route_ids,
            cause: alert_cause_str(alert.cause),
            effect: alert_effect_str(alert.effect),
            header_text: pick_translated_text(alert.header_text.as_ref()),
            description_text: pick_translated_text(alert.description_text.as_ref()),
            severity: alert_severity_str(alert.severity_level),
        });
    }

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::*;

    #[test]
    fn test_nyc_date_days_dst_and_est() {
        // 2026-11-16 01:00:00 UTC = 2026-11-15 20:00:00 EST (UTC-5)
        // Unix seconds for 2026-11-16 01:00:00 UTC:
        // Days from 1970-01-01 to 2026-11-16 is 20773
        let ts_utc = 20773 * 86400 + 3600;
        assert_eq!(nyc_date_days(ts_utc), 20772);
    }

    #[test]
    fn test_decode_vehicle_positions_with_trip_route_fallback() {
        let msg = FeedMessage {
            header: FeedHeader {
                gtfs_realtime_version: "2.0".to_string(),
                incrementality: Some(0),
                timestamp: Some(1_760_000_000),
            },
            entity: vec![
                FeedEntity {
                    id: "tu_1".to_string(),
                    is_deleted: None,
                    trip_update: Some(TripUpdate {
                        trip: TripDescriptor {
                            trip_id: Some("TRIP_123".to_string()),
                            route_id: Some("LIRR_10".to_string()),
                            direction_id: None,
                            start_time: None,
                            start_date: None,
                            schedule_relationship: None,
                            nyct_trip_descriptor: None,
                        },
                        stop_time_update: vec![],
                        vehicle: None,
                        timestamp: None,
                        delay: None,
                    }),
                    vehicle: None,
                    alert: None,
                },
                FeedEntity {
                    id: "vp_1".to_string(),
                    is_deleted: None,
                    trip_update: None,
                    vehicle: Some(VehiclePosition {
                        trip: Some(TripDescriptor {
                            trip_id: Some("TRIP_123".to_string()),
                            route_id: None,
                            direction_id: None,
                            start_time: None,
                            start_date: None,
                            schedule_relationship: None,
                            nyct_trip_descriptor: Some(NyctTripDescriptor {
                                train_id: Some("1A 1234".to_string()),
                                is_assigned: Some(true),
                                direction: Some(1),
                            }),
                        }),
                        position: Some(Position {
                            latitude: 40.7505,
                            longitude: -73.9934,
                            bearing: Some(90.0),
                            odometer: None,
                            speed: Some(12.5),
                        }),
                        current_stop_sequence: Some(4),
                        current_status: Some(1),
                        timestamp: Some(1_760_000_005),
                        congestion_level: None,
                        stop_id: Some("PENN".to_string()),
                        vehicle: Some(VehicleDescriptor {
                            id: Some("CAR_901".to_string()),
                            label: None,
                            license_plate: None,
                        }),
                        occupancy_status: Some(2),
                    }),
                    alert: None,
                },
            ],
        };

        let bytes = msg.encode_to_vec();
        let rows = decode_vehicle_positions(&bytes, "MTA_LIRR", 1_760_000_010).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.agency_id, "MTA_LIRR");
        assert_eq!(r.route_id.as_deref(), Some("LIRR_10"));
        assert_eq!(r.trip_id.as_deref(), Some("TRIP_123"));
        assert_eq!(r.vehicle_id, "CAR_901");
        assert_eq!(r.station_id.as_deref(), Some("PENN"));
        assert_eq!(r.status, "STOPPED_AT");
        assert_eq!(r.occupancy_status.as_deref(), Some("FEW_SEATS_AVAILABLE"));
        assert!((r.latitude.unwrap() - 40.7505).abs() < 1e-4);
        assert!((r.longitude.unwrap() - (-73.9934)).abs() < 1e-4);
        assert_eq!(r.event_time_us, 1_760_000_005 * 1_000_000);
    }

    #[test]
    fn test_decode_alerts() {
        let msg = FeedMessage {
            header: FeedHeader {
                gtfs_realtime_version: "2.0".to_string(),
                incrementality: Some(0),
                timestamp: Some(1_760_000_000),
            },
            entity: vec![FeedEntity {
                id: "lirr:alert:42".to_string(),
                is_deleted: None,
                trip_update: None,
                vehicle: None,
                alert: Some(Alert {
                    active_period: vec![TimeRange {
                        start: Some(1_759_999_000),
                        end: Some(1_760_005_000),
                    }],
                    informed_entity: vec![
                        EntitySelector {
                            agency_id: Some("MTA_NYCT_SUBWAY".to_string()),
                            route_id: Some("A".to_string()),
                            route_type: None,
                            trip: None,
                            stop_id: None,
                        },
                        EntitySelector {
                            agency_id: None,
                            route_id: Some("C".to_string()),
                            route_type: None,
                            trip: None,
                            stop_id: None,
                        },
                    ],
                    cause: Some(3),
                    effect: Some(3),
                    url: None,
                    header_text: Some(TranslatedString {
                        translation: vec![Translation {
                            text: "Signal malfunction at Jay St".to_string(),
                            language: Some("en".to_string()),
                        }],
                    }),
                    description_text: None,
                    severity_level: Some(3),
                }),
            }],
        };

        let bytes = msg.encode_to_vec();
        let rows = decode_alerts(&bytes, "MTA_ALERTS", 1_760_000_010).unwrap();
        assert_eq!(rows.len(), 1);
        let a = &rows[0];
        assert_eq!(a.alert_id, "lirr:alert:42");
        assert_eq!(a.agency_id, "MTA_NYCT_SUBWAY");
        assert_eq!(a.affected_route_ids.as_deref(), Some("A,C"));
        assert_eq!(a.cause.as_deref(), Some("TECHNICAL_PROBLEM"));
        assert_eq!(a.effect.as_deref(), Some("SIGNIFICANT_DELAYS"));
        assert_eq!(a.severity.as_deref(), Some("WARNING"));
        assert_eq!(a.header_text.as_deref(), Some("Signal malfunction at Jay St"));
    }
}
