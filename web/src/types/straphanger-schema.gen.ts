// Generated automatically by scripts/generate-schema-types.mjs
// Do not edit manually. Re-run 'npm run codegen:schema' to update.

export const CURRENT_SCHEMA_VERSION = 'transit_v2' as const;
export type CurrentSchemaVersion = typeof CURRENT_SCHEMA_VERSION;

export const TRANSIT_BASE_TABLES = [
  "dim_stations",
  "dim_routes",
  "fact_schedules",
  "fact_vehicle_positions",
  "fact_alerts",
  "fact_ridership",
  "dim_micromobility_stations",
  "fact_micromobility_status",
  "fact_turnstile_counts",
  "dim_boroughs",
  "dim_service_lines"
] as const;
export type TransitBaseTableName = (typeof TRANSIT_BASE_TABLES)[number];

export const TRANSIT_VIEWS = [
  "view_current_vehicle_positions",
  "view_current_micromobility_status",
  "view_active_alerts",
  "view_dim_stations",
  "view_station_complexes",
  "view_dim_routes",
  "view_dim_micromobility_stations",
  "view_vehicle_kinematics",
  "view_station_headways",
  "view_station_to_station_legs",
  "view_alert_routes",
  "view_alert_stations",
  "view_turnstile_flows",
  "view_schedule_adherence",
  "view_station_hourly_summary",
  "view_dim_surface_routes",
  "view_dim_surface_stations",
  "view_surface_kinematics",
  "view_surface_headways",
  "view_dim_boroughs",
  "view_dim_map_geography",
  "view_dim_service_lines",
  "view_dim_routes_1929",
  "view_dim_service_lines_1929",
  "view_dim_stations_1929",
  "view_dim_routes_1953",
  "view_dim_service_lines_1953",
  "view_dim_stations_1953",
  "view_dim_routes_proposed",
  "view_dim_service_lines_proposed",
  "view_dim_stations_proposed"
] as const;
export type TransitViewName = (typeof TRANSIT_VIEWS)[number];

export const TRANSIT_RELATIONS = [
  ...TRANSIT_BASE_TABLES,
  ...TRANSIT_VIEWS,
] as const;
export type TransitRelationName = (typeof TRANSIT_RELATIONS)[number];

export type QualifiedProdRelation = `prod.${typeof CURRENT_SCHEMA_VERSION}.${TransitRelationName}`;

export const NYC_AGENCIES = [
  "MTA_NYCT_SUBWAY",
  "MTA_NYCT_SIR",
  "MTA_LIRR",
  "MTA_METRO_NORTH",
  "PORT_AUTHORITY_PATH",
  "NJ_TRANSIT",
  "MTA_BUS",
  "CITIBIKE",
  "NYC_FERRY"
] as const;
export type CanonicalAgencyId = (typeof NYC_AGENCIES)[number];

export const AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7"
] as const;
export type AmbiguousRouteId = (typeof AMBIGUOUS_CROSS_AGENCY_ROUTE_IDS)[number];

export const UNBOUNDED_PARTITIONED_RELATIONS = [
  "fact_schedules",
  "fact_vehicle_positions",
  "fact_alerts",
  "fact_ridership",
  "fact_micromobility_status",
  "fact_turnstile_counts",
  "view_vehicle_kinematics",
  "view_station_headways",
  "view_station_to_station_legs",
  "view_alert_routes",
  "view_alert_stations",
  "view_turnstile_flows",
  "view_schedule_adherence",
  "view_station_hourly_summary",
  "view_surface_kinematics",
  "view_surface_headways"
] as const;
export type UnboundedPartitionedRelationName = (typeof UNBOUNDED_PARTITIONED_RELATIONS)[number];

export const PRE_BOUNDED_LIVE_VIEWS = [
  "view_current_vehicle_positions",
  "view_current_micromobility_status",
  "view_active_alerts"
] as const;
export type PreBoundedLiveViewName = (typeof PRE_BOUNDED_LIVE_VIEWS)[number];

export const DIMENSION_RELATIONS = [
  "dim_stations",
  "dim_routes",
  "dim_micromobility_stations",
  "dim_boroughs",
  "dim_service_lines",
  "view_dim_stations",
  "view_station_complexes",
  "view_dim_routes",
  "view_dim_micromobility_stations",
  "view_dim_surface_routes",
  "view_dim_surface_stations",
  "view_dim_boroughs",
  "view_dim_map_geography",
  "view_dim_service_lines",
  "view_dim_routes_1929",
  "view_dim_service_lines_1929",
  "view_dim_stations_1929",
  "view_dim_routes_1953",
  "view_dim_service_lines_1953",
  "view_dim_stations_1953",
  "view_dim_routes_proposed",
  "view_dim_service_lines_proposed",
  "view_dim_stations_proposed"
] as const;
export type DimensionRelationName = (typeof DIMENSION_RELATIONS)[number];

export const RECOMMENDED_ANALYTICS_RELATIONS = [
  "view_current_vehicle_positions",
  "view_current_micromobility_status",
  "view_active_alerts",
  "view_dim_stations",
  "view_station_complexes",
  "view_dim_routes",
  "view_dim_micromobility_stations",
  "view_vehicle_kinematics",
  "view_station_headways",
  "view_station_to_station_legs",
  "view_alert_routes",
  "view_alert_stations",
  "view_turnstile_flows",
  "view_schedule_adherence",
  "view_station_hourly_summary",
  "view_dim_surface_routes",
  "view_dim_surface_stations",
  "view_surface_kinematics",
  "view_surface_headways",
  "view_dim_boroughs",
  "view_dim_map_geography",
  "view_dim_service_lines",
  "view_dim_routes_1929",
  "view_dim_service_lines_1929",
  "view_dim_stations_1929",
  "view_dim_routes_1953",
  "view_dim_service_lines_1953",
  "view_dim_stations_1953",
  "view_dim_routes_proposed",
  "view_dim_service_lines_proposed",
  "view_dim_stations_proposed",
  "fact_schedules",
  "fact_ridership"
] as const;
export type RecommendedAnalyticsRelationName = (typeof RECOMMENDED_ANALYTICS_RELATIONS)[number];

export const RAW_SCD_BASE_TABLES = [
  "dim_stations",
  "dim_routes",
  "dim_micromobility_stations",
  "dim_boroughs",
  "dim_service_lines",
  "fact_alerts"
] as const;
export type RawScdBaseTableName = (typeof RAW_SCD_BASE_TABLES)[number];

export interface SchemaColumn {
  readonly name: string;
  readonly datatype: string;
}

