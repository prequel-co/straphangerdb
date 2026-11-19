package schema

import "fmt"

// GetBootstrapDDLWithCatalog returns DDL statements for creating tables under a specific catalog and versioned schema.
// When targeting an Iceberg catalog, fact tables are configured with PARTITIONED BY (event_date),
// raw_payload uses VARCHAR (Iceberg v2 compatible), and PRIMARY KEY / VIEW / COMMENT statements are omitted.
// When targeting a DuckLake catalog, PRIMARY KEY constraints are omitted as they are not supported by DuckLake.
func GetBootstrapDDLWithCatalog(catalog, version string) []string {
	schemaPrefix := version
	isIceberg := false
	includePK := true
	if catalog != "" {
		schemaPrefix = fmt.Sprintf("%s.%s", catalog, version)
		if catalog == "iceberg" || catalog == "straphanger" || catalog == "straphanger_db" {
			isIceberg = true
			includePK = false
		}
		if catalog == "ducklake" {
			includePK = false
		}
	}
	return GetBootstrapDDLInternal(schemaPrefix, isIceberg, includePK)
}

// GetBootstrapDDL returns standard DDL statements for creating all generic transit tables under the versioned schema.
func GetBootstrapDDL(version string) []string {
	return GetBootstrapDDLInternal(version, false, true)
}

