---
name: straphanger-viz-mta-editorial
description: >-
  Design, build, and refine transit and BI data visualizations for StraphangerDB
  (NYC Transit Studio) using the default MTA light-mode editorial theme.
  Activate this skill when creating or modifying ECharts options, MapLibre
  layers, editorial cards, or SQL visualization queries for the default MTA
  editorial theme.
---

# StraphangerDB Visualization Skill: MTA Editorial Theme

This skill defines the visual design system, typographic hierarchy, geographic rules, SQL-to-chart data contracts, and chart-type specifications for the default **MTA Editorial Theme** in **NYC Transit Studio** (covering NYC Subway, MTA Bus, LIRR, Metro-North, PATH, NJ Transit, NYC Ferry, Roosevelt Island Tram, and Citi Bike).

---

## 1. Aesthetic & Editorial Philosophy

The default StraphangerDB theme blends three visual traditions:
1. **Editorial Data Cards**: Clean light-mode paper surfaces (`#FFFFFF` card canvas on `#F8FAFC` workspace background), subtle 1px borders (`#E2E8F0`), generous whitespace, understated dashed gridlines, and clear **Title -> Subtitle -> Chart Canvas -> Source/Byline Footer** framing.
2. **Infographic Corridor Storytelling**: Literary serif station/section typography (`Georgia`), vertical or horizontal **Borough Backdrop Bands** (`THE BRONX`, `MANHATTAN`, `QUEENS`, `BROOKLYN`), river-crossing divider annotations, and curated peak/trough callout badges instead of cluttered axis tick labels.
3. **Massimo Vignelli / Unimark 1970 MTA Signage Standards**: Authentic circular local and diamond express route bullets (`buildRouteBulletSvgDataUri` and `buildRouteBulletHtml`), official trunk line colors (`SUBWAY_TRUNK_COLORS`), and crisp high-contrast pill badges.

### Strict Visual Guardrails
- **Light Mode Only**: Never use dark backgrounds (`#0F172A`, `#1E293B`) for chart canvases or cards in this theme. Keep chart backgrounds `'transparent'` over `#FFFFFF` cards, with dark slate `#0F172A` only used for small high-contrast axisPointer coordinate pills.
- **No Emoji Icons in UI Chrome**: Always use crisp `1.75px`-stroke inline SVG icons in sidebars, toolbars, and chart selectors.
- **Never Render Raw GTFS IDs on Axes**: Always resolve station IDs (`621`, `701`, `127N`) to human-readable station names (`125 St`, `Flushing-Main St`, `Times Sq-42 St`) via SQL joins against `prod.transit_v2.view_dim_stations` or `resolveStationDisplay()`.
- **Do Not Arbitrarily Truncate Corridor Queries**: Never put `LIMIT 500` on unaggregated raw trip/event tables when building corridor or stringline charts, as this randomly drops stations and clips trajectories. Aggregate per station (`GROUP BY`) or filter to a coherent rush-hour time window (`EXTRACT(HOUR FROM event_time) = 12`).
- **Strict Source Footer (`Source: StraphangerDB`)**: Every notebook cell and editorial card footer (`sourceNote`) must say `'Source: StraphangerDB'` and nothing else.

---

## 2. Typography & Color Tokens

### Three-Tier Font Stack
| Role | Font Family | Weight & Usage |
|---|---|---|
| **Editorial Display & Station Labels** | `'Georgia', 'Times New Roman', serif` | Card titles (`18px-20px`, `700`), Marey Y-axis station names (`11px`), and peak/trough station callout names |
| **UI Chrome, Subtitles & Badges** | `'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif` | Subtitles (`13px`, `#475569`), MTA route bullets (`700`), borough band headers (`10px`, `800`, uppercase, `letter-spacing: 1.5px`), and legend labels |
| **Tabular Telemetry & Axes** | `'JetBrains Mono', 'Fira Code', monospace` | Numeric axes, timestamps (`8:14 AM`), headway values (`4m 15s`), speed (`18.4 mph`), and SQL editors (`font-variant-numeric: tabular-nums`) |

