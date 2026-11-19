---
name: straphanger-ossie
description: Query production multi-agency transit lakehouse data and Apache Ossie semantic models using DuckDB and the duckdb-ossie community extension.
---

# StraphangerDB & Apache Ossie Semantic Lakehouse Skill

This skill guides data analysts, engineers, and AI agents querying StraphangerDB's multi-agency transit lakehouse via DuckDB. StraphangerDB ingests and synthesizes real-time feeds and static GTFS schedules across MTA New York City Subway, MTA Bus, Long Island Rail Road (LIRR), Metro-North Railroad (MNR), Staten Island Railway (SIR), PATH, NJ Transit (NJT), NYC Ferry, Roosevelt Island Tram, and Citi Bike GBFS.

---

## 1. Architecture & Endpoints

StraphangerDB publishes lakehouse catalogs, metadata, and Apache Ossie semantic models via Cloudflare R2 and high-speed public CDN caching:

| Asset | Public CDN URL | Cloud Run Origin Endpoint |
|---|---|---|
| **Public CDN Base** | `https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev` | `https://straphanger-prod-197171439775.us-central1.run.app` |
| **DuckLake Catalog** | `https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ducklake/catalog.db` | - |
| **Ossie Index** | `https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/index.json` | `/ossie/index.json` |
| **DuckLake Models** | `https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/<theme>.ossie.yaml` | `/ossie/ducklake/<theme>.ossie.yaml` |
| **Iceberg Models** | `https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/iceberg/<theme>.ossie.yaml` | `/ossie/iceberg/<theme>.ossie.yaml` |

Available Themes:
- `rail_operations`
- `surface_kinematics`
- `network_accessibility_and_demand`
- `service_reliability_and_micromobility`
- `unified_transit_network`

---

## 2. DuckDB Initialization & Extension Setup

To initialize DuckDB with DuckLake and the Apache Ossie Community Extension:

```sql
-- 1. Install and load network and lakehouse extensions
INSTALL httpfs;
LOAD httpfs;

INSTALL ducklake;
LOAD ducklake;

-- 2. Install and load Apache Ossie community extension
INSTALL ossie FROM community;
LOAD ossie;

-- Ensure standard ETag validation remains enabled for cache integrity
SET unsafe_disable_etag_checks = false;

-- 3. Attach the public DuckLake catalog
ATTACH 'ducklake:https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ducklake/catalog.db' AS prod;
```

---

## 3. Using Apache Ossie Functions

The `duckdb-ossie` extension provides native catalog reflection, semantic metric queries, and SQL compilation:

### Loading Semantic Models
```sql
-- Load a semantic model definition from CDN (enable allow_filter_functions if using SQL functions in filters)
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/rail_operations.ossie.yaml', allow_filter_functions => true);

-- Inspect available datasets and entities in the model
CALL ossie_datasets();

-- Inspect available semantic fields
CALL ossie_fields();

-- Inspect semantic metrics defined on the model
CALL ossie_metrics();

-- Inspect relationship join graph
CALL ossie_relationships();
```

### Function Signatures & Syntax
`duckdb-ossie` uses list/array argument syntax: `([metrics], [dimensions], [filters])`.

- **`ossie_compile([metrics], [dimensions], [filters]) -> VARCHAR`**: Scalar function returning the compiled SQL query.
- **`ossie_query([metrics], [dimensions], [filters])`**: Table function executing the compiled query directly (`SELECT * FROM ossie_query(...)`).

> [!IMPORTANT]
> **Date Filters Must Use String Literals**: In `ossie_query` filter arguments, always provide quoted date string literals like `'station_headways.event_date >= ''2026-10-26'''` or `'turnstile_flows.event_date >= ''2026-10-20'''`. Do not use unquoted SQL functions like `CURRENT_DATE` inside the filter string, because `duckdb-ossie`'s internal expression parser treats unquoted tokens as dataset field identifiers.

```sql
-- 1. Compile high-level semantic query into optimized SQL with partition filter
SELECT ossie_compile(
    ['network_avg_headway_sec', 'total_train_runs'],
    ['dim_routes.route_name', 'station_headways.direction_id'],
    ['station_headways.event_date >= ''2026-10-26''']
);

-- 2. Execute semantic metric query directly via ossie_query table function
SELECT * FROM ossie_query(
    ['network_avg_headway_sec', 'total_train_runs'],
    ['dim_routes.route_name', 'station_headways.direction_id'],
    ['station_headways.event_date >= ''2026-10-26''']
);

-- 3. Query system throughput from unified transit model (always filter by event_date)
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/unified_transit_network.ossie.yaml', allow_filter_functions => true);
SELECT * FROM ossie_query(
    ['overall_system_throughput'],
    ['dim_stations.name'],
    ['station_hourly_summary.event_date >= ''2026-10-01''']
);
```

