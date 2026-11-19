import type { ChartType } from './cell-state.js';

export function normalizeOssieColumnName(col: string): string {
  const parts = col.split('.');
  return parts[parts.length - 1] ?? col;
}

export interface TileContractDefinition {
  readonly requiredAnyOfSets: readonly (readonly string[])[];
  readonly optionalColumns?: readonly string[];
}

export const TILE_CONTRACTS = {
  'marey-chart': {
    requiredAnyOfSets: [
      ['trip_id'],
      ['arrival_time', 'departure_time', 'event_time'],
      ['station_name', 'name', 'stop_name', 'station_id', 'parent_station_id', 'from_station_id'],
    ],
    optionalColumns: [
      'station_name',
      'name',
      'route_id',
      'stop_sequence',
      'speed',
      'dwell_sec',
      'headway_sec',
      'borough',
      'direction_id',
      'display_value',
      'formatted_value',
      'station_label',
      'route_label',
    ],
  },
  'station-progression': {
    requiredAnyOfSets: [
      ['station_name', 'name', 'stop_name', 'complex_name', 'station_id', 'parent_station_id', 'from_station_id', 'station_label', 'display_label'],
      ['route_id'],
      [
        'headway_sec',
        'avg_headway_sec',
        'effective_speed_mph',
        'leg_speed_mps',
        'service_completion_pct',
        'passenger_count',
        'dwell_sec',
        'travel_time_sec',
        'total_entries',
        'total_exits',
        'ridership',
        'revenue',
        'income',
        'median_income',
        'value',
        'measure',
        'metric_value',
        'amount',
      ],
    ],
    optionalColumns: [
      'station_name',
      'name',
      'stop_name',
      'complex_name',
      'borough',
      'direction_id',
      'route_name',
      'color_hex',
      'display_value',
      'formatted_value',
      'measure_display',
      'value_label',
      'measure_label',
      'metric_label',
      'y_axis_label',
      'measure_unit',
      'unit',
      'station_label',
      'display_label',
      'route_label',
      'line_label',
    ],
  },
  'route-segment-map': {
    requiredAnyOfSets: [
      ['route_id'],
      ['from_station_id', 'latitude', 'from_lat'],
      ['to_station_id', 'longitude', 'to_lat'],
    ],
    optionalColumns: [
      'leg_speed_mps',
      'effective_speed_mph',
      'speed_mph',
      'speed',
      'headway_sec',
      'route_name',
      'from_lat',
      'from_lon',
      'to_lat',
      'to_lon',
      'from_station_name',
      'to_station_name',
      'station_name',
    ],
  },
  'isochrone-map': {
    requiredAnyOfSets: [
      ['station_id', 'parent_station_id', 'gtfs_stop_id', 'stop_id'],
      ['latitude', 'lat', 'st_lat'],
      ['longitude', 'lon', 'st_lon'],
      ['leg_travel_time_sec', 'travel_time_sec', 'travel_time_min', 'duration_sec', 'cumulative_time_min'],
    ],
    optionalColumns: ['name', 'station_name', 'route_id', 'borough'],
  },
  'train-position-map': {
    requiredAnyOfSets: [
      ['vehicle_id', 'trip_id'],
      ['latitude', 'lat'],
      ['longitude', 'lon'],
      ['event_time', 'timestamp'],
    ],
    optionalColumns: ['bearing', 'speed', 'speed_mph', 'route_id', 'occupancy_status', 'status', 'station_id', 'station_name'],
  },
  'headway-horizon': {
    requiredAnyOfSets: [
      ['route_id'],
      ['headway_sec', 'avg_headway_sec', 'headway_sec_squared'],
    ],
    optionalColumns: ['event_time', 'station_id', 'direction_id'],
  },
  'adherence-waterfall': {
    requiredAnyOfSets: [
      ['scheduled_trips_count', 'scheduled_trips', 'scheduled'],
      ['observed_trips_count', 'observed_trips', 'observed'],
    ],
    optionalColumns: [
      'route_id',
      'ghost_trips_count',
      'ghost_trips',
      'unscheduled_trips_count',
      'unscheduled_trips',
      'service_hour',
      'service_completion_pct',
      'event_date',
      'service_date',
    ],
  },
  'multimodal-pulse': {
    requiredAnyOfSets: [
      ['station_id', 'complex_id', 'station_name', 'name', 'complex_name', 'stop_name'],
      ['entry_count', 'exit_count', 'total_entries', 'total_exits', 'entries', 'exits'],
      [
        'num_bikes_available',
        'num_docks_available',
        'num_ebikes_available',
        'bikes_available',
        'ebikes_available',
        'docks_available',
        'num_bikes',
        'bikes',
        'num_ebikes',
        'ebikes',
        'num_docks',
        'docks',
      ],
    ],
    optionalColumns: ['reading_time', 'service_hour', 'latitude', 'longitude', 'event_time', 'hour_of_day'],
  },
  'od-ridership-flow': {
    requiredAnyOfSets: [
      [
        'origin_station_id',
        'from_station_id',
        'origin_station_name',
        'from_station_name',
        'origin_station',
        'from_station',
        'origin_borough',
        'origin',
        'source',
        'from',
      ],
      [
        'destination_station_id',
        'to_station_id',
        'destination_station_name',
        'to_station_name',
        'destination_station',
        'to_station',
        'destination_borough',
        'destination',
        'target',
        'to',
      ],
      ['passenger_count', 'ridership', 'entries', 'flow_count', 'count', 'passengers'],
    ],
    optionalColumns: ['event_date', 'agency_id', 'service_hour', 'route_id'],
  },
} as const;