### Official MTA Trunk Palette & Shade Differentiation
Reference [`web/src/viz/echarts-theme-mta.ts`](../../web/src/viz/echarts-theme-mta.ts):
- **8th Ave (`A`, `C`, `E`) / SIR**: `#0039A6` (white text)
- **6th Ave (`B`, `D`, `F`, `FX`, `M`)**: `#FF6319` (white text)
- **Crosstown (`G`)**: `#6CBE45` (white text)
- **Nassau (`J`, `Z`)**: `#996633` (white text)
- **Canarsie (`L`)**: `#A7A9AC` (white text)
- **Broadway (`N`, `Q`, `R`, `W`)**: `#FCCC0A` (**black `#000000` text** for contrast)
- **7th Ave (`1`, `2`, `3`)**: `#EE352E` (white text)
- **Lexington Ave (`4`, `5`, `6`, `6X`, `<6>`)**: `#00933C` (white text)
- **Flushing (`7`, `7X`, `<7>`)**: `#B933AD` (white text)
- **2nd Ave (`T`)**: `#00ADD0` (white text)
- **Shuttles (`S`, `GS`, `FS`, `H`)**: `#808183` (white text)
- **Ambiguous Cross-Agency Fallback**: `#6E737B` (`NEUTRAL_SLATE_GREY` when bare numeric route `1`..`7` lacks `agency_id` and `color_hex`).

> [!TIP]
> **Shared Trunk Shade Differentiation**: When plotting multiple routes from the same trunk line on one chart (e.g., `4`, `5`, `6`, and `6X` all sharing `#00933C`), keep the authentic trunk color inside the MTA bullet SVG (`buildRouteBulletSvgDataUri`), but pass each route's series line color through `differentiateTrunkShade(trunkColor, occurrenceIndex)` so overlapping lines remain visually distinguishable.

### Borough Backdrop Tints (`BOROUGH_TINTS`)
Use subtle vertical (`station-progression`) or horizontal (`marey-chart`) `markArea` bands with dashed `#CBD5E1` river-crossing `markLine` dividers:
- **The Bronx (`THE BRONX`)**: Fill `rgba(241, 245, 249, 0.65)`, Label `#64748B`
- **Manhattan (`MANHATTAN`)**: Fill `rgba(254, 243, 199, 0.22)`, Label `#92400E`
- **Queens (`QUEENS`)**: Fill `rgba(243, 232, 255, 0.25)`, Label `#6B21A8`
- **Brooklyn (`BROOKLYN`)**: Fill `rgba(224, 242, 254, 0.30)`, Label `#0369A1`
- **Staten Island (`STATEN ISLAND`)**: Fill `rgba(220, 252, 231, 0.25)`, Label `#166534`

---

## 3. NYC Geography, Spatial Borough Joins, Corridor Ordering & SQL Gotchas

1. **Spatial Borough Polygon Joins (`prod.transit_v2.view_dim_boroughs`)**:
   - StraphangerDB includes official NYC DCP borough boundary polygons in `prod.transit_v2.view_dim_boroughs` (`boro_code`, `boro_name`, `geom_wkt`), and DuckDB-Wasm loads the `spatial` extension on boot.
   - Always determine station boroughs in SQL using `ST_Contains(ST_GeomFromText(b.geom_wkt), ST_Point(s.longitude, s.latitude))`:
     ```sql
     WITH borough_polys AS (
       SELECT boro_name, ST_GeomFromText(geom_wkt) AS geom
       FROM prod.transit_v2.view_dim_boroughs
     ),
     station_boroughs AS (
       SELECT s.agency_id, s.gtfs_stop_id, s.name, b.boro_name AS borough
       FROM prod.transit_v2.view_dim_stations s
       LEFT JOIN borough_polys b
         ON ST_Contains(b.geom, ST_Point(s.longitude, s.latitude))
       WHERE s.agency_id = 'MTA_NYCT_SUBWAY'
     )
     ```
   - Both `station-progression` and `marey-chart` prioritize an explicit `borough` / `boro_name` column from the query result before falling back to `inferNycSubwayBoroughFromStopId()`.
2. **NYCT `direction_id` Values**:
   - In `prod.transit_v2.view_station_headways`, `direction_id` is `'N'`, `'S'`, or `'ALL'` (matching NYCT GTFS-RT platform suffixes), **not** `'0'` or `'1'`.
   - Use `coalesce(h.direction_id, right(h.station_id, 1), 'S') != 'N'` (or `= 'N'`) to filter direction reliably.