### Multi-CTE Cross-Fact Join Pattern
When combining metrics across unjoined fact tables (e.g. Turnstiles + Headways + Disruptions), run individual `ossie_query` calls inside CTEs and join on shared dimensions. **Always include partition date filters in every CTE**:

```sql
WITH headways AS (
    SELECT "dim_stations.name" AS station_name, network_avg_headway_sec
    FROM ossie_query(
        ['network_avg_headway_sec'], 
        ['dim_stations.name'], 
        ['station_headways.event_date >= ''2026-10-26''']
    )
),
turnstiles AS (
    SELECT "dim_stations.name" AS station_name, overall_system_throughput
    FROM ossie_query(
        ['overall_system_throughput'], 
        ['dim_stations.name'], 
        ['station_hourly_summary.event_date >= ''2026-10-01''']
    )
)
SELECT 
    h.station_name,
    h.network_avg_headway_sec,
    t.overall_system_throughput
FROM headways h
JOIN turnstiles t USING (station_name)
ORDER BY t.overall_system_throughput DESC;
```

---

## 4. When to Use `ossie_query` vs. Raw SQL on DuckLake Views

StraphangerDB provides two complementary query interfaces:

| Capability | Apache Ossie (`ossie_query`) | Raw SQL on DuckLake Views |
|---|---|---|
| **Best Used For** | Standard metric aggregations, dimension rollups, cross-fact joins without `JOIN` boilerplate | Complex statistical moments, post-aggregation `HAVING`, window-over-aggregates, asymmetric self-joins |
| **Date Partition Filtering** | Via filter list: `['<dataset>.event_date >= ''YYYY-MM-DD''']` | Via SQL `WHERE event_date >= CURRENT_DATE - INTERVAL 'N days'` |
| **Dimension Joins** | Automatic resolution via declared relationships | Explicit SQL `JOIN` on composite primary keys |
| **Window Functions** | Pre-computed inside views or requires outer SQL wrapper | Native SQL `OVER (PARTITION BY ... ORDER BY ...)` |
| **Asymmetric Self-Joins** | Not supported (single relationship per target entity) | Fully supported (e.g. `s_from` and `s_to` joining `dim_stations`) |

---

## 5. Analytical Query Recipes

### Recipe 1: Rail Headway Variability & Bunching Analysis

#### Semantic Layer Approach (`ossie_query`)
Queries average headway and trip volume across routes and directions:
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/rail_operations.ossie.yaml');

SELECT * FROM ossie_query(
    ['network_avg_headway_sec', 'total_train_runs'],
    ['dim_routes.route_name', 'station_headways.direction_id'],
    ['station_headways.event_date >= ''2026-10-26''']
)
ORDER BY total_train_runs DESC
LIMIT 20;
```

#### Advanced Statistical SQL Approach (DuckLake Views)
Identifies platforms experiencing excessive headway variance (bunching or gaps) using headway squares and `HAVING COUNT(*) >= 10`:
```sql
SELECT 
    r.route_name,
    h.direction_id,
    s.name AS station_name,
    COUNT(*) AS observed_trains,
    ROUND(AVG(h.headway_sec) / 60.0, 1) AS avg_headway_minutes,
    ROUND(MEDIAN(h.headway_sec) / 60.0, 1) AS median_headway_minutes,
    ROUND(SQRT(NULLIF(AVG(h.headway_sec_squared) - POWER(AVG(h.headway_sec), 2), 0)) / 60.0, 1) AS stddev_headway_minutes
FROM prod.transit_v2.view_station_headways h
JOIN prod.transit_v2.view_dim_stations s 
    ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id
JOIN prod.transit_v2.view_dim_routes r 
    ON h.route_id = r.route_id AND h.agency_id = r.agency_id
WHERE h.event_date >= CURRENT_DATE - INTERVAL '1 day'
  AND h.headway_sec > 60 AND h.headway_sec < 3600