export type TileContractKey = keyof typeof TILE_CONTRACTS;

export function matchesTileContract(
  availableColumns: readonly string[],
  contract: TileContractDefinition
): boolean {
  const normalized = new Set(availableColumns.map(c => normalizeOssieColumnName(c).toLowerCase()));
  return contract.requiredAnyOfSets.every(set =>
    set.some(candidate => normalized.has(candidate.toLowerCase()))
  );
}

export function detectUnlockedTransitTiles(availableColumns: readonly string[]): ChartType[] {
  const result: ChartType[] = [];
  for (const [tileKey, contract] of Object.entries(TILE_CONTRACTS)) {
    if (matchesTileContract(availableColumns, contract)) {
      result.push(tileKey as ChartType);
    }
  }
  return result;
}

export interface ChartColumnRole {
  readonly roleKey: string;
  readonly label: string;
  readonly canonicalColumn: string;
  readonly aliasTargets?: readonly string[];
  readonly defaultCandidates: readonly string[];
  readonly fallbackType: 'string' | 'number' | 'any';
  readonly required?: boolean;
}

const STANDARD_XY_ROLES: readonly ChartColumnRole[] = [
  {
    roleKey: 'x',
    label: 'X Axis / Category',
    canonicalColumn: 'category',
    defaultCandidates: [
      'event_date',
      'service_hour',
      'hour_of_day',
      'event_time',
      'reading_time',
      'route_id',
      'station_name',
      'borough',
      'division',
      'agency_id',
      'name',
      'category',
    ],
    fallbackType: 'any',
    required: true,
  },
  {
    roleKey: 'y',
    label: 'Y Axis / Primary Metric',
    canonicalColumn: 'value',
    defaultCandidates: [
      'entries',
      'entry_count',
      'total_entries',
      'passenger_count',
      'active_trains',
      'station_count',
      'route_count',
      'headway_sec',
      'avg_headway_sec',
      'effective_speed_mph',
      'observed_trips_count',
      'service_completion_pct',
      'travel_time_min',
      'travel_time_sec',
      'speed_mph',
      'count',
      'value',
    ],
    fallbackType: 'number',
    required: true,
  },
  {
    roleKey: 'y2',
    label: 'Secondary Metric (Optional)',
    canonicalColumn: 'value_secondary',
    defaultCandidates: [
      'exits',
      'exit_count',
      'total_exits',
      'scheduled_trips_count',
      'num_bikes_available',
      'leg_travel_time_sec',
    ],
    fallbackType: 'number',
    required: false,
  },
];