3. **Multi-Branch & Crosstown Corridor Station Ordering (`1/2/3`, `4/5/6`, `G`, `F`, `7`)**:
   - **Never sort corridor stations purely by `latitude DESC`**:
     - On `1, 2, 3`, the `1` terminates at South Ferry (`142`, Manhattan) while `2, 3` cross into Brooklyn (`228..257`), and in the Bronx/Harlem the `1`, `2`, and `3` branches interleave by latitude. Sorting by latitude produces split `MANHATTAN -> BROOKLYN -> MANHATTAN` bands and zig-zagging lines.
     - On `4, 5, 6`, the `4` (`401..416`), `5` (`501..505`), and `6` (`601..619`) interleave by latitude in the Bronx, and in Lower Manhattan the `6` terminates at Brooklyn Bridge while `4, 5` continue into Brooklyn.
     - On `G` and `F`, lines run east-west and curve across Queens, Manhattan, and Brooklyn.
   - **Canonical Ordering Rule**:
     - Group stations into contiguous borough blocks (`THE BRONX -> MANHATTAN -> QUEENS -> BROOKLYN`) and sort stations within each borough block by **GTFS stop ID prefix and numeric stop sequence** (`parseGtfsStopKey`, e.g., `101..142`, `201..257`, `601..640`, `701..726`, `G22..G36`).
     - In `marey-chart`, iteratively stitch trip sequences by maximum station overlap and sort each contiguous borough run monotonically by GTFS `station_id` prefix so even short time windows never scramble stations.
4. **Contiguous 6-Hour Window Selection (`hourly_coverage` + `latest_window`)**:
   - Never use a bare `max(event_time) - INTERVAL '6 hours'` filter on `view_station_headways` for stringline charts: if telemetry just resumed after an overnight gap, that 6-hour lookback may only contain 4 minutes of rows, and if run in the evening it will miss morning-rush diamond express service (`<7>` / `7X`, `<6>` / `6X`).
   - Always select a contiguous 6-hour window with `>= 5` populated hours (`HAVING count(*) >= 500` per hour), preferring the morning rush window ending at `11:00` EDT (`06:00 AM` to `12:00 PM` EDT).

---

## 4. Universal SQL Display & Measure Override Contract

Visualizations must never hardcode "seconds" as the only supported unit. Both `station-progression` and `marey-chart` auto-detect numeric measure columns and honor optional SQL display columns:

| Column Role | Supported Column Names | Behavior |
|---|---|---|
| **Numeric Measure** | `avg_headway_sec`, `headway_sec`, `effective_speed_mph`, `leg_speed_mps`, `service_completion_pct`, `passenger_count`, `total_entries`, `total_exits`, `dwell_sec`, `travel_time_sec`, `ridership`, `revenue`, `income`, `median_income`, `value`, `measure`, `metric_value`, `amount`, or any numeric non-ID column | Drives continuous Y-axis / X-axis coordinates and peak/trough detection |
| **Formatted Value Override** | `display_value`, `formatted_value`, `measure_display`, `value_label`, `<metric>_display`, `<metric>_formatted` | Overrides the formatted number in tooltips and peak/trough callout badges (e.g., `'4m 15s'`, `'$12,450'`, `'94.2%'`, `'18.4 mph'`) |
| **Measure Title Override** | `measure_label`, `metric_label`, `y_axis_label`, `axis_label` | Overrides the Y-axis header and tooltip metric label (e.g., `'Observed Headway'`, `'Median Household Income'`) |
| **Measure Unit Override** | `measure_unit`, `unit`, `value_unit` | Formats axis ticks and numbers (`'$'`/`'USD'`, `'%'`, `'mph'`, `'sec'`, `'riders'`) |
| **Entity Label Overrides** | `station_label` / `display_label`, `route_label` / `line_label` | Overrides station name or route display name in legends and tooltips |

---

## 5. Guide to Chart Types in NYC Transit Studio

### A. Specialized Transit Visuals (`web/src/viz/transit/`)