GROUP BY r.route_name, h.direction_id, s.name
HAVING COUNT(*) >= 10
ORDER BY stddev_headway_minutes DESC
LIMIT 20;
```

### Recipe 2: Inter-Station Travel Time, Stop Spacing & Link Velocity Profiling

#### Semantic Layer Approach (`ossie_query`)
Queries average stop-to-stop distance (meters), travel time, and link speed by route (highlighting super-expresses like the `E`, `F Express`, and `A` lines as well as commuter rail branches):
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/rail_operations.ossie.yaml');

SELECT * FROM ossie_query(
    ['avg_leg_distance_meters', 'avg_leg_travel_time_sec', 'avg_leg_speed_mps'],
    ['dim_routes.route_name'],
    ['station_to_station_legs.event_date >= ''2026-10-26''', 'station_to_station_legs.agency_id = ''MTA_NYCT_SUBWAY''']
)
ORDER BY avg_leg_distance_meters DESC
LIMIT 20;
```

#### Asymmetric Origin-Destination SQL Approach (DuckLake Views)
Measures actual transit leg durations, distance, and speed between specific `(from_station, to_station)` pairs.
*(Note: Requires Raw SQL when resolving both `from_station` and `to_station` names simultaneously, as semantic graph models allow a single relationship path between two datasets to avoid diamond cycles.)*

```sql
SELECT 
    l.route_name,
    s_from.name AS from_station,
    s_to.name AS to_station,
    COUNT(*) AS trip_observations,
    ROUND(AVG(l.leg_distance_meters) / 1000.0, 2) AS distance_km,
    ROUND(AVG(l.leg_travel_time_sec) / 60.0, 1) AS avg_travel_min,
    ROUND(AVG(l.leg_speed_mps) * 2.23694, 1) AS avg_speed_mph
FROM prod.transit_v2.view_station_to_station_legs l
JOIN prod.transit_v2.view_dim_stations s_from 
    ON l.from_station_id = s_from.gtfs_stop_id AND l.agency_id = s_from.agency_id
JOIN prod.transit_v2.view_dim_stations s_to 
    ON l.to_station_id = s_to.gtfs_stop_id AND l.agency_id = s_to.agency_id
WHERE l.event_date >= CURRENT_DATE - INTERVAL '2 days'
  AND l.leg_travel_time_sec BETWEEN 20 AND 1800
GROUP BY l.route_name, s_from.name, s_to.name
ORDER BY trip_observations DESC
LIMIT 25;
```

### Recipe 3: Real-Time Bus Kinematics & Traffic Delay Detection

#### Semantic Layer Approach (`ossie_query`)
Queries active surface vehicles, average corridor speed, and total stop dwell time by route:
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/surface_kinematics.ossie.yaml');

SELECT * FROM ossie_query(
    ['total_active_buses', 'avg_surface_speed_mph', 'total_corridor_dwell_sec'],
    ['dim_routes.route_name'],
    ['vehicle_kinematics.event_date >= ''2026-10-26''']
)
ORDER BY total_active_buses DESC
LIMIT 20;
```

#### Advanced Telemetry SQL Approach (DuckLake Views)
Analyzes bus telemetry to highlight street corridors suffering from high signal delays vs passenger dwell times:

```sql
SELECT 
    r.route_name,
    k.vehicle_id,
    ROUND(AVG(k.effective_speed_mph), 1) AS avg_speed_mph,
    ROUND(MAX(k.effective_speed_mph), 1) AS max_speed_mph,
    ROUND(SUM(k.dwell_sec) / 60.0, 1) AS total_dwell_minutes,
    ROUND(SUM(k.signal_delay_sec) / 60.0, 1) AS total_traffic_delay_minutes
FROM prod.transit_v2.view_vehicle_kinematics k
JOIN prod.transit_v2.view_dim_routes r 
    ON k.route_id = r.route_id AND k.agency_id = r.agency_id
WHERE k.event_date >= CURRENT_DATE - INTERVAL '1 day'
  AND k.agency_id IN ('MTA_BUS', 'NJT_BUS')