const PROPORTIONAL_ROLES: readonly ChartColumnRole[] = [
  {
    roleKey: 'x',
    label: 'Category / Slice Label',
    canonicalColumn: 'category',
    defaultCandidates: [
      'route_id',
      'borough',
      'station_name',
      'division',
      'agency_id',
      'status',
      'name',
      'category',
    ],
    fallbackType: 'string',
    required: true,
  },
  {
    roleKey: 'y',
    label: 'Value / Size Metric',
    canonicalColumn: 'value',
    defaultCandidates: [
      'active_trains',
      'entries',
      'entry_count',
      'passenger_count',
      'observed_trips_count',
      'station_count',
      'route_count',
      'headway_sec',
      'effective_speed_mph',
      'count',
      'value',
    ],
    fallbackType: 'number',
    required: true,
  },
];

export const CHART_DEFAULT_SCHEMAS: Readonly<Record<ChartType, readonly ChartColumnRole[]>> = {
  table: [
    {
      roleKey: 'x',
      label: 'Primary Key / Label Column',
      canonicalColumn: 'station_name',
      defaultCandidates: ['station_name', 'route_id', 'borough', 'event_date', 'trip_id', 'name'],
      fallbackType: 'any',
      required: false,
    },
    {
      roleKey: 'y',
      label: 'Primary Metric Column',
      canonicalColumn: 'value',
      defaultCandidates: ['entries', 'entry_count', 'passenger_count', 'headway_sec', 'effective_speed_mph', 'active_trains'],
      fallbackType: 'number',
      required: false,
    },
  ],
  bar: STANDARD_XY_ROLES,
  'stacked-bar': STANDARD_XY_ROLES,
  line: STANDARD_XY_ROLES,
  area: STANDARD_XY_ROLES,
  'stacked-area': STANDARD_XY_ROLES,
  scatter: [
    {
      roleKey: 'x',
      label: 'X Axis Metric',
      canonicalColumn: 'x',
      defaultCandidates: ['scheduled_trips_count', 'entries', 'entry_count', 'headway_sec', 'latitude', 'longitude', 'hour_of_day'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'y',
      label: 'Y Axis Metric',
      canonicalColumn: 'y',
      defaultCandidates: ['observed_trips_count', 'exits', 'exit_count', 'effective_speed_mph', 'speed_mph', 'num_bikes_available', 'travel_time_min'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'color',
      label: 'Group / Route Label',
      canonicalColumn: 'route_id',
      defaultCandidates: ['route_id', 'station_name', 'borough', 'agency_id'],
      fallbackType: 'string',
      required: false,
    },
  ],
  pie: PROPORTIONAL_ROLES,
  donut: PROPORTIONAL_ROLES,
  'kpi-metric': [
    {
      roleKey: 'y',
      label: 'KPI Metric Value',
      canonicalColumn: 'value',
      defaultCandidates: ['service_completion_pct', 'entries', 'entry_count', 'passenger_count', 'active_trains', 'headway_sec', 'effective_speed_mph', 'value'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'x',
      label: 'KPI Subtitle / Category',
      canonicalColumn: 'label',
      defaultCandidates: ['route_id', 'station_name', 'borough', 'event_date', 'name'],
      fallbackType: 'string',
      required: false,
    },
  ],
  gauge: [
    {
      roleKey: 'y',
      label: 'Gauge Value',
      canonicalColumn: 'value',
      defaultCandidates: ['service_completion_pct', 'effective_speed_mph', 'speed_mph', 'headway_sec', 'entries', 'active_trains', 'value'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'x',
      label: 'Gauge Label',
      canonicalColumn: 'label',
      defaultCandidates: ['route_id', 'station_name', 'borough', 'name'],
      fallbackType: 'string',
      required: false,
    },
  ],
  heatmap: [
    {
      roleKey: 'x',
      label: 'X Axis (Column Bucket)',
      canonicalColumn: 'x',
      defaultCandidates: ['service_hour', 'hour_of_day', 'event_date', 'destination_station_name', 'to_station_name', 'borough'],
      fallbackType: 'any',
      required: true,
    },
    {
      roleKey: 'color',
      label: 'Y Axis (Row Category)',
      canonicalColumn: 'y_category',
      defaultCandidates: ['route_id', 'station_name', 'origin_station_name', 'from_station_name', 'borough'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'y',
      label: 'Cell Intensity Value',
      canonicalColumn: 'value',
      defaultCandidates: ['passenger_count', 'entry_count', 'entries', 'headway_sec', 'effective_speed_mph', 'observed_trips_count', 'active_trains'],
      fallbackType: 'number',
      required: true,
    },
  ],
  treemap: PROPORTIONAL_ROLES,
  funnel: PROPORTIONAL_ROLES,
  radar: STANDARD_XY_ROLES,
  'choropleth-borough': [
    {
      roleKey: 'x',
      label: 'Borough Name',
      canonicalColumn: 'borough',
      aliasTargets: ['borough', 'origin_borough'],
      defaultCandidates: ['borough', 'origin_borough', 'destination_borough', 'station_name', 'route_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'y',
      label: 'Borough Metric Value',
      canonicalColumn: 'value',
      defaultCandidates: ['entries', 'entry_count', 'passenger_count', 'headway_sec', 'effective_speed_mph', 'active_trains', 'value'],
      fallbackType: 'number',
      required: true,
    },
  ],
  'station-progression': [
    {
      roleKey: 'station',
      label: 'Station Name / Stop',
      canonicalColumn: 'station_name',
      aliasTargets: ['station_name', 'station_id'],
      defaultCandidates: ['station_name', 'name', 'stop_name', 'complex_name', 'station_id', 'from_station_name', 'origin_station_name'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'route',
      label: 'Route / Line ID',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'route_name', 'borough', 'agency_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'metric',
      label: 'Corridor Metric (Y Axis)',
      canonicalColumn: 'headway_sec',
      aliasTargets: ['headway_sec', 'avg_headway_sec'],
      defaultCandidates: [
        'headway_sec',
        'avg_headway_sec',
        'effective_speed_mph',
        'service_completion_pct',
        'passenger_count',
        'entry_count',
        'entries',
        'travel_time_sec',
        'active_trains',
        'value',
      ],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'borough',
      label: 'Borough Band (Optional)',
      canonicalColumn: 'borough',
      aliasTargets: ['borough'],
      defaultCandidates: ['borough', 'origin_borough', 'agency_id'],
      fallbackType: 'string',
      required: false,
    },
  ],
  'marey-chart': [
    {
      roleKey: 'trip',
      label: 'Trip / Vehicle ID',
      canonicalColumn: 'trip_id',
      aliasTargets: ['trip_id'],
      defaultCandidates: ['trip_id', 'vehicle_id', 'route_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'time',
      label: 'Arrival / Event Time',
      canonicalColumn: 'event_time',
      aliasTargets: ['event_time', 'arrival_time'],
      defaultCandidates: ['event_time', 'arrival_time', 'departure_time', 'reading_time', 'service_hour', 'event_date'],
      fallbackType: 'any',
      required: true,
    },
    {
      roleKey: 'station',
      label: 'Station / Stop',
      canonicalColumn: 'station_name',
      aliasTargets: ['station_name', 'station_id'],
      defaultCandidates: ['station_name', 'station_id', 'stop_name', 'from_station_name', 'name'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'route',
      label: 'Route ID',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'agency_id', 'borough'],
      fallbackType: 'string',
      required: false,
    },
  ],
  'headway-horizon': [
    {
      roleKey: 'route',
      label: 'Route / Series Band',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'station_name', 'borough', 'agency_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'headway',
      label: 'Headway / Interval (sec)',
      canonicalColumn: 'headway_sec',
      aliasTargets: ['headway_sec', 'headway_seconds'],
      defaultCandidates: ['headway_sec', 'avg_headway_sec', 'headway_seconds', 'travel_time_sec', 'leg_travel_time_sec', 'entries', 'entry_count'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'time',
      label: 'Event Time Bucket',
      canonicalColumn: 'event_time',
      aliasTargets: ['event_time'],
      defaultCandidates: ['event_time', 'reading_time', 'service_hour', 'event_date'],
      fallbackType: 'any',
      required: false,
    },
  ],
  'adherence-waterfall': [
    {
      roleKey: 'route',
      label: 'Route / Line ID',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'route_name', 'borough', 'station_name'],
      fallbackType: 'string',
      required: false,
    },
    {
      roleKey: 'scheduled',
      label: 'Scheduled Baseline',
      canonicalColumn: 'scheduled_trips_count',
      aliasTargets: ['scheduled_trips_count', 'scheduled'],
      defaultCandidates: ['scheduled_trips_count', 'scheduled_trips', 'scheduled', 'entries', 'entry_count', 'passenger_count'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'observed',
      label: 'Observed Operated',
      canonicalColumn: 'observed_trips_count',
      aliasTargets: ['observed_trips_count', 'observed'],
      defaultCandidates: ['observed_trips_count', 'observed_trips', 'observed', 'exits', 'exit_count', 'active_trains'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'ghost',
      label: 'Missing / Ghost Drop',
      canonicalColumn: 'ghost_trips_count',
      aliasTargets: ['ghost_trips_count', 'ghost'],
      defaultCandidates: ['ghost_trips_count', 'ghost_trips', 'ghost'],
      fallbackType: 'number',
      required: false,
    },
    {
      roleKey: 'unscheduled',
      label: 'Unscheduled Added',
      canonicalColumn: 'unscheduled_trips_count',
      aliasTargets: ['unscheduled_trips_count', 'unscheduled'],
      defaultCandidates: ['unscheduled_trips_count', 'unscheduled_trips', 'unscheduled'],
      fallbackType: 'number',
      required: false,
    },
  ],
  'multimodal-pulse': [
    {
      roleKey: 'station',
      label: 'Station / Hub Name',
      canonicalColumn: 'station_name',
      aliasTargets: ['station_name', 'station_id'],
      defaultCandidates: ['station_name', 'complex_name', 'station_id', 'name', 'route_id', 'borough'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'time',
      label: 'Service Hour / Time',
      canonicalColumn: 'service_hour',
      aliasTargets: ['service_hour'],
      defaultCandidates: ['service_hour', 'hour_of_day', 'reading_time', 'event_time', 'event_date'],
      fallbackType: 'any',
      required: false,
    },
    {
      roleKey: 'entries',
      label: 'Subway Entries (Bars)',
      canonicalColumn: 'entry_count',
      aliasTargets: ['entry_count', 'entries'],
      defaultCandidates: ['entry_count', 'entries', 'total_entries', 'passenger_count', 'observed_trips_count', 'headway_sec'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'bikes',
      label: 'Bikes Available (Line)',
      canonicalColumn: 'num_bikes_available',
      aliasTargets: ['num_bikes_available', 'bikes_available'],
      defaultCandidates: ['num_bikes_available', 'bikes_available', 'bikes', 'exit_count', 'exits', 'scheduled_trips_count', 'effective_speed_mph'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'ebikes',
      label: 'E-Bikes Available (Optional)',
      canonicalColumn: 'num_ebikes_available',
      aliasTargets: ['num_ebikes_available', 'ebikes_available'],
      defaultCandidates: ['num_ebikes_available', 'ebikes_available', 'ebikes'],
      fallbackType: 'number',
      required: false,
    },
    {
      roleKey: 'docks',
      label: 'Docks Available (Optional)',
      canonicalColumn: 'num_docks_available',
      aliasTargets: ['num_docks_available', 'docks_available'],
      defaultCandidates: ['num_docks_available', 'docks_available', 'docks'],
      fallbackType: 'number',
      required: false,
    },
  ],
  'od-ridership-flow': [
    {
      roleKey: 'origin',
      label: 'Origin Station / Node',
      canonicalColumn: 'origin_station_name',
      aliasTargets: ['origin_station_name', 'origin_station_id', 'origin'],
      defaultCandidates: ['origin_station_name', 'origin_station_id', 'from_station_name', 'from_station_id', 'origin_borough', 'borough', 'route_id', 'station_name'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'destination',
      label: 'Destination Station / Node',
      canonicalColumn: 'destination_station_name',
      aliasTargets: ['destination_station_name', 'destination_station_id', 'destination'],
      defaultCandidates: ['destination_station_name', 'destination_station_id', 'to_station_name', 'to_station_id', 'destination_borough', 'station_name', 'borough'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'flow',
      label: 'Passenger / Flow Volume',
      canonicalColumn: 'passenger_count',
      aliasTargets: ['passenger_count', 'ridership'],
      defaultCandidates: ['passenger_count', 'ridership', 'entries', 'entry_count', 'observed_trips_count', 'headway_sec', 'active_trains'],
      fallbackType: 'number',
      required: true,
    },
  ],
  'route-segment-map': [
    {
      roleKey: 'route',
      label: 'Route ID',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'agency_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'fromStation',
      label: 'From Station ID',
      canonicalColumn: 'from_station_id',
      aliasTargets: ['from_station_id'],
      defaultCandidates: ['from_station_id', 'station_id', 'origin_station_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'toStation',
      label: 'To Station ID',
      canonicalColumn: 'to_station_id',
      aliasTargets: ['to_station_id'],
      defaultCandidates: ['to_station_id', 'destination_station_id', 'station_id'],
      fallbackType: 'string',
      required: false,
    },
    {
      roleKey: 'metric',
      label: 'Segment Metric (mph / sec)',
      canonicalColumn: 'effective_speed_mph',
      aliasTargets: ['effective_speed_mph', 'speed_mph'],
      defaultCandidates: ['effective_speed_mph', 'speed_mph', 'leg_travel_time_sec', 'headway_sec', 'travel_time_sec'],
      fallbackType: 'number',
      required: true,
    },
  ],
  'isochrone-map': [
    {
      roleKey: 'station',
      label: 'Station ID',
      canonicalColumn: 'station_id',
      aliasTargets: ['station_id'],
      defaultCandidates: ['station_id', 'from_station_id', 'origin_station_id', 'stop_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'lat',
      label: 'Latitude',
      canonicalColumn: 'latitude',
      aliasTargets: ['latitude', 'lat'],
      defaultCandidates: ['latitude', 'lat', 'from_lat'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'lon',
      label: 'Longitude',
      canonicalColumn: 'longitude',
      aliasTargets: ['longitude', 'lon'],
      defaultCandidates: ['longitude', 'lon', 'from_lon'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'travelTime',
      label: 'Travel Time (sec)',
      canonicalColumn: 'travel_time_sec',
      aliasTargets: ['travel_time_sec'],
      defaultCandidates: ['travel_time_sec', 'leg_travel_time_sec', 'travel_time_min', 'headway_sec'],
      fallbackType: 'number',
      required: true,
    },
  ],
  'train-position-map': [
    {
      roleKey: 'vehicle',
      label: 'Vehicle / Trip ID',
      canonicalColumn: 'vehicle_id',
      aliasTargets: ['vehicle_id', 'trip_id'],
      defaultCandidates: ['vehicle_id', 'trip_id', 'station_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'route',
      label: 'Route ID',
      canonicalColumn: 'route_id',
      aliasTargets: ['route_id'],
      defaultCandidates: ['route_id', 'agency_id'],
      fallbackType: 'string',
      required: true,
    },
    {
      roleKey: 'lat',
      label: 'Latitude',
      canonicalColumn: 'latitude',
      aliasTargets: ['latitude', 'lat'],
      defaultCandidates: ['latitude', 'lat', 'from_lat'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'lon',
      label: 'Longitude',
      canonicalColumn: 'longitude',
      aliasTargets: ['longitude', 'lon'],
      defaultCandidates: ['longitude', 'lon', 'from_lon'],
      fallbackType: 'number',
      required: true,
    },
    {
      roleKey: 'time',
      label: 'Event Timestamp',
      canonicalColumn: 'event_time',
      aliasTargets: ['event_time', 'timestamp'],
      defaultCandidates: ['event_time', 'timestamp', 'reading_time', 'event_date'],
      fallbackType: 'any',
      required: true,
    },
    {
      roleKey: 'speed',
      label: 'Speed (mph)',
      canonicalColumn: 'speed_mph',
      aliasTargets: ['speed_mph', 'speed'],
      defaultCandidates: ['speed_mph', 'speed', 'effective_speed_mph'],
      fallbackType: 'number',
      required: false,
    },
  ],
};

function isNumericColumnType(typeStr?: string): boolean {
  if (!typeStr) return false;
  const upper = typeStr.toUpperCase();
  return (
    upper.includes('INT') ||
    upper.includes('DOUBLE') ||
    upper.includes('FLOAT') ||
    upper.includes('DECIMAL') ||
    upper.includes('NUMERIC') ||
    upper.includes('REAL') ||
    upper.includes('NUMBER') ||
    upper.includes('HUGEINT')
  );
}

/**
 * Checks whether a chart type's default schema is natively satisfied by the given column names.
 */
export function isChartSchemaCompatible(
  chartType: ChartType,
  availableColumnNames: readonly string[]
): boolean {
  if (chartType in TILE_CONTRACTS) {
    return matchesTileContract(
      availableColumnNames,
      TILE_CONTRACTS[chartType as TileContractKey]
    );
  }
  if (chartType === 'table') return true;
  return availableColumnNames.length >= 2;
}

/**
 * Resolves the column mapping for a given chartType against the available columns and any user overrides.
 */
export function resolveChartColumnMapping(
  chartType: ChartType,
  availableColumns: readonly { readonly name: string; readonly type?: string }[],
  customMapping?: Readonly<Record<string, string>>,
  chartConfig?: Readonly<Record<string, unknown>>
): Record<string, string> {
  const roles = CHART_DEFAULT_SCHEMAS[chartType] ?? STANDARD_XY_ROLES;
  const colNames = availableColumns.map(c => c.name);
  const lowerToActual = new Map<string, string>();
  for (const name of colNames) {
    lowerToActual.set(name.toLowerCase(), name);
    lowerToActual.set(normalizeOssieColumnName(name).toLowerCase(), name);
  }

  const resolved: Record<string, string> = {};
  const usedCols = new Set<string>();

  for (const role of roles) {
    // 1. Explicit user mapping from columnMapping widget
    const userCol = customMapping?.[role.roleKey];
    if (userCol && (colNames.length === 0 || colNames.includes(userCol))) {
      resolved[role.roleKey] = userCol;
      usedCols.add(userCol);
      continue;
    }

    // 2. Legacy chartConfig field fallbacks (xColumn, yColumns, metricColumn)
    if (role.roleKey === 'x' && typeof chartConfig?.['xColumn'] === 'string') {
      const xCol = chartConfig['xColumn'];
      if (colNames.includes(xCol)) {
        resolved[role.roleKey] = xCol;
        usedCols.add(xCol);
        continue;
      }
    }
    if (role.roleKey === 'y' && Array.isArray(chartConfig?.['yColumns']) && typeof chartConfig['yColumns'][0] === 'string') {
      const yCol = chartConfig['yColumns'][0];
      if (colNames.includes(yCol)) {
        resolved[role.roleKey] = yCol;
        usedCols.add(yCol);
        continue;
      }
    }
    if (role.roleKey === 'metric' && typeof chartConfig?.['metricColumn'] === 'string') {
      const mCol = chartConfig['metricColumn'];
      if (colNames.includes(mCol)) {
        resolved[role.roleKey] = mCol;
        usedCols.add(mCol);
        continue;
      }
    }

    // 3. Default schema candidate match
    let matchedCandidate: string | undefined;
    for (const cand of role.defaultCandidates) {
      const actual = lowerToActual.get(cand.toLowerCase());
      if (actual && (!usedCols.has(actual) || role.required)) {
        matchedCandidate = actual;
        break;
      }
    }
    if (matchedCandidate) {
      resolved[role.roleKey] = matchedCandidate;
      usedCols.add(matchedCandidate);
      continue;
    }

    // 4. Automatic type-based fallback for required roles so unlocked charts always render sensibly
    if (role.required && availableColumns.length > 0) {
      let fallbackCol: string | undefined;
      if (role.fallbackType === 'number') {
        fallbackCol =
          availableColumns.find(c => !usedCols.has(c.name) && isNumericColumnType(c.type))?.name ??
          availableColumns.find(c => isNumericColumnType(c.type))?.name;
      } else if (role.fallbackType === 'string') {
        fallbackCol =
          availableColumns.find(c => !usedCols.has(c.name) && !isNumericColumnType(c.type))?.name ??
          availableColumns.find(c => !isNumericColumnType(c.type))?.name;
      }
      if (!fallbackCol) {
        fallbackCol = availableColumns.find(c => !usedCols.has(c.name))?.name ?? availableColumns[0]?.name;
      }
      if (fallbackCol) {
        resolved[role.roleKey] = fallbackCol;
        usedCols.add(fallbackCol);
      }
    }
  }

  return resolved;
}

/**
 * Applies resolved column mappings onto rows and chartConfig so any query result can drive any visual.
 */
export function applyChartColumnMapping(
  chartType: ChartType,
  rows: readonly Record<string, unknown>[],
  availableColumns: readonly { readonly name: string; readonly type?: string }[],
  chartConfig?: Readonly<Record<string, unknown>>
): {
  mappedRows: readonly Record<string, unknown>[];
  effectiveConfig: Record<string, unknown>;
  resolvedMapping: Record<string, string>;
} {
  const baseConfig: Record<string, unknown> = { ...(chartConfig ?? {}) };
  const customMapping = (baseConfig['columnMapping'] as Readonly<Record<string, string>> | undefined) ?? undefined;
  const inferredColumns =
    availableColumns.length > 0
      ? availableColumns
      : rows.length > 0 && rows[0]
        ? Object.keys(rows[0]).map(k => ({
            name: k,
            type: typeof rows[0]![k] === 'number' ? 'DOUBLE' : 'VARCHAR',
          }))
        : [];

  const resolvedMapping = resolveChartColumnMapping(chartType, inferredColumns, customMapping, baseConfig);
  const hasCustomOverrides = Boolean(customMapping && Object.keys(customMapping).length > 0);
  const roles = CHART_DEFAULT_SCHEMAS[chartType] ?? STANDARD_XY_ROLES;

  // Propagate mapped X / Y / Metric columns into effectiveConfig for renderers that read config directly
  if (resolvedMapping['x'] && (hasCustomOverrides || !baseConfig['xColumn'])) {
    baseConfig['xColumn'] = resolvedMapping['x'];
  }
  if (resolvedMapping['y'] && (hasCustomOverrides || !baseConfig['yColumns'])) {
    const yCols = [resolvedMapping['y']];
    if (resolvedMapping['y2'] && resolvedMapping['y2'] !== resolvedMapping['y']) {
      yCols.push(resolvedMapping['y2']);
    }
    baseConfig['yColumns'] = yCols;
  }
  if (resolvedMapping['color'] && (hasCustomOverrides || !baseConfig['colorColumn'])) {
    baseConfig['colorColumn'] = resolvedMapping['color'];
  }
  if (resolvedMapping['metric'] && (hasCustomOverrides || !baseConfig['metricColumn'])) {
    baseConfig['metricColumn'] = resolvedMapping['metric'];
  }

  if (rows.length === 0) {
    return { mappedRows: rows, effectiveConfig: baseConfig, resolvedMapping };
  }

  // Check if we need to alias any columns onto rows (either user set customMapping, or a transit visual's canonical column is missing on rows[0])
  const sampleRow = rows[0]!;
  const isNativelyCompatible = isChartSchemaCompatible(
    chartType,
    inferredColumns.map(c => c.name)
  );

  const rolesNeedingRowAlias = roles.filter(role => {
    const srcCol = resolvedMapping[role.roleKey];
    if (!srcCol) return false;
    const userExplicitlyMappedRole = Boolean(customMapping?.[role.roleKey]);
    if (userExplicitlyMappedRole && srcCol !== role.canonicalColumn) {
      return true;
    }
    if (!isNativelyCompatible && !(role.canonicalColumn in sampleRow)) {
      return true;
    }
    return false;
  });

  if (rolesNeedingRowAlias.length === 0) {
    return { mappedRows: rows, effectiveConfig: baseConfig, resolvedMapping };
  }

  const mappedRows = rows.map(row => {
    const clone: Record<string, unknown> = { ...row };
    for (const role of rolesNeedingRowAlias) {
      const srcCol = resolvedMapping[role.roleKey];
      if (!srcCol || !(srcCol in row)) continue;
      const val = row[srcCol];
      clone[role.canonicalColumn] = val;
      if (role.aliasTargets) {
        for (const target of role.aliasTargets) {
          clone[target] = val;
        }
      }
    }
    return clone;
  });

  return { mappedRows, effectiveConfig: baseConfig, resolvedMapping };
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected object: ${String(x)}`);
}