#### 1. Station Progression Profile (`station-progression`)
- **Implementation**: [`web/src/viz/transit/station-progression.ts`](../../web/src/viz/transit/station-progression.ts)
- **Visual Inspiration**: Editorial subway corridor profiles.
- **Required Columns**: `route_id`, station identifier/name (`station_name`, `name`, `station_id`, `parent_station_id`), and any numeric measure column.
- **Key Design Features**:
  - **Clean X-Axis**: `axisLabel.show = false` by default (`showStationLabels: false`) so 30+ station names do not collide into a wall of rotated text. A subtle caption (`"Stations ordered along corridor - Hover any stop for details"`) sits below the axis.
  - **Vertical Borough Bands**: `markArea` backdrops with uppercase borough headers (`THE BRONX`, `MANHATTAN`, `BROOKLYN`) at the top of the plot and dashed vertical river-crossing `markLine`s.
  - **Authentic MTA Bullets**: Used in `legend.data[].icon` (`itemWidth: 20, itemHeight: 20`) and placed as `22px` `markPoint` badges at the start and end terminals of each route trace.
  - **Curated Peak & Trough Callouts**: Automatically annotates the global corridor maximum and minimum stations with rich-text pill badges (`{station|Grand Central-42 St}\n{val|4m 15s}`).

#### 2. Marey Stringline Diagram (`marey-chart`)
- **Implementation**: [`web/src/viz/transit/marey-chart.ts`](../../web/src/viz/transit/marey-chart.ts)
- **Visual Inspiration**: E.J. Marey's classic train schedule graph + Philippe Vibien's NYC Subway Stringline (`pvibien.com/stringline`) with editorial serif typography.
- **Required Columns**: `trip_id`, timestamp (`event_time`, `arrival_time`, `departure_time`), and station (`station_name`, `name`, `station_id`, `parent_station_id`, or leg pairs `from_station_id` + `to_station_id`).
- **Key Design Features**:
  - **Axes**: X-axis is Eastern Time (`America/New_York`) with both bottom primary ticks (`8:15 AM`) and top secondary mirror axis; Y-axis is topological station order (`inverse: true`, origin at top, `Georgia` serif station labels on the left).
  - **Route-Grouped MTA Bullet Legend**: All trips on the same `routeId` share `series.name = routeId`. `legend.data` contains one entry per route with `icon: buildRouteBulletSvgDataUri(...)`, so clicking a route bullet toggles all trajectories for that line.
  - **Spaced Origin MTA Bullet Badges**: Places `18px` MTA bullet `markPoint`s on the first stop of spaced trips along the time axis so lines are identifiable directly on the canvas without clutter.
  - **Station Dwell Steps**: When both `arrival_time` and `departure_time` (or `dwell_sec >= 15`) are present, plots `[arrivalTime, yIdx]` followed by `[departureTime, yIdx]` to render horizontal dwell plateaus at stations.
  - **Interactive Zoom & Crosshair**: Includes `dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }]` and `tooltip.axisPointer: { type: 'cross' }` with high-contrast dark coordinate pills.

#### 3. Headway Horizon / Bunching Distribution (`headway-horizon`)
- **Implementation**: [`web/src/viz/transit/headway-horizon.ts`](../../web/src/viz/transit/headway-horizon.ts)
- **Required Columns**: `route_id` and `headway_sec` (or `avg_headway_sec`, `headway_sec_squared`). Optional `event_time`, `station_name`.
- **Key Design Features**:
  - **Authentic MTA Route Bullets**: Legend renders official route bullets (`buildRouteBulletSvgDataUri`) and rich tooltips show inline badges (`buildRouteBulletHtml`) with tabular timing and high-contrast BUNCHED / GAPPED tags.
  - **Plain-English Rider Copy**: Replaces abstract data jargon with intuitive transit phrasing: "Wait Between Trains" (Y-axis), "Bunched (< 2m · Nose-to-tail)", and "Gapped (> 15m · Long wait)".
  - **Single-Checkpoint Guidance**: In transit lakehouses, querying a whole corridor without a station filter returns simultaneous arrivals across all stations, causing multiple same-route points at the same timestamp. Queries should filter to a canonical merge checkpoint (such as Queens Plaza `h.parent_station_id = 'G21'`) to measure true alternating cadence. Tooltips attach `at {stationName}` when present.
  - **Adaptive Scale (`yAxisScale: 'auto' | 'log' | 'linear'`)**: Automatically selects `'log'` scale when variance is high (`maxHeadway / gappingThreshold >= 3` or `maxHeadway >= 2700s`, e.g. overnight service resumption on R/M) so gapping (> 15 min) and bunching (< 2 min) lines remain prominent and daytime variation is not compressed to the baseline, while retaining standard `'linear'` scale for low-variance lines (e.g. 7 vs 7X).
  - **Non-Overlapping Collision Guardrail**: Bunching threshold line (`#DC2626`) places its label at `position: 'insideStartBottom'` on the left; gapping threshold line (`#7C3AED`) places its label at `position: 'insideEndTop'` on the right. Threshold lines are rendered only on the primary series to prevent duplicate rendering.
  - **Zone Highlights**: Subtle `markArea` tints under the bunching threshold (`rgba(220, 38, 38, 0.04)`) and above the gapping threshold (`rgba(124, 58, 237, 0.035)`).
  - **Dual Inside DataZoom**: Enables scroll and pinch zooming on both time and headway axes.
  - **Categorical Fallback**: When `event_time` is absent, groups observations into binned distribution bars (`< 2m (Bunched)`, `2-4m`, `4-6m`, `6-8m`, `8-12m`, `> 12m (Gapped)`) with route-colored columns and bullet legend.