GROUP BY r.route_name, k.vehicle_id
ORDER BY total_traffic_delay_minutes DESC
LIMIT 20;
```

### Recipe 4: Turnstile Flow & Fare Gate Demand by Payment Method

#### Semantic Layer Approach (`ossie_query`)
Queries aggregated turnstile entries, exits, and net passenger flow by station complex:
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/network_accessibility_and_demand.ossie.yaml', allow_filter_functions => true);

SELECT * FROM ossie_query(
    ['network_turnstile_entries', 'total_exits', 'net_flow'],
    ['station_complexes.complex_name'],
    ['turnstile_flows.event_date >= ''2026-10-01''']
)
ORDER BY network_turnstile_entries DESC
LIMIT 30;
```

#### Advanced Window-over-Aggregate SQL Approach (DuckLake Views)
Compares OMNY contactless adoption against legacy MetroCard swipes across major station complexes with percentage share across complexes:
*(Note: Requires Raw SQL because `SUM(...) OVER (PARTITION BY complex_name)` is an analytic window function evaluated over group-by aggregates.)*

```sql
SELECT 
    c.complex_name,
    tf.payment_method,
    tf.fare_class_category,
    SUM(tf.entry_count) AS total_entries,
    SUM(tf.exit_count) AS total_exits,
    ROUND(SUM(tf.entry_count) * 100.0 / SUM(SUM(tf.entry_count)) OVER (PARTITION BY c.complex_name), 2) AS entry_pct_share
FROM prod.transit_v2.view_turnstile_flows tf
JOIN prod.transit_v2.view_station_complexes c 
    ON tf.station_id = c.complex_id AND tf.agency_id = c.agency_id
WHERE tf.event_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY c.complex_name, tf.payment_method, tf.fare_class_category
ORDER BY total_entries DESC
LIMIT 30;
```

### Recipe 5: Service Disruption Impact & Affected Routes/Stations

#### Semantic Layer Approach (`ossie_query`)
Queries route alert counts automatically joined to commercial route names:
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/service_reliability_and_micromobility.ossie.yaml');

SELECT * FROM ossie_query(
    ['route_alerts_count'],
    ['dim_routes.route_name'],
    ['alert_routes.event_date >= ''2026-10-20''']
)
ORDER BY route_alerts_count DESC
LIMIT 20;
```

#### Advanced Lifecycle SQL Approach (DuckLake Views)
Surfaces active system disruptions with detection timestamps and cause/effect breakdowns:
```sql
SELECT 
    r.route_name,
    ar.cause,
    ar.effect,
    ar.severity,
    COUNT(DISTINCT ar.alert_id) AS distinct_alerts,
    MIN(ar.detected_at) AS first_detected,
    MAX(ar.last_seen_at) AS last_detected
FROM prod.transit_v2.view_alert_routes ar
JOIN prod.transit_v2.view_dim_routes r 
    ON ar.route_id = r.route_id AND ar.agency_id = r.agency_id
WHERE ar.event_date >= CURRENT_DATE - INTERVAL '1 day'
  AND ar.removed_at IS NULL
GROUP BY r.route_name, ar.cause, ar.effect, ar.severity
ORDER BY distinct_alerts DESC;
```

### Recipe 6: End-to-End Schedule Adherence & Service Delivery

#### Semantic Layer Approach (`ossie_query`)
Queries scheduled vs observed trips and overall service completion percentage by route:
```sql
CALL ossie_load('https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ossie/ducklake/unified_transit_network.ossie.yaml');

SELECT * FROM ossie_query(
    ['total_scheduled_trips', 'total_observed_trips', 'network_service_completion_pct'],
    ['dim_routes.route_name'],
    ['schedule_adherence.event_date >= ''2026-10-26''']
)
ORDER BY total_scheduled_trips DESC
LIMIT 25;
```

#### Hourly Bridge View SQL Approach (DuckLake Views)
Calculates the hourly ratio of observed trains/buses delivered vs timetable GTFS schedules using the multi-fact bridge view:

```sql
SELECT 
    sa.service_hour,
    r.route_name,
    sa.scheduled_trips,
    sa.observed_trips,
    sa.service_completion_pct,
    ROUND(sa.avg_observed_headway_sec / 60.0, 1) AS avg_headway_min,
    sa.active_alerts_count
FROM prod.transit_v2.view_schedule_adherence sa
JOIN prod.transit_v2.view_dim_routes r 
    ON sa.route_id = r.route_id AND sa.agency_id = r.agency_id
WHERE sa.event_date >= CURRENT_DATE - INTERVAL '2 days'
  AND sa.scheduled_trips > 0
ORDER BY sa.service_hour DESC, sa.service_completion_pct ASC
LIMIT 30;
```