// GetBootstrapDDLInternal returns the DDL statements with optional OTF partitioning and optional primary keys.
func GetBootstrapDDLInternal(version string, isOTF bool, includePK bool) []string {
	factPartitionClause := ""
	payloadType := "VARIANT"
	if isOTF {
		factPartitionClause = " PARTITIONED BY (event_date)"
		payloadType = "VARCHAR"
	}

	dimStationsPK := ""
	if includePK {
		dimStationsPK = ",\n\t\t\tPRIMARY KEY (station_id, agency_id, valid_from)"
	}

	dimRoutesPK := ""
	if includePK {
		dimRoutesPK = ",\n\t\t\tPRIMARY KEY (route_id, agency_id, valid_from)"
	}

	dimMicroStationsPK := ""
	if includePK {
		dimMicroStationsPK = ",\n\t\t\tPRIMARY KEY (station_id, agency_id, valid_from)"
	}

	dimBoroughsPK := ""
	if includePK {
		dimBoroughsPK = ",\n\t\t\tPRIMARY KEY (boro_code, valid_from)"
	}

	dimServiceLinesPK := ""
	if includePK {
		dimServiceLinesPK = ",\n\t\t\tPRIMARY KEY (agency_id, route_id, valid_from)"
	}

	ddls := []string{
		fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s;", version),

		// 1. dim_stations (SCD Type II)
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.dim_stations (
			station_id VARCHAR NOT NULL,
			agency_id VARCHAR NOT NULL,
			name VARCHAR NOT NULL,
			latitude DOUBLE,
			longitude DOUBLE,
			gtfs_stop_id VARCHAR,
			complex_id VARCHAR,
			daytime_routes VARCHAR,
			structure VARCHAR,
			is_accessible BOOLEAN,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_to TIMESTAMPTZ,
			is_current BOOLEAN,
			raw_payload %s%s
		);`, version, payloadType, dimStationsPK),

		// 2. dim_routes (SCD Type II)
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.dim_routes (
			route_id VARCHAR NOT NULL,
			agency_id VARCHAR NOT NULL,
			route_name VARCHAR NOT NULL,
			color_hex VARCHAR,
			type VARCHAR NOT NULL,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_to TIMESTAMPTZ,
			is_current BOOLEAN,
			raw_payload %s%s
		);`, version, payloadType, dimRoutesPK),

		// 3. fact_schedules
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_schedules (
			event_date DATE NOT NULL,
			agency_id VARCHAR NOT NULL,
			route_id VARCHAR NOT NULL,
			station_id VARCHAR NOT NULL,
			trip_id VARCHAR NOT NULL,
			scheduled_arrival_time TIMESTAMPTZ,
			scheduled_departure_time TIMESTAMPTZ,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 4. fact_vehicle_positions
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_vehicle_positions (
			event_date DATE NOT NULL,
			event_time TIMESTAMPTZ NOT NULL,
			agency_id VARCHAR NOT NULL,
			route_id VARCHAR,
			trip_id VARCHAR,
			station_id VARCHAR,
			vehicle_id VARCHAR NOT NULL,
			status VARCHAR,
			latitude DOUBLE,
			longitude DOUBLE,
			bearing DOUBLE,
			speed DOUBLE,
			occupancy_status VARCHAR,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 5. fact_alerts
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_alerts (
			alert_id VARCHAR NOT NULL,
			agency_id VARCHAR NOT NULL,
			event_date DATE NOT NULL,
			detected_at TIMESTAMPTZ NOT NULL,
			last_seen_at TIMESTAMPTZ NOT NULL,
			removed_at TIMESTAMPTZ,
			active_period_start TIMESTAMPTZ,
			active_period_end TIMESTAMPTZ,
			affected_route_ids VARCHAR,
			cause VARCHAR,
			effect VARCHAR,
			header_text VARCHAR,
			description_text VARCHAR,
			severity VARCHAR,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 6. fact_ridership
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_ridership (
			event_date DATE NOT NULL,
			agency_id VARCHAR NOT NULL,
			origin_station_id VARCHAR NOT NULL,
			destination_station_id VARCHAR NOT NULL,
			passenger_count BIGINT NOT NULL,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 7. dim_micromobility_stations (SCD Type II)
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.dim_micromobility_stations (
			station_id VARCHAR NOT NULL,
			agency_id VARCHAR NOT NULL,
			name VARCHAR NOT NULL,
			latitude DOUBLE,
			longitude DOUBLE,
			capacity INT,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_to TIMESTAMPTZ,
			is_current BOOLEAN,
			raw_payload %s%s
		);`, version, payloadType, dimMicroStationsPK),

		// 8. fact_micromobility_status
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_micromobility_status (
			event_date DATE NOT NULL,
			event_time TIMESTAMPTZ NOT NULL,
			agency_id VARCHAR NOT NULL,
			station_id VARCHAR NOT NULL,
			num_bikes_available INT,
			num_ebikes_available INT,
			num_docks_available INT,
			is_installed BOOLEAN,
			is_renting BOOLEAN,
			is_returning BOOLEAN,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 9. fact_turnstile_counts
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.fact_turnstile_counts (
			event_date DATE NOT NULL,
			agency_id VARCHAR NOT NULL,
			station_id VARCHAR NOT NULL,
			device_id VARCHAR NOT NULL,
			reading_time TIMESTAMPTZ NOT NULL,
			entry_count BIGINT NOT NULL,
			exit_count BIGINT NOT NULL,
			raw_payload %s
		)%s;`, version, payloadType, factPartitionClause),

		// 10. dim_boroughs (SCD Type II NYC Borough Boundary Polygons)
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.dim_boroughs (
			boro_code INTEGER NOT NULL,
			boro_name VARCHAR NOT NULL,
			geom_wkt VARCHAR NOT NULL,
			geom_geojson VARCHAR,
			shape_area DOUBLE,
			shape_leng DOUBLE,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_to TIMESTAMPTZ,
			is_current BOOLEAN,
			raw_payload %s%s
		);`, version, payloadType, dimBoroughsPK),

		// 11. dim_service_lines (SCD Type II MTA Subway Service Line Alignments, s692-irgq)
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s.dim_service_lines (
			line_id VARCHAR NOT NULL,
			agency_id VARCHAR NOT NULL,
			route_id VARCHAR NOT NULL,
			service_name VARCHAR NOT NULL,
			division VARCHAR,
			line_name VARCHAR,
			color_hex VARCHAR,
			geom_wkt VARCHAR NOT NULL,
			geom_geojson VARCHAR,
			shape_leng DOUBLE,
			valid_from TIMESTAMPTZ NOT NULL,
			valid_to TIMESTAMPTZ,
			is_current BOOLEAN,
			raw_payload %s%s
		);`, version, payloadType, dimServiceLinesPK),
	}

	if !isOTF {
		ddls = append(ddls,
			fmt.Sprintf("COMMENT ON TABLE %s.dim_stations IS 'Static geographic locations of transit stations with raw_payload VARIANT for vendor-specific amenity and borough metadata.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.dim_routes IS 'Transit routes and lines with raw_payload VARIANT for agency-specific branding metadata.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_schedules IS 'Static scheduled stop times with raw_payload VARIANT for agency GTFS timetable attributes. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_vehicle_positions IS 'Real-time vehicle tracking with raw_payload VARIANT containing auto-shredded vendor telemetry. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_alerts IS 'Service alerts with raw_payload VARIANT vendor schemas and lifecycle tracking. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_ridership IS 'Delayed weekly aggregated ridership numbers between origin and destination stations. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.dim_micromobility_stations IS 'Static geographic locations and capacities of micromobility docks with raw_payload VARIANT.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_micromobility_status IS 'Real-time dock and bike availability with raw_payload VARIANT vendor details. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.fact_turnstile_counts IS 'Hardware-level fare gate entry and exit counts with raw_payload VARIANT. Partitioned by event_date.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.dim_boroughs IS 'NYC DCP Borough Boundary MultiPolygon geometries in EPSG:4326 (WKT and GeoJSON) for spatial joins.';", version),
			fmt.Sprintf("COMMENT ON TABLE %s.dim_service_lines IS 'MTA Subway Service Line MultiLineString track geometries in EPSG:4326 (NY Open Data s692-irgq) joinable by (agency_id, route_id).';", version),

			// 10. Deduplicated View for Current Vehicle Positions (LLM Helper, Bounded to Last 2 Hours)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_current_vehicle_positions AS
			SELECT * EXCLUDE (rn) FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY agency_id, vehicle_id ORDER BY event_time DESC) as rn
				FROM %s.fact_vehicle_positions
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND event_time >= CURRENT_TIMESTAMP - INTERVAL '2 hours'
			) WHERE rn = 1;`, version, version),

			// 11. Deduplicated View for Current Micromobility Status (LLM Helper, Bounded to Last 2 Hours)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_current_micromobility_status AS
			SELECT * EXCLUDE (rn) FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY agency_id, station_id ORDER BY event_time DESC) as rn
				FROM %s.fact_micromobility_status
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND event_time >= CURRENT_TIMESTAMP - INTERVAL '2 hours'
			) WHERE rn = 1;`, version, version),

			// 12. Helper View for Currently Active Service Alerts (LLM Helper, Bounded to Last 24 Hours)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_active_alerts AS
			SELECT * FROM %s.fact_alerts
			WHERE event_date >= CURRENT_DATE - INTERVAL '2 days'
			  AND removed_at IS NULL
			  AND detected_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours';`, version, version),

			// 13. SCD-Safe Station Dimension View (De-duplicated current stations with junction classification and unified complex names)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_stations AS
			WITH current_stations AS (
				SELECT 
					station_id,
					agency_id,
					name,
					latitude,
					longitude,
					gtfs_stop_id,
					complex_id,
					daytime_routes,
					structure,
					is_accessible,
					raw_payload,
					ROW_NUMBER() OVER (PARTITION BY station_id, agency_id ORDER BY valid_from DESC) as rn
				FROM %s.dim_stations
				WHERE is_current = true
				  AND station_id NOT LIKE '%%_STN_%%'
				  AND station_id NOT LIKE 'BUS_STOP_%%'
				  AND station_id NOT LIKE 'LANDING_%%'
			),
			deduped AS (
				SELECT * FROM current_stations WHERE rn = 1
			),
			complex_meta AS (
				SELECT 
					agency_id,
					complex_id,
					STRING_AGG(DISTINCT name, ' / ' ORDER BY CASE WHEN name LIKE 'Times Sq%%' THEN 0 ELSE 1 END, name) AS unified_name,
					STRING_AGG(DISTINCT REPLACE(TRIM(daytime_routes), ' ', ','), ',' ORDER BY REPLACE(TRIM(daytime_routes), ' ', ',')) AS all_routes
				FROM deduped
				GROUP BY agency_id, complex_id
			),
			name_counts AS (
				SELECT 
					agency_id,
					unified_name,
					COUNT(DISTINCT complex_id) AS complex_cnt
				FROM complex_meta
				GROUP BY agency_id, unified_name
			)
			SELECT 
				d.station_id,
				d.agency_id,
				CASE 
					WHEN d.agency_id = 'MTA_NYCT_SUBWAY' AND nc.complex_cnt > 1 AND cm.all_routes IS NOT NULL AND cm.all_routes != ''
					THEN cm.unified_name || ' (' || cm.all_routes || ')'
					ELSE COALESCE(cm.unified_name, d.name)
				END AS name,
				d.latitude,
				d.longitude,
				d.gtfs_stop_id,
				d.complex_id,
				d.daytime_routes,
				d.structure,
				d.is_accessible,
				CASE 
					WHEN d.daytime_routes IS NULL OR TRIM(d.daytime_routes) = '' THEN 1
					ELSE len(string_split(REPLACE(d.daytime_routes, ' ', ''), ','))
				END AS route_count,
				CASE 
					WHEN d.daytime_routes IS NOT NULL AND len(string_split(REPLACE(d.daytime_routes, ' ', ''), ',')) > 1 THEN true
					ELSE false
				END AS is_interlined_junction,
				CASE UPPER(TRIM(COALESCE(json_extract_string(d.raw_payload::JSON, '$.borough'), '')))
					WHEN 'M' THEN 'Manhattan'
					WHEN 'MANHATTAN' THEN 'Manhattan'
					WHEN 'BX' THEN 'Bronx'
					WHEN 'BRONX' THEN 'Bronx'
					WHEN 'BK' THEN 'Brooklyn'
					WHEN 'BROOKLYN' THEN 'Brooklyn'
					WHEN 'Q' THEN 'Queens'
					WHEN 'QUEENS' THEN 'Queens'
					WHEN 'SI' THEN 'Staten Island'
					WHEN 'STATEN ISLAND' THEN 'Staten Island'
					ELSE CASE
						WHEN d.latitude < 40.648 AND d.longitude < -74.055 THEN 'Staten Island'
						WHEN d.latitude > 40.878 THEN 'Bronx'
						WHEN d.latitude > 40.798 AND d.longitude > -73.934 THEN 'Bronx'
						WHEN d.longitude > -73.928 AND d.latitude >= 40.700 THEN 'Queens'
						WHEN d.longitude > -73.865 THEN 'Queens'
						WHEN d.latitude < 40.700 THEN 'Brooklyn'
						WHEN d.latitude < 40.739 AND d.longitude > -73.972 THEN 'Brooklyn'
						ELSE 'Manhattan'
					END
				END AS borough,
				d.raw_payload
			FROM deduped d
			LEFT JOIN complex_meta cm ON d.agency_id = cm.agency_id AND d.complex_id = cm.complex_id
			LEFT JOIN name_counts nc ON d.agency_id = nc.agency_id AND cm.unified_name = nc.unified_name;`, version, version),

			// 14. Station Complexes View (Aggregated 1 row per complex_id for 1:1 joins with turnstiles and ridership)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_station_complexes AS
			SELECT 
				complex_id,
				agency_id,
				MIN(name) AS complex_name,
				AVG(latitude) AS latitude,
				AVG(longitude) AS longitude,
				string_agg(DISTINCT daytime_routes, ' ') AS daytime_routes,
				BOOL_OR(is_accessible) AS is_accessible,
				COUNT(DISTINCT station_id) AS station_count,
				COUNT(DISTINCT NULLIF(TRIM(daytime_routes), '')) AS route_count
			FROM %s.view_dim_stations
			GROUP BY complex_id, agency_id;`, version, version),

			// 15. SCD-Safe Routes Dimension View (Multi-agency canonical route definitions enriched by dim_routes)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_routes AS
			WITH canonical_routes(route_id, agency_id, route_name, color_hex, type, bullet_code) AS (
				VALUES
					('1',  'MTA_NYCT_SUBWAY', 'Broadway-7 Avenue Local', '#EE352E', 'subway', '1'),
					('2',  'MTA_NYCT_SUBWAY', '7 Avenue Express', '#EE352E', 'subway', '2'),
					('3',  'MTA_NYCT_SUBWAY', '7 Avenue Express', '#EE352E', 'subway', '3'),
					('4',  'MTA_NYCT_SUBWAY', 'Lexington Avenue Express', '#00933C', 'subway', '4'),
					('5',  'MTA_NYCT_SUBWAY', 'Lexington Avenue Express', '#00933C', 'subway', '5'),
					('6',  'MTA_NYCT_SUBWAY', 'Lexington Avenue Local', '#00933C', 'subway', '6'),
					('6X', 'MTA_NYCT_SUBWAY', '6 Express', '#00933C', 'subway', '6'),
					('7',  'MTA_NYCT_SUBWAY', 'Flushing Local', '#B933AD', 'subway', '7'),
					('7X', 'MTA_NYCT_SUBWAY', '7 Express', '#B933AD', 'subway', '7'),
					('A',  'MTA_NYCT_SUBWAY', '8 Avenue Express', '#0039A6', 'subway', 'A'),
					('C',  'MTA_NYCT_SUBWAY', '8 Avenue Local', '#0039A6', 'subway', 'C'),
					('E',  'MTA_NYCT_SUBWAY', '8 Avenue Local', '#0039A6', 'subway', 'E'),
					('B',  'MTA_NYCT_SUBWAY', 'Central Park West Local / 6 Avenue Express', '#FF6319', 'subway', 'B'),
					('D',  'MTA_NYCT_SUBWAY', '6 Avenue Express', '#FF6319', 'subway', 'D'),
					('F',  'MTA_NYCT_SUBWAY', 'Queens Blvd Express / 6 Avenue Local', '#FF6319', 'subway', 'F'),
					('FX', 'MTA_NYCT_SUBWAY', 'F Express', '#FF6319', 'subway', 'F'),
					('M',  'MTA_NYCT_SUBWAY', 'Queens Blvd Local / 6 Avenue Local', '#FF6319', 'subway', 'M'),
					('G',  'MTA_NYCT_SUBWAY', 'Brooklyn-Queens Crosstown', '#6CBE45', 'subway', 'G'),
					('J',  'MTA_NYCT_SUBWAY', 'Nassau Street Local', '#996633', 'subway', 'J'),
					('Z',  'MTA_NYCT_SUBWAY', 'Nassau Street Express', '#996633', 'subway', 'Z'),
					('L',  'MTA_NYCT_SUBWAY', '14 Street-Canarsie Local', '#A7A9AC', 'subway', 'L'),
					('N',  'MTA_NYCT_SUBWAY', 'Broadway Express', '#FCCC0A', 'subway', 'N'),
					('Q',  'MTA_NYCT_SUBWAY', 'Second Ave / Broadway Express', '#FCCC0A', 'subway', 'Q'),
					('R',  'MTA_NYCT_SUBWAY', 'Broadway Local', '#FCCC0A', 'subway', 'R'),
					('W',  'MTA_NYCT_SUBWAY', 'Broadway Local', '#FCCC0A', 'subway', 'W'),
					('S',  'MTA_NYCT_SUBWAY', '42 St Shuttle', '#808183', 'subway', 'S'),
					('GS', 'MTA_NYCT_SUBWAY', '42 St Shuttle', '#808183', 'subway', 'S'),
					('FS', 'MTA_NYCT_SUBWAY', 'Franklin Av Shuttle', '#808183', 'subway', 'S'),
					('H',  'MTA_NYCT_SUBWAY', 'Rockaway Park Shuttle', '#808183', 'subway', 'S'),
					('T',  'MTA_NYCT_SUBWAY', 'Second Avenue Local', '#00ADD0', 'subway', 'T'),
					('SI', 'MTA_NYCT_SUBWAY', 'Staten Island Railway', '#0039A6', 'rail', 'SIR'),
					('SIR', 'MTA_NYCT_SUBWAY', 'Staten Island Railway', '#0039A6', 'rail', 'SIR'),
					('SS', 'MTA_NYCT_SUBWAY', 'Staten Island Railway', '#0039A6', 'rail', 'SIR'),
					('SI', 'MTA_NYCT_SIR', 'Staten Island Railway', '#0039A6', 'rail', 'SIR'),
					('SIR', 'MTA_NYCT_SIR', 'Staten Island Railway', '#0039A6', 'rail', 'SIR'),
					('1',  'MTA_LIRR', 'Babylon Branch', '#00985F', 'rail', 'BAB'),
					('2',  'MTA_LIRR', 'Hempstead Branch', '#CE8E00', 'rail', 'HEM'),
					('3',  'MTA_LIRR', 'Oyster Bay Branch', '#00AF3F', 'rail', 'OB'),
					('4',  'MTA_LIRR', 'Ronkonkoma Branch', '#A626AA', 'rail', 'RON'),
					('5',  'MTA_LIRR', 'Montauk Branch', '#00B2A9', 'rail', 'MTK'),
					('6',  'MTA_LIRR', 'Long Beach Branch', '#FF6319', 'rail', 'LB'),
					('7',  'MTA_LIRR', 'Far Rockaway Branch', '#6E3219', 'rail', 'FR'),
					('8',  'MTA_LIRR', 'West Hempstead Branch', '#00A1DE', 'rail', 'WH'),
					('9',  'MTA_LIRR', 'Port Washington Branch', '#C60C30', 'rail', 'PW'),
					('10', 'MTA_LIRR', 'Port Jefferson Branch', '#0039A6', 'rail', 'PJF'),
					('11', 'MTA_LIRR', 'Belmont Park Branch', '#60269E', 'rail', 'BEL'),
					('12', 'MTA_LIRR', 'City Terminal Zone', '#4D5357', 'rail', 'CTZ'),
					('13', 'MTA_LIRR', 'Greenport Branch', '#A626AA', 'rail', 'GPT'),
					('1',  'MTA_METRO_NORTH', 'Hudson Line', '#009B3A', 'rail', 'HUD'),
					('2',  'MTA_METRO_NORTH', 'Harlem Line', '#0039A6', 'rail', 'HAR'),
					('3',  'MTA_METRO_NORTH', 'New Haven Line', '#EE0034', 'rail', 'NH'),
					('4',  'MTA_METRO_NORTH', 'New Canaan Branch', '#EE0034', 'rail', 'NC'),
					('5',  'MTA_METRO_NORTH', 'Danbury Branch', '#EE0034', 'rail', 'DAN'),
					('6',  'MTA_METRO_NORTH', 'Waterbury Branch', '#EE0034', 'rail', 'WAT'),
					('14', 'MTA_METRO_NORTH', 'Pascack Valley Line', '#8E258D', 'rail', 'PV'),
					('15', 'MTA_METRO_NORTH', 'Port Jervis Line', '#FF7900', 'rail', 'PJ'),
					('NWK-WTC', 'PORT_AUTHORITY_PATH', 'Newark - World Trade Center', '#D93A30', 'rail', 'NWK'),
					('JSQ-33',  'PORT_AUTHORITY_PATH', 'Journal Square - 33rd Street', '#F9A51A', 'rail', 'JSQ'),
					('HOB-33',  'PORT_AUTHORITY_PATH', 'Hoboken - 33rd Street', '#4D92FB', 'rail', 'H33'),
					('HOB-WTC', 'PORT_AUTHORITY_PATH', 'Hoboken - World Trade Center', '#65C100', 'rail', 'HWT'),
					('M60-SBS', 'MTA_BUS', 'M60 Select Bus Service', '#0078C6', 'bus', 'M60'),
					('M60+',    'MTA_BUS', 'M60 Select Bus Service', '#0078C6', 'bus', 'M60'),
					('NEC',     'NJ_TRANSIT', 'Northeast Corridor', '#DD3439', 'rail', 'NEC'),
					('ER',  'NYC_FERRY', 'East River', '#00839B', 'ferry', 'ER'),
					('AS',  'NYC_FERRY', 'Astoria', '#FF6B00', 'ferry', 'AS'),
					('SB',  'NYC_FERRY', 'South Brooklyn', '#F6A800', 'ferry', 'SB'),
					('RW',  'NYC_FERRY', 'Rockaway', '#B71C8C', 'ferry', 'RW'),
					('RWS', 'NYC_FERRY', 'Rockaway Shuttle', '#B71C8C', 'ferry', 'RWS'),
					('RES', 'NYC_FERRY', 'Rockaway East Shuttle', '#B71C8C', 'ferry', 'RES'),
					('RS',  'NYC_FERRY', 'Rockaway / Soundview', '#B71C8C', 'ferry', 'RS'),
					('SV',  'NYC_FERRY', 'Soundview', '#532E8E', 'ferry', 'SV'),
					('SG',  'NYC_FERRY', 'St. George', '#78BE20', 'ferry', 'SG'),
					('GI',  'NYC_FERRY', 'Governors Island', '#6CBE45', 'ferry', 'GI'),
					('NYC_FERRY', 'NYC_FERRY', 'NYC Ferry', '#004B87', 'ferry', 'NYC_FERRY')
			),
			combined AS (
				SELECT 
					route_id,
					CASE 
						WHEN agency_id = 'MTA_MNR' THEN 'MTA_METRO_NORTH'
						WHEN agency_id = 'MTA_SIR' THEN 'MTA_NYCT_SIR'
						ELSE agency_id
					END AS agency_id,
					route_name,
					color_hex,
					type,
					raw_payload,
					valid_from,
					1 AS priority
				FROM %s.dim_routes
				WHERE is_current = true
				UNION ALL
				SELECT 
					route_id,
					agency_id,
					route_name,
					color_hex,
					type,
					to_json({'bullet_code': bullet_code})::VARIANT AS raw_payload,
					TIMESTAMP '1970-01-01 00:00:00' AS valid_from,
					2 AS priority
				FROM canonical_routes
			),
			current_routes AS (
				SELECT 
					route_id,
					agency_id,
					route_name,
					color_hex,
					type,
					raw_payload,
					ROW_NUMBER() OVER (PARTITION BY route_id, agency_id ORDER BY priority ASC, valid_from DESC) as rn
				FROM combined
			)
			SELECT 
				route_id,
				agency_id,
				route_name,
				color_hex,
				type,
				raw_payload,
				COALESCE(NULLIF(json_extract_string(raw_payload::JSON, '$.bullet_code'), ''), route_id) AS bullet_code,
				COALESCE(
					NULLIF(json_extract_string(raw_payload::JSON, '$.text_color_hex'), ''),
					CASE WHEN UPPER(COALESCE(color_hex, '')) IN ('#FCCC0A','#CE8E00','#00B2A9','#00A1DE','#FF9900','#F9A51A','#FFD411','#65C100') THEN '#000000' ELSE '#FFFFFF' END
				) AS text_color_hex,
				COALESCE(json_extract_string(raw_payload::JSON, '$.division'), '') AS division,
				COALESCE(NULLIF(json_extract_string(raw_payload::JSON, '$.trunk_group'), ''), route_name) AS trunk_group
			FROM current_routes
			WHERE rn = 1;`, version, version),

			// 16. SCD-Safe Micromobility Stations Dimension View (Excludes inactive/construction 0/0/0 docks)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_micromobility_stations AS
			WITH active_station_ids AS (
				SELECT DISTINCT station_id, agency_id
				FROM %s.fact_micromobility_status
				WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
				  AND is_renting = true AND (COALESCE(num_bikes_available, 0) + COALESCE(num_docks_available, 0)) > 0
			),
			current_stations AS (
				SELECT 
					d.station_id,
					d.agency_id,
					d.name,
					d.latitude,
					d.longitude,
					d.capacity,
					d.raw_payload,
					ROW_NUMBER() OVER (PARTITION BY d.station_id, d.agency_id ORDER BY d.valid_from DESC) as rn
				FROM %s.dim_micromobility_stations d
				JOIN active_station_ids a
					ON d.station_id = a.station_id AND d.agency_id = a.agency_id
				WHERE d.is_current = true
			)
			SELECT 
				station_id,
				agency_id,
				name,
				latitude,
				longitude,
				capacity,
				raw_payload
			FROM current_stations
			WHERE rn = 1 AND COALESCE(capacity, 0) > 0;`, version, version, version),

			// 17. Vehicle Kinematics View (Unbounded, partition pushdown via leading event_date)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_vehicle_kinematics AS
			WITH trip_routes AS (
				SELECT agency_id, trip_id, FIRST(route_id) AS sched_route_id
				FROM %s.fact_schedules
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND route_id IS NOT NULL AND route_id != '' AND trip_id IS NOT NULL
				GROUP BY agency_id, trip_id
			),
			station_coords AS (
				SELECT agency_id, gtfs_stop_id, AVG(latitude) AS st_lat, AVG(longitude) AS st_lon
				FROM %s.view_dim_stations
				WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0
				GROUP BY agency_id, gtfs_stop_id
			),
			ferry_grid AS (
				SELECT 
					ROUND(latitude * 250) AS lat_g,
					ROUND(longitude * 250) AS lon_g,
					MIN(gtfs_stop_id) AS ferry_stop_id,
					MIN(CASE
						WHEN gtfs_stop_id IN ('136', '137', '138') THEN 'SG'
						WHEN gtfs_stop_id IN ('112', '141') THEN 'SV'
						WHEN gtfs_stop_id IN ('25', '90') THEN 'AS'
						WHEN gtfs_stop_id IN ('11', '23', '24') THEN 'SB'
						WHEN gtfs_stop_id IN ('111') THEN 'GI'
						WHEN gtfs_stop_id IN ('4', '8', '17', '18', '19', '20', '120') THEN 'ER'
						ELSE 'RW'
					END) AS ferry_route_id
				FROM %s.view_dim_stations
				WHERE agency_id = 'NYC_FERRY' AND latitude IS NOT NULL AND longitude IS NOT NULL
				GROUP BY 1, 2
			),
			raw_enriched AS (
				SELECT 
					vp.event_date,
					vp.event_time,
					vp.agency_id,
					NULLIF(vp.route_id, '') AS raw_route_id,
					tr.sched_route_id,
					fg.ferry_route_id,
					vp.trip_id,
					CASE
						WHEN vp.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN RTRIM(vp.station_id, 'NS')
						WHEN vp.agency_id = 'NYC_FERRY' AND (vp.station_id IS NULL OR vp.station_id = '') THEN COALESCE(fg.ferry_stop_id, '')
						ELSE vp.station_id
					END AS station_id,
					CASE
						WHEN vp.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND vp.trip_id IS NOT NULL AND vp.trip_id != ''
						THEN vp.trip_id
						ELSE vp.vehicle_id
					END AS vehicle_id,
					vp.status,
					COALESCE(NULLIF(vp.latitude, 0.0), sc.st_lat) AS latitude,
					COALESCE(NULLIF(vp.longitude, 0.0), sc.st_lon) AS longitude,
					vp.speed,
					vp.bearing,
					vp.occupancy_status
				FROM %s.fact_vehicle_positions vp
				LEFT JOIN trip_routes tr
					ON vp.agency_id = tr.agency_id AND vp.trip_id = tr.trip_id
				LEFT JOIN station_coords sc
					ON vp.agency_id = sc.agency_id AND RTRIM(vp.station_id, 'NS') = sc.gtfs_stop_id
				LEFT JOIN ferry_grid fg
					ON vp.agency_id = 'NYC_FERRY' AND ROUND(vp.latitude * 250) = fg.lat_g AND ROUND(vp.longitude * 250) = fg.lon_g
				QUALIFY ROW_NUMBER() OVER (
					PARTITION BY vp.event_date, vp.agency_id,
						CASE WHEN vp.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND vp.trip_id IS NOT NULL AND vp.trip_id != '' THEN vp.trip_id ELSE vp.vehicle_id END,
						vp.event_time
					ORDER BY vp.station_id
				) = 1
			),
			enriched AS (
				SELECT
					event_date,
					event_time,
					agency_id,
					COALESCE(
						raw_route_id,
						sched_route_id,
						CASE
							WHEN agency_id = 'NYC_FERRY' THEN COALESCE(
								ferry_route_id,
								MAX(ferry_route_id) OVER (PARTITION BY event_date, agency_id, COALESCE(NULLIF(trip_id, ''), vehicle_id)),
								'ER'
							)
							WHEN agency_id = 'MTA_NYCT_SIR' THEN 'SI'
							ELSE ''
						END
					) AS route_id,
					trip_id,
					station_id,
					vehicle_id,
					status,
					latitude,
					longitude,
					speed,
					bearing,
					occupancy_status
				FROM raw_enriched
			),
			stepped AS (
				SELECT 
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
					speed,
					bearing,
					occupancy_status,
					LAG(event_time) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) AS prev_event_time,
					LAG(latitude) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) AS prev_lat,
					LAG(longitude) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) AS prev_lon,
					LAG(status) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) AS prev_status,
					LAG(station_id) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) AS prev_station_id,
					CASE
						WHEN LAG(latitude) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time) IS NULL
						     OR ABS(latitude - LAG(latitude) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time)) > 0.00005
						     OR ABS(longitude - LAG(longitude) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time)) > 0.00005
						THEN 1
						ELSE 0
					END AS is_new_pos
				FROM enriched
			),
			with_deltas AS (
				SELECT 
					event_date,
					event_time,
					agency_id,
					route_id,
					trip_id,
					station_id,
					prev_station_id,
					vehicle_id,
					status,
					prev_status,
					latitude,
					longitude,
					speed,
					bearing,
					occupancy_status,
					EXTRACT(EPOCH FROM (event_time - prev_event_time)) AS delta_time_sec,
					EXTRACT(EPOCH FROM (
						event_time - MAX(CASE WHEN is_new_pos = 1 THEN event_time END) OVER (
							PARTITION BY event_date, agency_id, vehicle_id
							ORDER BY event_time
							ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
						)
					)) AS pos_delta_time_sec,
					CASE 
						WHEN prev_lat IS NOT NULL AND prev_lon IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
						THEN 2 * 6371000 * ASIN(SQRT(
							POWER(SIN(RADIANS(latitude - prev_lat) / 2), 2) +
							COS(RADIANS(prev_lat)) * COS(RADIANS(latitude)) *
							POWER(SIN(RADIANS(longitude - prev_lon) / 2), 2)
						))
						ELSE 0.0
					END AS step_distance_meters
				FROM stepped
			),
			with_effective AS (
				SELECT 
					*,
					CASE
						WHEN COALESCE(speed, 0.0) > 0.0 AND speed <= 40.2336 THEN speed
						WHEN step_distance_meters > 5.0
						     AND pos_delta_time_sec BETWEEN 5 AND 900
						     AND (step_distance_meters / NULLIF(pos_delta_time_sec, 0)) <= 40.2336
						THEN step_distance_meters / NULLIF(pos_delta_time_sec, 0)
						ELSE 0.0
					END AS effective_speed_mps,
					CASE 
						WHEN (status = 'STOPPED_AT' OR agency_id = 'NYC_FERRY')
						     AND station_id IS NOT NULL AND station_id != ''
						     AND station_id = prev_station_id
						     AND delta_time_sec BETWEEN 1 AND 600
						THEN delta_time_sec
						ELSE 0.0
					END AS dwell_sec,
					CASE 
						WHEN status != 'STOPPED_AT'
						     AND COALESCE(speed, 0.0) = 0.0
						     AND delta_time_sec BETWEEN 1 AND 600
						     AND (step_distance_meters / NULLIF(delta_time_sec, 0)) < 0.5
						THEN delta_time_sec
						ELSE 0.0
					END AS signal_delay_sec
				FROM with_deltas
			)
			SELECT 
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
				occupancy_status,
				delta_time_sec,
				step_distance_meters,
				effective_speed_mps,
				effective_speed_mps * 2.23694 AS effective_speed_mph,
				(effective_speed_mps - LAG(effective_speed_mps) OVER (PARTITION BY event_date, agency_id, vehicle_id ORDER BY event_time)) / NULLIF(delta_time_sec, 0) AS accel_mps2,
				dwell_sec,
				signal_delay_sec
			FROM with_effective;`, version, version, version, version, version),

			// 18. Station Headways View (Unbounded, partition pushdown via leading event_date, headway variance metric)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_station_headways AS
			WITH trip_routes AS (
				SELECT agency_id, trip_id, FIRST(route_id) AS sched_route_id
				FROM %s.fact_schedules
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND route_id IS NOT NULL AND route_id != '' AND trip_id IS NOT NULL
				GROUP BY agency_id, trip_id
			),
			ferry_grid AS (
				SELECT 
					ROUND(latitude * 250) AS lat_g,
					ROUND(longitude * 250) AS lon_g,
					MIN(gtfs_stop_id) AS ferry_stop_id,
					MIN(CASE
						WHEN gtfs_stop_id IN ('136', '137', '138') THEN 'SG'
						WHEN gtfs_stop_id IN ('112', '141') THEN 'SV'
						WHEN gtfs_stop_id IN ('25', '90') THEN 'AS'
						WHEN gtfs_stop_id IN ('11', '23', '24') THEN 'SB'
						WHEN gtfs_stop_id IN ('111') THEN 'GI'
						WHEN gtfs_stop_id IN ('4', '8', '17', '18', '19', '20', '120') THEN 'ER'
						ELSE 'RW'
					END) AS ferry_route_id
				FROM %s.view_dim_stations
				WHERE agency_id = 'NYC_FERRY' AND latitude IS NOT NULL AND longitude IS NOT NULL
				GROUP BY 1, 2
			),
			raw_events AS (
				SELECT
					vp.event_date,
					vp.event_time,
					vp.agency_id,
					NULLIF(vp.route_id, '') AS raw_route_id,
					tr.sched_route_id,
					fg.ferry_route_id,
					vp.trip_id AS raw_trip_id,
					vp.vehicle_id,
					CASE
						WHEN vp.agency_id = 'NYC_FERRY' AND (vp.station_id IS NULL OR vp.station_id = '')
						THEN fg.ferry_stop_id
						ELSE vp.station_id
					END AS station_id,
					vp.status
				FROM %s.fact_vehicle_positions vp
				LEFT JOIN trip_routes tr
					ON vp.agency_id = tr.agency_id AND vp.trip_id = tr.trip_id
				LEFT JOIN ferry_grid fg
					ON vp.agency_id = 'NYC_FERRY' AND ROUND(vp.latitude * 250) = fg.lat_g AND ROUND(vp.longitude * 250) = fg.lon_g
			),
			resolved_events AS (
				SELECT
					event_date,
					event_time,
					agency_id,
					COALESCE(
						raw_route_id,
						sched_route_id,
						CASE
							WHEN agency_id = 'NYC_FERRY' THEN COALESCE(
								ferry_route_id,
								MAX(ferry_route_id) OVER (PARTITION BY event_date, agency_id, COALESCE(NULLIF(raw_trip_id, ''), vehicle_id)),
								'ER'
							)
							WHEN agency_id = 'MTA_NYCT_SIR' THEN 'SI'
							ELSE ''
						END
					) AS route_id,
					CASE
						WHEN agency_id = 'NYC_FERRY'
						THEN COALESCE(NULLIF(raw_trip_id, ''), vehicle_id) || '_' || CAST(date_trunc('hour', event_time) AS VARCHAR)
						ELSE raw_trip_id
					END AS trip_id,
					vehicle_id,
					station_id,
					status
				FROM raw_events
			),
			trip_station_arrivals AS (
				SELECT 
					event_date,
					agency_id,
					route_id,
					trip_id,
					CASE WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN RTRIM(station_id, 'NS') ELSE station_id END AS parent_station_id,
					CASE 
						WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND station_id LIKE '%%%%N' THEN 'N'
						WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND station_id LIKE '%%%%S' THEN 'S'
						ELSE 'ALL'
					END AS direction_id,
					MIN(event_time) AS event_time,
					FIRST(vehicle_id) AS vehicle_id,
					FIRST(station_id) AS station_id,
					FIRST(status) AS status
				FROM resolved_events
				WHERE station_id IS NOT NULL AND station_id != '' AND trip_id IS NOT NULL AND trip_id != ''
				GROUP BY 
					event_date,
					agency_id,
					route_id,
					trip_id,
					CASE WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN RTRIM(station_id, 'NS') ELSE station_id END,
					CASE 
						WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND station_id LIKE '%%%%N' THEN 'N'
						WHEN agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') AND station_id LIKE '%%%%S' THEN 'S'
						ELSE 'ALL'
					END
			),
			ordered_events AS (
				SELECT 
					event_date,
					event_time,
					agency_id,
					route_id,
					trip_id,
					vehicle_id,
					station_id,
					parent_station_id,
					direction_id,
					status,
					LAG(event_time) OVER (
						PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id 
						ORDER BY event_time
					) AS prev_event_time
				FROM trip_station_arrivals
			),
			with_headways AS (
				SELECT 
					event_date,
					event_time,
					agency_id,
					route_id,
					trip_id,
					vehicle_id,
					station_id,
					parent_station_id,
					direction_id,
					status,
					EXTRACT(EPOCH FROM (event_time - prev_event_time)) AS headway_sec
				FROM ordered_events
			)
			SELECT 
				event_date,
				event_time,
				agency_id,
				route_id,
				trip_id,
				vehicle_id,
				station_id,
				parent_station_id,
				direction_id,
				status,
				headway_sec,
				POWER(headway_sec, 2) AS headway_sec_squared
			FROM with_headways;`, version, version, version, version),

			// 19. Station-to-Station Legs View (Consecutive visited stops paired BEFORE requiring STOPPED_AT endpoints, avoiding skipped-stop merging)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_station_to_station_legs AS
			WITH trip_routes AS (
				SELECT agency_id, trip_id, FIRST(route_id) AS sched_route_id
				FROM %s.fact_schedules
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND route_id IS NOT NULL AND route_id != '' AND trip_id IS NOT NULL
				GROUP BY agency_id, trip_id
			),
			stop_routes AS (
				SELECT agency_id, station_id AS stop_id, MODE(route_id) AS stop_route_id
				FROM %s.fact_schedules
				WHERE event_date >= CURRENT_DATE - INTERVAL '1 day'
				  AND route_id IS NOT NULL AND route_id != '' AND station_id IS NOT NULL AND station_id != ''
				GROUP BY agency_id, station_id
			),
			station_coords AS (
				SELECT agency_id, gtfs_stop_id, AVG(latitude) AS st_lat, AVG(longitude) AS st_lon
				FROM %s.view_dim_stations
				WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0
				GROUP BY agency_id, gtfs_stop_id
			),
			visited_stops AS (
				SELECT 
					vp.event_date,
					CAST(vp.event_time AT TIME ZONE 'America/New_York' AS DATE) AS ny_service_date,
					vp.agency_id,
					COALESCE(
						NULLIF(vp.route_id, ''),
						tr.sched_route_id,
						CASE WHEN vp.agency_id = 'MTA_NYCT_SIR' THEN 'SI' ELSE NULL END,
						MAX(sr.stop_route_id)
					) AS stop_inferred_route_id,
					vp.trip_id,
					FIRST(vp.vehicle_id) AS vehicle_id,
					CASE WHEN vp.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN RTRIM(vp.station_id, 'NS') ELSE vp.station_id END AS station_id,
					MIN(vp.event_time) AS first_seen_time,
					MIN(CASE WHEN vp.status = 'STOPPED_AT' THEN vp.event_time END) AS stopped_arrival_time,
					MAX(CASE WHEN vp.status = 'STOPPED_AT' THEN vp.event_time END) AS stopped_departure_time,
					BOOL_OR(vp.status = 'STOPPED_AT') AS has_stopped,
					COALESCE(AVG(NULLIF(vp.latitude, 0.0)), MAX(sc.st_lat)) AS latitude,
					COALESCE(AVG(NULLIF(vp.longitude, 0.0)), MAX(sc.st_lon)) AS longitude
				FROM %s.fact_vehicle_positions vp
				LEFT JOIN trip_routes tr
					ON vp.agency_id = tr.agency_id AND vp.trip_id = tr.trip_id
				LEFT JOIN stop_routes sr
					ON vp.agency_id = sr.agency_id AND RTRIM(vp.station_id, 'NS') = sr.stop_id
				LEFT JOIN station_coords sc
					ON vp.agency_id = sc.agency_id AND RTRIM(vp.station_id, 'NS') = sc.gtfs_stop_id
				WHERE vp.trip_id IS NOT NULL AND vp.trip_id != '' AND vp.station_id IS NOT NULL AND vp.station_id != ''
				GROUP BY
					vp.event_date,
					CAST(vp.event_time AT TIME ZONE 'America/New_York' AS DATE),
					vp.agency_id,
					NULLIF(vp.route_id, ''),
					tr.sched_route_id,
					vp.trip_id,
					CASE WHEN vp.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN RTRIM(vp.station_id, 'NS') ELSE vp.station_id END
			),
			ordered_stops AS (
				SELECT 
					event_date,
					ny_service_date,
					agency_id,
					COALESCE(
						stop_inferred_route_id,
						MAX(stop_inferred_route_id) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id),
						''
					) AS route_id,
					trip_id,
					vehicle_id,
					station_id,
					first_seen_time,
					stopped_arrival_time,
					stopped_departure_time,
					has_stopped,
					latitude,
					longitude,
					LAG(station_id) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_station_id,
					LAG(stopped_departure_time) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_stopped_departure_time,
					LAG(first_seen_time) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_first_seen_time,
					LAG(has_stopped) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_has_stopped,
					LAG(latitude) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_lat,
					LAG(longitude) OVER (PARTITION BY event_date, ny_service_date, agency_id, trip_id ORDER BY first_seen_time) AS from_lon
				FROM visited_stops
			),
			computed_legs AS (
				SELECT 
					event_date,
					agency_id,
					route_id,
					trip_id,
					vehicle_id,
					from_station_id,
					station_id AS to_station_id,
					COALESCE(from_stopped_departure_time, from_first_seen_time) AS departure_time,
					COALESCE(stopped_arrival_time, first_seen_time) AS arrival_time,
					EXTRACT(EPOCH FROM (COALESCE(stopped_arrival_time, first_seen_time) - COALESCE(from_stopped_departure_time, from_first_seen_time))) AS leg_travel_time_sec,
					CASE 
						WHEN from_lat IS NOT NULL AND from_lon IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
						THEN 2 * 6371000 * ASIN(SQRT(
							POWER(SIN(RADIANS(latitude - from_lat) / 2), 2) +
							COS(RADIANS(from_lat)) * COS(RADIANS(latitude)) *
							POWER(SIN(RADIANS(longitude - from_lon) / 2), 2)
						))
						ELSE 0.0
					END AS leg_distance_meters
				FROM ordered_stops
				WHERE from_station_id IS NOT NULL
				  AND from_station_id != station_id
				  AND route_id != ''
				  AND (
				      agency_id NOT IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
				      OR (from_has_stopped = true AND has_stopped = true)
				  )
			)
			SELECT 
				cl.event_date,
				cl.agency_id,
				cl.route_id,
				COALESCE(dr.route_name, cl.route_id) AS route_name,
				cl.trip_id,
				cl.vehicle_id,
				cl.from_station_id,
				cl.to_station_id,
				cl.departure_time,
				cl.arrival_time,
				cl.leg_travel_time_sec,
				cl.leg_distance_meters,
				CASE 
					WHEN cl.leg_travel_time_sec > 0
					     AND (cl.leg_distance_meters / cl.leg_travel_time_sec) <= CASE WHEN cl.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN 27.0 ELSE 40.2336 END
					THEN cl.leg_distance_meters / cl.leg_travel_time_sec
					ELSE 0.0
				END AS leg_speed_mps
			FROM computed_legs cl
			LEFT JOIN %s.view_dim_routes dr
				ON cl.agency_id = dr.agency_id AND cl.route_id = dr.route_id
			WHERE cl.leg_travel_time_sec BETWEEN 20 AND 1800
			  AND cl.leg_distance_meters > 0
			  AND (cl.leg_distance_meters / cl.leg_travel_time_sec) <= CASE WHEN cl.agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR') THEN 27.0 ELSE 40.2336 END;`, version, version, version, version, version, version),

			// 20. Alert Routes View (Unnested route_ids with agency normalization and deduplication)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_alert_routes AS
			WITH unnested AS (
				SELECT 
					a.event_date,
					a.alert_id,
					CASE
						WHEN a.agency_id = 'MTABC' THEN 'MTA_BUS'
						WHEN a.agency_id = 'MTA_NYCT_SUBWAY' AND (
							a.header_text ILIKE '%%%%Grand Central to %%%%' OR
							a.header_text ILIKE '%%%% to Grand Central%%%%' OR
							a.header_text ILIKE '%%%%Harlem-125%%%%' OR
							a.header_text ILIKE '%%%%New Haven%%%%' OR
							a.header_text ILIKE '%%%%Stamford%%%%' OR
							a.header_text ILIKE '%%%%Danbury%%%%' OR
							a.header_text ILIKE '%%%%Waterbury%%%%' OR
							a.header_text ILIKE '%%%%Poughkeepsie%%%%' OR
							a.header_text ILIKE '%%%%Southeast%%%%' OR
							a.header_text ILIKE '%%%%Croton-Harmon%%%%' OR
							a.header_text ILIKE '%%%%White Plains%%%%' OR
							a.header_text ILIKE '%%%%Port Jervis%%%%' OR
							a.header_text ILIKE '%%%%Pascack Valley%%%%'
						) THEN 'MTA_METRO_NORTH'
						WHEN a.agency_id = 'MTA_NYCT_SUBWAY' AND (
							a.header_text ILIKE '%%%%Penn Station%%%%' OR
							a.header_text ILIKE '%%%%Jamaica%%%%' OR
							a.header_text ILIKE '%%%%Babylon%%%%' OR
							a.header_text ILIKE '%%%%Ronkonkoma%%%%' OR
							a.header_text ILIKE '%%%%Huntington%%%%' OR
							a.header_text ILIKE '%%%%Port Jefferson%%%%' OR
							a.header_text ILIKE '%%%%Oyster Bay%%%%' OR
							a.header_text ILIKE '%%%%Long Beach%%%%' OR
							a.header_text ILIKE '%%%%Montauk%%%%' OR
							a.header_text ILIKE '%%%%Hempstead%%%%' OR
							a.header_text ILIKE '%%%%Port Washington%%%%' OR
							a.header_text ILIKE '%%%%West Hempstead%%%%'
						) THEN 'MTA_LIRR'
						WHEN a.agency_id = 'MTA_NYCT_SUBWAY' AND (
							regexp_matches(TRIM(r.route_id), '^(M|B|Q|BX|Bx|S|SIM|BM|QM|X)[0-9]+') OR
							TRIM(r.route_id) LIKE '%%%%+%%%%'
						) THEN 'MTA_BUS'
						ELSE a.agency_id
					END AS agency_id,
					TRIM(r.route_id) AS route_id,
					a.detected_at,
					a.last_seen_at,
					a.removed_at,
					a.active_period_start,
					a.active_period_end,
					a.cause,
					a.effect,
					a.header_text,
					a.description_text,
					a.severity
				FROM %s.fact_alerts a,
				LATERAL (
					SELECT unnest(string_split(COALESCE(a.affected_route_ids, ''), ',')) AS route_id
				) r
				WHERE r.route_id IS NOT NULL AND TRIM(r.route_id) != ''
			)
			SELECT *
			FROM unnested
			QUALIFY ROW_NUMBER() OVER (PARTITION BY event_date, alert_id, agency_id, route_id ORDER BY last_seen_at DESC) = 1;`, version, version),

			// 21. Alert Stations View (Unnested stop_ids from JSON/VARIANT payload + header_text station extraction for MTA Subway)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_alert_stations AS
			WITH payload_stops AS (
				SELECT 
					a.event_date,
					a.alert_id,
					CASE WHEN a.agency_id = 'MTABC' THEN 'MTA_BUS' ELSE a.agency_id END AS agency_id,
					TRIM(s.stop_id, ' ''"') AS raw_stop_id,
					RTRIM(TRIM(s.stop_id, ' ''"'), 'NS') AS parent_station_id,
					a.detected_at,
					a.last_seen_at,
					a.removed_at,
					a.active_period_start,
					a.active_period_end,
					a.cause,
					a.effect,
					a.header_text,
					a.description_text,
					a.severity
				FROM %s.fact_alerts a,
				LATERAL (
					SELECT unnest(
						CASE 
							WHEN json_valid(CAST(a.raw_payload AS VARCHAR)) 
							     AND json_type(CAST(a.raw_payload AS VARCHAR), '$.affected_stop_ids') = 'ARRAY'
							THEN COALESCE(from_json(json_extract(CAST(a.raw_payload AS VARCHAR), '$.affected_stop_ids'), '["VARCHAR"]'), ARRAY[]::VARCHAR[])
							WHEN regexp_extract(CAST(a.raw_payload AS VARCHAR), '''affected_stop_ids'': \[([^\]]+)\]', 1) != ''
							THEN string_split(regexp_extract(CAST(a.raw_payload AS VARCHAR), '''affected_stop_ids'': \[([^\]]+)\]', 1), ',')
							ELSE ARRAY[]::VARCHAR[]
						END
					) AS stop_id
				) s
				WHERE s.stop_id IS NOT NULL AND TRIM(s.stop_id, ' ''"') != '' AND TRIM(s.stop_id, ' ''"') != 'NULL'
			),
			subway_header_stops AS (
				SELECT
					a.event_date,
					a.alert_id,
					'MTA_NYCT_SUBWAY' AS agency_id,
					st.gtfs_stop_id AS raw_stop_id,
					st.gtfs_stop_id AS parent_station_id,
					a.detected_at,
					a.last_seen_at,
					a.removed_at,
					a.active_period_start,
					a.active_period_end,
					a.cause,
					a.effect,
					a.header_text,
					a.description_text,
					a.severity
				FROM %s.fact_alerts a
				JOIN (
					SELECT
						gtfs_stop_id,
						REGEXP_REPLACE(name, ' \([^)]+\)$', '') AS clean_name,
						string_split(REPLACE(daytime_routes, ' ', ','), ',') AS route_list
					FROM %s.view_dim_stations
					WHERE agency_id = 'MTA_NYCT_SUBWAY'
					  AND LENGTH(REGEXP_REPLACE(name, ' \([^)]+\)$', '')) >= 5
				) st
					ON list_has_any(string_split(COALESCE(a.affected_route_ids, ''), ','), st.route_list)
					AND regexp_matches(
						REGEXP_REPLACE(COALESCE(a.header_text, ''), '[A-Za-z0-9 /-]+-bound', '', 'g'),
						'(^|[^A-Za-z0-9])' || REGEXP_REPLACE(st.clean_name, '[^A-Za-z0-9]+', '[^A-Za-z0-9]+', 'g') || '($|[^A-Za-z0-9])'
					)
				WHERE a.agency_id = 'MTA_NYCT_SUBWAY'
				  AND COALESCE(a.affected_route_ids, '') != ''
			),
			combined_stops AS (
				SELECT * FROM payload_stops
				UNION ALL
				SELECT * FROM subway_header_stops
			)
			SELECT 
				event_date,
				alert_id,
				agency_id,
				raw_stop_id AS station_id,
				parent_station_id,
				detected_at,
				last_seen_at,
				removed_at,
				active_period_start,
				active_period_end,
				cause,
				effect,
				header_text,
				description_text,
				severity
			FROM combined_stops
			QUALIFY ROW_NUMBER() OVER (PARTITION BY event_date, alert_id, agency_id, parent_station_id ORDER BY last_seen_at DESC) = 1;`, version, version, version, version),

			// 22. Turnstile Flows View (Hourly aggregations with safe VARIANT/JSON extraction for OMNY and fare class)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_turnstile_flows AS
			SELECT 
				event_date,
				agency_id,
				station_id,
				device_id,
				reading_time,
				date_trunc('hour', reading_time AT TIME ZONE 'America/New_York') AS service_hour,
				entry_count,
				exit_count,
				COALESCE(
					CASE WHEN json_valid(CAST(raw_payload AS VARCHAR)) THEN json_extract_string(CAST(raw_payload AS VARCHAR), '$.payment_method') ELSE NULL END,
					NULLIF(regexp_extract(CAST(raw_payload AS VARCHAR), '''payment_method'': ''([^'']+)''', 1), ''),
					'MetroCard'
				) AS payment_method,
				COALESCE(
					CASE WHEN json_valid(CAST(raw_payload AS VARCHAR)) THEN json_extract_string(CAST(raw_payload AS VARCHAR), '$.fare_class_category') ELSE NULL END,
					NULLIF(regexp_extract(CAST(raw_payload AS VARCHAR), '''fare_class_category'': ''([^'']+)''', 1), ''),
					'Full Fare'
				) AS fare_class_category
			FROM %s.fact_turnstile_counts;`, version, version),

			// 23. Schedule Adherence Multi-Fact Bridge View (Grain: event_date, agency_id, route_id, service_hour; trips deduplicated by NY service day and service_id)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_schedule_adherence AS
			WITH active_hours AS (
				SELECT DISTINCT
					event_date,
					date_trunc('hour', event_time AT TIME ZONE 'America/New_York') AS service_hour,
					EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') AS hour_of_day
				FROM %s.fact_vehicle_positions
			),
			sched_trip_origins AS (
				SELECT 
					CAST(scheduled_departure_time AT TIME ZONE 'America/New_York' AS DATE) AS ny_service_date,
					agency_id,
					route_id,
					regexp_extract(trip_id, '^([^_]+)', 1) AS service_id,
					coalesce(nullif(regexp_extract(trip_id, '_([^_]+_.*)$', 1), ''), trip_id) AS run_id,
					MIN(scheduled_departure_time) AS origin_departure_time
				FROM %s.fact_schedules
				WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
				  AND trip_id IS NOT NULL AND route_id IS NOT NULL AND route_id != ''
				GROUP BY 1, 2, 3, 4, 5
			),
			sched_by_hour_of_day AS (
				SELECT
					agency_id,
					route_id,
					hour_of_day,
					CAST(MAX(scheduled_trips) AS BIGINT) AS scheduled_trips
				FROM (
					SELECT
						ny_service_date,
						agency_id,
						route_id,
						service_id,
						EXTRACT(HOUR FROM origin_departure_time AT TIME ZONE 'America/New_York') AS hour_of_day,
						COUNT(DISTINCT run_id) AS scheduled_trips
					FROM sched_trip_origins
					GROUP BY ny_service_date, agency_id, route_id, service_id, hour_of_day
				)
				GROUP BY agency_id, route_id, hour_of_day
			),
			sched_hourly AS (
				SELECT 
					ah.event_date,
					s.agency_id,
					s.route_id,
					ah.service_hour,
					s.scheduled_trips
				FROM active_hours ah
				JOIN sched_by_hour_of_day s
					ON ah.hour_of_day = s.hour_of_day
			),
			obs_trip_origins AS (
				SELECT 
					CAST(event_time AT TIME ZONE 'America/New_York' AS DATE) AS ny_service_date,
					agency_id,
					route_id,
					trip_id,
					ARG_MIN(event_date, event_time) AS origin_event_date,
					MIN(event_time) AS origin_event_time
				FROM %s.view_station_headways
				WHERE trip_id IS NOT NULL AND route_id IS NOT NULL AND route_id != ''
				GROUP BY 1, 2, 3, 4
			),
			obs_trips_hourly AS (
				SELECT 
					origin_event_date AS event_date,
					agency_id,
					route_id,
					date_trunc('hour', origin_event_time AT TIME ZONE 'America/New_York') AS service_hour,
					COUNT(DISTINCT trip_id) AS observed_trips
				FROM obs_trip_origins
				GROUP BY origin_event_date, agency_id, route_id, service_hour
			),
			obs_headways_hourly AS (
				SELECT 
					event_date,
					agency_id,
					route_id,
					date_trunc('hour', event_time AT TIME ZONE 'America/New_York') AS service_hour,
					AVG(headway_sec) AS avg_observed_headway_sec,
					APPROX_QUANTILE(headway_sec, 0.5) AS median_observed_headway_sec,
					SUM(headway_sec_squared) AS sum_headway_sec_squared
				FROM %s.view_station_headways
				WHERE headway_sec BETWEEN 30 AND 3600 AND route_id IS NOT NULL AND route_id != ''
				GROUP BY event_date, agency_id, route_id, service_hour
			),
			obs_hourly AS (
				SELECT 
					COALESCE(t.event_date, h.event_date) AS event_date,
					COALESCE(t.agency_id, h.agency_id) AS agency_id,
					COALESCE(t.route_id, h.route_id) AS route_id,
					COALESCE(t.service_hour, h.service_hour) AS service_hour,
					COALESCE(t.observed_trips, 0) AS observed_trips,
					h.avg_observed_headway_sec,
					h.median_observed_headway_sec,
					h.sum_headway_sec_squared
				FROM obs_trips_hourly t
				FULL OUTER JOIN obs_headways_hourly h
					ON t.event_date = h.event_date AND t.agency_id = h.agency_id AND t.route_id = h.route_id AND t.service_hour = h.service_hour
			),
			alerts_hourly AS (
				SELECT 
					event_date,
					agency_id,
					route_id,
					date_trunc('hour', detected_at AT TIME ZONE 'America/New_York') AS service_hour,
					COUNT(DISTINCT alert_id) AS alert_count
				FROM %s.view_alert_routes
				GROUP BY event_date, agency_id, route_id, service_hour
			),
			all_keys AS (
				SELECT event_date, agency_id, route_id, service_hour FROM sched_hourly
				UNION
				SELECT event_date, agency_id, route_id, service_hour FROM obs_hourly
				UNION
				SELECT event_date, agency_id, route_id, service_hour FROM alerts_hourly
			)
			SELECT 
				k.event_date,
				k.agency_id,
				k.route_id,
				k.service_hour,
				COALESCE(s.scheduled_trips, 0) AS scheduled_trips,
				LEAST(COALESCE(o.observed_trips, 0), COALESCE(s.scheduled_trips, 0)) AS observed_trips,
				CASE 
					WHEN COALESCE(s.scheduled_trips, 0) > 0 
					THEN ROUND(CAST(LEAST(COALESCE(o.observed_trips, 0), s.scheduled_trips) AS DOUBLE) / s.scheduled_trips * 100.0, 2)
					ELSE NULL 
				END AS service_completion_pct,
				o.avg_observed_headway_sec,
				o.median_observed_headway_sec,
				o.sum_headway_sec_squared,
				COALESCE(a.alert_count, 0) AS active_alerts_count
			FROM all_keys k
			LEFT JOIN sched_hourly s 
				ON k.event_date = s.event_date AND k.agency_id = s.agency_id AND k.route_id = s.route_id AND k.service_hour = s.service_hour
			LEFT JOIN obs_hourly o 
				ON k.event_date = o.event_date AND k.agency_id = o.agency_id AND k.route_id = o.route_id AND k.service_hour = o.service_hour
			LEFT JOIN alerts_hourly a 
				ON k.event_date = a.event_date AND k.agency_id = a.agency_id AND k.route_id = a.route_id AND k.service_hour = a.service_hour;`, version, version, version, version, version, version),

			// 24. Station Hourly Summary Multi-Fact Bridge View (Grain: event_date, agency_id, parent_station_id, service_hour)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_station_hourly_summary AS
			WITH primary_complex_stop AS (
				SELECT 
					complex_id,
					agency_id,
					gtfs_stop_id
				FROM %s.view_dim_stations
				QUALIFY ROW_NUMBER() OVER (PARTITION BY complex_id, agency_id ORDER BY TRY_CAST(station_id AS BIGINT) ASC NULLS LAST, station_id ASC, gtfs_stop_id ASC) = 1
			),
			turnstiles_hourly AS (
				SELECT 
					tf.event_date,
					tf.agency_id,
					COALESCE(p.gtfs_stop_id, RTRIM(tf.station_id, 'NS')) AS parent_station_id,
					tf.service_hour,
					SUM(tf.entry_count) AS total_entries,
					SUM(tf.exit_count) AS total_exits
				FROM %s.view_turnstile_flows tf
				LEFT JOIN primary_complex_stop p
					ON tf.station_id = p.complex_id AND tf.agency_id = p.agency_id
				GROUP BY tf.event_date, tf.agency_id, COALESCE(p.gtfs_stop_id, RTRIM(tf.station_id, 'NS')), tf.service_hour
			),
			trains_hourly AS (
				SELECT 
					event_date,
					agency_id,
					parent_station_id,
					date_trunc('hour', event_time AT TIME ZONE 'America/New_York') AS service_hour,
					COUNT(DISTINCT vehicle_id) AS distinct_vehicles,
					COUNT(*) AS train_stops_count,
					AVG(headway_sec) AS avg_headway_sec
				FROM %s.view_station_headways
				WHERE headway_sec > 0 AND headway_sec < 7200
				GROUP BY event_date, agency_id, parent_station_id, service_hour
			),
			alerts_hourly AS (
				SELECT 
					event_date,
					agency_id,
					parent_station_id,
					date_trunc('hour', detected_at AT TIME ZONE 'America/New_York') AS service_hour,
					COUNT(DISTINCT alert_id) AS station_alerts_count
				FROM %s.view_alert_stations
				GROUP BY event_date, agency_id, parent_station_id, service_hour
			),
			all_keys AS (
				SELECT event_date, agency_id, parent_station_id, service_hour FROM turnstiles_hourly
				UNION
				SELECT event_date, agency_id, parent_station_id, service_hour FROM trains_hourly
				UNION
				SELECT event_date, agency_id, parent_station_id, service_hour FROM alerts_hourly
			)
			SELECT 
				k.event_date,
				k.agency_id,
				k.parent_station_id,
				k.service_hour,
				COALESCE(t.total_entries, 0) AS total_entries,
				COALESCE(t.total_exits, 0) AS total_exits,
				COALESCE(tr.distinct_vehicles, 0) AS distinct_vehicles,
				COALESCE(tr.train_stops_count, 0) AS train_stops_count,
				tr.avg_headway_sec,
				COALESCE(al.station_alerts_count, 0) AS station_alerts_count
			FROM all_keys k
			LEFT JOIN turnstiles_hourly t 
				ON k.event_date = t.event_date AND k.agency_id = t.agency_id AND k.parent_station_id = t.parent_station_id AND k.service_hour = t.service_hour
			LEFT JOIN trains_hourly tr 
				ON k.event_date = tr.event_date AND k.agency_id = tr.agency_id AND k.parent_station_id = tr.parent_station_id AND k.service_hour = tr.service_hour
			LEFT JOIN alerts_hourly al 
				ON k.event_date = al.event_date AND k.agency_id = al.agency_id AND k.parent_station_id = al.parent_station_id AND k.service_hour = al.service_hour;`, version, version, version, version, version),

			// 25. Surface Routes Dimension View (Bus & Ferry only)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_surface_routes AS
			SELECT *
			FROM %s.view_dim_routes
			WHERE agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY');`, version, version),

			// 26. Surface Stations Dimension View (Bus stops & Ferry landings only)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_surface_stations AS
			SELECT *
			FROM %s.view_dim_stations
			WHERE agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY');`, version, version),

			// 27. Surface Kinematics View (Bus & Ferry only)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_surface_kinematics AS
			SELECT *
			FROM %s.view_vehicle_kinematics
			WHERE agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY');`, version, version),

			// 28. Surface Headways View (Bus & Ferry only)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_surface_headways AS
			SELECT *
			FROM %s.view_station_headways
			WHERE agency_id IN ('MTA_BUS', 'NJT_BUS', 'NYC_FERRY');`, version, version),

			// 29. SCD-Safe Borough Boundary Polygons Dimension View (Exact 5 NYC Boroughs)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_boroughs AS
			SELECT
				boro_code,
				boro_name,
				geom_wkt,
				geom_geojson,
				shape_area,
				shape_leng,
				raw_payload
			FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY boro_code ORDER BY valid_from DESC) AS rn
				FROM %s.dim_boroughs
				WHERE is_current = true AND boro_code BETWEEN 1 AND 5
			) WHERE rn = 1;`, version, version),

			// 29b. SCD-Safe Regional Map Geography Polygons View (NYC Boroughs, Tri-State Landmass, and Major Parks)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_map_geography AS
			SELECT
				boro_code,
				boro_name,
				COALESCE(
					json_extract_string(raw_payload::JSON, '$.region_kind'),
					CASE
						WHEN boro_code BETWEEN 1 AND 5 THEN 'nyc_borough'
						WHEN boro_code BETWEEN 100 AND 199 THEN 'regional_land'
						ELSE 'park'
					END
				) AS region_kind,
				geom_wkt,
				geom_geojson,
				shape_area,
				shape_leng,
				raw_payload
			FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY boro_code ORDER BY valid_from DESC) AS rn
				FROM %s.dim_boroughs
				WHERE is_current = true
			) WHERE rn = 1;`, version, version),

			// 30. SCD-Safe Multi-Agency Service Lines Track Geometry Dimension View (1-to-1 with view_dim_routes on agency_id, route_id)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_service_lines AS
			SELECT
				line_id,
				agency_id,
				route_id,
				service_name,
				division,
				line_name,
				color_hex,
				geom_wkt,
				geom_geojson,
				shape_leng,
				raw_payload
			FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY agency_id, route_id ORDER BY valid_from DESC) AS rn
				FROM %s.dim_service_lines
				WHERE is_current = true AND agency_id NOT LIKE '%%_1953'
			) WHERE rn = 1;`, version, version),

			// 31. 1929 Historical Network Routes View (Pre-IND Dual System: IRT & BMT)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_routes_1929 AS
			SELECT
				route_id,
				agency_id,
				CASE
					WHEN route_id IN ('1','2','3','4','5','6','7','S','GS') THEN 'IRT ' || COALESCE(route_name, route_id)
					ELSE 'BMT ' || COALESCE(route_name, route_id)
				END AS route_name,
				color_hex,
				CASE WHEN route_id IN ('1','2','3','4','5','6','7','S','GS') THEN 'IRT' ELSE 'BMT' END AS division
			FROM %s.view_dim_routes
			WHERE agency_id = 'MTA_NYCT_SUBWAY'
			  AND route_id IN ('1','2','3','4','5','6','7','J','L','M','N','Q','R','W','Z','S','GS');`, version, version),

			// 32. 1929 Historical Network Service Lines Track Geometry View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_service_lines_1929 AS
			SELECT
				route_id,
				agency_id,
				service_name AS route_name,
				color_hex,
				geom_geojson
			FROM %s.view_dim_service_lines
			WHERE agency_id = 'MTA_NYCT_SUBWAY'
			  AND route_id IN ('1','2','3','4','5','6','7','J','L','M','N','Q','R','W','Z','S','GS','FS');`, version, version),

			// 33. 1929 Historical Network Stations View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_stations_1929 AS
			SELECT
				station_id,
				agency_id,
				name,
				latitude,
				longitude,
				gtfs_stop_id,
				complex_id,
				borough,
				daytime_routes
			FROM %s.view_dim_stations
			WHERE agency_id = 'MTA_NYCT_SUBWAY'
			  AND COALESCE(gtfs_stop_id, '') NOT IN (
				'G05','G06','G07','G08','G09','G10','G11','G12','G13','G14','G15','G16','G18','G19','G20','G21',
				'F05','F06','F07','F09','B04','B06','B08','B10','Q03','Q04','Q05','726','301','D13','D22',
				'H01','H02','H03','H04','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15'
			  )
			  AND NOT regexp_matches(COALESCE(daytime_routes, ''), '^[ACEFGbdfmZWTH,\s]+$');`, version, version),

			// 33b. 1953 Board of Transportation Historical Network Routes View (Pre-Chrystie St / Pre-Rockaways / Pre-63rd St / Pre-Archer Ave)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_routes_1953 AS
			SELECT
				route_id,
				agency_id,
				route_name,
				color_hex,
				type,
				raw_payload,
				bullet_code,
				text_color_hex,
				division,
				trunk_group
			FROM %s.view_dim_routes
			WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
			  AND route_id NOT IN ('Z', 'W', 'T', 'H', 'FX', '6X', '7X', 'IBX');`, version, version),

			// 33c. 1953 Board of Transportation Historical Network Service Lines Track Geometry View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_service_lines_1953 AS
			SELECT
				line_id,
				REPLACE(agency_id, '_1953', '') AS agency_id,
				route_id,
				service_name,
				division,
				line_name,
				color_hex,
				geom_wkt,
				geom_geojson,
				shape_leng,
				raw_payload
			FROM (
				SELECT *, ROW_NUMBER() OVER (PARTITION BY agency_id, route_id ORDER BY valid_from DESC) AS rn
				FROM %s.dim_service_lines
				WHERE is_current = true AND agency_id IN ('MTA_NYCT_SUBWAY_1953', 'MTA_NYCT_SIR_1953')
			) WHERE rn = 1;`, version, version),

			// 33d. 1953 Board of Transportation Historical Network Stations View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_stations_1953 AS
			SELECT
				station_id,
				agency_id,
				name,
				latitude,
				longitude,
				gtfs_stop_id,
				complex_id,
				borough,
				daytime_routes
			FROM %s.view_dim_stations
			WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
			  AND COALESCE(gtfs_stop_id, '') NOT IN (
				'G05','G06','G07','B04','B06','B08','Q03','Q04','Q05','726','301','D13','B10','D22',
				'H01','H02','H03','H04','H06','H07','H08','H09','H10','H11','H12','H13','H14','H15'
			  )
			  AND NOT regexp_matches(COALESCE(daytime_routes, ''), '^[ZWHTFX,\s]+$');`, version, version),

			// 34. 2035 Future Network Routes View (Full 2nd Ave Subway T & Interborough Express IBX)
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_routes_proposed AS
			SELECT
				route_id,
				agency_id,
				route_name,
				color_hex,
				'SUBWAY' AS division
			FROM %s.view_dim_routes
			WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
			UNION ALL
			SELECT 'T' AS route_id, 'MTA_NYCT_SUBWAY' AS agency_id, '2 Avenue Express/Local (125 St to Hanover Sq)' AS route_name, '#00ADD0' AS color_hex, 'IND' AS division
			UNION ALL
			SELECT 'IBX' AS route_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Interborough Express (Bay Ridge to Jackson Hts)' AS route_name, '#7C3AED' AS color_hex, 'LRT' AS division;`, version, version),

			// 35. 2035 Future Network Service Lines Track Geometry View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_service_lines_proposed AS
			SELECT
				route_id,
				agency_id,
				service_name AS route_name,
				color_hex,
				geom_geojson
			FROM %s.view_dim_service_lines
			WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
			UNION ALL
			SELECT
				'T' AS route_id,
				'MTA_NYCT_SUBWAY' AS agency_id,
				'2 Avenue Subway (Full Phased Alignment)' AS route_name,
				'#00ADD0' AS color_hex,
				'{"type":"MultiLineString","coordinates":[[[-74.0091,40.7038],[-74.0005,40.7132],[-73.9911,40.7235],[-73.9862,40.7325],[-73.9808,40.7420],[-73.9718,40.7545],[-73.9635,40.7648],[-73.9558,40.7736],[-73.9510,40.7795],[-73.9472,40.7841],[-73.9428,40.7905],[-73.9385,40.7968],[-73.9352,40.8015],[-73.9378,40.8042]]]}' AS geom_geojson
			UNION ALL
			SELECT
				'IBX' AS route_id,
				'MTA_NYCT_SUBWAY' AS agency_id,
				'Interborough Express (Bay Ridge - Brooklyn - Queens)' AS route_name,
				'#7C3AED' AS color_hex,
				'{"type":"MultiLineString","coordinates":[[[-74.0285,40.6350],[-74.0050,40.6315],[-73.9760,40.6295],[-73.9475,40.6320],[-73.9110,40.6465],[-73.9035,40.6762],[-73.9045,40.6990],[-73.9030,40.7220],[-73.8985,40.7385],[-73.8913,40.7466]]]}' AS geom_geojson;`, version, version),

			// 36. 2035 Future Network Stations View
			fmt.Sprintf(`CREATE OR REPLACE VIEW %s.view_dim_stations_proposed AS
			SELECT
				station_id,
				agency_id,
				name,
				latitude,
				longitude,
				gtfs_stop_id,
				complex_id,
				borough,
				daytime_routes
			FROM %s.view_dim_stations
			WHERE agency_id IN ('MTA_NYCT_SUBWAY', 'MTA_NYCT_SIR')
			UNION ALL
			SELECT 'T01' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '125 St-2 Av' AS name, 40.8042 AS latitude, -73.9378 AS longitude, 'T01' AS gtfs_stop_id, 'T01' AS complex_id, 'Manhattan' AS borough, 'Q,T' AS daytime_routes
			UNION ALL
			SELECT 'T02' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '116 St-2 Av' AS name, 40.7968 AS latitude, -73.9385 AS longitude, 'T02' AS gtfs_stop_id, 'T02' AS complex_id, 'Manhattan' AS borough, 'Q,T' AS daytime_routes
			UNION ALL
			SELECT 'T03' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '106 St-2 Av' AS name, 40.7905 AS latitude, -73.9428 AS longitude, 'T03' AS gtfs_stop_id, 'T03' AS complex_id, 'Manhattan' AS borough, 'Q,T' AS daytime_routes
			UNION ALL
			SELECT 'T04' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '55 St-2 Av' AS name, 40.7575 AS latitude, -73.9690 AS longitude, 'T04' AS gtfs_stop_id, 'T04' AS complex_id, 'Manhattan' AS borough, 'T,E,M' AS daytime_routes
			UNION ALL
			SELECT 'T05' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '42 St-2 Av' AS name, 40.7495 AS latitude, -73.9742 AS longitude, 'T05' AS gtfs_stop_id, 'T05' AS complex_id, 'Manhattan' AS borough, 'T,7' AS daytime_routes
			UNION ALL
			SELECT 'T06' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, '14 St-2 Av' AS name, 40.7325 AS latitude, -73.9862 AS longitude, 'T06' AS gtfs_stop_id, 'T06' AS complex_id, 'Manhattan' AS borough, 'T,L' AS daytime_routes
			UNION ALL
			SELECT 'T07' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Houston St-2 Av' AS name, 40.7235 AS latitude, -73.9911 AS longitude, 'T07' AS gtfs_stop_id, 'T07' AS complex_id, 'Manhattan' AS borough, 'T,F' AS daytime_routes
			UNION ALL
			SELECT 'T08' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Hanover Sq' AS name, 40.7038 AS latitude, -74.0091 AS longitude, 'T08' AS gtfs_stop_id, 'T08' AS complex_id, 'Manhattan' AS borough, 'T' AS daytime_routes
			UNION ALL
			SELECT 'IBX01' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Brooklyn Army Terminal (IBX)' AS name, 40.6350 AS latitude, -74.0285 AS longitude, 'IBX01' AS gtfs_stop_id, 'IBX01' AS complex_id, 'Brooklyn' AS borough, 'IBX,N,R' AS daytime_routes
			UNION ALL
			SELECT 'IBX02' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Flatbush Av-Brooklyn College (IBX)' AS name, 40.6320 AS latitude, -73.9475 AS longitude, 'IBX02' AS gtfs_stop_id, 'IBX02' AS complex_id, 'Brooklyn' AS borough, 'IBX,2,5' AS daytime_routes
			UNION ALL
			SELECT 'IBX03' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Broadway Junction (IBX)' AS name, 40.6762 AS latitude, -73.9035 AS longitude, 'IBX03' AS gtfs_stop_id, 'IBX03' AS complex_id, 'Brooklyn' AS borough, 'IBX,A,C,J,L,Z' AS daytime_routes
			UNION ALL
			SELECT 'IBX04' AS station_id, 'MTA_NYCT_SUBWAY' AS agency_id, 'Jackson Hts-Roosevelt Av (IBX)' AS name, 40.7466 AS latitude, -73.8913 AS longitude, 'IBX04' AS gtfs_stop_id, 'IBX04' AS complex_id, 'Queens' AS borough, 'IBX,7,E,F,M,R' AS daytime_routes;`, version, version),
		)
	}

	return ddls
}