#### 4. Schedule Adherence Waterfall (`adherence-waterfall`)
- **Implementation**: [`web/src/viz/transit/adherence-waterfall.ts`](../../web/src/viz/transit/adherence-waterfall.ts)
- **Required Columns**: `scheduled_trips_count`, `observed_trips_count` (optional `ghost_trips_count`, `unscheduled_trips_count`, `route_id`).
- **Design**: 4-step stacked waterfall (`Scheduled` in MTA Blue `#0039A6` -> `Ghost / Missing` drop in Red `#D82222` -> `Unscheduled Added` rise in Green `#00933C` -> `Observed` net bar in MTA Orange `#FF6319`) with top value labels and completion percentage headline.
- **Critical SQL Rules**:
  - **Deduplicate `service_id`**: `fact_schedules` contains `Weekday`, `Saturday`, `Sunday`, and supplemental schedules simultaneously. Extract `regexp_extract(trip_id, '^([^_]+)', 1) AS service_id` and `run_id`, count distinct `run_id` per `(agency_id, route_id, service_id, hour_of_day)`, and take `MAX(scheduled_trips)` across `service_id` per hour.
  - **Use 2-Day Schedule Lookback**: Filter `fact_schedules` with `WHERE event_date >= CURRENT_DATE - INTERVAL '2 days'` so UTC/EDT ingestion partition boundaries never drop routes (`N`, `Q`, `R`, `W`, `7`, `L`), while filtering `fact_vehicle_positions` to the full 24-hour yesterday partition (`WHERE event_date = CURRENT_DATE - INTERVAL '1 day'`).

#### 5. Multimodal Transfer Pulse (`multimodal-pulse`)
- **Implementation**: [`web/src/viz/transit/multimodal-pulse.ts`](../../web/src/viz/transit/multimodal-pulse.ts)
- **Required Columns**: `station_id`/`complex_id`, turnstile flow (`entry_count`, `exit_count`, `total_entries`, `total_exits`), and Citi Bike availability (`num_bikes_available`, `num_docks_available`, `num_ebikes_available`).
- **Design**: Dual-axis correlation pairing subway turnstile entries/exits with adjacent micromobility dock/e-bike depletion over time or across station complexes.
- **Critical SQL Rule**: `fact_turnstile_flows` (MTA Hourly Ridership) only populates `entry_count` (`exit_count` is `0`). Only query and plot Subway Entries (`total_entries`) alongside Citi Bike Available Bikes, Available E-Bikes, and Empty Docks.