export const TRANSIT_SCHEMA_COLUMNS: Record<TransitRelationName, readonly SchemaColumn[]> = {
  "dim_stations": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    },
    {
      "name": "structure",
      "datatype": "VARCHAR"
    },
    {
      "name": "is_accessible",
      "datatype": "BOOLEAN"
    },
    {
      "name": "valid_from",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "valid_to",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "is_current",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "dim_routes": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "type",
      "datatype": "VARCHAR"
    },
    {
      "name": "valid_from",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "valid_to",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "is_current",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_schedules": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "scheduled_arrival_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "scheduled_departure_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_vehicle_positions": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "bearing",
      "datatype": "DOUBLE"
    },
    {
      "name": "speed",
      "datatype": "DOUBLE"
    },
    {
      "name": "occupancy_status",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_alerts": [
    {
      "name": "alert_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "detected_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "last_seen_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "removed_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_start",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_end",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "affected_route_ids",
      "datatype": "VARCHAR"
    },
    {
      "name": "cause",
      "datatype": "VARCHAR"
    },
    {
      "name": "effect",
      "datatype": "VARCHAR"
    },
    {
      "name": "header_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "description_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "severity",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_ridership": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "origin_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "destination_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "passenger_count",
      "datatype": "BIGINT"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "dim_micromobility_stations": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "capacity",
      "datatype": "INTEGER"
    },
    {
      "name": "valid_from",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "valid_to",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "is_current",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_micromobility_status": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "num_bikes_available",
      "datatype": "INTEGER"
    },
    {
      "name": "num_ebikes_available",
      "datatype": "INTEGER"
    },
    {
      "name": "num_docks_available",
      "datatype": "INTEGER"
    },
    {
      "name": "is_installed",
      "datatype": "BOOLEAN"
    },
    {
      "name": "is_renting",
      "datatype": "BOOLEAN"
    },
    {
      "name": "is_returning",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "fact_turnstile_counts": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "device_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "reading_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "entry_count",
      "datatype": "BIGINT"
    },
    {
      "name": "exit_count",
      "datatype": "BIGINT"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_current_vehicle_positions": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "bearing",
      "datatype": "DOUBLE"
    },
    {
      "name": "speed",
      "datatype": "DOUBLE"
    },
    {
      "name": "occupancy_status",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_current_micromobility_status": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "num_bikes_available",
      "datatype": "INTEGER"
    },
    {
      "name": "num_ebikes_available",
      "datatype": "INTEGER"
    },
    {
      "name": "num_docks_available",
      "datatype": "INTEGER"
    },
    {
      "name": "is_installed",
      "datatype": "BOOLEAN"
    },
    {
      "name": "is_renting",
      "datatype": "BOOLEAN"
    },
    {
      "name": "is_returning",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_active_alerts": [
    {
      "name": "alert_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "detected_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "last_seen_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "removed_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_start",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_end",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "affected_route_ids",
      "datatype": "VARCHAR"
    },
    {
      "name": "cause",
      "datatype": "VARCHAR"
    },
    {
      "name": "effect",
      "datatype": "VARCHAR"
    },
    {
      "name": "header_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "description_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "severity",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_stations": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    },
    {
      "name": "structure",
      "datatype": "VARCHAR"
    },
    {
      "name": "is_accessible",
      "datatype": "BOOLEAN"
    },
    {
      "name": "route_count",
      "datatype": "INTEGER"
    },
    {
      "name": "is_interlined_junction",
      "datatype": "BOOLEAN"
    },
    {
      "name": "borough",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_station_complexes": [
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    },
    {
      "name": "is_accessible",
      "datatype": "BOOLEAN"
    },
    {
      "name": "station_count",
      "datatype": "BIGINT"
    },
    {
      "name": "route_count",
      "datatype": "BIGINT"
    }
  ],
  "view_dim_routes": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "type",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    },
    {
      "name": "bullet_code",
      "datatype": "VARCHAR"
    },
    {
      "name": "text_color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "trunk_group",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_micromobility_stations": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "capacity",
      "datatype": "INTEGER"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_vehicle_kinematics": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "bearing",
      "datatype": "DOUBLE"
    },
    {
      "name": "occupancy_status",
      "datatype": "VARCHAR"
    },
    {
      "name": "delta_time_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "step_distance_meters",
      "datatype": "DOUBLE"
    },
    {
      "name": "effective_speed_mps",
      "datatype": "DOUBLE"
    },
    {
      "name": "effective_speed_mph",
      "datatype": "DOUBLE"
    },
    {
      "name": "accel_mps2",
      "datatype": "DOUBLE"
    },
    {
      "name": "dwell_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "signal_delay_sec",
      "datatype": "DOUBLE"
    }
  ],
  "view_station_headways": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "parent_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "direction_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "headway_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "headway_sec_squared",
      "datatype": "DOUBLE"
    }
  ],
  "view_station_to_station_legs": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "from_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "to_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "departure_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "arrival_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "leg_travel_time_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "leg_distance_meters",
      "datatype": "DOUBLE"
    },
    {
      "name": "leg_speed_mps",
      "datatype": "DOUBLE"
    }
  ],
  "view_alert_routes": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "alert_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "detected_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "last_seen_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "removed_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_start",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_end",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "cause",
      "datatype": "VARCHAR"
    },
    {
      "name": "effect",
      "datatype": "VARCHAR"
    },
    {
      "name": "header_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "description_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "severity",
      "datatype": "VARCHAR"
    }
  ],
  "view_alert_stations": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "alert_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "parent_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "detected_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "last_seen_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "removed_at",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_start",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "active_period_end",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "cause",
      "datatype": "VARCHAR"
    },
    {
      "name": "effect",
      "datatype": "VARCHAR"
    },
    {
      "name": "header_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "description_text",
      "datatype": "VARCHAR"
    },
    {
      "name": "severity",
      "datatype": "VARCHAR"
    }
  ],
  "view_turnstile_flows": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "device_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "reading_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "service_hour",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "entry_count",
      "datatype": "BIGINT"
    },
    {
      "name": "exit_count",
      "datatype": "BIGINT"
    },
    {
      "name": "payment_method",
      "datatype": "VARCHAR"
    },
    {
      "name": "fare_class_category",
      "datatype": "VARCHAR"
    }
  ],
  "view_schedule_adherence": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "service_hour",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "hour_of_day",
      "datatype": "DOUBLE"
    },
    {
      "name": "scheduled_trips_count",
      "datatype": "BIGINT"
    },
    {
      "name": "observed_trips_count",
      "datatype": "BIGINT"
    },
    {
      "name": "ghost_trips_count",
      "datatype": "BIGINT"
    },
    {
      "name": "unscheduled_trips_count",
      "datatype": "BIGINT"
    },
    {
      "name": "service_completion_pct",
      "datatype": "DOUBLE"
    },
    {
      "name": "avg_observed_headway_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "median_observed_headway_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "sum_headway_sec_squared",
      "datatype": "DOUBLE"
    },
    {
      "name": "active_alerts_count",
      "datatype": "BIGINT"
    }
  ],
  "view_station_hourly_summary": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "parent_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "service_hour",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "total_entries",
      "datatype": "BIGINT"
    },
    {
      "name": "total_exits",
      "datatype": "BIGINT"
    },
    {
      "name": "train_arrivals_count",
      "datatype": "BIGINT"
    },
    {
      "name": "avg_headway_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "station_alerts_count",
      "datatype": "BIGINT"
    }
  ],
  "view_dim_surface_routes": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "type",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    },
    {
      "name": "bullet_code",
      "datatype": "VARCHAR"
    },
    {
      "name": "text_color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "trunk_group",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_surface_stations": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    },
    {
      "name": "structure",
      "datatype": "VARCHAR"
    },
    {
      "name": "is_accessible",
      "datatype": "BOOLEAN"
    },
    {
      "name": "route_count",
      "datatype": "INTEGER"
    },
    {
      "name": "is_interlined_junction",
      "datatype": "BOOLEAN"
    },
    {
      "name": "borough",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_surface_kinematics": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "bearing",
      "datatype": "DOUBLE"
    },
    {
      "name": "occupancy_status",
      "datatype": "VARCHAR"
    },
    {
      "name": "delta_time_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "step_distance_meters",
      "datatype": "DOUBLE"
    },
    {
      "name": "effective_speed_mps",
      "datatype": "DOUBLE"
    },
    {
      "name": "effective_speed_mph",
      "datatype": "DOUBLE"
    },
    {
      "name": "accel_mps2",
      "datatype": "DOUBLE"
    },
    {
      "name": "dwell_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "signal_delay_sec",
      "datatype": "DOUBLE"
    }
  ],
  "view_surface_headways": [
    {
      "name": "event_date",
      "datatype": "DATE"
    },
    {
      "name": "event_time",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "trip_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "vehicle_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "parent_station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "direction_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "status",
      "datatype": "VARCHAR"
    },
    {
      "name": "headway_sec",
      "datatype": "DOUBLE"
    },
    {
      "name": "headway_sec_squared",
      "datatype": "DOUBLE"
    }
  ],
  "dim_boroughs": [
    {
      "name": "boro_code",
      "datatype": "INTEGER"
    },
    {
      "name": "boro_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_area",
      "datatype": "DOUBLE"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "valid_from",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "valid_to",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "is_current",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "dim_service_lines": [
    {
      "name": "line_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "service_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "line_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "valid_from",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "valid_to",
      "datatype": "TIMESTAMPTZ"
    },
    {
      "name": "is_current",
      "datatype": "BOOLEAN"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_boroughs": [
    {
      "name": "boro_code",
      "datatype": "INTEGER"
    },
    {
      "name": "boro_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_area",
      "datatype": "DOUBLE"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_map_geography": [
    {
      "name": "boro_code",
      "datatype": "INTEGER"
    },
    {
      "name": "boro_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "region_kind",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_area",
      "datatype": "DOUBLE"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_service_lines": [
    {
      "name": "line_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "service_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "line_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_routes_1929": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_service_lines_1929": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_stations_1929": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "borough",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_routes_1953": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "type",
      "datatype": "VARCHAR"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    },
    {
      "name": "bullet_code",
      "datatype": "VARCHAR"
    },
    {
      "name": "text_color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "trunk_group",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_service_lines_1953": [
    {
      "name": "line_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "service_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    },
    {
      "name": "line_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_wkt",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    },
    {
      "name": "shape_leng",
      "datatype": "DOUBLE"
    },
    {
      "name": "raw_payload",
      "datatype": "VARIANT"
    }
  ],
  "view_dim_stations_1953": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "borough",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_routes_proposed": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "division",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_service_lines_proposed": [
    {
      "name": "route_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "route_name",
      "datatype": "VARCHAR"
    },
    {
      "name": "color_hex",
      "datatype": "VARCHAR"
    },
    {
      "name": "geom_geojson",
      "datatype": "VARCHAR"
    }
  ],
  "view_dim_stations_proposed": [
    {
      "name": "station_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "agency_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "name",
      "datatype": "VARCHAR"
    },
    {
      "name": "latitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "longitude",
      "datatype": "DOUBLE"
    },
    {
      "name": "gtfs_stop_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "complex_id",
      "datatype": "VARCHAR"
    },
    {
      "name": "borough",
      "datatype": "VARCHAR"
    },
    {
      "name": "daytime_routes",
      "datatype": "VARCHAR"
    }
  ]
} as const;

export interface CanonicalRouteInfo {
  readonly routeId: string;
  readonly agencyId: string;
  readonly routeName: string;
  readonly colorHex: string;
  readonly type: string;
  readonly bulletCode: string;
  readonly textColorHex?: string;
  readonly division?: string;
  readonly trunkGroup?: string;
  readonly isDiamond?: boolean;
  readonly aliases?: readonly string[];
  readonly tauranacColorHex?: string;
  readonly ind1953ColorHex?: string;
  readonly routeShortLabel?: string;
}

export const CANONICAL_ROUTES: Record<string, CanonicalRouteInfo> = {
  "MTA_NYCT_SUBWAY:1": {
    "routeId": "1",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Broadway-7 Avenue Local",
    "colorHex": "#EE352E",
    "type": "subway",
    "bulletCode": "1",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT 7th Ave Red",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#D82233",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:2": {
    "routeId": "2",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "7 Avenue Express",
    "colorHex": "#EE352E",
    "type": "subway",
    "bulletCode": "2",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT 7th Ave Red",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#D82233",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:3": {
    "routeId": "3",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "7 Avenue Express",
    "colorHex": "#EE352E",
    "type": "subway",
    "bulletCode": "3",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT 7th Ave Red",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#D82233",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:4": {
    "routeId": "4",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Lexington Avenue Express",
    "colorHex": "#00933C",
    "type": "subway",
    "bulletCode": "4",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Lexington Green",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#009952",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:5": {
    "routeId": "5",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Lexington Avenue Express",
    "colorHex": "#00933C",
    "type": "subway",
    "bulletCode": "5",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Lexington Green",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#009952",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:6": {
    "routeId": "6",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Lexington Avenue Local",
    "colorHex": "#00933C",
    "type": "subway",
    "bulletCode": "6",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Lexington Green",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#009952",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:6X": {
    "routeId": "6X",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "6 Express",
    "colorHex": "#00933C",
    "type": "subway",
    "bulletCode": "6",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Lexington Green",
    "isDiamond": true,
    "aliases": [
      "<6>"
    ],
    "tauranacColorHex": "#009952",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:7": {
    "routeId": "7",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Flushing Local",
    "colorHex": "#B933AD",
    "type": "subway",
    "bulletCode": "7",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Flushing Purple",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#9A38A1",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:7X": {
    "routeId": "7X",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "7 Express",
    "colorHex": "#B933AD",
    "type": "subway",
    "bulletCode": "7",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "IRT Flushing Purple",
    "isDiamond": true,
    "aliases": [
      "<7>"
    ],
    "tauranacColorHex": "#9A38A1",
    "ind1953ColorHex": "#B8292F"
  },
  "MTA_NYCT_SUBWAY:A": {
    "routeId": "A",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "8 Avenue Express",
    "colorHex": "#0039A6",
    "type": "subway",
    "bulletCode": "A",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 8th Ave Blue",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_NYCT_SUBWAY:C": {
    "routeId": "C",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "8 Avenue Local",
    "colorHex": "#0039A6",
    "type": "subway",
    "bulletCode": "C",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 8th Ave Blue",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#3B6E8C"
  },
  "MTA_NYCT_SUBWAY:E": {
    "routeId": "E",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "8 Avenue Local",
    "colorHex": "#0039A6",
    "type": "subway",
    "bulletCode": "E",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 8th Ave Blue",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#1B7F5C"
  },
  "MTA_NYCT_SUBWAY:B": {
    "routeId": "B",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Central Park West Local / 6 Avenue Express",
    "colorHex": "#FF6319",
    "type": "subway",
    "bulletCode": "B",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 6th Ave Orange",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#F58220",
    "ind1953ColorHex": "#D9531E"
  },
  "MTA_NYCT_SUBWAY:D": {
    "routeId": "D",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "6 Avenue Express",
    "colorHex": "#FF6319",
    "type": "subway",
    "bulletCode": "D",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 6th Ave Orange",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#F58220",
    "ind1953ColorHex": "#D9531E"
  },
  "MTA_NYCT_SUBWAY:F": {
    "routeId": "F",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Queens Blvd Express / 6 Avenue Local",
    "colorHex": "#FF6319",
    "type": "subway",
    "bulletCode": "F",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 6th Ave Orange",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#F58220",
    "ind1953ColorHex": "#1B7F5C"
  },
  "MTA_NYCT_SUBWAY:FX": {
    "routeId": "FX",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "F Express",
    "colorHex": "#FF6319",
    "type": "subway",
    "bulletCode": "F",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 6th Ave Orange",
    "isDiamond": true,
    "aliases": [
      "<F>"
    ],
    "tauranacColorHex": "#F58220",
    "ind1953ColorHex": "#1B7F5C"
  },
  "MTA_NYCT_SUBWAY:M": {
    "routeId": "M",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Queens Blvd Local / 6 Avenue Local",
    "colorHex": "#FF6319",
    "type": "subway",
    "bulletCode": "M",
    "textColorHex": "#FFFFFF",
    "division": "BMT",
    "trunkGroup": "IND 6th Ave Orange",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#8E5B3A",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:G": {
    "routeId": "G",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Brooklyn-Queens Crosstown",
    "colorHex": "#6CBE45",
    "type": "subway",
    "bulletCode": "G",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND Crosstown Lime",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#7AC143",
    "ind1953ColorHex": "#5E9E3E"
  },
  "MTA_NYCT_SUBWAY:J": {
    "routeId": "J",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Nassau Street Local",
    "colorHex": "#996633",
    "type": "subway",
    "bulletCode": "J",
    "textColorHex": "#FFFFFF",
    "division": "BMT",
    "trunkGroup": "BMT Nassau Brown",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#8E5B3A",
    "ind1953ColorHex": "#6B4C35"
  },
  "MTA_NYCT_SUBWAY:Z": {
    "routeId": "Z",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Nassau Street Express",
    "colorHex": "#996633",
    "type": "subway",
    "bulletCode": "Z",
    "textColorHex": "#FFFFFF",
    "division": "BMT",
    "trunkGroup": "BMT Nassau Brown",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#8E5B3A",
    "ind1953ColorHex": "#6B4C35"
  },
  "MTA_NYCT_SUBWAY:L": {
    "routeId": "L",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "14 Street-Canarsie Local",
    "colorHex": "#A7A9AC",
    "type": "subway",
    "bulletCode": "L",
    "textColorHex": "#FFFFFF",
    "division": "BMT",
    "trunkGroup": "BMT Canarsie Grey",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#9EA2A2",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:N": {
    "routeId": "N",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Broadway Express",
    "colorHex": "#FCCC0A",
    "type": "subway",
    "bulletCode": "N",
    "textColorHex": "#000000",
    "division": "BMT",
    "trunkGroup": "BMT Broadway Yellow",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#FCCC0A",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:Q": {
    "routeId": "Q",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Second Ave / Broadway Express",
    "colorHex": "#FCCC0A",
    "type": "subway",
    "bulletCode": "Q",
    "textColorHex": "#000000",
    "division": "BMT",
    "trunkGroup": "BMT Broadway Yellow",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#FCCC0A",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:R": {
    "routeId": "R",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Broadway Local",
    "colorHex": "#FCCC0A",
    "type": "subway",
    "bulletCode": "R",
    "textColorHex": "#000000",
    "division": "BMT",
    "trunkGroup": "BMT Broadway Yellow",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#FCCC0A",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:W": {
    "routeId": "W",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Broadway Local",
    "colorHex": "#FCCC0A",
    "type": "subway",
    "bulletCode": "W",
    "textColorHex": "#000000",
    "division": "BMT",
    "trunkGroup": "BMT Broadway Yellow",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#FCCC0A",
    "ind1953ColorHex": "#D99B00"
  },
  "MTA_NYCT_SUBWAY:S": {
    "routeId": "S",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "42 St Shuttle",
    "colorHex": "#808183",
    "type": "subway",
    "bulletCode": "S",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "Shuttle / Neutral Slate",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#75787B",
    "ind1953ColorHex": "#6E737B"
  },
  "MTA_NYCT_SUBWAY:GS": {
    "routeId": "GS",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "42 St Shuttle",
    "colorHex": "#808183",
    "type": "subway",
    "bulletCode": "S",
    "textColorHex": "#FFFFFF",
    "division": "IRT",
    "trunkGroup": "Shuttle / Neutral Slate",
    "isDiamond": false,
    "aliases": [
      "S"
    ],
    "tauranacColorHex": "#75787B",
    "ind1953ColorHex": "#6E737B"
  },
  "MTA_NYCT_SUBWAY:FS": {
    "routeId": "FS",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Franklin Av Shuttle",
    "colorHex": "#808183",
    "type": "subway",
    "bulletCode": "S",
    "textColorHex": "#FFFFFF",
    "division": "BMT",
    "trunkGroup": "Shuttle / Neutral Slate",
    "isDiamond": false,
    "aliases": [
      "SF"
    ],
    "tauranacColorHex": "#75787B",
    "ind1953ColorHex": "#6E737B"
  },
  "MTA_NYCT_SUBWAY:H": {
    "routeId": "H",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Rockaway Park Shuttle",
    "colorHex": "#808183",
    "type": "subway",
    "bulletCode": "S",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "Shuttle / Neutral Slate",
    "isDiamond": false,
    "aliases": [
      "SR"
    ],
    "tauranacColorHex": "#75787B",
    "ind1953ColorHex": "#6E737B"
  },
  "MTA_NYCT_SUBWAY:T": {
    "routeId": "T",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Second Avenue Local",
    "colorHex": "#00ADD0",
    "type": "subway",
    "bulletCode": "T",
    "textColorHex": "#FFFFFF",
    "division": "IND",
    "trunkGroup": "IND 2nd Ave Turquoise",
    "isDiamond": false,
    "aliases": [],
    "tauranacColorHex": "#00AEEF",
    "ind1953ColorHex": "#00ADD0"
  },
  "MTA_NYCT_SUBWAY:SI": {
    "routeId": "SI",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Staten Island Railway",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "SIR",
    "textColorHex": "#FFFFFF",
    "division": "SIR",
    "trunkGroup": "Staten Island Railway",
    "isDiamond": false,
    "aliases": [
      "SIR",
      "SS"
    ],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_NYCT_SUBWAY:SIR": {
    "routeId": "SIR",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Staten Island Railway",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "SIR",
    "textColorHex": "#FFFFFF",
    "division": "SIR",
    "trunkGroup": "Staten Island Railway",
    "isDiamond": false,
    "aliases": [
      "SI",
      "SS"
    ],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_NYCT_SUBWAY:SS": {
    "routeId": "SS",
    "agencyId": "MTA_NYCT_SUBWAY",
    "routeName": "Staten Island Railway",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "SIR",
    "textColorHex": "#FFFFFF",
    "division": "SIR",
    "trunkGroup": "Staten Island Railway",
    "isDiamond": false,
    "aliases": [
      "SIR"
    ],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_NYCT_SIR:SI": {
    "routeId": "SI",
    "agencyId": "MTA_NYCT_SIR",
    "routeName": "Staten Island Railway",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "SIR",
    "textColorHex": "#FFFFFF",
    "division": "SIR",
    "trunkGroup": "Staten Island Railway",
    "isDiamond": false,
    "aliases": [
      "SI",
      "SIR",
      "SS"
    ],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_NYCT_SIR:SIR": {
    "routeId": "SIR",
    "agencyId": "MTA_NYCT_SIR",
    "routeName": "Staten Island Railway",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "SIR",
    "textColorHex": "#FFFFFF",
    "division": "SIR",
    "trunkGroup": "Staten Island Railway",
    "isDiamond": false,
    "aliases": [
      "SI",
      "SIR",
      "SS"
    ],
    "tauranacColorHex": "#006BB6",
    "ind1953ColorHex": "#0039A6"
  },
  "MTA_LIRR:1": {
    "routeId": "1",
    "agencyId": "MTA_LIRR",
    "routeName": "Babylon Branch",
    "colorHex": "#00985F",
    "type": "rail",
    "bulletCode": "BAB",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Babylon Branch",
    "isDiamond": false,
    "aliases": [
      "BAB",
      "BABYLON",
      "BABYLON BRANCH"
    ],
    "routeShortLabel": "Babylon"
  },
  "MTA_LIRR:2": {
    "routeId": "2",
    "agencyId": "MTA_LIRR",
    "routeName": "Hempstead Branch",
    "colorHex": "#CE8E00",
    "type": "rail",
    "bulletCode": "HEM",
    "textColorHex": "#000000",
    "division": "LIRR",
    "trunkGroup": "LIRR Hempstead Branch",
    "isDiamond": false,
    "aliases": [
      "HEM",
      "HEMPSTEAD",
      "HEMPSTEAD BRANCH"
    ],
    "routeShortLabel": "Hempstead"
  },
  "MTA_LIRR:3": {
    "routeId": "3",
    "agencyId": "MTA_LIRR",
    "routeName": "Oyster Bay Branch",
    "colorHex": "#00AF3F",
    "type": "rail",
    "bulletCode": "OB",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Oyster Bay Branch",
    "isDiamond": false,
    "aliases": [
      "OB",
      "OYSTER_BAY",
      "OYSTER BAY"
    ],
    "routeShortLabel": "Oyster Bay"
  },
  "MTA_LIRR:4": {
    "routeId": "4",
    "agencyId": "MTA_LIRR",
    "routeName": "Ronkonkoma Branch",
    "colorHex": "#A626AA",
    "type": "rail",
    "bulletCode": "RON",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Ronkonkoma Branch",
    "isDiamond": false,
    "aliases": [
      "RON",
      "RONKONKOMA",
      "RONKONKOMA BRANCH"
    ],
    "routeShortLabel": "Ronkonkoma"
  },
  "MTA_LIRR:5": {
    "routeId": "5",
    "agencyId": "MTA_LIRR",
    "routeName": "Montauk Branch",
    "colorHex": "#00B2A9",
    "type": "rail",
    "bulletCode": "MTK",
    "textColorHex": "#000000",
    "division": "LIRR",
    "trunkGroup": "LIRR Montauk Branch",
    "isDiamond": false,
    "aliases": [
      "MTK",
      "MONTAUK"
    ],
    "routeShortLabel": "Montauk"
  },
  "MTA_LIRR:6": {
    "routeId": "6",
    "agencyId": "MTA_LIRR",
    "routeName": "Long Beach Branch",
    "colorHex": "#FF6319",
    "type": "rail",
    "bulletCode": "LB",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Long Beach Branch",
    "isDiamond": false,
    "aliases": [
      "LB",
      "LONG_BEACH",
      "LONG BEACH"
    ],
    "routeShortLabel": "Long Beach"
  },
  "MTA_LIRR:7": {
    "routeId": "7",
    "agencyId": "MTA_LIRR",
    "routeName": "Far Rockaway Branch",
    "colorHex": "#6E3219",
    "type": "rail",
    "bulletCode": "FR",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Far Rockaway Branch",
    "isDiamond": false,
    "aliases": [
      "FR",
      "FAR_ROCKAWAY",
      "FAR ROCKAWAY"
    ],
    "routeShortLabel": "Far Rock"
  },
  "MTA_LIRR:8": {
    "routeId": "8",
    "agencyId": "MTA_LIRR",
    "routeName": "West Hempstead Branch",
    "colorHex": "#00A1DE",
    "type": "rail",
    "bulletCode": "WH",
    "textColorHex": "#000000",
    "division": "LIRR",
    "trunkGroup": "LIRR West Hempstead Branch",
    "isDiamond": false,
    "aliases": [
      "WH",
      "WEST_HEMPSTEAD",
      "WEST HEMPSTEAD"
    ],
    "routeShortLabel": "W Hempstead"
  },
  "MTA_LIRR:9": {
    "routeId": "9",
    "agencyId": "MTA_LIRR",
    "routeName": "Port Washington Branch",
    "colorHex": "#C60C30",
    "type": "rail",
    "bulletCode": "PW",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Port Washington Branch",
    "isDiamond": false,
    "aliases": [
      "PW",
      "PORT_WASHINGTON",
      "PORT WASHINGTON"
    ],
    "routeShortLabel": "Pt Wash"
  },
  "MTA_LIRR:10": {
    "routeId": "10",
    "agencyId": "MTA_LIRR",
    "routeName": "Port Jefferson Branch",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "PJF",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Port Jefferson Branch",
    "isDiamond": false,
    "aliases": [
      "PJF",
      "PORT_JEFFERSON",
      "PORT JEFFERSON",
      "HUNTINGTON"
    ],
    "routeShortLabel": "Pt Jeff"
  },
  "MTA_LIRR:11": {
    "routeId": "11",
    "agencyId": "MTA_LIRR",
    "routeName": "Belmont Park Branch",
    "colorHex": "#60269E",
    "type": "rail",
    "bulletCode": "BEL",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Belmont Park Branch",
    "isDiamond": false,
    "aliases": [
      "BEL",
      "BELMONT"
    ],
    "routeShortLabel": "Belmont"
  },
  "MTA_LIRR:12": {
    "routeId": "12",
    "agencyId": "MTA_LIRR",
    "routeName": "City Terminal Zone",
    "colorHex": "#4D5357",
    "type": "rail",
    "bulletCode": "CTZ",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR City Terminal Zone",
    "isDiamond": false,
    "aliases": [
      "CTZ",
      "CITY_TERMINAL",
      "CITY TERMINAL ZONE"
    ],
    "routeShortLabel": "City Zone"
  },
  "MTA_LIRR:13": {
    "routeId": "13",
    "agencyId": "MTA_LIRR",
    "routeName": "Greenport Branch",
    "colorHex": "#A626AA",
    "type": "rail",
    "bulletCode": "GPT",
    "textColorHex": "#FFFFFF",
    "division": "LIRR",
    "trunkGroup": "LIRR Greenport Branch",
    "isDiamond": false,
    "aliases": [
      "GPT",
      "GREENPORT"
    ],
    "routeShortLabel": "Greenport"
  },
  "MTA_METRO_NORTH:1": {
    "routeId": "1",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Hudson Line",
    "colorHex": "#009B3A",
    "type": "rail",
    "bulletCode": "HUD",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Hudson Line",
    "isDiamond": false,
    "aliases": [
      "HUD",
      "HUDSON",
      "HUDSON LINE"
    ],
    "routeShortLabel": "Hudson"
  },
  "MTA_METRO_NORTH:2": {
    "routeId": "2",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Harlem Line",
    "colorHex": "#0039A6",
    "type": "rail",
    "bulletCode": "HAR",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Harlem Line",
    "isDiamond": false,
    "aliases": [
      "HAR",
      "HARLEM",
      "HARLEM LINE"
    ],
    "routeShortLabel": "Harlem"
  },
  "MTA_METRO_NORTH:3": {
    "routeId": "3",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "New Haven Line",
    "colorHex": "#EE0034",
    "type": "rail",
    "bulletCode": "NH",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North New Haven Line",
    "isDiamond": false,
    "aliases": [
      "NH",
      "NEW_HAVEN",
      "NEW HAVEN",
      "NEW HAVEN LINE"
    ],
    "routeShortLabel": "New Haven"
  },
  "MTA_METRO_NORTH:4": {
    "routeId": "4",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "New Canaan Branch",
    "colorHex": "#EE0034",
    "type": "rail",
    "bulletCode": "NC",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North New Canaan Branch",
    "isDiamond": false,
    "aliases": [
      "NC",
      "NEW_CANAAN",
      "NEW CANAAN"
    ],
    "routeShortLabel": "New Canaan"
  },
  "MTA_METRO_NORTH:5": {
    "routeId": "5",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Danbury Branch",
    "colorHex": "#EE0034",
    "type": "rail",
    "bulletCode": "DAN",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Danbury Branch",
    "isDiamond": false,
    "aliases": [
      "DAN",
      "DANBURY"
    ],
    "routeShortLabel": "Danbury"
  },
  "MTA_METRO_NORTH:6": {
    "routeId": "6",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Waterbury Branch",
    "colorHex": "#EE0034",
    "type": "rail",
    "bulletCode": "WAT",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Waterbury Branch",
    "isDiamond": false,
    "aliases": [
      "WAT",
      "WATERBURY"
    ],
    "routeShortLabel": "Waterbury"
  },
  "MTA_METRO_NORTH:14": {
    "routeId": "14",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Pascack Valley Line",
    "colorHex": "#8E258D",
    "type": "rail",
    "bulletCode": "PV",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Pascack Valley Line",
    "isDiamond": false,
    "aliases": [
      "PV",
      "PASC",
      "PASCACK",
      "PASCACK_VALLEY",
      "PASCACK VALLEY",
      "PASCACK VALLEY LINE"
    ],
    "routeShortLabel": "Pascack"
  },
  "MTA_METRO_NORTH:15": {
    "routeId": "15",
    "agencyId": "MTA_METRO_NORTH",
    "routeName": "Port Jervis Line",
    "colorHex": "#FF7900",
    "type": "rail",
    "bulletCode": "PJ",
    "textColorHex": "#FFFFFF",
    "division": "MNR",
    "trunkGroup": "Metro-North Port Jervis Line",
    "isDiamond": false,
    "aliases": [
      "PJ",
      "MNBNP",
      "PORT_JERVIS",
      "PORT JERVIS",
      "PORT JERVIS LINE"
    ],
    "routeShortLabel": "Pt Jervis"
  },
  "PORT_AUTHORITY_PATH:NWK-WTC": {
    "routeId": "NWK-WTC",
    "agencyId": "PORT_AUTHORITY_PATH",
    "routeName": "Newark - World Trade Center",
    "colorHex": "#D93A30",
    "type": "rail",
    "bulletCode": "NWK",
    "textColorHex": "#FFFFFF",
    "division": "PATH",
    "trunkGroup": "PATH Newark - World Trade Center",
    "isDiamond": false,
    "aliases": [
      "NWK",
      "862"
    ],
    "routeShortLabel": "NWK-WTC"
  },
  "PORT_AUTHORITY_PATH:JSQ-33": {
    "routeId": "JSQ-33",
    "agencyId": "PORT_AUTHORITY_PATH",
    "routeName": "Journal Square - 33rd Street",
    "colorHex": "#F9A51A",
    "type": "rail",
    "bulletCode": "JSQ",
    "textColorHex": "#000000",
    "division": "PATH",
    "trunkGroup": "PATH Journal Square - 33rd Street",
    "isDiamond": false,
    "aliases": [
      "JSQ",
      "JSQ-33 (VIA HOB)",
      "861",
      "1024"
    ],
    "routeShortLabel": "JSQ-33"
  },
  "PORT_AUTHORITY_PATH:HOB-33": {
    "routeId": "HOB-33",
    "agencyId": "PORT_AUTHORITY_PATH",
    "routeName": "Hoboken - 33rd Street",
    "colorHex": "#4D92FB",
    "type": "rail",
    "bulletCode": "H33",
    "textColorHex": "#FFFFFF",
    "division": "PATH",
    "trunkGroup": "PATH Hoboken - 33rd Street",
    "isDiamond": false,
    "aliases": [
      "H33",
      "859"
    ],
    "routeShortLabel": "HOB-33"
  },
  "PORT_AUTHORITY_PATH:HOB-WTC": {
    "routeId": "HOB-WTC",
    "agencyId": "PORT_AUTHORITY_PATH",
    "routeName": "Hoboken - World Trade Center",
    "colorHex": "#65C100",
    "type": "rail",
    "bulletCode": "HWT",
    "textColorHex": "#000000",
    "division": "PATH",
    "trunkGroup": "PATH Hoboken - World Trade Center",
    "isDiamond": false,
    "aliases": [
      "HWT",
      "860"
    ],
    "routeShortLabel": "HOB-WTC"
  },
  "MTA_BUS:M60-SBS": {
    "routeId": "M60-SBS",
    "agencyId": "MTA_BUS",
    "routeName": "M60 Select Bus Service",
    "colorHex": "#0078C6",
    "type": "bus",
    "bulletCode": "M60",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "M60 Select Bus Service",
    "isDiamond": false,
    "aliases": []
  },
  "MTA_BUS:M60+": {
    "routeId": "M60+",
    "agencyId": "MTA_BUS",
    "routeName": "M60 Select Bus Service",
    "colorHex": "#0078C6",
    "type": "bus",
    "bulletCode": "M60",
    "textColorHex": "#FFFFFF",
    "division": "SBS",
    "trunkGroup": "Select Bus Service",
    "isDiamond": false,
    "aliases": [
      "M60",
      "M60-SBS",
      "MTA NYCT_M60+",
      "MTABC_M60+"
    ],
    "routeShortLabel": "M60-SBS"
  },
  "NJ_TRANSIT:NEC": {
    "routeId": "NEC",
    "agencyId": "NJ_TRANSIT",
    "routeName": "Northeast Corridor",
    "colorHex": "#DD3439",
    "type": "rail",
    "bulletCode": "NEC",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Northeast Corridor",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:ER": {
    "routeId": "ER",
    "agencyId": "NYC_FERRY",
    "routeName": "East River",
    "colorHex": "#00839B",
    "type": "ferry",
    "bulletCode": "ER",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "East River",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:AS": {
    "routeId": "AS",
    "agencyId": "NYC_FERRY",
    "routeName": "Astoria",
    "colorHex": "#FF6B00",
    "type": "ferry",
    "bulletCode": "AS",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Astoria",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:SB": {
    "routeId": "SB",
    "agencyId": "NYC_FERRY",
    "routeName": "South Brooklyn",
    "colorHex": "#F6A800",
    "type": "ferry",
    "bulletCode": "SB",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "South Brooklyn",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:RW": {
    "routeId": "RW",
    "agencyId": "NYC_FERRY",
    "routeName": "Rockaway",
    "colorHex": "#B71C8C",
    "type": "ferry",
    "bulletCode": "RW",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Rockaway",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:RWS": {
    "routeId": "RWS",
    "agencyId": "NYC_FERRY",
    "routeName": "Rockaway Shuttle",
    "colorHex": "#B71C8C",
    "type": "ferry",
    "bulletCode": "RWS",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Rockaway Shuttle",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:RES": {
    "routeId": "RES",
    "agencyId": "NYC_FERRY",
    "routeName": "Rockaway East Shuttle",
    "colorHex": "#B71C8C",
    "type": "ferry",
    "bulletCode": "RES",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Rockaway East Shuttle",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:RS": {
    "routeId": "RS",
    "agencyId": "NYC_FERRY",
    "routeName": "Rockaway / Soundview",
    "colorHex": "#B71C8C",
    "type": "ferry",
    "bulletCode": "RS",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Rockaway / Soundview",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:SV": {
    "routeId": "SV",
    "agencyId": "NYC_FERRY",
    "routeName": "Soundview",
    "colorHex": "#532E8E",
    "type": "ferry",
    "bulletCode": "SV",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Soundview",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:SG": {
    "routeId": "SG",
    "agencyId": "NYC_FERRY",
    "routeName": "St. George",
    "colorHex": "#78BE20",
    "type": "ferry",
    "bulletCode": "SG",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "St. George",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:GI": {
    "routeId": "GI",
    "agencyId": "NYC_FERRY",
    "routeName": "Governors Island",
    "colorHex": "#6CBE45",
    "type": "ferry",
    "bulletCode": "GI",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "Governors Island",
    "isDiamond": false,
    "aliases": []
  },
  "NYC_FERRY:NYC_FERRY": {
    "routeId": "NYC_FERRY",
    "agencyId": "NYC_FERRY",
    "routeName": "NYC Ferry",
    "colorHex": "#004B87",
    "type": "ferry",
    "bulletCode": "NYC_FERRY",
    "textColorHex": "#FFFFFF",
    "division": "",
    "trunkGroup": "NYC Ferry",
    "isDiamond": false,
    "aliases": []
  }
} as const;

export interface OssieField {
  readonly name: string;
  readonly datatype: string;
  readonly description: string;
  readonly expression?: string;
  readonly isDimension: boolean;
  readonly isTime: boolean;
}

export interface OssieDataset {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly isLens?: boolean;
  readonly lensLabel?: string;
  readonly defaultDimensions?: readonly string[];
  readonly defaultMetrics?: readonly string[];
  readonly defaultWindow?: string;
  readonly fields: readonly OssieField[];
}

export interface OssieRelationship {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly fromColumns: readonly string[];
  readonly toColumns: readonly string[];
  readonly type: string;
}

export interface OssieMetric {
  readonly name: string;
  readonly description: string;
  readonly datatype: string;
  readonly expression: string;
  readonly referencedDatasets: readonly string[];
}

export interface OssieTheme {
  readonly name: string;
  readonly description: string;
  readonly datasets: readonly OssieDataset[];
  readonly relationships: readonly OssieRelationship[];
  readonly metrics: readonly OssieMetric[];
}

export const OSSIE_THEMES: readonly OssieTheme[] = [
  {
    "name": "dbtc",
    "description": "Unified DBTC (NYC Transit Studio) semantic model combining rail operations, surface kinematics, schedule adherence, station demand, origin-destination ridership, micromobility, and service lines for all default studio cells.",
    "datasets": [
      {
        "name": "station_headways",
        "description": "Calculated headway intervals between consecutive trains at stations (drives Station Progression and Headway Horizon cells)",
        "source": "prod.transit_v2.view_station_headways",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date of the observed train event",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of train arrival or presence at station",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Transit agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Transit route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "GTFS trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Physical vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station platform identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Train direction (N, S, or ALL)",
            "expression": "direction_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status at station",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Observed headway gap in seconds from preceding train",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec_squared",
            "datatype": "DOUBLE",
            "description": "Squared headway for computing sample variance",
            "expression": "headway_sec_squared",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_to_station_legs",
        "description": "Point-to-point transit link segments between consecutive stations (drives Marey Diagram, Route Segment Speed Map, Adherence Waterfall, and Isochrone Reachability cells)",
        "source": "prod.transit_v2.view_station_to_station_legs",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "from_station_id",
            "datatype": "VARCHAR",
            "description": "Origin stop identifier",
            "expression": "from_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "to_station_id",
            "datatype": "VARCHAR",
            "description": "Destination stop identifier",
            "expression": "to_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "departure_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of departure from origin stop",
            "expression": "departure_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "arrival_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of arrival at destination stop",
            "expression": "arrival_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "leg_travel_time_sec",
            "datatype": "DOUBLE",
            "description": "Travel duration across leg in seconds",
            "expression": "leg_travel_time_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_distance_meters",
            "datatype": "DOUBLE",
            "description": "Great-circle distance across leg in meters",
            "expression": "leg_distance_meters",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_speed_mps",
            "datatype": "DOUBLE",
            "description": "Calculated leg velocity in meters per second",
            "expression": "leg_speed_mps",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "current_vehicle_positions",
        "description": "Latest bounded vehicle position observations (drives Live Train Position & Fleet Map cell)",
        "source": "prod.transit_v2.view_current_vehicle_positions",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Telemetry observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status (STOPPED_AT, IN_TRANSIT_TO, INCOMING_AT)",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "GPS latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "GPS longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bearing",
            "datatype": "DOUBLE",
            "description": "Compass bearing degrees",
            "expression": "bearing",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "speed",
            "datatype": "DOUBLE",
            "description": "Reported speed in m/s",
            "expression": "speed",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "occupancy_status",
            "datatype": "VARCHAR",
            "description": "Passenger occupancy status",
            "expression": "occupancy_status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station ID (N/S platform suffix stripped)",
            "expression": "rtrim(current_vehicle_positions.station_id, 'NS')",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Platform direction suffix (N or S)",
            "expression": "right(current_vehicle_positions.station_id, 1)",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour_et",
            "datatype": "INTEGER",
            "description": "Hour of day in America/New_York (0-23)",
            "expression": "EXTRACT(HOUR FROM current_vehicle_positions.event_time AT TIME ZONE 'America/New_York')",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "vehicle_kinematics",
        "description": "High-resolution telemetry dynamics, velocity, acceleration, and station dwells",
        "source": "prod.transit_v2.view_vehicle_kinematics",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Telemetry observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "GPS latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "GPS longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bearing",
            "datatype": "DOUBLE",
            "description": "Compass bearing degrees",
            "expression": "bearing",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mps",
            "datatype": "DOUBLE",
            "description": "Effective calculated speed in m/s",
            "expression": "effective_speed_mps",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mph",
            "datatype": "DOUBLE",
            "description": "Effective speed converted to miles per hour",
            "expression": "effective_speed_mph",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "accel_mps2",
            "datatype": "DOUBLE",
            "description": "Instantaneous acceleration in m/s^2",
            "expression": "accel_mps2",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "dwell_sec",
            "datatype": "DOUBLE",
            "description": "Dwell time at station in seconds",
            "expression": "dwell_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "signal_delay_sec",
            "datatype": "DOUBLE",
            "description": "Holding or signal delay duration in seconds",
            "expression": "signal_delay_sec",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "schedule_adherence",
        "description": "Hourly route-level scheduled vs observed trip counts, headways, and service completion (drives Schedule Adherence Waterfall cell)",
        "source": "prod.transit_v2.view_schedule_adherence",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Truncated hourly timestamp",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "hour_of_day",
            "datatype": "DOUBLE",
            "description": "Hour of day (0-23)",
            "expression": "hour_of_day",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "scheduled_trips_count",
            "datatype": "BIGINT",
            "description": "Count of scheduled trips in the hour",
            "expression": "scheduled_trips_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "observed_trips_count",
            "datatype": "BIGINT",
            "description": "Count of observed trips in the hour",
            "expression": "observed_trips_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "ghost_trips_count",
            "datatype": "BIGINT",
            "description": "Scheduled trips not observed in real-time feed",
            "expression": "ghost_trips_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "unscheduled_trips_count",
            "datatype": "BIGINT",
            "description": "Observed trips not matched to static schedule",
            "expression": "unscheduled_trips_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_completion_pct",
            "datatype": "DOUBLE",
            "description": "Percentage of scheduled trips completed",
            "expression": "service_completion_pct",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "avg_observed_headway_sec",
            "datatype": "DOUBLE",
            "description": "Average observed headway in seconds",
            "expression": "avg_observed_headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "median_observed_headway_sec",
            "datatype": "DOUBLE",
            "description": "Median observed headway in seconds",
            "expression": "median_observed_headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "active_alerts_count",
            "datatype": "BIGINT",
            "description": "Count of active alerts during the hour",
            "expression": "active_alerts_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_hourly_summary",
        "description": "Station-level hourly summary combining turnstile entries/exits, train stops, headways, and alerts (drives Multimodal Pulse cell)",
        "source": "prod.transit_v2.view_station_hourly_summary",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Truncated hourly timestamp",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "total_entries",
            "datatype": "BIGINT",
            "description": "Hourly turnstile entries",
            "expression": "total_entries",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "total_exits",
            "datatype": "BIGINT",
            "description": "Hourly turnstile exits",
            "expression": "total_exits",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "train_arrivals_count",
            "datatype": "BIGINT",
            "description": "Hourly train stops at station",
            "expression": "train_arrivals_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "avg_headway_sec",
            "datatype": "DOUBLE",
            "description": "Hourly average headway at station",
            "expression": "avg_headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_alerts_count",
            "datatype": "BIGINT",
            "description": "Hourly station alert count",
            "expression": "station_alerts_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "turnstile_flows",
        "description": "Hourly station turnstile entry and exit counts with fare payment breakdown",
        "source": "prod.transit_v2.view_turnstile_flows",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Truncated hourly timestamp",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "device_id",
            "datatype": "VARCHAR",
            "description": "Fare gate or turnstile unit identifier",
            "expression": "device_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "reading_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of turnstile audit reading",
            "expression": "reading_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "entry_count",
            "datatype": "BIGINT",
            "description": "Passenger entries",
            "expression": "entry_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "exit_count",
            "datatype": "BIGINT",
            "description": "Passenger exits",
            "expression": "exit_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "payment_method",
            "datatype": "VARCHAR",
            "description": "Payment method (OMNY, MetroCard)",
            "expression": "payment_method",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "fare_class_category",
            "datatype": "VARCHAR",
            "description": "Fare class category",
            "expression": "fare_class_category",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_ridership",
        "description": "Origin-destination station passenger ridership volume (drives OD Ridership Sankey Flow cell)",
        "source": "prod.transit_v2.fact_ridership",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "origin_station_id",
            "datatype": "VARCHAR",
            "description": "Origin station identifier",
            "expression": "origin_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "destination_station_id",
            "datatype": "VARCHAR",
            "description": "Destination station identifier",
            "expression": "destination_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "passenger_count",
            "datatype": "BIGINT",
            "description": "Observed or estimated passenger count",
            "expression": "passenger_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_micromobility_status",
        "description": "Real-time Citi Bike and micromobility dock, classic bike, and e-bike availability (drives Multimodal Pulse cell)",
        "source": "prod.transit_v2.fact_micromobility_status",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Status timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Micromobility operator identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Docking station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_bikes_available",
            "datatype": "INTEGER",
            "description": "Available bikes",
            "expression": "num_bikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_ebikes_available",
            "datatype": "INTEGER",
            "description": "Available e-bikes",
            "expression": "num_ebikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_docks_available",
            "datatype": "INTEGER",
            "description": "Available empty docks",
            "expression": "num_docks_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_installed",
            "datatype": "BOOLEAN",
            "description": "Station installed flag",
            "expression": "is_installed",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_renting",
            "datatype": "BOOLEAN",
            "description": "Station actively renting flag",
            "expression": "is_renting",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "alert_routes",
        "description": "Route-level service disruption alerts",
        "source": "prod.transit_v2.view_alert_routes",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "alert_id",
            "datatype": "VARCHAR",
            "description": "Alert identifier",
            "expression": "alert_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "cause",
            "datatype": "VARCHAR",
            "description": "Disruption cause",
            "expression": "cause",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effect",
            "datatype": "VARCHAR",
            "description": "Disruption effect",
            "expression": "effect",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "severity",
            "datatype": "VARCHAR",
            "description": "Alert severity",
            "expression": "severity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "alert_stations",
        "description": "Station-level service disruption alerts",
        "source": "prod.transit_v2.view_alert_stations",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "alert_id",
            "datatype": "VARCHAR",
            "description": "Alert identifier",
            "expression": "alert_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Parent station identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "cause",
            "datatype": "VARCHAR",
            "description": "Disruption cause",
            "expression": "cause",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effect",
            "datatype": "VARCHAR",
            "description": "Disruption effect",
            "expression": "effect",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "severity",
            "datatype": "VARCHAR",
            "description": "Alert severity",
            "expression": "severity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of current transit stations",
        "source": "prod.transit_v2.view_dim_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station unique identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating transit agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Human-readable station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Station latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Station longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Transfer complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "Routes serving this station during regular daytime service",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "structure",
            "datatype": "VARCHAR",
            "description": "Station structure type (Subway, Elevated, Open Cut, At Grade)",
            "expression": "structure",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "ADA accessibility status",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_count",
            "datatype": "INTEGER",
            "description": "Count of distinct routes serving this platform",
            "expression": "route_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_interlined_junction",
            "datatype": "BOOLEAN",
            "description": "Flag indicating whether multiple lines converge at this station",
            "expression": "is_interlined_junction",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "borough",
            "datatype": "VARCHAR",
            "description": "NYC borough or regional jurisdiction of the station",
            "expression": "borough",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_complexes",
        "description": "Aggregated multi-platform transfer hubs and station complexes",
        "source": "prod.transit_v2.view_station_complexes",
        "fields": [
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_name",
            "datatype": "VARCHAR",
            "description": "Complex name",
            "expression": "complex_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Complex centroid latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Complex centroid longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "All daytime routes serving the complex",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "Complex ADA accessibility status",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_count",
            "datatype": "BIGINT",
            "description": "Count of constituent stations in complex",
            "expression": "station_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_count",
            "datatype": "BIGINT",
            "description": "Count of distinct route groups in complex",
            "expression": "route_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of current transit lines and routes",
        "source": "prod.transit_v2.view_dim_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Hexadecimal route branding color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "type",
            "datatype": "VARCHAR",
            "description": "GTFS route type",
            "expression": "type",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bullet_code",
            "datatype": "VARCHAR",
            "description": "Short bullet badge code for route icons",
            "expression": "bullet_code",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "text_color_hex",
            "datatype": "VARCHAR",
            "description": "Contrasting foreground text hex color for route badges",
            "expression": "text_color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "division",
            "datatype": "VARCHAR",
            "description": "Operating division (IRT, BMT, IND, EOH, WOH, SBS, etc.)",
            "expression": "division",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trunk_group",
            "datatype": "VARCHAR",
            "description": "Trunk corridor or branch family name",
            "expression": "trunk_group",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_service_lines",
        "description": "Subway service line MultiLineString track geometry and trunk colors",
        "source": "prod.transit_v2.view_dim_service_lines",
        "fields": [
          {
            "name": "line_id",
            "datatype": "VARCHAR",
            "description": "Composite service line identifier",
            "expression": "line_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_name",
            "datatype": "VARCHAR",
            "description": "Service line name",
            "expression": "service_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "line_name",
            "datatype": "VARCHAR",
            "description": "Corridor or trunk line name",
            "expression": "line_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "division",
            "datatype": "VARCHAR",
            "description": "Subway division (IRT, BMT, IND)",
            "expression": "division",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Trunk hex color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_wkt",
            "datatype": "VARCHAR",
            "description": "WKT MultiLineString track geometry",
            "expression": "geom_wkt",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_geojson",
            "datatype": "VARCHAR",
            "description": "GeoJSON MultiLineString track geometry",
            "expression": "geom_geojson",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "shape_leng",
            "datatype": "DOUBLE",
            "description": "Track geometry shape length",
            "expression": "shape_leng",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_boroughs",
        "description": "NYC borough boundary polygons and metadata",
        "source": "prod.transit_v2.view_dim_boroughs",
        "fields": [
          {
            "name": "boro_code",
            "datatype": "INTEGER",
            "description": "Borough code (1=Manhattan, 2=Bronx, 3=Brooklyn, 4=Queens, 5=Staten Island)",
            "expression": "boro_code",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "boro_name",
            "datatype": "VARCHAR",
            "description": "Borough name",
            "expression": "boro_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_wkt",
            "datatype": "VARCHAR",
            "description": "WKT borough polygon geometry",
            "expression": "geom_wkt",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_geojson",
            "datatype": "VARCHAR",
            "description": "GeoJSON borough polygon geometry",
            "expression": "geom_geojson",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_map_geography",
        "description": "NYC boroughs, Tri-State regional landmass, and major park polygons for map overlays",
        "source": "prod.transit_v2.view_dim_map_geography",
        "fields": [
          {
            "name": "boro_code",
            "datatype": "INTEGER",
            "description": "Geography polygon code (1..5 NYC boroughs, 101..105 regional land, 201..203 parks)",
            "expression": "boro_code",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "boro_name",
            "datatype": "VARCHAR",
            "description": "Geography feature name",
            "expression": "boro_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "region_kind",
            "datatype": "VARCHAR",
            "description": "Geography classification (nyc_borough, regional_land, park)",
            "expression": "region_kind",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_wkt",
            "datatype": "VARCHAR",
            "description": "WKT MultiPolygon geometry",
            "expression": "geom_wkt",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_geojson",
            "datatype": "VARCHAR",
            "description": "GeoJSON MultiPolygon geometry",
            "expression": "geom_geojson",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_micromobility_stations",
        "description": "SCD-safe dimension view of Citi Bike and micromobility docking stations",
        "source": "prod.transit_v2.dim_micromobility_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Docking station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Micromobility operator",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Docking station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Dock latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Dock longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "capacity",
            "datatype": "INTEGER",
            "description": "Total dock capacity",
            "expression": "capacity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_vehicle_positions",
        "description": "Partitioned GTFS-RT vehicle position and stop-arrival pings across all transit agencies",
        "source": "prod.transit_v2.fact_vehicle_positions",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "GTFS trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Stop or platform identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status (STOPPED_AT, IN_TRANSIT_TO, INCOMING_AT)",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "GPS latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "GPS longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bearing",
            "datatype": "DOUBLE",
            "description": "Compass bearing degrees",
            "expression": "bearing",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "speed",
            "datatype": "DOUBLE",
            "description": "Reported speed in m/s",
            "expression": "speed",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "occupancy_status",
            "datatype": "VARCHAR",
            "description": "Passenger occupancy status",
            "expression": "occupancy_status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station ID (N/S platform suffix stripped)",
            "expression": "rtrim(fact_vehicle_positions.station_id, 'NS')",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Platform direction suffix (N or S)",
            "expression": "right(fact_vehicle_positions.station_id, 1)",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour_et",
            "datatype": "INTEGER",
            "description": "Hour of day in America/New_York (0-23)",
            "expression": "EXTRACT(HOUR FROM fact_vehicle_positions.event_time AT TIME ZONE 'America/New_York')",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_schedules",
        "description": "Partitioned published GTFS timetable stop times",
        "source": "prod.transit_v2.fact_schedules",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Schedule partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Stop identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Scheduled GTFS trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "scheduled_arrival_time",
            "datatype": "TIMESTAMP",
            "description": "Scheduled arrival timestamp",
            "expression": "scheduled_arrival_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "scheduled_departure_time",
            "datatype": "TIMESTAMP",
            "description": "Scheduled departure timestamp",
            "expression": "scheduled_departure_time",
            "isDimension": true,
            "isTime": true
          }
        ]
      },
      {
        "name": "dim_routes_1929",
        "description": "1929 Historical Network routes view (Pre-IND Dual System: IRT & BMT)",
        "source": "prod.transit_v2.view_dim_routes_1929",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "1929 IRT/BMT route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Route hex color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "division",
            "datatype": "VARCHAR",
            "description": "IRT or BMT division",
            "expression": "division",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_service_lines_1929",
        "description": "1929 Historical Network service line track geometry",
        "source": "prod.transit_v2.view_dim_service_lines_1929",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Service line name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Trunk color hex",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_geojson",
            "datatype": "VARCHAR",
            "description": "GeoJSON MultiLineString track geometry",
            "expression": "geom_geojson",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations_1929",
        "description": "1929 Historical Network stations view (IRT & BMT stations)",
        "source": "prod.transit_v2.view_dim_stations_1929",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Station latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Station longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Station complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "Daytime routes",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes_proposed",
        "description": "2035 Future Network routes view including full 2nd Ave Subway (T) and Interborough Express (IBX)",
        "source": "prod.transit_v2.view_dim_routes_proposed",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Route hex color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "division",
            "datatype": "VARCHAR",
            "description": "Division",
            "expression": "division",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_service_lines_proposed",
        "description": "2035 Future Network service line track geometry including full 2nd Ave Subway (T) and IBX",
        "source": "prod.transit_v2.view_dim_service_lines_proposed",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Service line name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Trunk color hex",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "geom_geojson",
            "datatype": "VARCHAR",
            "description": "GeoJSON MultiLineString track geometry",
            "expression": "geom_geojson",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations_proposed",
        "description": "2035 Future Network stations view including 2nd Ave Subway (T01..T08) and IBX (IBX01..IBX04)",
        "source": "prod.transit_v2.view_dim_stations_proposed",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Station latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Station longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Station complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "Daytime routes",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "subway_station_headways",
        "description": "Chart-ready subway station headway regularity (Station Progression & Headway Horizon)",
        "source": "local.main.dbtc_subway_headways",
        "isLens": true,
        "lensLabel": "Subway Headway Regularity",
        "defaultDimensions": [
          "subway_station_headways.event_date",
          "subway_station_headways.agency_id",
          "subway_station_headways.route_id",
          "subway_station_headways.station_id",
          "subway_station_headways.station_name",
          "subway_station_headways.borough"
        ],
        "defaultMetrics": [
          "lens_avg_headway_sec"
        ],
        "defaultWindow": "yesterday_am_rush",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Arrival timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Subway route",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Parent station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Human-readable station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "borough",
            "datatype": "VARCHAR",
            "description": "NYC borough (with spatial fallback)",
            "expression": "borough",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Direction (N or S)",
            "expression": "direction_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Observed headway interval in seconds",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "train_stringline_marey",
        "description": "Chart-ready per-trip train progression for Marey Stringline Diagrams",
        "source": "local.main.dbtc_subway_headways",
        "isLens": true,
        "lensLabel": "Train Stringline (Marey)",
        "defaultDimensions": [
          "train_stringline_marey.event_date",
          "train_stringline_marey.agency_id",
          "train_stringline_marey.route_id",
          "train_stringline_marey.trip_id",
          "train_stringline_marey.direction_id",
          "train_stringline_marey.station_id",
          "train_stringline_marey.station_name",
          "train_stringline_marey.borough",
          "train_stringline_marey.event_time",
          "train_stringline_marey.headway_sec"
        ],
        "defaultMetrics": [],
        "defaultWindow": "prev_weekday_am_rush",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Station arrival timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Subway route",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "GTFS trip ID",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Direction (N or S)",
            "expression": "direction_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Parent station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "borough",
            "datatype": "VARCHAR",
            "description": "NYC borough",
            "expression": "borough",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Headway interval in seconds",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "live_subway_fleet",
        "description": "Live + historical tail subway & SIR fleet positions with kinematics and service line colors",
        "source": "local.main.dbtc_live_subway_fleet",
        "isLens": true,
        "lensLabel": "Live Subway & SIR Fleet",
        "defaultDimensions": [
          "live_subway_fleet.event_date",
          "live_subway_fleet.event_time",
          "live_subway_fleet.agency_id",
          "live_subway_fleet.route_id",
          "live_subway_fleet.trip_id",
          "live_subway_fleet.vehicle_id",
          "live_subway_fleet.station_id"
        ],
        "defaultMetrics": [],
        "defaultWindow": "live_3h",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Ping timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip ID",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle ID",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "live_commuter_rail_fleet",
        "description": "Live + historical tail LIRR & Metro-North commuter rail positions",
        "source": "local.main.dbtc_live_commuter_rail_fleet",
        "isLens": true,
        "lensLabel": "Live Commuter Rail (LIRR & MNR)",
        "defaultDimensions": [
          "live_commuter_rail_fleet.event_date",
          "live_commuter_rail_fleet.event_time",
          "live_commuter_rail_fleet.agency_id",
          "live_commuter_rail_fleet.route_id",
          "live_commuter_rail_fleet.vehicle_id"
        ],
        "defaultMetrics": [],
        "defaultWindow": "live_3h",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Ping timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Branch/line ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Train ID",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "live_bus_fleet",
        "description": "Live + historical tail NYC Bus fleet positions",
        "source": "local.main.dbtc_live_bus_fleet",
        "isLens": true,
        "lensLabel": "Live NYC Bus Fleet",
        "defaultDimensions": [
          "live_bus_fleet.event_date",
          "live_bus_fleet.event_time",
          "live_bus_fleet.agency_id",
          "live_bus_fleet.route_id",
          "live_bus_fleet.vehicle_id"
        ],
        "defaultMetrics": [],
        "defaultWindow": "live_3h",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Ping timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Bus route ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Bus vehicle ID",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "route_segment_speeds",
        "description": "Chart-ready station-to-station segment speeds and service line colors",
        "source": "local.main.dbtc_route_segment_speeds",
        "isLens": true,
        "lensLabel": "Route Segment Speeds",
        "defaultDimensions": [
          "route_segment_speeds.agency_id",
          "route_segment_speeds.route_id",
          "route_segment_speeds.from_station_id",
          "route_segment_speeds.to_station_id"
        ],
        "defaultMetrics": [],
        "defaultWindow": "yesterday",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "from_station_id",
            "datatype": "VARCHAR",
            "description": "Origin station ID",
            "expression": "from_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "to_station_id",
            "datatype": "VARCHAR",
            "description": "Destination station ID",
            "expression": "to_station_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_isochrones",
        "description": "Chart-ready transit reachability isochrones from an origin station",
        "source": "local.main.dbtc_station_isochrones",
        "isLens": true,
        "lensLabel": "Station Isochrones",
        "defaultDimensions": [
          "station_isochrones.station_id",
          "station_isochrones.station_name"
        ],
        "defaultMetrics": [],
        "defaultWindow": "yesterday",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "schedule_adherence_hourly",
        "description": "Chart-ready scheduled vs observed trip completion and ghost trains",
        "source": "local.main.dbtc_schedule_adherence_hourly",
        "isLens": true,
        "lensLabel": "Schedule Adherence (Ghost Trains)",
        "defaultDimensions": [
          "schedule_adherence_hourly.event_date",
          "schedule_adherence_hourly.agency_id",
          "schedule_adherence_hourly.route_id",
          "schedule_adherence_hourly.route_name"
        ],
        "defaultMetrics": [
          "lens_scheduled_trips",
          "lens_observed_trips"
        ],
        "defaultWindow": "yesterday",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Route display name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_turnstile_ranking",
        "description": "Chart-ready station ranking by turnstile entries with disambiguated names",
        "source": "local.main.dbtc_turnstile_station_totals",
        "isLens": true,
        "lensLabel": "Top Turnstile Stations",
        "defaultDimensions": [
          "station_turnstile_ranking.station_name"
        ],
        "defaultMetrics": [
          "lens_turnstile_entries"
        ],
        "defaultWindow": "latest_turnstiles",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Complex station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Disambiguated station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "entry_count",
            "datatype": "BIGINT",
            "description": "Turnstile entry count",
            "expression": "entry_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "hourly_turnstile_profile",
        "description": "Chart-ready systemwide hourly turnstile entry profile",
        "source": "local.main.dbtc_turnstile_hourly",
        "isLens": true,
        "lensLabel": "Hourly Ridership Profile",
        "defaultDimensions": [
          "hourly_turnstile_profile.service_hour"
        ],
        "defaultMetrics": [
          "lens_avg_hourly_entries"
        ],
        "defaultWindow": "latest_turnstiles",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour",
            "datatype": "VARCHAR",
            "description": "Formatted hour label (00:00..23:00)",
            "expression": "service_hour",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "entry_count",
            "datatype": "BIGINT",
            "description": "Turnstile entry count",
            "expression": "entry_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fleet_route_share",
        "description": "Chart-ready observed trip share across top subway routes with Other Routes bucket",
        "source": "local.main.dbtc_fleet_route_share",
        "isLens": true,
        "lensLabel": "Fleet Trip Share by Route",
        "defaultDimensions": [
          "fleet_route_share.route_label"
        ],
        "defaultMetrics": [
          "lens_observed_trips_share"
        ],
        "defaultWindow": "yesterday",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_label",
            "datatype": "VARCHAR",
            "description": "Route label (e.g. 6 Train or Other Routes)",
            "expression": "route_label",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip ID",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "subway_headway_horizon",
        "description": "Chart-ready station-level headway time series for horizon plots",
        "source": "local.main.dbtc_headway_horizon",
        "isLens": true,
        "lensLabel": "Subway Headway Horizon",
        "defaultDimensions": [
          "subway_headway_horizon.event_time",
          "subway_headway_horizon.route_id",
          "subway_headway_horizon.station_name"
        ],
        "defaultMetrics": [],
        "defaultWindow": "prev_weekday_am_rush",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route ID",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip ID",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "INTEGER",
            "description": "GTFS direction ID",
            "expression": "direction_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Parent station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Arrival timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Headway in seconds",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "display_value",
            "datatype": "VARCHAR",
            "description": "Formatted headway in minutes",
            "expression": "display_value",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "multimodal_station_pulse",
        "description": "Chart-ready 24-hour subway turnstile entries paired with nearby bikeshare dock telemetry",
        "source": "local.main.dbtc_multimodal_pulse",
        "isLens": true,
        "lensLabel": "Multimodal Station Pulse",
        "defaultDimensions": [
          "multimodal_station_pulse.hour_of_day"
        ],
        "defaultMetrics": [
          "lens_multimodal_entries"
        ],
        "defaultWindow": "yesterday",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Complex or station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_name",
            "datatype": "VARCHAR",
            "description": "Complex or station name",
            "expression": "station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "hour_of_day",
            "datatype": "INTEGER",
            "description": "Hour of day (0..23 ET)",
            "expression": "hour_of_day",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour",
            "datatype": "INTEGER",
            "description": "Hour of day",
            "expression": "service_hour",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "entry_count",
            "datatype": "BIGINT",
            "description": "Hourly subway entries",
            "expression": "entry_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "subway_entries",
            "datatype": "BIGINT",
            "description": "Hourly subway entries alias",
            "expression": "subway_entries",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_bikes_available",
            "datatype": "DOUBLE",
            "description": "Available bikeshare bikes",
            "expression": "num_bikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_ebikes_available",
            "datatype": "DOUBLE",
            "description": "Available bikeshare e-bikes",
            "expression": "num_ebikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_docks_available",
            "datatype": "DOUBLE",
            "description": "Available bikeshare docks",
            "expression": "num_docks_available",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "od_ridership_flows",
        "description": "Chart-ready origin-destination ridership flows unified across major transit complexes",
        "source": "local.main.dbtc_od_ridership_flow",
        "isLens": true,
        "lensLabel": "Origin-Destination Ridership Flows",
        "defaultDimensions": [
          "od_ridership_flows.origin_station_name",
          "od_ridership_flows.destination_station_name"
        ],
        "defaultMetrics": [
          "lens_od_passengers"
        ],
        "defaultWindow": "latest_turnstile_partition",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "origin_station_id",
            "datatype": "VARCHAR",
            "description": "Unified origin station ID",
            "expression": "origin_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "origin_station_name",
            "datatype": "VARCHAR",
            "description": "Origin station name",
            "expression": "origin_station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "origin_borough",
            "datatype": "VARCHAR",
            "description": "Origin borough",
            "expression": "origin_borough",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "destination_station_id",
            "datatype": "VARCHAR",
            "description": "Unified destination station ID",
            "expression": "destination_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "destination_station_name",
            "datatype": "VARCHAR",
            "description": "Destination station name",
            "expression": "destination_station_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "destination_borough",
            "datatype": "VARCHAR",
            "description": "Destination borough",
            "expression": "destination_borough",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "passenger_count",
            "datatype": "BIGINT",
            "description": "Estimated daily OD passengers",
            "expression": "passenger_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "headways_to_dim_stations",
        "from": "station_headways",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "headways_to_dim_routes",
        "from": "station_headways",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "headways_to_service_lines",
        "from": "station_headways",
        "to": "dim_service_lines",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_from_station",
        "from": "station_to_station_legs",
        "to": "dim_stations",
        "fromColumns": [
          "from_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_dim_routes",
        "from": "station_to_station_legs",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_service_lines",
        "from": "station_to_station_legs",
        "to": "dim_service_lines",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "positions_to_dim_stations",
        "from": "current_vehicle_positions",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "positions_to_dim_routes",
        "from": "current_vehicle_positions",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "positions_to_service_lines",
        "from": "current_vehicle_positions",
        "to": "dim_service_lines",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "fact_positions_to_dim_stations",
        "from": "fact_vehicle_positions",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "fact_positions_to_dim_routes",
        "from": "fact_vehicle_positions",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "fact_positions_to_service_lines",
        "from": "fact_vehicle_positions",
        "to": "dim_service_lines",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "fact_schedules_to_dim_routes",
        "from": "fact_schedules",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "fact_schedules_to_dim_stations",
        "from": "fact_schedules",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "kinematics_to_dim_routes",
        "from": "vehicle_kinematics",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "kinematics_to_dim_stations",
        "from": "vehicle_kinematics",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "adherence_to_dim_routes",
        "from": "schedule_adherence",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "station_hourly_to_dim_stations",
        "from": "station_hourly_summary",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "turnstiles_to_dim_stations",
        "from": "turnstile_flows",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "turnstiles_to_complexes",
        "from": "turnstile_flows",
        "to": "station_complexes",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "ridership_to_origin_station",
        "from": "fact_ridership",
        "to": "dim_stations",
        "fromColumns": [
          "origin_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "ridership_to_complexes",
        "from": "fact_ridership",
        "to": "station_complexes",
        "fromColumns": [
          "origin_station_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "micromobility_to_dim_docks",
        "from": "fact_micromobility_status",
        "to": "dim_micromobility_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "station_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "alert_routes_to_dim_routes",
        "from": "alert_routes",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "alert_stations_to_dim_stations",
        "from": "alert_stations",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "avg_headway_sec",
        "description": "Average observed headway in seconds (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "AVG(station_headways.headway_sec) FILTER (WHERE station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "median_headway_sec",
        "description": "Median observed headway in seconds (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "MEDIAN(station_headways.headway_sec) FILTER (WHERE station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "p90_headway_sec",
        "description": "90th percentile observed headway in seconds",
        "datatype": "DOUBLE",
        "expression": "QUANTILE_CONT(station_headways.headway_sec, 0.90) FILTER (WHERE station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "headway_variance",
        "description": "Population variance of observed headways in seconds squared",
        "datatype": "DOUBLE",
        "expression": "VAR_POP(station_headways.headway_sec) FILTER (WHERE station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "total_train_runs",
        "description": "Total distinct train trips observed",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT station_headways.trip_id)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "train_stops_count",
        "description": "Total observed train station stop events",
        "datatype": "BIGINT",
        "expression": "COUNT(station_headways.trip_id)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "bunching_events_count",
        "description": "Count of bunched train arrivals (< 120 seconds)",
        "datatype": "BIGINT",
        "expression": "COUNT(*) FILTER (WHERE station_headways.headway_sec BETWEEN 30 AND 120)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "gapping_events_count",
        "description": "Count of gapped train arrivals (> 600 seconds)",
        "datatype": "BIGINT",
        "expression": "COUNT(*) FILTER (WHERE station_headways.headway_sec > 600 AND station_headways.headway_sec <= 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "avg_travel_time_sec",
        "description": "Average station-to-station leg travel duration in seconds",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_travel_time_sec) FILTER (WHERE station_to_station_legs.leg_travel_time_sec BETWEEN 20 AND 900)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "median_travel_time_sec",
        "description": "Median station-to-station leg travel duration in seconds",
        "datatype": "DOUBLE",
        "expression": "MEDIAN(station_to_station_legs.leg_travel_time_sec) FILTER (WHERE station_to_station_legs.leg_travel_time_sec BETWEEN 20 AND 900)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "calibrated_leg_travel_time_sec",
        "description": "Calibrated inter-station travel duration in seconds including 30s station dwell and track-distance floor",
        "datatype": "DOUBLE",
        "expression": "GREATEST(MEDIAN(station_to_station_legs.leg_travel_time_sec) FILTER (WHERE station_to_station_legs.leg_travel_time_sec BETWEEN 45 AND 600), (AVG(station_to_station_legs.leg_distance_meters) * 1.22) / 11.5, 65.0) + 30.0",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "effective_speed_mph",
        "description": "Average effective segment speed in miles per hour across station-to-station legs",
        "datatype": "DOUBLE",
        "expression": "ROUND(AVG(station_to_station_legs.leg_speed_mps * 2.23694) FILTER (WHERE station_to_station_legs.leg_speed_mps BETWEEN 1.5 AND 30.0), 1)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "sample_size",
        "description": "Observed station-to-station leg sample count",
        "datatype": "BIGINT",
        "expression": "COUNT(station_to_station_legs.trip_id)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "avg_leg_distance_meters",
        "description": "Average great-circle distance between consecutive station stops in meters",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_distance_meters) FILTER (WHERE station_to_station_legs.leg_distance_meters > 0)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "avg_leg_speed_mps",
        "description": "Average transit link speed in m/s",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_speed_mps) FILTER (WHERE station_to_station_legs.leg_speed_mps > 0)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "active_trains_count",
        "description": "Count of distinct active vehicles reporting positions",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT current_vehicle_positions.vehicle_id)",
        "referencedDatasets": [
          "current_vehicle_positions"
        ]
      },
      {
        "name": "current_avg_speed_mph",
        "description": "Average reported speed in mph across current vehicle positions",
        "datatype": "DOUBLE",
        "expression": "ROUND(AVG(current_vehicle_positions.speed * 2.23694) FILTER (WHERE current_vehicle_positions.speed > 0), 1)",
        "referencedDatasets": [
          "current_vehicle_positions"
        ]
      },
      {
        "name": "avg_speed_mph",
        "description": "Average vehicle speed in mph (active moving observations)",
        "datatype": "DOUBLE",
        "expression": "AVG(vehicle_kinematics.effective_speed_mph) FILTER (WHERE vehicle_kinematics.effective_speed_mph > 0)",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "total_dwell_sec",
        "description": "Total accumulated station dwell time in seconds",
        "datatype": "DOUBLE",
        "expression": "SUM(vehicle_kinematics.dwell_sec)",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "scheduled_trips",
        "description": "Total scheduled trips across selected hours",
        "datatype": "BIGINT",
        "expression": "SUM(schedule_adherence.scheduled_trips_count)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "observed_trips",
        "description": "Total observed trips across selected hours",
        "datatype": "BIGINT",
        "expression": "SUM(schedule_adherence.observed_trips_count)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "ghost_trips",
        "description": "Total ghost trips (scheduled minus observed)",
        "datatype": "BIGINT",
        "expression": "SUM(schedule_adherence.ghost_trips_count)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "service_completion_pct",
        "description": "Average percentage of scheduled trips completed",
        "datatype": "DOUBLE",
        "expression": "AVG(schedule_adherence.service_completion_pct)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "hourly_entries",
        "description": "Total station turnstile entries from hourly summary",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.total_entries)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "hourly_exits",
        "description": "Total station turnstile exits from hourly summary",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.total_exits)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "hourly_train_arrivals",
        "description": "Total train arrivals from station hourly summary",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.train_arrivals_count)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "total_entries",
        "description": "Total turnstile passenger entries",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.entry_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "total_exits",
        "description": "Total turnstile passenger exits",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.exit_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "total_ridership_volume",
        "description": "Total origin-destination passenger count",
        "datatype": "BIGINT",
        "expression": "SUM(fact_ridership.passenger_count)",
        "referencedDatasets": [
          "fact_ridership"
        ]
      },
      {
        "name": "avg_ebikes_available",
        "description": "Average available e-bikes across reporting docks",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_ebikes_available)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      },
      {
        "name": "avg_bikes_available",
        "description": "Average available bikes across reporting docks",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_bikes_available)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      },
      {
        "name": "avg_docks_available",
        "description": "Average available empty docks across reporting stations",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_docks_available)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      },
      {
        "name": "distinct_route_alerts",
        "description": "Count of distinct active route alerts",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT alert_routes.alert_id)",
        "referencedDatasets": [
          "alert_routes"
        ]
      },
      {
        "name": "distinct_station_alerts",
        "description": "Count of distinct active station alerts",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT alert_stations.alert_id)",
        "referencedDatasets": [
          "alert_stations"
        ]
      },
      {
        "name": "lens_avg_headway_sec",
        "description": "Average subway headway in seconds (60..900s operational band)",
        "datatype": "DOUBLE",
        "expression": "ROUND(AVG(subway_station_headways.headway_sec) FILTER (WHERE subway_station_headways.headway_sec BETWEEN 60 AND 900), 1)",
        "referencedDatasets": [
          "station_headways",
          "subway_station_headways"
        ]
      },
      {
        "name": "lens_turnstile_entries",
        "description": "Total turnstile entries for station ranking lens",
        "datatype": "BIGINT",
        "expression": "CAST(SUM(station_turnstile_ranking.entry_count) AS BIGINT)",
        "referencedDatasets": [
          "station_turnstile_ranking"
        ]
      },
      {
        "name": "lens_avg_hourly_entries",
        "description": "Average hourly turnstile entries across metered days",
        "datatype": "BIGINT",
        "expression": "CAST(ROUND(SUM(hourly_turnstile_profile.entry_count) / GREATEST(1, COUNT(DISTINCT hourly_turnstile_profile.event_date))) AS BIGINT)",
        "referencedDatasets": [
          "hourly_turnstile_profile"
        ]
      },
      {
        "name": "lens_observed_trips_share",
        "description": "Distinct observed trips for fleet share donut lens",
        "datatype": "BIGINT",
        "expression": "CAST(COUNT(DISTINCT fleet_route_share.trip_id) AS BIGINT)",
        "referencedDatasets": [
          "fleet_route_share"
        ]
      },
      {
        "name": "lens_scheduled_trips",
        "description": "Scheduled trips in adherence lens",
        "datatype": "BIGINT",
        "expression": "CAST(SUM(schedule_adherence_hourly.scheduled_trips_count) AS BIGINT)",
        "referencedDatasets": [
          "schedule_adherence_hourly"
        ]
      },
      {
        "name": "lens_observed_trips",
        "description": "Observed trips in adherence lens",
        "datatype": "BIGINT",
        "expression": "CAST(SUM(schedule_adherence_hourly.observed_trips_count) AS BIGINT)",
        "referencedDatasets": [
          "schedule_adherence_hourly"
        ]
      },
      {
        "name": "lens_multimodal_entries",
        "description": "Hourly subway entries in multimodal station pulse lens",
        "datatype": "BIGINT",
        "expression": "CAST(SUM(multimodal_station_pulse.entry_count) AS BIGINT)",
        "referencedDatasets": [
          "multimodal_station_pulse"
        ]
      },
      {
        "name": "lens_od_passengers",
        "description": "Passenger count in OD ridership flows lens",
        "datatype": "BIGINT",
        "expression": "CAST(SUM(od_ridership_flows.passenger_count) AS BIGINT)",
        "referencedDatasets": [
          "od_ridership_flows"
        ]
      }
    ]
  },
  {
    "name": "network_accessibility_and_demand",
    "description": "Network Accessibility and Demand semantic model covering fare gate entries/exits, payment methods, complex interchanges, and passenger ridership.",
    "datasets": [
      {
        "name": "turnstile_flows",
        "description": "Fare gate transactions categorized by payment method and fare class",
        "source": "prod.transit_v2.view_turnstile_flows",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "device_id",
            "datatype": "VARCHAR",
            "description": "Turnstile device identifier",
            "expression": "device_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "reading_time",
            "datatype": "TIMESTAMP",
            "description": "Hardware reading timestamp",
            "expression": "reading_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Truncated service hour in America/New_York",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "entry_count",
            "datatype": "BIGINT",
            "description": "Incremental turnstile entries",
            "expression": "entry_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "exit_count",
            "datatype": "BIGINT",
            "description": "Incremental turnstile exits",
            "expression": "exit_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "payment_method",
            "datatype": "VARCHAR",
            "description": "Payment method (e.g. OMNY Contactless, MetroCard)",
            "expression": "payment_method",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "fare_class_category",
            "datatype": "VARCHAR",
            "description": "Fare class (Full Fare, Senior/Disabled, Student, Fair Fares)",
            "expression": "fare_class_category",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_ridership",
        "description": "Passenger origin-destination ridership counts",
        "source": "prod.transit_v2.fact_ridership",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "origin_station_id",
            "datatype": "VARCHAR",
            "description": "Origin station ID",
            "expression": "origin_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "destination_station_id",
            "datatype": "VARCHAR",
            "description": "Destination station ID",
            "expression": "destination_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "passenger_count",
            "datatype": "BIGINT",
            "description": "Aggregated passenger volume",
            "expression": "passenger_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_complexes",
        "description": "Aggregated station complexes unifying multiple platform structures",
        "source": "prod.transit_v2.view_station_complexes",
        "fields": [
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Unique complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_name",
            "datatype": "VARCHAR",
            "description": "Representative complex name",
            "expression": "complex_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Centroid latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Centroid longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "Aggregated routes serving this complex",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "Whether any platform in complex is ADA accessible",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_count",
            "datatype": "BIGINT",
            "description": "Count of platforms in complex",
            "expression": "station_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_count",
            "datatype": "BIGINT",
            "description": "Count of distinct routes connected",
            "expression": "route_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_to_station_legs",
        "description": "Link segments connecting consecutive stations",
        "source": "prod.transit_v2.view_station_to_station_legs",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "from_station_id",
            "datatype": "VARCHAR",
            "description": "Origin station",
            "expression": "from_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "to_station_id",
            "datatype": "VARCHAR",
            "description": "Destination station",
            "expression": "to_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_travel_time_sec",
            "datatype": "DOUBLE",
            "description": "Leg travel time in seconds",
            "expression": "leg_travel_time_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_distance_meters",
            "datatype": "DOUBLE",
            "description": "Great-circle distance across leg in meters",
            "expression": "leg_distance_meters",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of current transit stations",
        "source": "prod.transit_v2.view_dim_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station ID",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency ID",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Associated complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "ADA accessibility flag",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of current transit lines and routes",
        "source": "prod.transit_v2.view_dim_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Hexadecimal route branding color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "type",
            "datatype": "VARCHAR",
            "description": "GTFS route type",
            "expression": "type",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "turnstiles_to_station_complexes",
        "from": "turnstile_flows",
        "to": "station_complexes",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "stations_to_complex",
        "from": "dim_stations",
        "to": "station_complexes",
        "fromColumns": [
          "complex_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "ridership_to_origin_complex",
        "from": "fact_ridership",
        "to": "station_complexes",
        "fromColumns": [
          "origin_station_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_origin_station",
        "from": "station_to_station_legs",
        "to": "dim_stations",
        "fromColumns": [
          "from_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_dim_routes",
        "from": "station_to_station_legs",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "network_turnstile_entries",
        "description": "Network-wide total turnstile entries",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.entry_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "total_entries",
        "description": "Total turnstile passenger entries",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.entry_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "total_exits",
        "description": "Total turnstile passenger exits",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.exit_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "net_flow",
        "description": "Net passenger inflow (entries minus exits)",
        "datatype": "BIGINT",
        "expression": "SUM(turnstile_flows.entry_count) - SUM(turnstile_flows.exit_count)",
        "referencedDatasets": [
          "turnstile_flows"
        ]
      },
      {
        "name": "total_passengers",
        "description": "Total passenger volume across OD pairs",
        "datatype": "BIGINT",
        "expression": "SUM(fact_ridership.passenger_count)",
        "referencedDatasets": [
          "fact_ridership"
        ]
      },
      {
        "name": "avg_leg_distance_meters",
        "description": "Average great-circle distance between consecutive station stops in meters",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_distance_meters) FILTER (WHERE station_to_station_legs.leg_distance_meters > 0)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      }
    ]
  },
  {
    "name": "rail_operations",
    "description": "Rail Operations semantic model covering station headways, station-to-station legs, and vehicle kinematics for heavy rail and subway systems.",
    "datasets": [
      {
        "name": "station_headways",
        "description": "Calculated headway intervals between consecutive trains at stations",
        "source": "prod.transit_v2.view_station_headways",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date of the observed train event",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of train arrival or presence at station",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Transit agency identifier (e.g. mta_subway, path, njt)",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Transit route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "GTFS trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Physical vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station platform identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "direction_id",
            "datatype": "VARCHAR",
            "description": "Train direction (N, S, or ALL)",
            "expression": "direction_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status at station (e.g. STOPPED_AT, INCOMING_AT)",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Observed headway gap in seconds from preceding train",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec_squared",
            "datatype": "DOUBLE",
            "description": "Squared headway for computing sample variance",
            "expression": "headway_sec_squared",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_to_station_legs",
        "description": "Point-to-point transit link segments between consecutive stations",
        "source": "prod.transit_v2.view_station_to_station_legs",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "from_station_id",
            "datatype": "VARCHAR",
            "description": "Origin stop identifier",
            "expression": "from_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "to_station_id",
            "datatype": "VARCHAR",
            "description": "Destination stop identifier",
            "expression": "to_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "departure_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of departure from origin stop",
            "expression": "departure_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "arrival_time",
            "datatype": "TIMESTAMP",
            "description": "Timestamp of arrival at destination stop",
            "expression": "arrival_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "leg_travel_time_sec",
            "datatype": "DOUBLE",
            "description": "Travel duration across leg in seconds",
            "expression": "leg_travel_time_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_distance_meters",
            "datatype": "DOUBLE",
            "description": "Great-circle distance across leg in meters",
            "expression": "leg_distance_meters",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "leg_speed_mps",
            "datatype": "DOUBLE",
            "description": "Calculated leg velocity in meters per second",
            "expression": "leg_speed_mps",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "vehicle_kinematics",
        "description": "High-resolution telemetry dynamics, velocity, and dwells",
        "source": "prod.transit_v2.view_vehicle_kinematics",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Telemetry observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Vehicle identifier",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle status",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "GPS latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "GPS longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bearing",
            "datatype": "DOUBLE",
            "description": "Compass bearing degrees",
            "expression": "bearing",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "occupancy_status",
            "datatype": "VARCHAR",
            "description": "Passenger load category",
            "expression": "occupancy_status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "delta_time_sec",
            "datatype": "DOUBLE",
            "description": "Time delta from previous ping",
            "expression": "delta_time_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "step_distance_meters",
            "datatype": "DOUBLE",
            "description": "Distance travelled from previous ping",
            "expression": "step_distance_meters",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mps",
            "datatype": "DOUBLE",
            "description": "Effective calculated speed in m/s",
            "expression": "effective_speed_mps",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mph",
            "datatype": "DOUBLE",
            "description": "Effective speed converted to miles per hour",
            "expression": "effective_speed_mph",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "accel_mps2",
            "datatype": "DOUBLE",
            "description": "Instantaneous acceleration in m/s^2",
            "expression": "accel_mps2",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "dwell_sec",
            "datatype": "DOUBLE",
            "description": "Dwell time at station in seconds",
            "expression": "dwell_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "signal_delay_sec",
            "datatype": "DOUBLE",
            "description": "Holding or signal delay duration in seconds",
            "expression": "signal_delay_sec",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of current transit stations",
        "source": "prod.transit_v2.view_dim_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station unique identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating transit agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Human-readable station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Station latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Station longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Transfer complex identifier grouping physical platforms",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "daytime_routes",
            "datatype": "VARCHAR",
            "description": "Routes serving this station during regular daytime service",
            "expression": "daytime_routes",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "structure",
            "datatype": "VARCHAR",
            "description": "Station structure type (Subway, Elevated, Open Cut, At Grade)",
            "expression": "structure",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "ADA accessibility status",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_count",
            "datatype": "INTEGER",
            "description": "Count of distinct routes serving this platform",
            "expression": "route_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_interlined_junction",
            "datatype": "BOOLEAN",
            "description": "Flag indicating whether multiple lines converge at this station",
            "expression": "is_interlined_junction",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of current transit lines and routes",
        "source": "prod.transit_v2.view_dim_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Hexadecimal route branding color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "type",
            "datatype": "VARCHAR",
            "description": "GTFS route type",
            "expression": "type",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "headways_to_dim_stations",
        "from": "station_headways",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "headways_to_dim_routes",
        "from": "station_headways",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "legs_to_from_station",
        "from": "station_to_station_legs",
        "to": "dim_stations",
        "fromColumns": [
          "from_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "kinematics_to_dim_routes",
        "from": "vehicle_kinematics",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "total_train_runs",
        "description": "Total distinct train trips observed",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT station_headways.trip_id) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "network_avg_headway_sec",
        "description": "System-wide average rail headway (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "AVG(station_headways.headway_sec) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "avg_headway_sec",
        "description": "Average observed headway in seconds (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "AVG(station_headways.headway_sec) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "median_headway_sec",
        "description": "Median observed headway in seconds (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "MEDIAN(station_headways.headway_sec) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "headway_variance",
        "description": "Headway variance metric (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "VAR_POP(station_headways.headway_sec) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "train_stops_count",
        "description": "Total observed train station stop events",
        "datatype": "BIGINT",
        "expression": "COUNT(station_headways.trip_id) FILTER (WHERE station_headways.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "station_headways"
        ]
      },
      {
        "name": "avg_travel_time_sec",
        "description": "Average leg travel duration in seconds",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_travel_time_sec) FILTER (WHERE station_to_station_legs.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "avg_leg_distance_meters",
        "description": "Average great-circle distance between consecutive station stops in meters",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_distance_meters) FILTER (WHERE station_to_station_legs.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_to_station_legs.leg_distance_meters > 0)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "avg_leg_speed_mps",
        "description": "Average transit link speed in m/s",
        "datatype": "DOUBLE",
        "expression": "AVG(station_to_station_legs.leg_speed_mps) FILTER (WHERE station_to_station_legs.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_to_station_legs.leg_speed_mps > 0)",
        "referencedDatasets": [
          "station_to_station_legs"
        ]
      },
      {
        "name": "avg_speed_mph",
        "description": "Average speed in mph (active moving observations)",
        "datatype": "DOUBLE",
        "expression": "AVG(vehicle_kinematics.effective_speed_mph) FILTER (WHERE vehicle_kinematics.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND vehicle_kinematics.effective_speed_mph > 0)",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "total_dwell_sec",
        "description": "Total accumulated dwell time in seconds",
        "datatype": "DOUBLE",
        "expression": "SUM(vehicle_kinematics.dwell_sec) FILTER (WHERE vehicle_kinematics.agency_id NOT IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      }
    ]
  },
  {
    "name": "service_reliability_and_micromobility",
    "description": "Service Reliability and Micromobility semantic model uniting real-time disruptions, route/station alerts, and first/last-mile bike/dock availability.",
    "datasets": [
      {
        "name": "alert_routes",
        "description": "Service alerts normalized per affected transit route",
        "source": "prod.transit_v2.view_alert_routes",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "alert_id",
            "datatype": "VARCHAR",
            "description": "Alert identifier",
            "expression": "alert_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Disrupted route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "detected_at",
            "datatype": "TIMESTAMP",
            "description": "Initial detection timestamp",
            "expression": "detected_at",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "last_seen_at",
            "datatype": "TIMESTAMP",
            "description": "Latest observation timestamp",
            "expression": "last_seen_at",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "removed_at",
            "datatype": "TIMESTAMP",
            "description": "Resolution timestamp if cleared",
            "expression": "removed_at",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "cause",
            "datatype": "VARCHAR",
            "description": "Alert cause classification",
            "expression": "cause",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effect",
            "datatype": "VARCHAR",
            "description": "Alert effect on service",
            "expression": "effect",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "header_text",
            "datatype": "VARCHAR",
            "description": "Summary alert header",
            "expression": "header_text",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "description_text",
            "datatype": "VARCHAR",
            "description": "Detailed alert narrative",
            "expression": "description_text",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "severity",
            "datatype": "VARCHAR",
            "description": "Disruption severity level",
            "expression": "severity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "alert_stations",
        "description": "Service alerts normalized per affected station",
        "source": "prod.transit_v2.view_alert_stations",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "alert_id",
            "datatype": "VARCHAR",
            "description": "Alert identifier",
            "expression": "alert_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Affected stop / platform identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "detected_at",
            "datatype": "TIMESTAMP",
            "description": "Initial detection timestamp",
            "expression": "detected_at",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "cause",
            "datatype": "VARCHAR",
            "description": "Alert cause",
            "expression": "cause",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effect",
            "datatype": "VARCHAR",
            "description": "Alert effect",
            "expression": "effect",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "severity",
            "datatype": "VARCHAR",
            "description": "Alert severity",
            "expression": "severity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_alerts",
        "description": "Raw service alerts event log",
        "source": "prod.transit_v2.fact_alerts",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "alert_id",
            "datatype": "VARCHAR",
            "description": "Alert identifier",
            "expression": "alert_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "detected_at",
            "datatype": "TIMESTAMP",
            "description": "Detection timestamp",
            "expression": "detected_at",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "cause",
            "datatype": "VARCHAR",
            "description": "Cause",
            "expression": "cause",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effect",
            "datatype": "VARCHAR",
            "description": "Effect",
            "expression": "effect",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "fact_micromobility_status",
        "description": "Periodic micromobility dock and e-bike capacity telemetry",
        "source": "prod.transit_v2.fact_micromobility_status",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Micromobility network (e.g. citibike)",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Dock station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_bikes_available",
            "datatype": "INTEGER",
            "description": "Total available bicycles",
            "expression": "num_bikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_ebikes_available",
            "datatype": "INTEGER",
            "description": "Total available electric bicycles",
            "expression": "num_ebikes_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "num_docks_available",
            "datatype": "INTEGER",
            "description": "Total empty docks available for return",
            "expression": "num_docks_available",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_renting",
            "datatype": "BOOLEAN",
            "description": "Whether station is actively renting",
            "expression": "is_renting",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_returning",
            "datatype": "BOOLEAN",
            "description": "Whether station is actively accepting returns",
            "expression": "is_returning",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_micromobility_stations",
        "description": "SCD-safe dimension view of micromobility station docks",
        "source": "prod.transit_v2.view_dim_micromobility_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Dock location name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "capacity",
            "datatype": "INTEGER",
            "description": "Total physical dock capacity",
            "expression": "capacity",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of transit stations",
        "source": "prod.transit_v2.view_dim_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of transit routes",
        "source": "prod.transit_v2.view_dim_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "alert_routes_to_dim_routes",
        "from": "alert_routes",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "alert_stations_to_dim_stations",
        "from": "alert_stations",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "micro_status_to_dim_stations",
        "from": "fact_micromobility_status",
        "to": "dim_micromobility_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "station_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "active_disruptions_count",
        "description": "Total unique disruptions",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT fact_alerts.alert_id)",
        "referencedDatasets": [
          "fact_alerts"
        ]
      },
      {
        "name": "route_alerts_count",
        "description": "Count of route alert incidents",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT alert_routes.alert_id)",
        "referencedDatasets": [
          "alert_routes"
        ]
      },
      {
        "name": "station_alerts_count",
        "description": "Count of station alert incidents",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT alert_stations.alert_id)",
        "referencedDatasets": [
          "alert_stations"
        ]
      },
      {
        "name": "avg_bikes_available",
        "description": "Average available bikes at active renting docks",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_bikes_available) FILTER (WHERE fact_micromobility_status.is_renting = true AND (fact_micromobility_status.num_bikes_available + fact_micromobility_status.num_docks_available) > 0)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      },
      {
        "name": "avg_ebikes_available",
        "description": "Average available e-bikes at active renting docks",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_ebikes_available) FILTER (WHERE fact_micromobility_status.is_renting = true AND (fact_micromobility_status.num_bikes_available + fact_micromobility_status.num_docks_available) > 0)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      },
      {
        "name": "avg_docks_available",
        "description": "Average empty docks at active renting docks",
        "datatype": "DOUBLE",
        "expression": "AVG(fact_micromobility_status.num_docks_available) FILTER (WHERE fact_micromobility_status.is_renting = true AND (fact_micromobility_status.num_bikes_available + fact_micromobility_status.num_docks_available) > 0)",
        "referencedDatasets": [
          "fact_micromobility_status"
        ]
      }
    ]
  },
  {
    "name": "surface_kinematics",
    "description": "Surface Kinematics semantic model for bus and surface transit telemetry, velocity profiling, dwell times, and corridor speeds.",
    "datasets": [
      {
        "name": "vehicle_kinematics",
        "description": "Surface vehicle dynamic telemetry and motion profiles",
        "source": "prod.transit_v2.view_surface_kinematics",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Observation timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Transit agency identifier (e.g. mta_bus, njt)",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Nearest stop or timepoint identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "vehicle_id",
            "datatype": "VARCHAR",
            "description": "Bus fleet vehicle number",
            "expression": "vehicle_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "status",
            "datatype": "VARCHAR",
            "description": "Vehicle transit status",
            "expression": "status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "bearing",
            "datatype": "DOUBLE",
            "description": "Vehicle compass heading",
            "expression": "bearing",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "occupancy_status",
            "datatype": "VARCHAR",
            "description": "Vehicle passenger load level",
            "expression": "occupancy_status",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "delta_time_sec",
            "datatype": "DOUBLE",
            "description": "Seconds elapsed since prior position report",
            "expression": "delta_time_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "step_distance_meters",
            "datatype": "DOUBLE",
            "description": "Meters travelled between reports",
            "expression": "step_distance_meters",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mps",
            "datatype": "DOUBLE",
            "description": "Instantaneous velocity in meters per second",
            "expression": "effective_speed_mps",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "effective_speed_mph",
            "datatype": "DOUBLE",
            "description": "Instantaneous velocity in miles per hour",
            "expression": "effective_speed_mph",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "accel_mps2",
            "datatype": "DOUBLE",
            "description": "Rate of acceleration in m/s^2",
            "expression": "accel_mps2",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "dwell_sec",
            "datatype": "DOUBLE",
            "description": "Observed dwell duration at stop",
            "expression": "dwell_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "signal_delay_sec",
            "datatype": "DOUBLE",
            "description": "Traffic or intersection delay duration in seconds",
            "expression": "signal_delay_sec",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_headways",
        "description": "Surface stop headway intervals",
        "source": "prod.transit_v2.view_surface_headways",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "event_time",
            "datatype": "TIMESTAMP",
            "description": "Arrival timestamp",
            "expression": "event_time",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "trip_id",
            "datatype": "VARCHAR",
            "description": "Trip identifier",
            "expression": "trip_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Stop identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent stop identifier",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec",
            "datatype": "DOUBLE",
            "description": "Observed headway between buses in seconds",
            "expression": "headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "headway_sec_squared",
            "datatype": "DOUBLE",
            "description": "Squared headway metric",
            "expression": "headway_sec_squared",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of bus stops and timepoints",
        "source": "prod.transit_v2.view_dim_surface_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Stop identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Bus stop name / cross street",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "latitude",
            "datatype": "DOUBLE",
            "description": "Latitude",
            "expression": "latitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "longitude",
            "datatype": "DOUBLE",
            "description": "Longitude",
            "expression": "longitude",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "is_accessible",
            "datatype": "BOOLEAN",
            "description": "ADA accessibility flag",
            "expression": "is_accessible",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of bus lines",
        "source": "prod.transit_v2.view_dim_surface_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Agency identifier",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Route name (e.g. M15-SBS, B44)",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "color_hex",
            "datatype": "VARCHAR",
            "description": "Route branding color",
            "expression": "color_hex",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "type",
            "datatype": "VARCHAR",
            "description": "Route type",
            "expression": "type",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "kinematics_to_routes",
        "from": "vehicle_kinematics",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "kinematics_to_stations",
        "from": "vehicle_kinematics",
        "to": "dim_stations",
        "fromColumns": [
          "station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "headways_to_stations",
        "from": "station_headways",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "total_active_buses",
        "description": "Count of distinct active surface transit vehicles (MTA Bus, NJT Bus, NYC Ferry)",
        "datatype": "BIGINT",
        "expression": "COUNT(DISTINCT vehicle_kinematics.vehicle_id) FILTER (WHERE vehicle_kinematics.agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "avg_surface_speed_mph",
        "description": "Average surface corridor speed in mph",
        "datatype": "DOUBLE",
        "expression": "AVG(vehicle_kinematics.effective_speed_mph) FILTER (WHERE vehicle_kinematics.agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND vehicle_kinematics.effective_speed_mph > 0)",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "total_corridor_dwell_sec",
        "description": "Total stop passenger boarding dwell time in seconds",
        "datatype": "DOUBLE",
        "expression": "SUM(vehicle_kinematics.dwell_sec) FILTER (WHERE vehicle_kinematics.agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY'))",
        "referencedDatasets": [
          "vehicle_kinematics"
        ]
      },
      {
        "name": "avg_bus_headway_sec",
        "description": "Average bus headway gap in seconds (filtered to 30s..3600s operational range)",
        "datatype": "DOUBLE",
        "expression": "AVG(station_headways.headway_sec) FILTER (WHERE station_headways.agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY') AND station_headways.headway_sec BETWEEN 30 AND 3600)",
        "referencedDatasets": [
          "station_headways"
        ]
      }
    ]
  },
  {
    "name": "unified_transit_network",
    "description": "Unified Transit Network multi-fact semantic model linking scheduled vs observed trips, station throughput, and disruptions.",
    "datasets": [
      {
        "name": "schedule_adherence",
        "description": "Route-level hourly scheduled vs observed trip adherence and service completion",
        "source": "prod.transit_v2.view_schedule_adherence",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Hourly service window in America/New_York",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "scheduled_trips",
            "datatype": "BIGINT",
            "description": "Timetabled trips scheduled in this hour",
            "expression": "scheduled_trips",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "observed_trips",
            "datatype": "BIGINT",
            "description": "Actual train/bus trips observed running in this hour",
            "expression": "observed_trips",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_completion_pct",
            "datatype": "DOUBLE",
            "description": "Percentage of scheduled service delivered (observed / scheduled * 100)",
            "expression": "service_completion_pct",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "avg_observed_headway_sec",
            "datatype": "DOUBLE",
            "description": "Average observed headway in seconds",
            "expression": "avg_observed_headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "active_alerts_count",
            "datatype": "BIGINT",
            "description": "Count of distinct active route alerts in this hour",
            "expression": "active_alerts_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_hourly_summary",
        "description": "Multi-fact hourly summary at parent stations uniting turnstiles, train arrivals, and station alerts",
        "source": "prod.transit_v2.view_station_hourly_summary",
        "fields": [
          {
            "name": "event_date",
            "datatype": "DATE",
            "description": "Partition date",
            "expression": "event_date",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "parent_station_id",
            "datatype": "VARCHAR",
            "description": "Normalized parent station ID",
            "expression": "parent_station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "service_hour",
            "datatype": "TIMESTAMP",
            "description": "Hourly service window",
            "expression": "service_hour",
            "isDimension": true,
            "isTime": true
          },
          {
            "name": "total_entries",
            "datatype": "BIGINT",
            "description": "Total turnstile passenger entries",
            "expression": "total_entries",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "total_exits",
            "datatype": "BIGINT",
            "description": "Total turnstile passenger exits",
            "expression": "total_exits",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "train_stops_count",
            "datatype": "BIGINT",
            "description": "Total observed train stops made at this station",
            "expression": "train_stops_count",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "distinct_vehicles",
            "datatype": "BIGINT",
            "description": "Distinct transit vehicles servicing this station",
            "expression": "distinct_vehicles",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "avg_headway_sec",
            "datatype": "DOUBLE",
            "description": "Average headway between train arrivals",
            "expression": "avg_headway_sec",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "station_alerts_count",
            "datatype": "BIGINT",
            "description": "Disruptions affecting this station in this hour",
            "expression": "station_alerts_count",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_stations",
        "description": "SCD-safe dimension view of current transit stations",
        "source": "prod.transit_v2.view_dim_stations",
        "fields": [
          {
            "name": "station_id",
            "datatype": "VARCHAR",
            "description": "Station identifier",
            "expression": "station_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "name",
            "datatype": "VARCHAR",
            "description": "Station name",
            "expression": "name",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "gtfs_stop_id",
            "datatype": "VARCHAR",
            "description": "GTFS stop identifier",
            "expression": "gtfs_stop_id",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "station_complexes",
        "description": "Aggregated station complexes",
        "source": "prod.transit_v2.view_station_complexes",
        "fields": [
          {
            "name": "complex_id",
            "datatype": "VARCHAR",
            "description": "Complex identifier",
            "expression": "complex_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "complex_name",
            "datatype": "VARCHAR",
            "description": "Complex name",
            "expression": "complex_name",
            "isDimension": false,
            "isTime": false
          }
        ]
      },
      {
        "name": "dim_routes",
        "description": "SCD-safe dimension view of current transit lines and routes",
        "source": "prod.transit_v2.view_dim_routes",
        "fields": [
          {
            "name": "route_id",
            "datatype": "VARCHAR",
            "description": "Route identifier",
            "expression": "route_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "agency_id",
            "datatype": "VARCHAR",
            "description": "Operating agency",
            "expression": "agency_id",
            "isDimension": false,
            "isTime": false
          },
          {
            "name": "route_name",
            "datatype": "VARCHAR",
            "description": "Commercial route name",
            "expression": "route_name",
            "isDimension": false,
            "isTime": false
          }
        ]
      }
    ],
    "relationships": [
      {
        "name": "schedule_adherence_to_dim_routes",
        "from": "schedule_adherence",
        "to": "dim_routes",
        "fromColumns": [
          "route_id",
          "agency_id"
        ],
        "toColumns": [
          "route_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "station_summary_to_dim_stations",
        "from": "station_hourly_summary",
        "to": "dim_stations",
        "fromColumns": [
          "parent_station_id",
          "agency_id"
        ],
        "toColumns": [
          "gtfs_stop_id",
          "agency_id"
        ],
        "type": "many_to_one"
      },
      {
        "name": "dim_stations_to_complex",
        "from": "dim_stations",
        "to": "station_complexes",
        "fromColumns": [
          "complex_id",
          "agency_id"
        ],
        "toColumns": [
          "complex_id",
          "agency_id"
        ],
        "type": "many_to_one"
      }
    ],
    "metrics": [
      {
        "name": "overall_system_throughput",
        "description": "Sum of passenger entries and exits at fare-controlled stations",
        "datatype": "BIGINT",
        "expression": "SUM(NULLIF(station_hourly_summary.total_entries + station_hourly_summary.total_exits, 0))",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "station_total_entries",
        "description": "Total passenger entries across stations",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.total_entries)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "station_total_exits",
        "description": "Total passenger exits across stations",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.total_exits)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "station_train_stops_count",
        "description": "Total train stops across stations",
        "datatype": "BIGINT",
        "expression": "SUM(station_hourly_summary.train_stops_count)",
        "referencedDatasets": [
          "station_hourly_summary"
        ]
      },
      {
        "name": "total_scheduled_trips",
        "description": "Total scheduled trips across filtered period",
        "datatype": "BIGINT",
        "expression": "SUM(schedule_adherence.scheduled_trips)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "total_observed_trips",
        "description": "Total observed trips delivered",
        "datatype": "BIGINT",
        "expression": "SUM(schedule_adherence.observed_trips)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      },
      {
        "name": "network_service_completion_pct",
        "description": "Overall percentage of scheduled service delivered",
        "datatype": "DOUBLE",
        "expression": "ROUND(CAST(SUM(schedule_adherence.observed_trips) AS DOUBLE) / NULLIF(SUM(schedule_adherence.scheduled_trips), 0) * 100.0, 2)",
        "referencedDatasets": [
          "schedule_adherence"
        ]
      }
    ]
  }
] as const;

export type OssieThemeName = (typeof OSSIE_THEMES)[number]['name'];

export const OSSIE_FACT_GRAPH = {
  "dbtc": {
    "factDatasets": [
      "station_headways",
      "station_to_station_legs",
      "current_vehicle_positions",
      "vehicle_kinematics",
      "schedule_adherence",
      "station_hourly_summary",
      "turnstile_flows",
      "fact_ridership",
      "fact_micromobility_status",
      "alert_routes",
      "alert_stations",
      "subway_station_headways",
      "station_turnstile_ranking",
      "hourly_turnstile_profile",
      "fleet_route_share",
      "schedule_adherence_hourly",
      "multimodal_station_pulse",
      "od_ridership_flows"
    ],
    "datasets": {
      "station_headways": {
        "reachableDatasets": [
          "station_headways",
          "dim_stations",
          "dim_routes",
          "dim_service_lines"
        ],
        "dimensions": [
          "station_headways.event_date",
          "station_headways.event_time",
          "station_headways.agency_id",
          "station_headways.route_id",
          "station_headways.trip_id",
          "station_headways.vehicle_id",
          "station_headways.station_id",
          "station_headways.parent_station_id",
          "station_headways.direction_id",
          "station_headways.status",
          "station_headways.headway_sec",
          "station_headways.headway_sec_squared",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_service_lines.line_id",
          "dim_service_lines.route_id",
          "dim_service_lines.agency_id",
          "dim_service_lines.service_name",
          "dim_service_lines.line_name",
          "dim_service_lines.division",
          "dim_service_lines.color_hex",
          "dim_service_lines.geom_wkt",
          "dim_service_lines.geom_geojson",
          "dim_service_lines.shape_leng"
        ],
        "metrics": [
          "avg_headway_sec",
          "median_headway_sec",
          "p90_headway_sec",
          "headway_variance",
          "total_train_runs",
          "train_stops_count",
          "bunching_events_count",
          "gapping_events_count"
        ]
      },
      "station_to_station_legs": {
        "reachableDatasets": [
          "station_to_station_legs",
          "dim_stations",
          "dim_routes",
          "dim_service_lines"
        ],
        "dimensions": [
          "station_to_station_legs.event_date",
          "station_to_station_legs.agency_id",
          "station_to_station_legs.route_id",
          "station_to_station_legs.route_name",
          "station_to_station_legs.trip_id",
          "station_to_station_legs.vehicle_id",
          "station_to_station_legs.from_station_id",
          "station_to_station_legs.to_station_id",
          "station_to_station_legs.departure_time",
          "station_to_station_legs.arrival_time",
          "station_to_station_legs.leg_travel_time_sec",
          "station_to_station_legs.leg_distance_meters",
          "station_to_station_legs.leg_speed_mps",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_service_lines.line_id",
          "dim_service_lines.route_id",
          "dim_service_lines.agency_id",
          "dim_service_lines.service_name",
          "dim_service_lines.line_name",
          "dim_service_lines.division",
          "dim_service_lines.color_hex",
          "dim_service_lines.geom_wkt",
          "dim_service_lines.geom_geojson",
          "dim_service_lines.shape_leng"
        ],
        "metrics": [
          "avg_travel_time_sec",
          "median_travel_time_sec",
          "calibrated_leg_travel_time_sec",
          "effective_speed_mph",
          "sample_size",
          "avg_leg_distance_meters",
          "avg_leg_speed_mps"
        ]
      },
      "current_vehicle_positions": {
        "reachableDatasets": [
          "current_vehicle_positions",
          "dim_stations",
          "dim_routes",
          "dim_service_lines"
        ],
        "dimensions": [
          "current_vehicle_positions.event_date",
          "current_vehicle_positions.event_time",
          "current_vehicle_positions.agency_id",
          "current_vehicle_positions.route_id",
          "current_vehicle_positions.trip_id",
          "current_vehicle_positions.station_id",
          "current_vehicle_positions.vehicle_id",
          "current_vehicle_positions.status",
          "current_vehicle_positions.latitude",
          "current_vehicle_positions.longitude",
          "current_vehicle_positions.bearing",
          "current_vehicle_positions.speed",
          "current_vehicle_positions.occupancy_status",
          "current_vehicle_positions.parent_station_id",
          "current_vehicle_positions.direction_id",
          "current_vehicle_positions.service_hour_et",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_service_lines.line_id",
          "dim_service_lines.route_id",
          "dim_service_lines.agency_id",
          "dim_service_lines.service_name",
          "dim_service_lines.line_name",
          "dim_service_lines.division",
          "dim_service_lines.color_hex",
          "dim_service_lines.geom_wkt",
          "dim_service_lines.geom_geojson",
          "dim_service_lines.shape_leng"
        ],
        "metrics": [
          "active_trains_count",
          "current_avg_speed_mph"
        ]
      },
      "vehicle_kinematics": {
        "reachableDatasets": [
          "vehicle_kinematics",
          "dim_routes",
          "dim_stations"
        ],
        "dimensions": [
          "vehicle_kinematics.event_date",
          "vehicle_kinematics.event_time",
          "vehicle_kinematics.agency_id",
          "vehicle_kinematics.route_id",
          "vehicle_kinematics.trip_id",
          "vehicle_kinematics.station_id",
          "vehicle_kinematics.vehicle_id",
          "vehicle_kinematics.status",
          "vehicle_kinematics.latitude",
          "vehicle_kinematics.longitude",
          "vehicle_kinematics.bearing",
          "vehicle_kinematics.effective_speed_mps",
          "vehicle_kinematics.effective_speed_mph",
          "vehicle_kinematics.accel_mps2",
          "vehicle_kinematics.dwell_sec",
          "vehicle_kinematics.signal_delay_sec",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough"
        ],
        "metrics": [
          "avg_speed_mph",
          "total_dwell_sec"
        ]
      },
      "schedule_adherence": {
        "reachableDatasets": [
          "schedule_adherence",
          "dim_routes"
        ],
        "dimensions": [
          "schedule_adherence.event_date",
          "schedule_adherence.service_hour",
          "schedule_adherence.agency_id",
          "schedule_adherence.route_id",
          "schedule_adherence.hour_of_day",
          "schedule_adherence.scheduled_trips_count",
          "schedule_adherence.observed_trips_count",
          "schedule_adherence.ghost_trips_count",
          "schedule_adherence.unscheduled_trips_count",
          "schedule_adherence.service_completion_pct",
          "schedule_adherence.avg_observed_headway_sec",
          "schedule_adherence.median_observed_headway_sec",
          "schedule_adherence.active_alerts_count",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group"
        ],
        "metrics": [
          "scheduled_trips",
          "observed_trips",
          "ghost_trips",
          "service_completion_pct"
        ]
      },
      "station_hourly_summary": {
        "reachableDatasets": [
          "station_hourly_summary",
          "dim_stations"
        ],
        "dimensions": [
          "station_hourly_summary.event_date",
          "station_hourly_summary.agency_id",
          "station_hourly_summary.parent_station_id",
          "station_hourly_summary.service_hour",
          "station_hourly_summary.total_entries",
          "station_hourly_summary.total_exits",
          "station_hourly_summary.train_arrivals_count",
          "station_hourly_summary.avg_headway_sec",
          "station_hourly_summary.station_alerts_count",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough"
        ],
        "metrics": [
          "hourly_entries",
          "hourly_exits",
          "hourly_train_arrivals"
        ]
      },
      "turnstile_flows": {
        "reachableDatasets": [
          "turnstile_flows",
          "dim_stations",
          "station_complexes"
        ],
        "dimensions": [
          "turnstile_flows.event_date",
          "turnstile_flows.service_hour",
          "turnstile_flows.agency_id",
          "turnstile_flows.station_id",
          "turnstile_flows.device_id",
          "turnstile_flows.reading_time",
          "turnstile_flows.entry_count",
          "turnstile_flows.exit_count",
          "turnstile_flows.payment_method",
          "turnstile_flows.fare_class_category",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": [
          "total_entries",
          "total_exits"
        ]
      },
      "fact_ridership": {
        "reachableDatasets": [
          "fact_ridership",
          "dim_stations",
          "station_complexes"
        ],
        "dimensions": [
          "fact_ridership.event_date",
          "fact_ridership.agency_id",
          "fact_ridership.origin_station_id",
          "fact_ridership.destination_station_id",
          "fact_ridership.passenger_count",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": [
          "total_ridership_volume"
        ]
      },
      "fact_micromobility_status": {
        "reachableDatasets": [
          "fact_micromobility_status",
          "dim_micromobility_stations"
        ],
        "dimensions": [
          "fact_micromobility_status.event_date",
          "fact_micromobility_status.event_time",
          "fact_micromobility_status.agency_id",
          "fact_micromobility_status.station_id",
          "fact_micromobility_status.num_bikes_available",
          "fact_micromobility_status.num_ebikes_available",
          "fact_micromobility_status.num_docks_available",
          "fact_micromobility_status.is_installed",
          "fact_micromobility_status.is_renting",
          "dim_micromobility_stations.station_id",
          "dim_micromobility_stations.agency_id",
          "dim_micromobility_stations.name",
          "dim_micromobility_stations.latitude",
          "dim_micromobility_stations.longitude",
          "dim_micromobility_stations.capacity"
        ],
        "metrics": [
          "avg_ebikes_available",
          "avg_bikes_available",
          "avg_docks_available"
        ]
      },
      "alert_routes": {
        "reachableDatasets": [
          "alert_routes",
          "dim_routes"
        ],
        "dimensions": [
          "alert_routes.event_date",
          "alert_routes.alert_id",
          "alert_routes.agency_id",
          "alert_routes.route_id",
          "alert_routes.cause",
          "alert_routes.effect",
          "alert_routes.severity",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group"
        ],
        "metrics": [
          "distinct_route_alerts"
        ]
      },
      "alert_stations": {
        "reachableDatasets": [
          "alert_stations",
          "dim_stations"
        ],
        "dimensions": [
          "alert_stations.event_date",
          "alert_stations.alert_id",
          "alert_stations.agency_id",
          "alert_stations.parent_station_id",
          "alert_stations.cause",
          "alert_stations.effect",
          "alert_stations.severity",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough"
        ],
        "metrics": [
          "distinct_station_alerts"
        ]
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough"
        ],
        "metrics": []
      },
      "station_complexes": {
        "reachableDatasets": [
          "station_complexes"
        ],
        "dimensions": [
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group"
        ],
        "metrics": []
      },
      "dim_service_lines": {
        "reachableDatasets": [
          "dim_service_lines"
        ],
        "dimensions": [
          "dim_service_lines.line_id",
          "dim_service_lines.route_id",
          "dim_service_lines.agency_id",
          "dim_service_lines.service_name",
          "dim_service_lines.line_name",
          "dim_service_lines.division",
          "dim_service_lines.color_hex",
          "dim_service_lines.geom_wkt",
          "dim_service_lines.geom_geojson",
          "dim_service_lines.shape_leng"
        ],
        "metrics": []
      },
      "dim_boroughs": {
        "reachableDatasets": [
          "dim_boroughs"
        ],
        "dimensions": [
          "dim_boroughs.boro_code",
          "dim_boroughs.boro_name",
          "dim_boroughs.geom_wkt",
          "dim_boroughs.geom_geojson"
        ],
        "metrics": []
      },
      "dim_map_geography": {
        "reachableDatasets": [
          "dim_map_geography"
        ],
        "dimensions": [
          "dim_map_geography.boro_code",
          "dim_map_geography.boro_name",
          "dim_map_geography.region_kind",
          "dim_map_geography.geom_wkt",
          "dim_map_geography.geom_geojson"
        ],
        "metrics": []
      },
      "dim_micromobility_stations": {
        "reachableDatasets": [
          "dim_micromobility_stations"
        ],
        "dimensions": [
          "dim_micromobility_stations.station_id",
          "dim_micromobility_stations.agency_id",
          "dim_micromobility_stations.name",
          "dim_micromobility_stations.latitude",
          "dim_micromobility_stations.longitude",
          "dim_micromobility_stations.capacity"
        ],
        "metrics": []
      },
      "fact_vehicle_positions": {
        "reachableDatasets": [
          "fact_vehicle_positions",
          "dim_stations",
          "dim_routes",
          "dim_service_lines"
        ],
        "dimensions": [
          "fact_vehicle_positions.event_date",
          "fact_vehicle_positions.event_time",
          "fact_vehicle_positions.agency_id",
          "fact_vehicle_positions.route_id",
          "fact_vehicle_positions.trip_id",
          "fact_vehicle_positions.station_id",
          "fact_vehicle_positions.vehicle_id",
          "fact_vehicle_positions.status",
          "fact_vehicle_positions.latitude",
          "fact_vehicle_positions.longitude",
          "fact_vehicle_positions.bearing",
          "fact_vehicle_positions.speed",
          "fact_vehicle_positions.occupancy_status",
          "fact_vehicle_positions.parent_station_id",
          "fact_vehicle_positions.direction_id",
          "fact_vehicle_positions.service_hour_et",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_service_lines.line_id",
          "dim_service_lines.route_id",
          "dim_service_lines.agency_id",
          "dim_service_lines.service_name",
          "dim_service_lines.line_name",
          "dim_service_lines.division",
          "dim_service_lines.color_hex",
          "dim_service_lines.geom_wkt",
          "dim_service_lines.geom_geojson",
          "dim_service_lines.shape_leng"
        ],
        "metrics": []
      },
      "fact_schedules": {
        "reachableDatasets": [
          "fact_schedules",
          "dim_routes",
          "dim_stations"
        ],
        "dimensions": [
          "fact_schedules.event_date",
          "fact_schedules.agency_id",
          "fact_schedules.route_id",
          "fact_schedules.station_id",
          "fact_schedules.trip_id",
          "fact_schedules.scheduled_arrival_time",
          "fact_schedules.scheduled_departure_time",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_routes.bullet_code",
          "dim_routes.text_color_hex",
          "dim_routes.division",
          "dim_routes.trunk_group",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_stations.borough"
        ],
        "metrics": []
      },
      "dim_routes_1929": {
        "reachableDatasets": [
          "dim_routes_1929"
        ],
        "dimensions": [
          "dim_routes_1929.route_id",
          "dim_routes_1929.agency_id",
          "dim_routes_1929.route_name",
          "dim_routes_1929.color_hex",
          "dim_routes_1929.division"
        ],
        "metrics": []
      },
      "dim_service_lines_1929": {
        "reachableDatasets": [
          "dim_service_lines_1929"
        ],
        "dimensions": [
          "dim_service_lines_1929.route_id",
          "dim_service_lines_1929.agency_id",
          "dim_service_lines_1929.route_name",
          "dim_service_lines_1929.color_hex",
          "dim_service_lines_1929.geom_geojson"
        ],
        "metrics": []
      },
      "dim_stations_1929": {
        "reachableDatasets": [
          "dim_stations_1929"
        ],
        "dimensions": [
          "dim_stations_1929.station_id",
          "dim_stations_1929.agency_id",
          "dim_stations_1929.name",
          "dim_stations_1929.latitude",
          "dim_stations_1929.longitude",
          "dim_stations_1929.gtfs_stop_id",
          "dim_stations_1929.complex_id",
          "dim_stations_1929.daytime_routes"
        ],
        "metrics": []
      },
      "dim_routes_proposed": {
        "reachableDatasets": [
          "dim_routes_proposed"
        ],
        "dimensions": [
          "dim_routes_proposed.route_id",
          "dim_routes_proposed.agency_id",
          "dim_routes_proposed.route_name",
          "dim_routes_proposed.color_hex",
          "dim_routes_proposed.division"
        ],
        "metrics": []
      },
      "dim_service_lines_proposed": {
        "reachableDatasets": [
          "dim_service_lines_proposed"
        ],
        "dimensions": [
          "dim_service_lines_proposed.route_id",
          "dim_service_lines_proposed.agency_id",
          "dim_service_lines_proposed.route_name",
          "dim_service_lines_proposed.color_hex",
          "dim_service_lines_proposed.geom_geojson"
        ],
        "metrics": []
      },
      "dim_stations_proposed": {
        "reachableDatasets": [
          "dim_stations_proposed"
        ],
        "dimensions": [
          "dim_stations_proposed.station_id",
          "dim_stations_proposed.agency_id",
          "dim_stations_proposed.name",
          "dim_stations_proposed.latitude",
          "dim_stations_proposed.longitude",
          "dim_stations_proposed.gtfs_stop_id",
          "dim_stations_proposed.complex_id",
          "dim_stations_proposed.daytime_routes"
        ],
        "metrics": []
      },
      "subway_station_headways": {
        "reachableDatasets": [
          "subway_station_headways"
        ],
        "dimensions": [
          "subway_station_headways.event_date",
          "subway_station_headways.event_time",
          "subway_station_headways.agency_id",
          "subway_station_headways.route_id",
          "subway_station_headways.station_id",
          "subway_station_headways.station_name",
          "subway_station_headways.borough",
          "subway_station_headways.direction_id",
          "subway_station_headways.headway_sec"
        ],
        "metrics": []
      },
      "train_stringline_marey": {
        "reachableDatasets": [
          "train_stringline_marey"
        ],
        "dimensions": [
          "train_stringline_marey.event_date",
          "train_stringline_marey.event_time",
          "train_stringline_marey.agency_id",
          "train_stringline_marey.route_id",
          "train_stringline_marey.trip_id",
          "train_stringline_marey.direction_id",
          "train_stringline_marey.station_id",
          "train_stringline_marey.station_name",
          "train_stringline_marey.borough",
          "train_stringline_marey.headway_sec"
        ],
        "metrics": []
      },
      "live_subway_fleet": {
        "reachableDatasets": [
          "live_subway_fleet"
        ],
        "dimensions": [
          "live_subway_fleet.event_date",
          "live_subway_fleet.event_time",
          "live_subway_fleet.agency_id",
          "live_subway_fleet.route_id",
          "live_subway_fleet.trip_id",
          "live_subway_fleet.vehicle_id",
          "live_subway_fleet.station_id"
        ],
        "metrics": []
      },
      "live_commuter_rail_fleet": {
        "reachableDatasets": [
          "live_commuter_rail_fleet"
        ],
        "dimensions": [
          "live_commuter_rail_fleet.event_date",
          "live_commuter_rail_fleet.event_time",
          "live_commuter_rail_fleet.agency_id",
          "live_commuter_rail_fleet.route_id",
          "live_commuter_rail_fleet.vehicle_id"
        ],
        "metrics": []
      },
      "live_bus_fleet": {
        "reachableDatasets": [
          "live_bus_fleet"
        ],
        "dimensions": [
          "live_bus_fleet.event_date",
          "live_bus_fleet.event_time",
          "live_bus_fleet.agency_id",
          "live_bus_fleet.route_id",
          "live_bus_fleet.vehicle_id"
        ],
        "metrics": []
      },
      "route_segment_speeds": {
        "reachableDatasets": [
          "route_segment_speeds"
        ],
        "dimensions": [
          "route_segment_speeds.event_date",
          "route_segment_speeds.agency_id",
          "route_segment_speeds.route_id",
          "route_segment_speeds.from_station_id",
          "route_segment_speeds.to_station_id"
        ],
        "metrics": []
      },
      "station_isochrones": {
        "reachableDatasets": [
          "station_isochrones"
        ],
        "dimensions": [
          "station_isochrones.event_date",
          "station_isochrones.agency_id",
          "station_isochrones.station_id",
          "station_isochrones.station_name"
        ],
        "metrics": []
      },
      "schedule_adherence_hourly": {
        "reachableDatasets": [
          "schedule_adherence_hourly"
        ],
        "dimensions": [
          "schedule_adherence_hourly.event_date",
          "schedule_adherence_hourly.agency_id",
          "schedule_adherence_hourly.route_id",
          "schedule_adherence_hourly.route_name"
        ],
        "metrics": [
          "lens_scheduled_trips",
          "lens_observed_trips"
        ]
      },
      "station_turnstile_ranking": {
        "reachableDatasets": [
          "station_turnstile_ranking"
        ],
        "dimensions": [
          "station_turnstile_ranking.event_date",
          "station_turnstile_ranking.agency_id",
          "station_turnstile_ranking.station_id",
          "station_turnstile_ranking.station_name",
          "station_turnstile_ranking.entry_count"
        ],
        "metrics": [
          "lens_turnstile_entries"
        ]
      },
      "hourly_turnstile_profile": {
        "reachableDatasets": [
          "hourly_turnstile_profile"
        ],
        "dimensions": [
          "hourly_turnstile_profile.event_date",
          "hourly_turnstile_profile.agency_id",
          "hourly_turnstile_profile.service_hour",
          "hourly_turnstile_profile.entry_count"
        ],
        "metrics": [
          "lens_avg_hourly_entries"
        ]
      },
      "fleet_route_share": {
        "reachableDatasets": [
          "fleet_route_share"
        ],
        "dimensions": [
          "fleet_route_share.event_date",
          "fleet_route_share.agency_id",
          "fleet_route_share.route_id",
          "fleet_route_share.route_label",
          "fleet_route_share.trip_id"
        ],
        "metrics": [
          "lens_observed_trips_share"
        ]
      },
      "subway_headway_horizon": {
        "reachableDatasets": [
          "subway_headway_horizon"
        ],
        "dimensions": [
          "subway_headway_horizon.event_date",
          "subway_headway_horizon.agency_id",
          "subway_headway_horizon.route_id",
          "subway_headway_horizon.trip_id",
          "subway_headway_horizon.direction_id",
          "subway_headway_horizon.station_id",
          "subway_headway_horizon.station_name",
          "subway_headway_horizon.event_time",
          "subway_headway_horizon.headway_sec",
          "subway_headway_horizon.display_value"
        ],
        "metrics": []
      },
      "multimodal_station_pulse": {
        "reachableDatasets": [
          "multimodal_station_pulse"
        ],
        "dimensions": [
          "multimodal_station_pulse.event_date",
          "multimodal_station_pulse.station_id",
          "multimodal_station_pulse.station_name",
          "multimodal_station_pulse.hour_of_day",
          "multimodal_station_pulse.service_hour",
          "multimodal_station_pulse.entry_count",
          "multimodal_station_pulse.subway_entries",
          "multimodal_station_pulse.num_bikes_available",
          "multimodal_station_pulse.num_ebikes_available",
          "multimodal_station_pulse.num_docks_available"
        ],
        "metrics": [
          "lens_multimodal_entries"
        ]
      },
      "od_ridership_flows": {
        "reachableDatasets": [
          "od_ridership_flows"
        ],
        "dimensions": [
          "od_ridership_flows.event_date",
          "od_ridership_flows.agency_id",
          "od_ridership_flows.origin_station_id",
          "od_ridership_flows.origin_station_name",
          "od_ridership_flows.origin_borough",
          "od_ridership_flows.destination_station_id",
          "od_ridership_flows.destination_station_name",
          "od_ridership_flows.destination_borough",
          "od_ridership_flows.passenger_count"
        ],
        "metrics": [
          "lens_od_passengers"
        ]
      }
    }
  },
  "network_accessibility_and_demand": {
    "factDatasets": [
      "turnstile_flows",
      "fact_ridership",
      "station_to_station_legs"
    ],
    "datasets": {
      "turnstile_flows": {
        "reachableDatasets": [
          "turnstile_flows",
          "station_complexes"
        ],
        "dimensions": [
          "turnstile_flows.event_date",
          "turnstile_flows.agency_id",
          "turnstile_flows.station_id",
          "turnstile_flows.device_id",
          "turnstile_flows.reading_time",
          "turnstile_flows.service_hour",
          "turnstile_flows.entry_count",
          "turnstile_flows.exit_count",
          "turnstile_flows.payment_method",
          "turnstile_flows.fare_class_category",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": [
          "network_turnstile_entries",
          "total_entries",
          "total_exits",
          "net_flow"
        ]
      },
      "fact_ridership": {
        "reachableDatasets": [
          "fact_ridership",
          "station_complexes"
        ],
        "dimensions": [
          "fact_ridership.event_date",
          "fact_ridership.agency_id",
          "fact_ridership.origin_station_id",
          "fact_ridership.destination_station_id",
          "fact_ridership.passenger_count",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": [
          "total_passengers"
        ]
      },
      "station_complexes": {
        "reachableDatasets": [
          "station_complexes"
        ],
        "dimensions": [
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": []
      },
      "station_to_station_legs": {
        "reachableDatasets": [
          "station_to_station_legs",
          "dim_stations",
          "dim_routes",
          "station_complexes"
        ],
        "dimensions": [
          "station_to_station_legs.event_date",
          "station_to_station_legs.agency_id",
          "station_to_station_legs.route_id",
          "station_to_station_legs.route_name",
          "station_to_station_legs.trip_id",
          "station_to_station_legs.from_station_id",
          "station_to_station_legs.to_station_id",
          "station_to_station_legs.leg_travel_time_sec",
          "station_to_station_legs.leg_distance_meters",
          "dim_stations.station_id",
          "dim_stations.gtfs_stop_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.complex_id",
          "dim_stations.is_accessible",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": [
          "avg_leg_distance_meters"
        ]
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations",
          "station_complexes"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.gtfs_stop_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.complex_id",
          "dim_stations.is_accessible",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name",
          "station_complexes.latitude",
          "station_complexes.longitude",
          "station_complexes.daytime_routes",
          "station_complexes.is_accessible",
          "station_complexes.station_count",
          "station_complexes.route_count"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type"
        ],
        "metrics": []
      }
    }
  },
  "rail_operations": {
    "factDatasets": [
      "station_headways",
      "station_to_station_legs",
      "vehicle_kinematics"
    ],
    "datasets": {
      "station_headways": {
        "reachableDatasets": [
          "station_headways",
          "dim_stations",
          "dim_routes"
        ],
        "dimensions": [
          "station_headways.event_date",
          "station_headways.event_time",
          "station_headways.agency_id",
          "station_headways.route_id",
          "station_headways.trip_id",
          "station_headways.vehicle_id",
          "station_headways.station_id",
          "station_headways.parent_station_id",
          "station_headways.direction_id",
          "station_headways.status",
          "station_headways.headway_sec",
          "station_headways.headway_sec_squared",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type"
        ],
        "metrics": [
          "total_train_runs",
          "network_avg_headway_sec",
          "avg_headway_sec",
          "median_headway_sec",
          "headway_variance",
          "train_stops_count"
        ]
      },
      "station_to_station_legs": {
        "reachableDatasets": [
          "station_to_station_legs",
          "dim_stations"
        ],
        "dimensions": [
          "station_to_station_legs.event_date",
          "station_to_station_legs.agency_id",
          "station_to_station_legs.route_id",
          "station_to_station_legs.route_name",
          "station_to_station_legs.trip_id",
          "station_to_station_legs.vehicle_id",
          "station_to_station_legs.from_station_id",
          "station_to_station_legs.to_station_id",
          "station_to_station_legs.departure_time",
          "station_to_station_legs.arrival_time",
          "station_to_station_legs.leg_travel_time_sec",
          "station_to_station_legs.leg_distance_meters",
          "station_to_station_legs.leg_speed_mps",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction"
        ],
        "metrics": [
          "avg_travel_time_sec",
          "avg_leg_distance_meters",
          "avg_leg_speed_mps"
        ]
      },
      "vehicle_kinematics": {
        "reachableDatasets": [
          "vehicle_kinematics",
          "dim_routes"
        ],
        "dimensions": [
          "vehicle_kinematics.event_date",
          "vehicle_kinematics.event_time",
          "vehicle_kinematics.agency_id",
          "vehicle_kinematics.route_id",
          "vehicle_kinematics.trip_id",
          "vehicle_kinematics.station_id",
          "vehicle_kinematics.vehicle_id",
          "vehicle_kinematics.status",
          "vehicle_kinematics.latitude",
          "vehicle_kinematics.longitude",
          "vehicle_kinematics.bearing",
          "vehicle_kinematics.occupancy_status",
          "vehicle_kinematics.delta_time_sec",
          "vehicle_kinematics.step_distance_meters",
          "vehicle_kinematics.effective_speed_mps",
          "vehicle_kinematics.effective_speed_mph",
          "vehicle_kinematics.accel_mps2",
          "vehicle_kinematics.dwell_sec",
          "vehicle_kinematics.signal_delay_sec",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type"
        ],
        "metrics": [
          "avg_speed_mph",
          "total_dwell_sec"
        ]
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.gtfs_stop_id",
          "dim_stations.complex_id",
          "dim_stations.daytime_routes",
          "dim_stations.structure",
          "dim_stations.is_accessible",
          "dim_stations.route_count",
          "dim_stations.is_interlined_junction"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type"
        ],
        "metrics": []
      }
    }
  },
  "service_reliability_and_micromobility": {
    "factDatasets": [
      "fact_alerts",
      "alert_routes",
      "alert_stations",
      "fact_micromobility_status"
    ],
    "datasets": {
      "alert_routes": {
        "reachableDatasets": [
          "alert_routes",
          "dim_routes"
        ],
        "dimensions": [
          "alert_routes.event_date",
          "alert_routes.alert_id",
          "alert_routes.agency_id",
          "alert_routes.route_id",
          "alert_routes.detected_at",
          "alert_routes.last_seen_at",
          "alert_routes.removed_at",
          "alert_routes.cause",
          "alert_routes.effect",
          "alert_routes.header_text",
          "alert_routes.description_text",
          "alert_routes.severity",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name"
        ],
        "metrics": [
          "route_alerts_count"
        ]
      },
      "alert_stations": {
        "reachableDatasets": [
          "alert_stations",
          "dim_stations"
        ],
        "dimensions": [
          "alert_stations.event_date",
          "alert_stations.alert_id",
          "alert_stations.agency_id",
          "alert_stations.station_id",
          "alert_stations.parent_station_id",
          "alert_stations.detected_at",
          "alert_stations.cause",
          "alert_stations.effect",
          "alert_stations.severity",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.gtfs_stop_id"
        ],
        "metrics": [
          "station_alerts_count"
        ]
      },
      "fact_alerts": {
        "reachableDatasets": [
          "fact_alerts"
        ],
        "dimensions": [
          "fact_alerts.event_date",
          "fact_alerts.alert_id",
          "fact_alerts.agency_id",
          "fact_alerts.detected_at",
          "fact_alerts.cause",
          "fact_alerts.effect"
        ],
        "metrics": [
          "active_disruptions_count"
        ]
      },
      "fact_micromobility_status": {
        "reachableDatasets": [
          "fact_micromobility_status",
          "dim_micromobility_stations"
        ],
        "dimensions": [
          "fact_micromobility_status.event_date",
          "fact_micromobility_status.event_time",
          "fact_micromobility_status.agency_id",
          "fact_micromobility_status.station_id",
          "fact_micromobility_status.num_bikes_available",
          "fact_micromobility_status.num_ebikes_available",
          "fact_micromobility_status.num_docks_available",
          "fact_micromobility_status.is_renting",
          "fact_micromobility_status.is_returning",
          "dim_micromobility_stations.station_id",
          "dim_micromobility_stations.agency_id",
          "dim_micromobility_stations.name",
          "dim_micromobility_stations.latitude",
          "dim_micromobility_stations.longitude",
          "dim_micromobility_stations.capacity"
        ],
        "metrics": [
          "avg_bikes_available",
          "avg_ebikes_available",
          "avg_docks_available"
        ]
      },
      "dim_micromobility_stations": {
        "reachableDatasets": [
          "dim_micromobility_stations"
        ],
        "dimensions": [
          "dim_micromobility_stations.station_id",
          "dim_micromobility_stations.agency_id",
          "dim_micromobility_stations.name",
          "dim_micromobility_stations.latitude",
          "dim_micromobility_stations.longitude",
          "dim_micromobility_stations.capacity"
        ],
        "metrics": []
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.gtfs_stop_id"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name"
        ],
        "metrics": []
      }
    }
  },
  "surface_kinematics": {
    "factDatasets": [
      "vehicle_kinematics",
      "station_headways"
    ],
    "datasets": {
      "vehicle_kinematics": {
        "reachableDatasets": [
          "vehicle_kinematics",
          "dim_routes",
          "dim_stations"
        ],
        "dimensions": [
          "vehicle_kinematics.event_date",
          "vehicle_kinematics.event_time",
          "vehicle_kinematics.agency_id",
          "vehicle_kinematics.route_id",
          "vehicle_kinematics.trip_id",
          "vehicle_kinematics.station_id",
          "vehicle_kinematics.vehicle_id",
          "vehicle_kinematics.status",
          "vehicle_kinematics.latitude",
          "vehicle_kinematics.longitude",
          "vehicle_kinematics.bearing",
          "vehicle_kinematics.occupancy_status",
          "vehicle_kinematics.delta_time_sec",
          "vehicle_kinematics.step_distance_meters",
          "vehicle_kinematics.effective_speed_mps",
          "vehicle_kinematics.effective_speed_mph",
          "vehicle_kinematics.accel_mps2",
          "vehicle_kinematics.dwell_sec",
          "vehicle_kinematics.signal_delay_sec",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.gtfs_stop_id",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.is_accessible"
        ],
        "metrics": [
          "total_active_buses",
          "avg_surface_speed_mph",
          "total_corridor_dwell_sec"
        ]
      },
      "station_headways": {
        "reachableDatasets": [
          "station_headways",
          "dim_stations"
        ],
        "dimensions": [
          "station_headways.event_date",
          "station_headways.event_time",
          "station_headways.agency_id",
          "station_headways.route_id",
          "station_headways.trip_id",
          "station_headways.station_id",
          "station_headways.parent_station_id",
          "station_headways.headway_sec",
          "station_headways.headway_sec_squared",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.gtfs_stop_id",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.is_accessible"
        ],
        "metrics": [
          "avg_bus_headway_sec"
        ]
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.gtfs_stop_id",
          "dim_stations.latitude",
          "dim_stations.longitude",
          "dim_stations.is_accessible"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name",
          "dim_routes.color_hex",
          "dim_routes.type"
        ],
        "metrics": []
      }
    }
  },
  "unified_transit_network": {
    "factDatasets": [
      "station_hourly_summary",
      "schedule_adherence"
    ],
    "datasets": {
      "schedule_adherence": {
        "reachableDatasets": [
          "schedule_adherence",
          "dim_routes"
        ],
        "dimensions": [
          "schedule_adherence.event_date",
          "schedule_adherence.agency_id",
          "schedule_adherence.route_id",
          "schedule_adherence.service_hour",
          "schedule_adherence.scheduled_trips",
          "schedule_adherence.observed_trips",
          "schedule_adherence.service_completion_pct",
          "schedule_adherence.avg_observed_headway_sec",
          "schedule_adherence.active_alerts_count",
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name"
        ],
        "metrics": [
          "total_scheduled_trips",
          "total_observed_trips",
          "network_service_completion_pct"
        ]
      },
      "station_hourly_summary": {
        "reachableDatasets": [
          "station_hourly_summary",
          "dim_stations",
          "station_complexes"
        ],
        "dimensions": [
          "station_hourly_summary.event_date",
          "station_hourly_summary.agency_id",
          "station_hourly_summary.parent_station_id",
          "station_hourly_summary.service_hour",
          "station_hourly_summary.total_entries",
          "station_hourly_summary.total_exits",
          "station_hourly_summary.train_stops_count",
          "station_hourly_summary.distinct_vehicles",
          "station_hourly_summary.avg_headway_sec",
          "station_hourly_summary.station_alerts_count",
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.complex_id",
          "dim_stations.gtfs_stop_id",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name"
        ],
        "metrics": [
          "overall_system_throughput",
          "station_total_entries",
          "station_total_exits",
          "station_train_stops_count"
        ]
      },
      "dim_stations": {
        "reachableDatasets": [
          "dim_stations",
          "station_complexes"
        ],
        "dimensions": [
          "dim_stations.station_id",
          "dim_stations.agency_id",
          "dim_stations.name",
          "dim_stations.complex_id",
          "dim_stations.gtfs_stop_id",
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name"
        ],
        "metrics": []
      },
      "station_complexes": {
        "reachableDatasets": [
          "station_complexes"
        ],
        "dimensions": [
          "station_complexes.complex_id",
          "station_complexes.agency_id",
          "station_complexes.complex_name"
        ],
        "metrics": []
      },
      "dim_routes": {
        "reachableDatasets": [
          "dim_routes"
        ],
        "dimensions": [
          "dim_routes.route_id",
          "dim_routes.agency_id",
          "dim_routes.route_name"
        ],
        "metrics": []
      }
    }
  }
} as const;

export interface TypedOssieConfig<
  TTheme extends OssieThemeName = OssieThemeName,
  TFact extends string = string,
> {
  readonly theme: TTheme;
  readonly factDataset: TFact;
  readonly selectedMetrics: readonly string[];
  readonly selectedDimensions: readonly string[];
  readonly filters: readonly {
    readonly field: string;
    readonly operator: '=' | '!=' | 'IN' | 'BETWEEN' | '>' | '<' | '>=' | '<=';
    readonly value: string | number | readonly (string | number)[];
  }[];
  readonly limit?: number;
}