#### 6. Origin-Destination Ridership Sankey (`od-ridership-flow`)
- **Implementation**: [`web/src/viz/transit/od-ridership-flow.ts`](../../web/src/viz/transit/od-ridership-flow.ts)
- **Required Columns**: `origin_station_id` (or `from_station_id`), `destination_station_id` (or `to_station_id`), and `passenger_count`.
- **Design**: ECharts `sankey` flow diagram connecting origin stations/boroughs to destination stations/boroughs with smooth curveness and human-readable station names.
- **Critical SQL Rules**:
  - **DuckDB `GROUP BY` Aggregate Guardrail**: Never put `CASE WHEN ... ELSE any_value(c.complex_name) END` directly inside a `GROUP BY` clause (throws `Binder Error: GROUP BY clause cannot contain aggregates!`). Map `origin_hub` and `destination_hub` inside an inner subquery/CTE first, then `GROUP BY origin_hub, destination_hub` in the outer query and filter `WHERE origin_hub != destination_hub`.
  - **Multi-Complex Hub Consolidation & Sample Scaling**: Consolidate multi-division complexes for major hubs (e.g., Penn Station `complex_id IN ('611', '610', '164')`) and scale the 2-hour daily `fact_od_ridership` sample by `12.0` (`ROUND(SUM(estimated_trips) * 12.0)`) to represent full daily passenger volumes.

### B. MapLibre Geospatial Transit Visuals (`web/src/viz/map/` & `web/src/viz/transit/`)

All three geospatial chart types share `DbtcMapController` ([`web/src/viz/map/maplibre-controller.ts`](../../web/src/viz/map/maplibre-controller.ts)), which includes the schematic track-map base style, a **Tilt 29 deg** button aligning the viewport with the Manhattan street grid, and an **Allmaps IIIF** historical map overlay selector:

1. **Route Segment Map (`route-segment-map`)**: Colors inter-station track segments by `leg_speed_mps`, `effective_speed_mph`, or `headway_sec` using official route colors or diverging speed scales.
2. **Isochrone Travel-Time Map (`isochrone-map`)**: Plots reachable stations and travel-time contours (`travel_time_sec` / `leg_travel_time_sec`) radiating from an interactive origin station (`onSelectStation` updates `cell.params.origin_station_id` and re-runs the DuckDB query).
3. **Live Train Position Map (`train-position-map`)**: Plots real-time vehicle coordinates (`vehicle_id`/`trip_id`, `latitude`, `longitude`, `bearing`, `event_time`) with route-colored markers.

### C. Standard BI Chart Types (`web/src/viz/standard-bi.ts`)

All standard BI charts inherit the `mta-modern` ECharts theme ([`web/src/viz/echarts-theme-mta.ts`](../../web/src/viz/echarts-theme-mta.ts)) with MTA categorical palette colors, clean `#E5E7EB` horizontal splitLines, and hidden vertical axis lines:
- **`bar` / `stacked-bar`**: `barMaxWidth: 36`, rounded top corners (`borderRadius: [3, 3, 0, 0]`), shadow axis pointer.
- **`line` / `area` / `stacked-area`**: Smooth `2.5px` strokes, `6px` circle symbols, `0.16` area opacity.
- **`scatter`**: Two-dimensional continuous X/Y numeric comparison.
- **`pie` / `donut`**: Proportional breakdown (`donut` uses `radius: ['45%', '70%']`).
- **`choropleth-borough`**: Horizontal bar comparison across the five NYC boroughs (`#0039A6`).
- **`radar` / `treemap` / `funnel` / `gauge`**: Specialized multi-metric and hierarchical breakdowns.
- **`kpi-metric` & `table`**: Clean HTML renderers with tabular numerals, automatic epoch timestamp formatting, and 1,000-row DOM virtualization safety caps.

---

## 6. Verification Checklist When Authoring or Modifying Visuals

1. **Schema Contract Sync**: If adding new accepted column aliases, update both `TILE_CONTRACTS` in [`web/src/types/schema-contracts.ts`](../../web/src/types/schema-contracts.ts) and the LLM prompt generator `buildLlmSystemPrompt()` in [`web/src/ui/data-uploads-view.ts`](../../web/src/ui/data-uploads-view.ts).
2. **Unit & Typecheck Suite**: Run `npm --prefix web test` to verify zero-drift schema generation, TypeScript compilation (`tsc --noEmit`), and all Vitest suites (`station-progression.test.ts`, `marey-chart.test.ts`, `starter-queries.typecheck.test.ts`).
3. **Production & Bento Builds**: Run `npm --prefix web run build` to regenerate both `web/dist/pages/index.html` and the single-file Bento bundle `web/dist/bento/index.html`.
