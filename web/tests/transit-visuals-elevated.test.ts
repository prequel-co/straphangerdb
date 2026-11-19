import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupNycTestNetwork } from './fixtures/nyc-test-network.js';
import { buildAdherenceWaterfallOption } from '../src/viz/transit/adherence-waterfall.js';
import { buildMultimodalPulseOption } from '../src/viz/transit/multimodal-pulse.js';
import { buildOdRidershipFlowOption } from '../src/viz/transit/od-ridership-flow.js';
import { buildRouteSegmentGeoJson, isEastRiverCrossing, getSpeedTierColor } from '../src/viz/transit/route-segment-map.js';
import {
  parseEventEpochSec,
  buildTrainFeatures,
  buildTrainPopupHtml,
  attachPopupCopyHandlers,
  renderTrainPositions,
} from '../src/viz/transit/train-position-map.js';
import {
  buildIsochroneBandsGeoJson,
  buildStationWalkGradientGeoJson,
  renderIsochroneMap,
} from '../src/viz/transit/isochrone-map.js';
import { buildMapTableCustomizationModalHtml } from '../src/viz/chart-router.js';
import {
  TRANSFER_HUB_STATION_IDS,
  resolveStationInfo,
  hydrateStationCache,
  buildMtaSubwayMapGeoJson,
  getActiveMapNetworkData,
  extractCurvedSegmentAlongServiceLine,
  interpolateAlongServiceLine,
  projectStationOntoServiceLine,
  snapPointToSubwayTrack,
  cleanStationLabelText,
  extractRoutesFromStationText,
  normalizeStationRoutes,
  getStopPillIconId,
  selectCompactCapsuleRoutes,
  MAP_TABLE_SCHEMA_CONTRACTS,
  MAP_NETWORK_TABLE_PRESETS,
  validateMapTableSchema,
  bootstrapMapNetworkFromDuckDb,
  setActiveMapNetworkData,
  resetActiveMapNetworkData,
  setActiveMapVisualTheme,
  getActiveMapVisualTheme,
} from '../src/viz/map/mta-subway-overlay.js';
import {
  MAP_VISUAL_THEMES,
  getMapThemeSpec,
  buildMapStyleForTheme,
} from '../src/viz/map/transit-map-style.js';
import { ALLMAPS_IIIF_PRESETS } from '../src/viz/map/allmaps-layer.js';

describe('Elevated Transit Visualizations', () => {
  beforeEach(() => {
    setupNycTestNetwork();
  });

  afterEach(() => {
    resetActiveMapNetworkData();
  });

  describe('Adherence Waterfall', () => {
    it('handles empty rows gracefully with fallback title', () => {
      const option = buildAdherenceWaterfallOption([]);
      expect(option.title).toBeDefined();
      const title = option.title as { text: string };
      expect(title.text).toBe('No Schedule Adherence Telemetry');
    });

    it('builds editorial waterfall arithmetic with floating base and delta labels', () => {
      const rows = [
        {
          route_id: 'L',
          scheduled_trips_count: 240,
          observed_trips_count: 232,
          ghost_trips_count: 10,
          unscheduled_trips_count: 2,
          service_completion_pct: 96.7,
        },
      ];

      const option = buildAdherenceWaterfallOption(rows);
      expect(option.series).toBeDefined();
      const series = option.series as Array<{ name: string; type: string; data: unknown[] }>;
      expect(series.length).toBeGreaterThanOrEqual(2);

      // Series 0 is transparent base offset bar
      expect(series[0]!.name).toBe('Placeholder Base');
      expect(series[0]!.type).toBe('bar');

      // Series 1 is visible delta/metric bar
      expect(series[1]!.name).toBe('Trips Change');
      expect(series[1]!.type).toBe('bar');

      // Grid should have dashed horizontal splitLines on Y axis
      const yAxis = option.yAxis as { splitLine?: { show?: boolean; lineStyle?: { type?: string } } };
      expect(yAxis.splitLine?.show).toBe(true);
      expect(yAxis.splitLine?.lineStyle?.type).toBe('dashed');

      // Title should contain adherence status pill
      const title = option.title as { text: string; subtext?: string };
      expect(title.text).toContain('Service Completion');
      expect(title.text).toContain('Adherence');
      expect(title.text).toContain('96.7%');
      expect(title.subtext).toContain('232 observed of 240 scheduled');
    });
    it('applies MTA editorial color specification: #FF6319 observed net bar and #D82222 ghost drop', () => {
      const rows = [
        {
          route_id: 'L',
          scheduled: 280,
          observed: 270,
          ghost: 12,
          unscheduled: 2,
        },
      ];
      const option = buildAdherenceWaterfallOption(rows);
      const series = option.series as Array<{ name: string; type: string; data: Array<{ value: number; itemStyle?: { color?: string } }> }>;
      const valBars = series[1]!.data;

      expect(valBars[0]!.itemStyle?.color).toBe('#0039A6'); // Scheduled MTA Blue
      expect(valBars[1]!.itemStyle?.color).toBe('#D82222'); // Ghost drop Red
      expect(valBars[2]!.itemStyle?.color).toBe('#00933C'); // Unscheduled rise Green
      expect(valBars[3]!.itemStyle?.color).toBe('#FF6319'); // Observed net bar MTA Orange
    });

    it('clamps negative input values and includes route identifier in subtext', () => {
      const rows = [
        {
          route_id: 'L',
          scheduled: -50,
          observed: 200,
          ghost: -10,
          unscheduled: 20,
        },
      ];
      const option = buildAdherenceWaterfallOption(rows);
      const title = option.title as { text: string; subtext?: string };
      expect(title.subtext).toContain('L Line:');
      expect(title.subtext).toContain('200 observed of 0 scheduled');
    });

    it('correctly handles zero scheduled trips with unscheduled observed runs', () => {
      const rows = [
        {
          route_id: 'M',
          scheduled: 0,
          observed: 15,
        },
      ];
      const option = buildAdherenceWaterfallOption(rows);
      const title = option.title as { text: string; subtext?: string };
      expect(title.text).toContain('Service Completion: 100%');
      expect(title.text).toContain('Unscheduled Service');
      expect(title.subtext).toContain('15 observed of 0 scheduled');
      expect(title.subtext).toContain('+15 unscheduled');

      const series = option.series as Array<{ name: string; data: Array<{ value: number }> }>;
      expect(series[1]!.data[2]!.value).toBe(15); // Unscheduled Added
      expect(series[1]!.data[3]!.value).toBe(15); // Observed Operated
    });
  });

  describe('Multimodal Pulse', () => {
    it('handles empty rows gracefully with fallback title', () => {
      const option = buildMultimodalPulseOption([]);
      expect(option.title).toBeDefined();
      const title = option.title as { text: string };
      expect(title.text).toBe('No Multimodal Telemetry');
    });

    it('prevents dual-axis gridline collision by showing splitLine only on left Y-axis', () => {
      const rows = [
        {
          station_id: '631',
          service_hour: '8:00 AM',
          entry_count: 4200,
          exit_count: 11500,
          num_bikes_available: 14,
          num_docks_available: 36,
          num_ebikes_available: 4,
        },
        {
          station_id: '631',
          service_hour: '9:00 AM',
          entry_count: 3800,
          exit_count: 12800,
          num_bikes_available: 8,
          num_docks_available: 42,
          num_ebikes_available: 2,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'time' });
      const yAxes = option.yAxis as Array<{ splitLine?: { show?: boolean }; position?: string; min?: number }>;
      expect(yAxes).toHaveLength(2);

      // Left axis has dashed splitLine
      expect(yAxes[0]!.splitLine?.show).toBe(true);
      expect(yAxes[0]!.min).toBe(0);

      // Right axis MUST NOT have splitLine to avoid gridline collision
      expect(yAxes[1]!.splitLine?.show).toBe(false);
      expect(yAxes[1]!.min).toBe(0);

      // Series includes subway bars and bike lines
      const series = option.series as Array<{ name: string; type: string; yAxisIndex?: number }>;
      expect(series.some(s => s.name === 'Subway Entries' && s.type === 'bar')).toBe(true);
      expect(series.some(s => s.name === 'Subway Exits' && s.type === 'bar')).toBe(true);
      expect(series.some(s => s.name === 'Citi Bikes Available' && s.type === 'line' && s.yAxisIndex === 1)).toBe(true);
    });

    it('correctly parses HH:MM service_hour strings and sorts chronologically', () => {
      const rows = [
        {
          station_id: '631',
          service_hour: '09:00',
          entries: 3800,
          exits: 12800,
          num_bikes_available: 8,
          docks_available: 42,
        },
        {
          station_id: '631',
          service_hour: '06:00',
          entries: 1200,
          exits: 2100,
          num_bikes_available: 22,
          docks_available: 18,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'time' });
      const xAxis = option.xAxis as { data: string[] };
      expect(xAxis.data).toEqual(['6:00 AM', '9:00 AM']);

      const yAxes = option.yAxis as Array<{ min?: number }>;
      expect(yAxes[0]!.min).toBe(0);
      expect(yAxes[1]!.min).toBe(0);
    });

    it('expands a solitary 1-hour bucket (e.g. 11:00 AM) into a 24-hour diurnal profile in time mode so it never renders a single bar', () => {
      const rows = [
        {
          station_id: '610',
          hour_of_day: 11,
          entry_count: 6850,
          num_bikes_available: 245,
          num_ebikes_available: 65,
          num_docks_available: 390,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'time' });
      const xAxis = option.xAxis as { data: string[] };
      expect(xAxis.data).toHaveLength(24);
      expect(xAxis.data[0]).toBe('12:00 AM');
      expect(xAxis.data[11]).toBe('11:00 AM');
      expect(xAxis.data[23]).toBe('11:00 PM');

      const series = option.series as Array<{ name: string; data: number[] }>;
      const entriesSeries = series.find(s => s.name === 'Subway Entries')!;
      expect(entriesSeries.data).toHaveLength(24);
      expect(entriesSeries.data[11]).toBe(6850);
      expect(entriesSeries.data[8]).toBeGreaterThan(entriesSeries.data[11]!);

      // Also verify a non-11:00 AM single-hour row (e.g. 08:00 AM / hour_of_day: 8) anchors at index 8 rather than falling back to 11
      const option8am = buildMultimodalPulseOption(
        [
          {
            station_id: '610',
            hour_of_day: 8,
            service_hour: '08:00',
            entry_count: 9420,
            num_bikes_available: 110,
            num_ebikes_available: 30,
            num_docks_available: 290,
          },
        ],
        { groupBy: 'time' }
      );
      const entries8am = (option8am.series as Array<{ name: string; data: number[] }>).find(
        s => s.name === 'Subway Entries'
      )!;
      expect(entries8am.data).toHaveLength(24);
      expect(entries8am.data[8]).toBe(9420);
      expect(entries8am.data[11]).toBeLessThan(9420);
    });

    it('anchors zero ground baseline with min: 0 in station mode', () => {
      const rows = [
        {
          station_id: '631',
          station_name: 'Grand Central-42 St',
          entries: 45000,
          exits: 52000,
          num_bikes_available: 12,
          ebikes_available: 5,
          docks_available: 34,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'station' });
      const yAxes = option.yAxis as Array<{ min?: number }>;
      expect(yAxes[0]!.min).toBe(0);
      expect(yAxes[1]!.min).toBe(0);
    });

    it('renders e-bikes line series and updates legend in station mode when ebikes are available', () => {
      const rows = [
        {
          station_id: '631',
          station_name: 'Grand Central-42 St',
          entries: 45000,
          exits: 52000,
          num_bikes_available: 12,
          ebikes_available: 5,
          docks_available: 34,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'station' });
      const legend = option.legend as { data: string[] };
      expect(legend.data).toContain('Citi E-Bikes Available');

      const series = option.series as Array<{ name: string; type: string; yAxisIndex?: number }>;
      const ebikesSeries = series.find(s => s.name === 'Citi E-Bikes Available');
      expect(ebikesSeries).toBeDefined();
      expect(ebikesSeries!.type).toBe('line');
      expect(ebikesSeries!.yAxisIndex).toBe(1);
    });

    it('handles Date instances and column aliases like bikes and docks', () => {
      const date1 = new Date('2026-10-28T12:00:00Z');
      const date2 = new Date('2026-10-28T13:00:00Z');
      const rows = [
        {
          complex_name: 'Times Sq-42 St',
          reading_time: date1,
          entries: 5000,
          exits: 4000,
          bikes: 25,
          ebikes: 10,
          docks: 15,
        },
        {
          complex_name: 'Times Sq-42 St',
          reading_time: date2,
          entries: 6000,
          exits: 5500,
          bikes: 20,
          ebikes: 8,
          docks: 20,
        },
      ];

      const option = buildMultimodalPulseOption(rows, { groupBy: 'time' });
      const xAxis = option.xAxis as { data: string[] };
      expect(xAxis.data.length).toBe(2);

      const series = option.series as Array<{ name: string; data: number[] }>;
      const bikesSeries = series.find(s => s.name === 'Citi Bikes Available');
      expect(bikesSeries).toBeDefined();
      expect(bikesSeries!.data[0]).toBe(25);
    });
  });

  describe('Origin-Destination Ridership Flow', () => {
    it('handles empty rows gracefully with fallback title', () => {
      const option = buildOdRidershipFlowOption([]);
      expect(option.title).toBeDefined();
      const title = option.title as { text: string };
      expect(title.text).toBe('No Origin-Destination Flow Data');
    });

    it('defaults to Sankey mode with node disambiguation avoiding same-key crash', () => {
      // Intentionally share a station as both origin and destination (e.g. 14 St-Union Sq)
      const rows = [
        {
          origin_station_id: 'L08', // Bedford Av
          destination_station_id: '635', // 14 St-Union Sq
          passenger_count: 21000,
        },
        {
          origin_station_id: '635', // 14 St-Union Sq (now origin)
          destination_station_id: 'R36', // Court St
          passenger_count: 9800,
        },
      ];

      const option = buildOdRidershipFlowOption(rows);
      expect(option.series).toBeDefined();
      const series = (option.series as Array<{
        type: string;
        data: Array<{ name: string; depth: number }>;
        links: Array<{ source: string; target: string; value: number }>;
        label?: { formatter?: (p: { name: string }) => string };
      }>)[0]!;

      expect(series.type).toBe('sankey');

      // Check node keys have disambiguation suffixes internally
      const nodeNames = series.data.map(n => n.name);
      expect(nodeNames.some(n => n.includes('(Origin)'))).toBe(true);
      expect(nodeNames.some(n => n.includes('(Dest)'))).toBe(true);

      // Verify origin and destination node keys for 14 St-Union Sq are distinct
      const unionSqOrigin = series.data.find(n => n.name.includes('Union Sq') && n.name.includes('(Origin)'));
      const unionSqDest = series.data.find(n => n.name.includes('Union Sq') && n.name.includes('(Dest)'));
      expect(unionSqOrigin).toBeDefined();
      expect(unionSqDest).toBeDefined();
      expect(unionSqOrigin!.name).not.toBe(unionSqDest!.name);

      // Depths: origins at 0, destinations at 1
      expect(unionSqOrigin!.depth).toBe(0);
      expect(unionSqDest!.depth).toBe(1);

      // Formatter strips the disambiguation suffix for clean presentation
      expect(series.label?.formatter).toBeDefined();
      const formatted = series.label!.formatter!({ name: '14 St-Union Sq (Origin)' });
      expect(formatted).toBe('14 St-Union Sq');

      // Check links connect origin keys to destination keys
      expect(series.links).toHaveLength(2);
      expect(series.links[0]!.source).toContain('(Origin)');
      expect(series.links[0]!.target).toContain('(Dest)');
    });

    it('configures Sankey margins and label truncation', () => {
      const rows = [
        {
          origin_station_name: 'Bedford Park Blvd-Lehman College',
          destination_station_name: 'Jackson Hts-Roosevelt Av',
          passenger_count: 14200,
        },
      ];

      const option = buildOdRidershipFlowOption(rows, { displayMode: 'sankey' });
      const series = (option.series as Array<{ left?: number; right?: number; label?: { overflow?: string; width?: number } }>)[0]!;
      expect(series.left).toBe(150);
      expect(series.right).toBe(150);
      expect(series.label?.overflow).toBe('truncate');
    });

    it('sets grid left to 220 in ranked-bars mode and truncates y-axis labels', () => {
      const rows = [
        {
          origin_station_name: 'Bedford Park Blvd-Lehman College',
          destination_station_name: 'Jackson Hts-Roosevelt Av',
          passenger_count: 14200,
        },
      ];

      const option = buildOdRidershipFlowOption(rows, { displayMode: 'ranked-bars' });
      const grid = option.grid as { left?: number };
      expect(grid.left).toBe(220);

      const yAxis = option.yAxis as { axisLabel?: { width?: number; overflow?: string } };
      expect(yAxis.axisLabel?.width).toBe(200);
      expect(yAxis.axisLabel?.overflow).toBe('truncate');
    });

    it('supports ranked-bars mode when requested', () => {
      const rows = [
        {
          origin_station_name: 'Flushing-Main St',
          destination_station_name: 'Grand Central-42 St',
          passenger_count: 18500,
        },
      ];

      const option = buildOdRidershipFlowOption(rows, { displayMode: 'ranked-bars' });
      const series = (option.series as Array<{ type: string; data: number[] }>)[0]!;
      expect(series.type).toBe('bar');
    });

    it('supports heatmap mode when requested', () => {
      const rows = [
        {
          origin_station_name: 'Flushing-Main St',
          destination_station_name: 'Grand Central-42 St',
          passenger_count: 18500,
        },
      ];

      const option = buildOdRidershipFlowOption(rows, { displayMode: 'heatmap' });
      const series = (option.series as Array<{ type: string; data: unknown[] }>)[0]!;
      expect(series.type).toBe('heatmap');
      expect(option.visualMap).toBeDefined();
    });

    it('resolves graph aliases source, target, passengers and clamps topStationsLimit', () => {
      const rows = [
        {
          source: 'Grand Central-42 St',
          target: 'Times Sq-42 St',
          passengers: 28000,
        },
        {
          origin: 'Union Sq',
          destination: 'Fulton St',
          ridership: 19500,
        },
      ];

      const option = buildOdRidershipFlowOption(rows, {
        topStationsLimit: 0,
        displayMode: 'sankey',
      });
      const series = (option.series as Array<{ data: Array<{ name: string }>; links: Array<{ value: number }> }>)[0]!;
      expect(series.links.length).toBe(2);

      const nodeNames = series.data.map(n => n.name);
      expect(nodeNames.some(n => n.includes('Grand Central-42 St (Origin)'))).toBe(true);
      expect(nodeNames.some(n => n.includes('Times Sq-42 St (Dest)'))).toBe(true);
    });
  });

  describe('MTA Subway Basemap & Station Overlay', () => {
    it('resolves Grand Army Plaza station 237 with routes 2 and 3 when hydrated', () => {
      hydrateStationCache([
        { station_id: '237', name: 'Grand Army Plaza', borough: 'Brooklyn', daytime_routes: '2 3', latitude: 40.67514, longitude: -73.97042 },
      ]);
      const gap = resolveStationInfo('237');
      expect(gap).toBeDefined();
      expect(gap!.name).toBe('Grand Army Plaza');
      expect(gap!.borough).toBe('Brooklyn');
      expect(gap!.routes).toEqual(['2', '3']);
      expect(gap!.lat).toBeCloseTo(40.67514, 4);
      expect(gap!.lon).toBeCloseTo(-73.97042, 4);
    });

    it('resolves station info stripping directional GTFS suffixes', () => {
      const northbound = resolveStationInfo('237N');
      expect(northbound).toBeDefined();
      expect(northbound!.stationId).toBe('237');
      expect(northbound!.name).toBe('Grand Army Plaza');

      const southbound = resolveStationInfo('127S');
      expect(southbound).toBeDefined();
      expect(southbound!.stationId).toBe('127');
      expect(southbound!.name).toBe('Times Sq-42 St');
    });

    it('hydrates station cache from leg fields from_station_id and to_station_id', () => {
      const legRows = [
        {
          from_station_id: 'TEST_FROM_01',
          from_station_name: 'Test From Station',
          from_lat: 40.7128,
          from_lon: -74.0060,
          to_station_id: 'TEST_TO_02',
          to_station_name: 'Test To Station',
          to_lat: 40.7589,
          to_lon: -73.9851,
          route_id: 'F',
        },
      ];
      hydrateStationCache(legRows);

      const resolvedFrom = resolveStationInfo('TEST_FROM_01');
      expect(resolvedFrom).toBeDefined();
      expect(resolvedFrom!.name).toBe('Test From Station');
      expect(resolvedFrom!.lat).toBe(40.7128);

      const resolvedTo = resolveStationInfo('TEST_TO_02');
      expect(resolvedTo).toBeDefined();
      expect(resolvedTo!.name).toBe('Test To Station');
      expect(resolvedTo!.lat).toBe(40.7589);
    });
  });

  describe('Route Segment Map (Corridor Speeds)', () => {
    it('builds connected LineString features for inter-station legs and tags slow zones under 14 mph', () => {
      const rows = [
        {
          route_id: '7',
          from_station_id: '725',
          from_station_name: 'Times Sq-42 St',
          from_lat: 40.75529,
          from_lon: -73.98715,
          to_station_id: '726',
          to_station_name: '34 St-Hudson Yards',
          to_lat: 40.75545,
          to_lon: -74.00220,
          effective_speed_mph: 11.4,
          leg_travel_time_sec: 140,
        },
        {
          route_id: '7',
          from_station_id: '724',
          from_station_name: '5 Av',
          from_lat: 40.75382,
          from_lon: -73.98196,
          to_station_id: '725',
          to_station_name: 'Times Sq-42 St',
          to_lat: 40.75529,
          to_lon: -73.98715,
          effective_speed_mph: 24.8,
          leg_travel_time_sec: 75,
        },
      ];

      const { segmentsGeoJson, stationsGeoJson, bounds } = buildRouteSegmentGeoJson(rows);

      expect(segmentsGeoJson.type).toBe('FeatureCollection');
      expect(segmentsGeoJson.features).toHaveLength(2);

      const slowFeature = segmentsGeoJson.features[0]!;
      expect(slowFeature.geometry.type).toBe('LineString');
      expect((slowFeature.geometry as GeoJSON.LineString).coordinates).toHaveLength(2);
      expect(slowFeature.properties?.['isSlowZone']).toBe(true);
      expect(slowFeature.properties?.['speedTier']).toBe('slow');
      expect(slowFeature.properties?.['color']).toBe('#B933AD'); // MTA Purple for 7 line

      const fastFeature = segmentsGeoJson.features[1]!;
      expect(fastFeature.properties?.['isSlowZone']).toBe(false);
      expect(fastFeature.properties?.['speedTier']).toBe('express');

      // Stations GeoJSON has unique station nodes
      expect(stationsGeoJson.features.length).toBeGreaterThanOrEqual(3);
      expect(bounds).not.toBeNull();
    });

    it('builds connected LineString features when consecutive points are grouped by route', () => {
      const rows = [
        { route_id: 'L', latitude: 40.74089, longitude: -74.00169, stop_sequence: 1 },
        { route_id: 'L', latitude: 40.73800, longitude: -73.99900, stop_sequence: 2 },
        { route_id: 'L', latitude: 40.73467, longitude: -73.99067, stop_sequence: 3 },
      ];

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows);
      expect(segmentsGeoJson.features).toHaveLength(2);
      const feature = segmentsGeoJson.features[0]!;
      expect(feature.geometry.type).toBe('LineString');
      expect((feature.geometry as GeoJSON.LineString).coordinates).toHaveLength(2);
      expect(feature.properties?.['color']).toBe('#A7A9AC'); // MTA Grey for L line
    });
  });

  describe('Train Position Map Telemetry & Timestamp Parsing', () => {
    it('parses numeric epoch seconds, milliseconds (> 1e11), microseconds (> 1e14), nanoseconds (> 1e17), and BigInts', () => {
      expect(parseEventEpochSec(1714500000)).toBe(1714500000);
      expect(parseEventEpochSec(1714500000000)).toBe(1714500000);
      expect(parseEventEpochSec(1714500000000000)).toBe(1714500000);
      expect(parseEventEpochSec(1714500000000000000n)).toBe(1714500000);
      expect(parseEventEpochSec('1714500000000000')).toBe(1714500000);
    });

    it('parses Date instances and ISO-8601 string dates correctly', () => {
      const d = new Date('2026-04-15T12:00:00Z');
      const expectedSec = d.getTime() / 1000;

      expect(parseEventEpochSec(d)).toBe(expectedSec);
      expect(parseEventEpochSec('2026-04-15T12:00:00Z')).toBe(expectedSec);
    });

    it('returns zero for invalid date inputs or NaN', () => {
      expect(parseEventEpochSec(NaN)).toBe(0);
      expect(parseEventEpochSec('not-a-timestamp')).toBe(0);
      expect(parseEventEpochSec(null)).toBe(0);
      expect(parseEventEpochSec(undefined)).toBe(0);
    });

    it('deduplicates vehicle observations with identical event timestamps during interpolation', () => {
      const groups = new Map();
      groups.set('MTA_NYCT_SUBWAY:T100', {
        routeId: '2',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          {
            tripId: 'T100',
            vehicleId: 'V1',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.70,
            lon: -73.98,
            bearing: 0,
            speedMph: 20,
            eventTime: 1000,
            stationId: '237',
            stationName: 'Grand Army Plaza',
            status: 'IN_TRANSIT_TO',
          },
          {
            tripId: 'T100',
            vehicleId: 'V1',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.71,
            lon: -73.98,
            bearing: 0,
            speedMph: 20,
            eventTime: 1000, // Identical timestamp
            stationId: '237',
            stationName: 'Grand Army Plaza',
            status: 'STOPPED_AT',
          },
          {
            tripId: 'T100',
            vehicleId: 'V1',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.75,
            lon: -73.98,
            bearing: 0,
            speedMph: 25,
            eventTime: 2000,
            stationId: '128',
            stationName: '34 St-Penn Station',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });

      const { geojson } = buildTrainFeatures(groups, 1500);
      expect(geojson.features).toHaveLength(1);
      const feat = geojson.features[0]!;
      const coords = (feat.geometry as GeoJSON.Point).coordinates;
      // Interpolated latitude between 40.71 and 40.75 at midpoint (ratio 0.5) is 40.73
      expect(coords[1]).toBeCloseTo(40.73, 2);
    });
  });

  describe('Route Segment Map (Spiderweb Rejection)', () => {
    it('rejects long-jump chords exceeding distance threshold to eliminate spiderwebs', () => {
      const rows = [
        {
          from_station_id: '725',
          to_station_id: 'FAR_AWAY',
          from_lat: 40.755,
          from_lon: -73.987,
          to_lat: 40.550, // Far jump across city (~0.20 deg)
          to_lon: -74.150,
          route_id: '7',
          effective_speed_mph: 15,
        },
      ];
      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows);
      expect(segmentsGeoJson.features).toHaveLength(0);
    });
  });

  describe('Isochrone Map Travel Time Contours', () => {
    it('builds descending MultiPolygon bands with authentic MTA palette', () => {
      const stations = [
        { stationId: '237', name: 'Grand Army Plaza', lat: 40.67514, lon: -73.97042, transitTimeMin: 0 },
        { stationId: '236', name: 'Bergen St', lat: 40.68083, lon: -73.97500, transitTimeMin: 4 },
        { stationId: '235', name: 'Nevins St', lat: 40.68825, lon: -73.98049, transitTimeMin: 8 },
        { stationId: '128', name: '34 St-Penn Station', lat: 40.75058, lon: -73.99106, transitTimeMin: 22 },
        { stationId: '120', name: '96 St', lat: 40.79392, lon: -73.97232, transitTimeMin: 38 },
      ];

      const geojson = buildIsochroneBandsGeoJson(stations, [10, 20, 30, 45]);
      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features.length).toBeGreaterThanOrEqual(1);

      // Verify descending order
      const bands = geojson.features.map(f => f.properties?.['band'] as number);
      for (let i = 0; i < bands.length - 1; i++) {
        expect(bands[i]!).toBeGreaterThan(bands[i + 1]!);
      }

      // 10m band should use IND 8th Ave Blue (#0039A6)
      const band10 = geojson.features.find(f => f.properties?.['band'] === 10);
      expect(band10).toBeDefined();
      expect(band10?.properties?.['color']).toBe('#0039A6');

      // 20m band should use Second Ave Teal (#00ADD0)
      const band20 = geojson.features.find(f => f.properties?.['band'] === 20);
      expect(band20).toBeDefined();
      expect(band20?.properties?.['color']).toBe('#00ADD0');

      // All features should have geometry type MultiPolygon
      for (const f of geojson.features) {
        expect(f.geometry.type).toBe('MultiPolygon');
      }
    });
  });

  describe('MTA Subway Service Lines (s692-irgq) & South Brooklyn Curve Alignment', () => {
    it('includes all 26 NYC Subway service lines including South Brooklyn trunks in buildMtaSubwayMapGeoJson', () => {
      const geo = buildMtaSubwayMapGeoJson();
      expect(geo.subwayTrunks.features.length).toBeGreaterThanOrEqual(24);
      const routeIds = new Set(
        geo.subwayTrunks.features.map(f => String(f.properties?.['route_id'] ?? f.properties?.['trunk']))
      );
      for (const expected of ['1', '2', '3', '4', '5', '6', '7', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'L', 'M', 'N', 'Q', 'R', 'W', 'Z', 'S', 'SI']) {
        expect(routeIds.has(expected)).toBe(true);
      }
    });

    it('extracts multi-vertex curved track paths along MTA service lines', () => {
      // E line across 53rd St Tunnel from Lexington Av/53 St to Queens Plaza
      const curvedE = extractCurvedSegmentAlongServiceLine(
        'E',
        -73.96906,
        40.75755,
        -73.93724,
        40.74898
      );
      expect(curvedE.length).toBeGreaterThan(2);
      expect(curvedE[0]).toEqual([-73.96906, 40.75755]);
      expect(curvedE[curvedE.length - 1]).toEqual([-73.93724, 40.74898]);

      // South Brooklyn Q line from Prospect Park to Coney Island-Stillwell Av
      const curvedQ = extractCurvedSegmentAlongServiceLine(
        'Q',
        -73.96225,
        40.66161,
        -73.98124,
        40.57728
      );
      expect(curvedQ.length).toBeGreaterThan(5);
    });

    it('does not misclassify intra-Queens station legs as East River crossings when borough is omitted', () => {
      hydrateStationCache([
        {
          route_id: '7',
          from_station_id: '712',
          from_station_name: '61 St-Woodside',
          from_lat: 40.74563,
          from_lon: -73.90298,
          to_station_id: '707',
          to_station_name: 'Junction Blvd',
          to_lat: 40.74915,
          to_lon: -73.86953,
        },
      ]);
      const st712 = resolveStationInfo('712');
      const st707 = resolveStationInfo('707');
      expect(st712?.borough).toBe('Queens');
      expect(st707?.borough).toBe('Queens');
      expect(isEastRiverCrossing(st712, st707, '712', '707')).toBe(false);
    });

    it('permits only adjacent East River portal pairs and rejects cross-portal spiderweb jumps', () => {
      // Valid adjacent tunnel portals
      expect(isEastRiverCrossing(resolveStationInfo('723'), resolveStationInfo('721'), '723', '721')).toBe(true);
      expect(isEastRiverCrossing(resolveStationInfo('F11'), resolveStationInfo('F09'), 'F11', 'F09')).toBe(true);
      expect(isEastRiverCrossing(resolveStationInfo('B08'), resolveStationInfo('B06'), 'B08', 'B06')).toBe(true);
      expect(isEastRiverCrossing(resolveStationInfo('B06'), resolveStationInfo('B04'), 'B06', 'B04')).toBe(true);

      // Invalid cross-portal / non-adjacent pairs that previously caused East River spiderwebs
      expect(isEastRiverCrossing(resolveStationInfo('B06'), resolveStationInfo('G21'), 'B06', 'G21')).toBe(false);
      expect(isEastRiverCrossing(resolveStationInfo('723'), resolveStationInfo('720'), '723', '720')).toBe(false);
      expect(isEastRiverCrossing(resolveStationInfo('724'), resolveStationInfo('721'), '724', '721')).toBe(false);
    });

    it('filters out multi-station skip-stop chords and deduplicates overlapping trunk routes on shared links', () => {
      const rows = [
        // Local adjacent hop A -> B (33 St to 40 St on 7)
        {
          route_id: '7',
          from_station_id: '716',
          from_lat: 40.74459,
          from_lon: -73.93099,
          to_station_id: '715',
          to_lat: 40.74378,
          to_lon: -73.92402,
          effective_speed_mph: 18.5,
        },
        // Local adjacent hop B -> C (40 St to 46 St on 7)
        {
          route_id: '7',
          from_station_id: '715',
          from_lat: 40.74378,
          from_lon: -73.92402,
          to_station_id: '714',
          to_lat: 40.74317,
          to_lon: -73.91844,
          effective_speed_mph: 19.2,
        },
        // Missed-poll skip-stop chord A -> C (33 St directly to 46 St, bypassing 40 St)
        {
          route_id: '7',
          from_station_id: '716',
          from_lat: 40.74459,
          from_lon: -73.93099,
          to_station_id: '714',
          to_lat: 40.74317,
          to_lon: -73.91844,
          effective_speed_mph: 26.0,
        },
        // Duplicate route on the exact same physical link A -> B
        {
          route_id: '7X',
          from_station_id: '716',
          from_lat: 40.74459,
          from_lon: -73.93099,
          to_station_id: '715',
          to_lat: 40.74378,
          to_lon: -73.92402,
          effective_speed_mph: 21.0,
        },
      ];

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows, { followServiceLines: true });
      // Only the 2 adjacent hops (716->715 and 715->714) should be rendered, once each
      expect(segmentsGeoJson.features).toHaveLength(2);
      const pairs = segmentsGeoJson.features.map(
        f => `${f.properties?.['fromStationId']}->${f.properties?.['toStationId']}`
      );
      expect(pairs).toEqual(['716->715', '715->714']);
    });

    it('assigns parallel offset_slot (-1, 0, +1) to subwayTrunks and deduplicates alias trunks', () => {
      const geo = buildMtaSubwayMapGeoJson();
      const byRoute = new Map(
        geo.subwayTrunks.features.map(f => [
          String(f.properties?.['route_id']),
          Number(f.properties?.['offset_slot']),
        ])
      );
      expect(byRoute.get('E')).toBe(-1);
      expect(byRoute.get('1')).toBe(-1);
      expect(byRoute.get('G')).toBe(-1);
      expect(byRoute.get('F')).toBe(0);
      expect(byRoute.get('7')).toBe(0);
      expect(byRoute.get('L')).toBe(0);
      expect(byRoute.get('R')).toBe(1);
      expect(byRoute.get('4')).toBe(1);
      expect(byRoute.get('J')).toBe(1);

      // Duplicate alias trunks should not be double-drawn in subwayTrunks
      for (const alias of ['6X', '7X', 'FX', 'GS', 'SIR']) {
        expect(byRoute.has(alias)).toBe(false);
      }
    });

    it('excludes Grand Army Plaza (237) from transfer hubs, caps capsule bullets at 3 colors, and cleans station labels', () => {
      expect(TRANSFER_HUB_STATION_IDS.has('237')).toBe(false);
      const geo = buildMtaSubwayMapGeoJson();
      const capsuleIds = new Set(
        geo.transferCapsules.features.map(f => String(f.properties?.['stationId']))
      );
      expect(capsuleIds.has('237')).toBe(false);

      const compact = selectCompactCapsuleRoutes(['1', '2', '3', '7', 'N', 'Q', 'R', 'W', 'S']);
      expect(compact).toHaveLength(3);

      expect(cleanStationLabelText('Jackson Hts-Roosevelt Av / 74 St (E,F,M,R)')).toBe('Jackson Hts-Roosevelt Av');
      expect(cleanStationLabelText('59 St / Lexington Av/59 St')).toBe('Lexington Av-59 St');
      expect(cleanStationLabelText('47-50 Sts-Rockefeller Ctr')).toBe('47-50 Sts');
      expect(cleanStationLabelText('Steinway St (M,R)')).toBe('Steinway St');
    });

    it('rejects cross-corridor anomalies with strictSnap and Queens Blvd express skip-stop chords via arc-length', () => {
      // Cross-corridor anomaly: Grand Central (631) to Queens Plaza (G21) on route E (Grand Central is > 400m from E)
      const crossCorridor = extractCurvedSegmentAlongServiceLine(
        'E',
        -73.97675,
        40.75178,
        -73.93724,
        40.74898,
        undefined,
        true
      );
      expect(crossCorridor).toHaveLength(0);

      // Queens Blvd corridor with local stops (G21 -> G20 -> G19) + express skip-stop chords (G21 -> G19 and G21 -> G14)
      const rows = [
        {
          route_id: 'R',
          from_station_id: 'G21',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G20',
          to_lat: 40.75204,
          to_lon: -73.92878,
          effective_speed_mph: 17.5,
        },
        {
          route_id: 'R',
          from_station_id: 'G20',
          from_lat: 40.75204,
          from_lon: -73.92878,
          to_station_id: 'G19',
          to_lat: 40.75688,
          to_lon: -73.92074,
          effective_speed_mph: 18.0,
        },
        // Skip-stop chord G21 (Queens Plaza) -> G19 (Steinway St) bypassing G20 (36 St)
        {
          route_id: 'R',
          from_station_id: 'G21',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G19',
          to_lat: 40.75688,
          to_lon: -73.92074,
          effective_speed_mph: 25.0,
        },
        // Express chord G21 (Queens Plaza) -> G14 (Jackson Hts) skipping G20 and G19
        {
          route_id: 'E',
          from_station_id: 'G21',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G14',
          to_lat: 40.74664,
          to_lon: -73.89134,
          effective_speed_mph: 28.0,
        },
        // Cross-corridor anomaly: Lexington Av/59 St (629) -> Roosevelt Island (B06) on R
        {
          route_id: 'R',
          from_station_id: '629',
          from_lat: 40.76257,
          from_lon: -73.96797,
          to_station_id: 'B06',
          to_lat: 40.75915,
          to_lon: -73.95326,
          effective_speed_mph: 22.0,
        },
      ];

      const projG21 = projectStationOntoServiceLine('R', -73.93724, 40.74898);
      const projG19 = projectStationOntoServiceLine('R', -73.92074, 40.75688);
      const projG14 = projectStationOntoServiceLine('R', -73.89134, 40.74664);
      expect(projG21).not.toBeNull();
      expect(projG19).not.toBeNull();
      expect(projG14).not.toBeNull();

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows, { followServiceLines: true });
      const pairs = segmentsGeoJson.features.map(
        f => `${f.properties?.['fromStationId']}->${f.properties?.['toStationId']}`
      );
      expect(pairs).toEqual(['G21->G20', 'G20->G19']);
    });

    it('maintains single continuous SIR chain, grafts A branch wyes, aligns F/M 53rd/63rd St tunnels, and orients shared corridors consistently for line-offset', () => {
      // 1. SIR full-island continuity from St. George (S31) to Tottenville (S01)
      const sirSeg = extractCurvedSegmentAlongServiceLine(
        'SIR',
        -74.07364,
        40.64375,
        -74.25196,
        40.51276,
        undefined,
        true
      );
      expect(sirSeg.length).toBeGreaterThan(20);

      // 2. Route A wye branches: Broad Channel (H04) -> Far Rockaway (H11), Broad Channel (H04) -> Beach 90 St (H12), Rockaway Blvd (A55) -> Ozone Park-Lefferts Blvd (A65)
      const aFarRockaway = extractCurvedSegmentAlongServiceLine(
        'A',
        -73.81592,
        40.60838,
        -73.7554,
        40.60399,
        undefined,
        true
      );
      expect(aFarRockaway.length).toBeGreaterThan(5);

      const aRockawayPark = extractCurvedSegmentAlongServiceLine(
        'A',
        -73.81592,
        40.60838,
        -73.81364,
        40.58803,
        undefined,
        true
      );
      expect(aRockawayPark.length).toBeGreaterThan(2);

      const aLefferts = extractCurvedSegmentAlongServiceLine(
        'A',
        -73.84485,
        40.68043,
        -73.8258,
        40.68596,
        undefined,
        true
      );
      expect(aLefferts.length).toBeGreaterThan(2);

      // 3. Route M projects within < 0.0002 deg of Queens Plaza (G21) on 53rd St line, and Route F projects within < 0.0002 deg of Roosevelt Island (B06) on 63rd St line
      const projMQueensPlaza = projectStationOntoServiceLine('M', -73.93724, 40.74898);
      expect(projMQueensPlaza).not.toBeNull();
      expect(Math.sqrt(projMQueensPlaza!.distSq)).toBeLessThan(0.0002);

      const projFRoosevelt = projectStationOntoServiceLine('F', -73.95326, 40.75915);
      expect(projFRoosevelt).not.toBeNull();
      expect(Math.sqrt(projFRoosevelt!.distSq)).toBeLessThan(0.0002);

      // 4. Canonical South-to-North / West-to-East orientation on shared corridors so MapLibre line-offset (-1, 0, +1) shifts parallel routes to distinct physical sides
      const geo = buildMtaSubwayMapGeoJson();
      for (const f of geo.subwayTrunks.features) {
        const routeId = String(f.properties?.['route_id']);
        const geom = f.geometry as GeoJSON.MultiLineString;
        const mainChain = geom.coordinates[0]!;
        const startPt = mainChain[0]!;
        const endPt = mainChain[mainChain.length - 1]!;
        if (['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D', 'F', 'G', 'M', 'N', 'Q', 'R', 'W', 'SI'].includes(routeId)) {
          // South-to-North: end latitude > start latitude
          expect(endPt[1]!).toBeGreaterThan(startPt[1]!);
        } else if (['E', '7', 'L'].includes(routeId)) {
          // West-to-East: end longitude > start longitude
          expect(endPt[0]!).toBeGreaterThan(startPt[0]!);
        }
      }
    });

    it('preserves East River tunnel crossings and Queens Plaza segments when cross-corridor stations are present', () => {
      hydrateStationCache([
        { station_id: 'G18', name: '46 St', borough: 'Queens', daytime_routes: 'M R', latitude: 40.756312, longitude: -73.913333 },
        { station_id: 'G16', name: 'Northern Blvd', borough: 'Queens', daytime_routes: 'M R', latitude: 40.752885, longitude: -73.906006 },
      ]);
      expect(resolveStationInfo('G18')?.name).toBe('46 St');
      expect(resolveStationInfo('G16')?.name).toBe('Northern Blvd');

      const rows = [
        // 7 Line Steinway Tunnel: Grand Central-42 St (723) -> Vernon Blvd-Jackson Av (721)
        {
          route_id: '7',
          from_station_id: '723',
          from_lat: 40.75178,
          from_lon: -73.97675,
          to_station_id: '721',
          to_lat: 40.74262,
          to_lon: -73.95358,
          effective_speed_mph: 24.5,
        },
        // E/M 53rd St Tunnel: Lexington Av/53 St (F11) -> Court Sq-23 St (F09)
        {
          route_id: 'E',
          from_station_id: 'F11',
          from_lat: 40.75755,
          from_lon: -73.96906,
          to_station_id: 'F09',
          to_lat: 40.74785,
          to_lon: -73.94600,
          effective_speed_mph: 22.0,
        },
        // N/R/W 60th St Tunnel: Lexington Av/59 St (R11) -> Queensboro Plaza (R09)
        {
          route_id: 'N',
          from_station_id: 'R11',
          from_lat: 40.76257,
          from_lon: -73.96797,
          to_station_id: 'R09',
          to_lat: 40.75058,
          to_lon: -73.94020,
          effective_speed_mph: 21.0,
        },
        // F 63rd St Tunnel: Lexington Av/63 St (B08) -> Roosevelt Island (B06) -> 21 St-Queensbridge (B04)
        {
          route_id: 'F',
          from_station_id: 'B08',
          from_lat: 40.76463,
          from_lon: -73.96611,
          to_station_id: 'B06',
          to_lat: 40.75915,
          to_lon: -73.95326,
          effective_speed_mph: 25.0,
        },
        {
          route_id: 'F',
          from_station_id: 'B06',
          from_lat: 40.75915,
          from_lon: -73.95326,
          to_station_id: 'B04',
          to_lat: 40.75420,
          to_lon: -73.94284,
          effective_speed_mph: 23.0,
        },
        // Queens Plaza (G21) -> 36 St (G20) on R while Queensboro Plaza (719) is also in the dataset
        {
          route_id: 'R',
          from_station_id: 'G21',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G20',
          to_lat: 40.75204,
          to_lon: -73.92878,
          effective_speed_mph: 18.5,
        },
        {
          route_id: '7',
          from_station_id: '720',
          from_lat: 40.74563,
          from_lon: -73.94857,
          to_station_id: '719',
          to_lat: 40.75058,
          to_lon: -73.94020,
          effective_speed_mph: 16.0,
        },
      ];

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows, { followServiceLines: true });
      const pairs = new Set(
        segmentsGeoJson.features.map(
          f => `${f.properties?.['fromStationId']}->${f.properties?.['toStationId']}`
        )
      );
      expect(pairs.has('723->721')).toBe(true);
      expect(pairs.has('F11->F09')).toBe(true);
      expect(pairs.has('R11->R09')).toBe(true);
      expect(pairs.has('B08->B06')).toBe(true);
      expect(pairs.has('B06->B04')).toBe(true);
      expect(pairs.has('G21->G20')).toBe(true);
      expect(pairs.has('720->719')).toBe(true);
    });

    it('merges overlapping station walk-shed circles in buildIsochroneBandsGeoJson into unified corridor polygons', () => {
      const adjacentBrooklynStations = [
        { stationId: '237', name: 'Grand Army Plaza', lat: 40.67514, lon: -73.97042, transitTimeMin: 0 },
        { stationId: '236', name: 'Bergen St', lat: 40.68083, lon: -73.97500, transitTimeMin: 2 },
        { stationId: '235', name: 'Nevins St', lat: 40.68825, lon: -73.98049, transitTimeMin: 4 },
      ];
      const geojson = buildIsochroneBandsGeoJson(adjacentBrooklynStations, [20]);
      expect(geojson.features).toHaveLength(1);
      const geom = geojson.features[0]!.geometry as GeoJSON.MultiPolygon;
      // Three overlapping 800m circles (~700m apart) merge into a single connected contour polygon
      expect(geom.coordinates.length).toBe(1);
      expect(geom.coordinates[0]![0]!.length).toBeGreaterThan(20);
    });

    it('collapses stationary duplicate-coordinate polls for smooth timelapse movement and positions live in-transit trains along curved tracks', () => {
      const groups = new Map();
      groups.set('MTA_NYCT_SUBWAY:T700', {
        routeId: '7',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          // Multiple polls at Grand Central-42 St (723) before moving to Vernon Blvd-Jackson Av (721)
          {
            tripId: 'T700',
            vehicleId: 'T700',
            routeId: '7',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.75178,
            lon: -73.97675,
            bearing: 0,
            speedMph: 22,
            eventTime: 1000,
            stationId: '723N',
            stationName: 'Grand Central-42 St',
            status: 'STOPPED_AT',
          },
          {
            tripId: 'T700',
            vehicleId: 'T700',
            routeId: '7',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.75178,
            lon: -73.97675,
            bearing: 0,
            speedMph: 22,
            eventTime: 1030,
            stationId: '723N',
            stationName: 'Grand Central-42 St',
            status: 'STOPPED_AT',
          },
          {
            tripId: 'T700',
            vehicleId: 'T700',
            routeId: '7',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.74262,
            lon: -73.95358,
            bearing: 0,
            speedMph: 25,
            eventTime: 1100,
            stationId: '721N',
            stationName: 'Vernon Blvd-Jackson Av',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });

      // At t=1050 (midway between 1000 and 1100), train should be actively moving between 723 and 721 (not stuck at 723!)
      const { geojson: midGeo } = buildTrainFeatures(groups, 1050);
      const midCoords = (midGeo.features[0]!.geometry as GeoJSON.Point).coordinates;
      expect(midCoords[0]!).toBeGreaterThan(-73.97675);
      expect(midCoords[0]!).toBeLessThan(-73.95358);
      expect(Number(midGeo.features[0]!.properties?.['bearing'])).toBeGreaterThan(0);

      // In Live mode (targetTime undefined), an IN_TRANSIT_TO train with >=2 stops is positioned mid-segment along the track
      const { geojson: liveGeo } = buildTrainFeatures(groups, undefined);
      const liveCoords = (liveGeo.features[0]!.geometry as GeoJSON.Point).coordinates;
      expect(liveCoords[0]!).toBeGreaterThan(-73.97675);
      expect(liveCoords[0]!).toBeLessThan(-73.95358);

      // Even before the train's first recorded timestamp (t=920 < 1000), timelapse wraps continuously instead of freezing
      const { geojson: wrappedGeo } = buildTrainFeatures(groups, 950);
      const wrappedCoords = (wrappedGeo.features[0]!.geometry as GeoJSON.Point).coordinates;
      expect(wrappedCoords[0]!).toBeGreaterThan(-73.97675);
      expect(wrappedCoords[0]!).toBeLessThan(-73.95358);

      // Single-observation vehicle also moves smoothly along its curved MTA service line during timelapse
      const singleGroup = new Map();
      singleGroup.set('MTA_NYCT_SUBWAY:T_SINGLE', {
        routeId: '4',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          {
            tripId: 'T_SINGLE',
            vehicleId: 'T_SINGLE',
            routeId: '4',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.75178,
            lon: -73.97675,
            bearing: 30,
            speedMph: 20,
            eventTime: 1000,
            stationId: '631N',
            stationName: 'Grand Central-42 St',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });
      const { geojson: singleT0 } = buildTrainFeatures(singleGroup, 1000, { minEpoch: 1000, maxEpoch: 1600 });
      const { geojson: singleT1 } = buildTrainFeatures(singleGroup, 1300, { minEpoch: 1000, maxEpoch: 1600 });
      const c0 = (singleT0.features[0]!.geometry as GeoJSON.Point).coordinates;
      const c1 = (singleT1.features[0]!.geometry as GeoJSON.Point).coordinates;
      expect(Math.hypot(c1[0]! - c0[0]!, c1[1]! - c0[1]!)).toBeGreaterThan(0.002);

      // Express diamond routes (6X, 7X, FX) and shuttles/SIR (GS, FS, H -> S, SI -> SIR) normalize displayLabel
      const badgeGroups = new Map();
      for (const [rId, expectedLabel, expectedIcon] of [
        ['6X', '6', 'diamond-6'],
        ['7X', '7', 'diamond-7'],
        ['FX', 'F', 'diamond-F'],
        ['GS', 'S', 'bullet-S'],
        ['FS', 'S', 'bullet-S'],
        ['H', 'S', 'bullet-S'],
        ['SI', 'SIR', 'bullet-SIR'],
      ] as const) {
        badgeGroups.clear();
        badgeGroups.set(`MTA_NYCT_SUBWAY:T_${rId}`, {
          routeId: rId,
          agencyId: 'MTA_NYCT_SUBWAY',
          positions: [
            {
              tripId: `T_${rId}`,
              vehicleId: `T_${rId}`,
              routeId: rId,
              agencyId: 'MTA_NYCT_SUBWAY',
              lat: 40.75178,
              lon: -73.97675,
              bearing: 30,
              speedMph: 20,
              eventTime: 1000,
              stationId: '631N',
              stationName: 'Grand Central-42 St',
              status: 'STOPPED_AT',
            },
          ],
        });
        const { geojson: bGeo } = buildTrainFeatures(badgeGroups);
        expect(bGeo.features[0]!.properties?.['displayLabel']).toBe(expectedLabel);
        expect(bGeo.features[0]!.properties?.['iconId']).toBe(expectedIcon);
      }
    });

    it('heals single-station polling skips into missing adjacent curved sub-segments without emitting skip-stop chords', () => {
      hydrateStationCache([
        { station_id: '718', name: 'Queensboro Plaza', borough: 'Queens', daytime_routes: '7 N W', latitude: 40.750582, longitude: -73.940202 },
        { station_id: '719', name: 'Court Sq', borough: 'Queens', daytime_routes: '7 E G M', latitude: 40.747023, longitude: -73.945264 },
      ]);
      expect(resolveStationInfo('718')?.name).toBe('Queensboro Plaza');
      expect(resolveStationInfo('719')?.name).toBe('Court Sq');

      // Suppose 720->719 (Hunters Point Av -> Court Sq) was missed by a poll, leaving only 721->720, 720->718, and 719->718
      const rows = [
        {
          route_id: '7',
          from_station_id: '721',
          from_lat: 40.74263,
          from_lon: -73.95358,
          to_station_id: '720',
          to_lat: 40.74222,
          to_lon: -73.94891,
          effective_speed_mph: 18.0,
        },
        {
          route_id: '7',
          from_station_id: '719',
          from_lat: 40.74702,
          from_lon: -73.94526,
          to_station_id: '718',
          to_lat: 40.75058,
          to_lon: -73.94020,
          effective_speed_mph: 17.5,
        },
        // 1-stop polling skip across 719 (Court Sq)
        {
          route_id: '7',
          from_station_id: '720',
          from_lat: 40.74222,
          from_lon: -73.94891,
          to_station_id: '718',
          to_lat: 40.75058,
          to_lon: -73.94020,
          effective_speed_mph: 19.0,
        },
      ];

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows, { followServiceLines: true });
      const pairs = segmentsGeoJson.features.map(
        f => `${f.properties?.['fromStationId']}->${f.properties?.['toStationId']}`
      );
      // 720->718 skip-stop chord is NOT emitted; instead the missing adjacent 720->719 link is healed!
      expect(pairs).toEqual(['721->720', '719->718', '720->719']);
    });

    it('preserves interior un-walkable gaps as polygon hole rings in buildIsochroneBandsGeoJson', () => {
      // 8 stations arranged in a ring around an un-walkable center (radius ~1.4km, walk radius 800m)
      const centerLat = 40.775;
      const centerLon = -73.965;
      const ringStations = Array.from({ length: 8 }, (_, idx) => {
        const angle = (idx / 8) * Math.PI * 2;
        return {
          stationId: `RING_${idx}`,
          name: `Ring Station ${idx}`,
          lat: centerLat + Math.sin(angle) * 0.012,
          lon: centerLon + Math.cos(angle) * 0.016,
          transitTimeMin: 0,
        };
      });

      const geojson = buildIsochroneBandsGeoJson(ringStations, [20], 80, 800);
      expect(geojson.features).toHaveLength(1);
      const geom = geojson.features[0]!.geometry as GeoJSON.MultiPolygon;
      // Should be 1 outer polygon containing 1 outer ring + 1 interior hole ring (length === 2)
      expect(geom.coordinates).toHaveLength(1);
      expect(geom.coordinates[0]!.length).toBeGreaterThanOrEqual(2);
    });

    it('uses high-visibility neon speed palette (#FF007F, #00E5FF, #00F59B) distinct from MTA route bullets', () => {
      expect(getSpeedTierColor('slow')).toBe('#FF007F'); // Neon Magenta slow zone
      expect(getSpeedTierColor('standard')).toBe('#00E5FF'); // Electric Cyan standard
      expect(getSpeedTierColor('express')).toBe('#00F59B'); // Neon Emerald express

      const rows = [
        {
          route_id: '7',
          from_station_id: '723',
          from_station_name: 'Grand Central-42 St',
          from_lat: 40.75178,
          from_lon: -73.97675,
          to_station_id: '721',
          to_station_name: 'Vernon Blvd-Jackson Av',
          to_lat: 40.74262,
          to_lon: -73.95358,
          effective_speed_mph: 25.4,
        },
        {
          route_id: 'E',
          from_station_id: 'F11',
          from_station_name: 'Lexington Av/53 St (E,M)',
          from_lat: 40.75755,
          from_lon: -73.96905,
          to_station_id: 'F09',
          to_station_name: 'Court Sq-23 St (E,M)',
          to_lat: 40.74785,
          to_lon: -73.946,
          effective_speed_mph: 11.8,
        },
      ];

      const { segmentsGeoJson, stationsGeoJson } = buildRouteSegmentGeoJson(rows, {
        followServiceLines: true,
      });

      const seg7 = segmentsGeoJson.features.find(f => f.properties?.['fromStationId'] === '723');
      const segE = segmentsGeoJson.features.find(f => f.properties?.['fromStationId'] === 'F11');
      expect(seg7?.properties?.['speedTierColor']).toBe('#00F59B');
      expect(segE?.properties?.['speedTierColor']).toBe('#FF007F');

      // Multi-route station Lexington Av/53 St (F11) has parenthetical (E,M) stripped from name and routes=['E','M']
      const stF11 = stationsGeoJson.features.find(f => f.properties?.['stationId'] === 'F11');
      expect(stF11?.properties?.['name']).toBe('Lexington Av/53 St');
      expect(stF11?.properties?.['routes']).toBe('E,M');
      expect(stF11?.properties?.['routeCount']).toBe(2);
      expect(stF11?.properties?.['isMultiRoute']).toBe(true);
      expect(stF11?.properties?.['iconId']).toBe('stop-pill-E-M');
    });

    it('extracts route bullets from parenthetical station labels and builds variable-span stop pill IDs across all maps', () => {
      expect(extractRoutesFromStationText('Grand Army Plaza (2,3)')).toEqual(['2', '3']);
      expect(extractRoutesFromStationText('Queens Plaza (E,M,R)')).toEqual(['E', 'M', 'R']);
      expect(cleanStationLabelText('Grand Army Plaza (2,3)')).toBe('Grand Army Plaza');
      expect(cleanStationLabelText('36 St (M,R)')).toBe('36 St');

      expect(getStopPillIconId(['1'])).toBe('stop-pill-1');
      expect(getStopPillIconId(['2', '3'])).toBe('stop-pill-2-3');
      expect(getStopPillIconId(['E', 'F', 'M', 'R'])).toBe('stop-pill-E-F-M-R');
      expect(normalizeStationRoutes(['7', '7X', 'E', 'M'])).toEqual(['7', 'E', 'M']);

      hydrateStationCache([
        {
          station_id: 'TEST_MULTI',
          station_name: 'Custom Junction (A,C,E)',
          latitude: 40.75,
          longitude: -73.99,
        },
      ]);
      const resolved = resolveStationInfo('TEST_MULTI');
      expect(resolved?.name).toBe('Custom Junction');
      expect(resolved?.routes).toEqual(['A', 'C', 'E']);
    });

    it('eliminates 1-2s train wraparound jumps, filters single-poll A->B->A bounces, and zeroes STOPPED_AT speed', () => {
      const groups = new Map();
      groups.set('MTA_NYCT_SUBWAY:J_TRAIN', {
        routeId: 'J',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          // First poll at Kosciuszko St (M12N) at t=1050 (50s after window minEpoch=1000)
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_TRAIN',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.69334,
            lon: -73.92881,
            bearing: 60,
            speedMph: 19.5,
            eventTime: 1050,
            stationId: 'M12N',
            stationName: 'Kosciuszko St (J)',
            status: 'IN_TRANSIT_TO',
          },
          // Single-poll retrograde bounce to Myrtle Av (M11N) at t=1080 then back to Kosciuszko St (M12N) at t=1110
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_TRAIN',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.69721,
            lon: -73.93566,
            bearing: 60,
            speedMph: 25.5,
            eventTime: 1080,
            stationId: 'M11N',
            stationName: 'Myrtle Av (J,M,Z)',
            status: 'STOPPED_AT',
          },
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_TRAIN',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.69334,
            lon: -73.92881,
            bearing: 60,
            speedMph: 19.5,
            eventTime: 1110,
            stationId: 'M12N',
            stationName: 'Kosciuszko St (J)',
            status: 'IN_TRANSIT_TO',
          },
          // Arrives at Gates Av (M13N) at t=1550 (50s before window maxEpoch=1600)
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_TRAIN',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.68963,
            lon: -73.92227,
            bearing: 60,
            speedMph: 25.5,
            eventTime: 1550,
            stationId: 'M13N',
            stationName: 'Gates Av (J,Z)',
            status: 'STOPPED_AT',
          },
        ],
      });

      const windowBounds = { minEpoch: 1000, maxEpoch: 1600 };

      // 1. At t=1010 (before firstPt.eventTime=1050), train stays near start (M12N) instead of jumping to end (M13N)
      const { geojson: startGeo } = buildTrainFeatures(groups, 1010, windowBounds);
      const startCoords = (startGeo.features[0]!.geometry as GeoJSON.Point).coordinates;
      expect(Math.hypot(startCoords[0]! - (-73.92881), startCoords[1]! - 40.69334)).toBeLessThan(0.002);

      // 2. Mid-journey (t=1300), retrograde bounce to M11N was filtered out, status is IN_TRANSIT_TO, and stationName has no parenthetical
      const { geojson: midGeo } = buildTrainFeatures(groups, 1300, windowBounds);
      const midProps = midGeo.features[0]!.properties!;
      expect(midProps['status']).toBe('IN_TRANSIT_TO');
      expect(midProps['stationName']).toBe('Gates Av');
      expect(midProps['speedMph']).toBeGreaterThan(0);

      // 3. At end of trip (t=1598, ratio >= 0.96) where endpoint status is STOPPED_AT, status is STOPPED_AT and speedMph is 0
      const { geojson: endGeo } = buildTrainFeatures(groups, 1598, windowBounds);
      const endProps = endGeo.features[0]!.properties!;
      expect(endProps['status']).toBe('STOPPED_AT');
      expect(endProps['speedMph']).toBe(0);
    });

    it('renders pinned train popup modal HTML with clickable copy attributes', () => {
      const html = buildTrainPopupHtml(
        {
          routeId: 'J',
          tripId: '109100_J..N45R',
          status: 'IN_TRANSIT_TO',
          stationName: 'Myrtle Av (J,M,Z)',
          stationId: 'M11N',
          speedMph: 22.4,
          eventTime: 1730000000,
          color: '#996633',
        },
        true
      );
      expect(html).toContain('Pinned (click any text to copy)');
      expect(html).toContain('data-copy-text="Train J"');
      expect(html).toContain('data-copy-text="109100_J..N45R"');
      expect(html).toContain('data-copy-text="Myrtle Av (M11N)"');
      expect(html).toContain('data-copy-text="22.4 mph"');
      expect(html).not.toContain('(J,M,Z)');
    });

    it('validates DuckDB map table schema contracts and bootstraps custom/historical map networks', async () => {
      const mockCatalog: Record<
        string,
        { columns: { name: string; type: string }[]; rows: Record<string, unknown>[] }
      > = {
        'local.main.view_dim_routes_1929': {
          columns: [
            { name: 'route_id', type: 'VARCHAR' },
            { name: 'route_name', type: 'VARCHAR' },
            { name: 'color_hex', type: 'VARCHAR' },
            { name: 'division', type: 'VARCHAR' },
          ],
          rows: [
            { route_id: '1', route_name: 'IRT Broadway-7 Av', color_hex: '#EE352E', division: 'IRT' },
            { route_id: 'Q', route_name: 'BMT Brighton', color_hex: '#FCCC0A', division: 'BMT' },
          ],
        },
        'local.main.view_dim_service_lines_1929': {
          columns: [
            { name: 'route_id', type: 'VARCHAR' },
            { name: 'color_hex', type: 'VARCHAR' },
            { name: 'geom_geojson', type: 'VARCHAR' },
          ],
          rows: [
            {
              route_id: '1',
              color_hex: '#EE352E',
              geom_geojson: JSON.stringify({
                type: 'MultiLineString',
                coordinates: [
                  [
                    [-74.013, 40.703],
                    [-73.987, 40.755],
                  ],
                ],
              }),
            },
          ],
        },
        'local.main.view_dim_stations_1929': {
          columns: [
            { name: 'station_id', type: 'VARCHAR' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'latitude', type: 'DOUBLE' },
            { name: 'longitude', type: 'DOUBLE' },
            { name: 'daytime_routes', type: 'VARCHAR' },
          ],
          rows: [
            {
              station_id: '127',
              name: 'Times Sq-42 St (1,Q)',
              latitude: 40.75529,
              longitude: -73.98749,
              daytime_routes: '1,Q',
            },
          ],
        },
        'local.main.bad_stations': {
          columns: [
            { name: 'station_id', type: 'VARCHAR' },
            { name: 'name', type: 'VARCHAR' },
          ],
          rows: [],
        },
      };

      const mockExec = async (sql: string) => {
        for (const [tbl, data] of Object.entries(mockCatalog)) {
          if (sql.includes(tbl)) {
            return data;
          }
        }
        throw new Error(`Table not found in mock catalog: ${sql}`);
      };

      // Valid schema check
      const validRoutes = await validateMapTableSchema(
        mockExec,
        'local.main.view_dim_routes_1929',
        'routes'
      );
      expect(validRoutes.valid).toBe(true);
      expect(validRoutes.missingColumns).toEqual([]);

      // Invalid schema check (missing latitude, longitude, daytime_routes)
      const invalidStations = await validateMapTableSchema(
        mockExec,
        'local.main.bad_stations',
        'stations'
      );
      expect(invalidStations.valid).toBe(false);
      expect(invalidStations.missingColumns).toContain('latitude');
      expect(invalidStations.missingColumns).toContain('longitude');
      expect(invalidStations.missingColumns).toContain('daytime_routes');

      // Every default preset relies on pure prod.transit_v2.* StraphangerDB tables, not local.main.*
      for (const preset of MAP_NETWORK_TABLE_PRESETS) {
        expect(preset.config.routesTable.startsWith('prod.transit_v2.')).toBe(true);
        expect(preset.config.tracksTable.startsWith('prod.transit_v2.')).toBe(true);
        expect(preset.config.stationsTable.startsWith('prod.transit_v2.')).toBe(true);
        expect(preset.config.theme).toBeDefined();
      }

      // Bootstrap 1929 network from DuckDB tables
      const preset1929 = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === '1929')!;
      expect(preset1929.config.routesTable).toBe('prod.transit_v2.view_dim_routes_1929');
      expect(preset1929.config.tracksTable).toBe('prod.transit_v2.view_dim_service_lines_1929');
      expect(preset1929.config.stationsTable).toBe('prod.transit_v2.view_dim_stations_1929');
      expect(preset1929.config.theme).toBe('ind');

      const presetProposed = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === 'proposed')!;
      expect(presetProposed.config.routesTable).toBe('prod.transit_v2.view_dim_routes_proposed');
      expect(presetProposed.config.tracksTable).toBe('prod.transit_v2.view_dim_service_lines_proposed');
      expect(presetProposed.config.stationsTable).toBe('prod.transit_v2.view_dim_stations_proposed');
      expect(presetProposed.config.theme).toBe('mta');

      const net1929 = await bootstrapMapNetworkFromDuckDb(mockExec, preset1929.config);
      expect(Object.keys(net1929.routes)).toEqual(['1', 'Q']);
      expect(net1929.serviceLines.features).toHaveLength(1);
      expect(net1929.stations['127']?.name).toBe('Times Sq-42 St');
      expect(net1929.stations['127']?.routes).toEqual(['1', 'Q']);

      try {
        setActiveMapNetworkData(net1929);
        setActiveMapVisualTheme('ind');
        expect(getActiveMapVisualTheme()).toBe('ind');
        const customGeo = buildMtaSubwayMapGeoJson();
        expect(customGeo.subwayTrunks.features).toHaveLength(1);
        expect(customGeo.subwayTrunks.features[0]?.properties?.['color']).toBe('#B8292F');
      } finally {
        setActiveMapVisualTheme('mta');
        resetActiveMapNetworkData();
      }

      // Validate Map Visual Themes (MTA, Tauranac / Hertz, IND, Geographic Light & Dark)
      const themeIds = MAP_VISUAL_THEMES.map(t => t.id);
      expect(themeIds).toEqual(['mta', 'tauranac-hertz', 'ind', 'geo-light', 'geo-dark']);
      expect(getMapThemeSpec('mta').label).toBe('MTA');
      expect(getMapThemeSpec('tauranac-hertz').label).toBe('Tauranac / Hertz');
      expect(getMapThemeSpec('ind').label).toBe('IND');
      expect(getMapThemeSpec('geo-light').label).toBe('Geographic (Light)');
      expect(getMapThemeSpec('geo-dark').label).toBe('Geographic (Dark)');
      expect(getMapThemeSpec('ind').landFillColor).toBe('#FBF0C4');
      expect(buildMapStyleForTheme('ind').layers[0]).toEqual({
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#D2CFC6' },
      });
      expect(buildMapStyleForTheme('geo-light').sources['openfreemap-planet']).toBeDefined();
      expect(buildMapStyleForTheme('geo-dark').sources['openfreemap-planet']).toBeDefined();
      expect(buildMapStyleForTheme('geo-light').glyphs).toBe(
        'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
      );

      // Modal HTML includes all 3 table inputs, presets, and visual theme selector
      const modalHtml = buildMapTableCustomizationModalHtml(preset1929.config, '1929');
      expect(modalHtml).toContain('Map Visual Theme');
      expect(modalHtml).toContain('prod.transit_v2.view_dim_routes_1929');
      expect(modalHtml).toContain('prod.transit_v2.view_dim_service_lines_1929');
      expect(modalHtml).toContain('prod.transit_v2.view_dim_stations_1929');
      expect(modalHtml).toContain('Tauranac / Hertz');
      expect(modalHtml).toContain('Geographic (Light)');
      expect(modalHtml).toContain('Geographic (Dark)');
      expect(modalHtml).toContain('1953 IND Service Guide');
      expect(modalHtml).toContain(MAP_TABLE_SCHEMA_CONTRACTS.routes.requiredColumns.join(', '));
    });

    it('collapses same-station GPS jitter at Myrtle Av (M11N), filters retrograde arc-length steps, and avoids maxEpoch wrap jumps', () => {
      const groups = new Map<string, any>();
      groups.set('MTA_NYCT_SUBWAY:J_MYRTLE', {
        routeId: 'J',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_MYRTLE',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.69334,
            lon: -73.92881,
            bearing: 310,
            speedMph: 22.0,
            eventTime: 1000,
            stationId: 'M12N',
            stationName: 'Kosciuszko St',
            status: 'STOPPED_AT',
          },
          // First ping at M11N with IN_TRANSIT_TO and slightly offset GPS coordinate
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_MYRTLE',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.69745,
            lon: -73.93595,
            bearing: 310,
            speedMph: 25.5,
            eventTime: 1120,
            stationId: 'M11N',
            stationName: 'Myrtle Av (J,M,Z)',
            status: 'IN_TRANSIT_TO',
          },
          // Second ping at same station M11N (STOPPED_AT) with station centroid coordinates
          {
            tripId: '109100_J..N45R',
            vehicleId: 'J_MYRTLE',
            routeId: 'J',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.6972,
            lon: -73.9356,
            bearing: 310,
            speedMph: 25.5,
            eventTime: 1200,
            stationId: 'M11N',
            stationName: 'Myrtle Av (J,M,Z)',
            status: 'STOPPED_AT',
          },
        ],
      });

      const windowBounds = { minEpoch: 1000, maxEpoch: 1200 };
      // At exact maxEpoch (1200), progress must clamp to 1.0 (at M11N STOPPED_AT with 0 mph), never wrapping back to M12N
      const { geojson: atMax } = buildTrainFeatures(groups, 1200, windowBounds);
      const feat = atMax.features[0]!;
      expect(feat.properties?.['stationId']).toBe('M11N');
      expect(feat.properties?.['stationName']).toBe('Myrtle Av');
      expect(feat.properties?.['status']).toBe('STOPPED_AT');
      expect(feat.properties?.['speedMph']).toBe(0);

      // Stopped train popup still includes clickable 0 mph speed row
      const stoppedPopup = buildTrainPopupHtml(feat.properties!, true);
      expect(stoppedPopup).toContain('data-copy-text="0 mph"');
      expect(stoppedPopup).toContain('data-copy-text="Myrtle Av (M11N)"');
    });

    it('preserves express route bullets on corridor endpoint station pills even when express skip-stop chords are suppressed', () => {
      const rows = [
        // Local M/R segments along Queens Blvd: G21 (Queens Plaza) -> G20 (36 St) -> G19 (Steinway St)
        {
          route_id: 'R',
          from_station_id: 'G21',
          from_station_name: 'Queens Plaza',
          from_routes: 'E,M,R',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G20',
          to_station_name: '36 St',
          to_routes: 'M,R',
          to_lat: 40.75204,
          to_lon: -73.92878,
          effective_speed_mph: 17.5,
        },
        {
          route_id: 'M',
          from_station_id: 'G20',
          from_station_name: '36 St',
          from_routes: 'M,R',
          from_lat: 40.75204,
          from_lon: -73.92878,
          to_station_id: 'G19',
          to_station_name: 'Steinway St',
          to_routes: 'M,R',
          to_lat: 40.75688,
          to_lon: -73.92074,
          effective_speed_mph: 18.2,
        },
        // Express E skip-stop chord from G21 to G19 (skips G20)
        {
          route_id: 'E',
          from_station_id: 'G21',
          from_station_name: 'Queens Plaza',
          from_lat: 40.74898,
          from_lon: -73.93724,
          to_station_id: 'G19',
          to_station_name: 'Steinway St',
          to_lat: 40.75688,
          to_lon: -73.92074,
          effective_speed_mph: 28.0,
        },
      ];

      const { stationsGeoJson } = buildRouteSegmentGeoJson(rows, {
        metricColumn: 'effective_speed_mph',
        followServiceLines: true,
      });
      const g21 = stationsGeoJson.features.find(f => f.properties?.['stationId'] === 'G21');
      const g20 = stationsGeoJson.features.find(f => f.properties?.['stationId'] === 'G20');
      expect(g21?.properties?.['iconId']).toBe('stop-pill-E-M-R');
      expect(g20?.properties?.['iconId']).toBe('stop-pill-M-R');
    });

    it('builds concentric station walk-radius gradient rings (100m..800m) with disjoint transit arrival tiers and clamps overflow stations (>45m) into the outer tier', () => {
      const stations = [
        { stationId: '237', name: 'Grand Army Plaza', lat: 40.67514, lon: -73.97042, transitTimeMin: 0 },
        { stationId: '128', name: '34 St-Penn Station', lat: 40.75058, lon: -73.99106, transitTimeMin: 18 },
        { stationId: '101', name: 'Van Cortlandt Park-242 St', lat: 40.88925, lon: -73.89858, transitTimeMin: 54 },
      ];
      const gradGeo = buildStationWalkGradientGeoJson(stations, [10, 20, 30, 45]);
      // 3 active tiers (10m, 20m, and 45m for the 54m overflow station) * 8 radius steps (100m..800m) = 24 concentric gradient features
      expect(gradGeo.features).toHaveLength(24);

      const band10Radii = gradGeo.features
        .filter(f => f.properties?.['band'] === 10)
        .map(f => Number(f.properties?.['radiusMeters']));
      expect(band10Radii).toEqual([800, 700, 600, 500, 400, 300, 200, 100]);

      const band45Radii = gradGeo.features
        .filter(f => f.properties?.['band'] === 45)
        .map(f => Number(f.properties?.['radiusMeters']));
      expect(band45Radii).toEqual([800, 700, 600, 500, 400, 300, 200, 100]);

      const majorRings10 = gradGeo.features
        .filter(f => f.properties?.['band'] === 10 && f.properties?.['isMajorWalkRing'] === true)
        .map(f => `${f.properties?.['radiusMeters']}m (${f.properties?.['walkMinutes']}m)`);
      expect(majorRings10).toEqual(['800m (10m)', '600m (7.5m)', '400m (5m)', '200m (2.5m)']);

      // Inner 100m step has higher stepOpacity than outer 800m step for radial center-to-edge gradient falloff
      const step100 = gradGeo.features.find(
        f => f.properties?.['band'] === 10 && f.properties?.['radiusMeters'] === 100
      );
      const step800 = gradGeo.features.find(
        f => f.properties?.['band'] === 10 && f.properties?.['radiusMeters'] === 800
      );
      expect(Number(step100?.properties?.['stepOpacity'])).toBeGreaterThan(
        Number(step800?.properties?.['stepOpacity'])
      );
      expect(Number(step800?.properties?.['stepOpacity'])).toBeGreaterThanOrEqual(0.06);
    });

    it('removes hardcoded IRT Lines 1-7 labels from renderIsochroneMap HUDs, summarizes queried lines dynamically, and does not inject IRT 2/3 routes on custom stations', () => {
      const savedDoc = (globalThis as any).document;
      const children: Record<string, any> = {};
      const makeEl = () => {
        const el: any = {
          className: '',
          innerHTML: '',
          style: {},
          dataset: {},
          appendChild: (c: any) => {
            if (c.className) children[c.className] = c;
          },
          querySelector: (sel: string) => {
            if (sel === '.dbtc-map-hud-origin-banner') return children['dbtc-map-hud dbtc-map-hud-origin-banner'] ?? null;
            if (sel === '.dbtc-map-hud-legend') return children['dbtc-map-hud dbtc-map-hud-legend'] ?? null;
            if (sel === '.center-shed-btn') return { onclick: null };
            return null;
          },
        };
        return el;
      };

      (globalThis as any).document = {
        createElement: () => makeEl(),
      };

      try {
        const container = makeEl();
        const sources: Record<string, any> = {};
        const layers: Record<string, any> = {};
        const mockMap: any = {
          getContainer: () => container,
          getSource: (id: string) => sources[id],
          addSource: (id: string, spec: any) => {
            sources[id] = { ...spec, setData: (d: any) => { sources[id].data = d; } };
          },
          getLayer: (id: string) => layers[id],
          addLayer: (spec: any) => {
            layers[spec.id] = spec;
          },
          hasImage: () => true,
          addImage: () => {},
          easeTo: () => {},
          getZoom: () => 12.5,
          on: () => {},
        };

        renderIsochroneMap(mockMap, [
          {
            station_id: 'A27',
            station_name: '42 St-Port Authority Bus Terminal (A,C,E)',
            latitude: 40.75731,
            longitude: -73.98974,
            travel_time_sec: 0,
            daytime_routes: 'A,C,E',
          },
          {
            station_id: 'A31',
            station_name: '14 St (A,C,E)',
            latitude: 40.74089,
            longitude: -74.00169,
            travel_time_sec: 360,
            daytime_routes: 'A,C,E',
          },
        ]);

        const originBannerHtml = children['dbtc-map-hud dbtc-map-hud-origin-banner']?.innerHTML ?? '';
        const legendHtml = children['dbtc-map-hud dbtc-map-hud-legend']?.innerHTML ?? '';

        expect(originBannerHtml).not.toContain('IRT Lines 1-7');
        expect(originBannerHtml).toContain('Lines A, C, E');
        expect(originBannerHtml).toContain('2 Stations + Walk Gradient');
        expect(legendHtml).not.toContain('IRT (1-7)');
        expect(legendHtml).toContain('Transit Reachability');
        expect(legendHtml).toContain('Station Walk Radius Gradient (80m/min)');
        expect(legendHtml).toContain('<strong>200m</strong> (2.5 min)');
        expect(legendHtml).toContain('<strong>400m</strong> (5 min)');
        expect(legendHtml).toContain('<strong>600m</strong> (7.5 min)');
        expect(legendHtml).toContain('<strong>800m</strong> (10 min)');

        // Custom query with unmapped station IDs and no route metadata must not inject hardcoded IRT ['2', '3'] routes
        renderIsochroneMap(mockMap, [
          {
            station_id: 'CUSTOM_HUB_999',
            station_name: 'Custom Ferry Terminal',
            latitude: 40.701,
            longitude: -74.012,
            travel_time_sec: 0,
          },
        ]);
        const customBannerHtml = children['dbtc-map-hud dbtc-map-hud-origin-banner']?.innerHTML ?? '';
        expect(customBannerHtml).toContain('Custom Ferry Terminal');
        expect(customBannerHtml).toContain('1 Station + Walk Gradient');
        expect(customBannerHtml).not.toContain('Lines 2, 3');
        const customStationFeat = sources['isochrone-stations-source']?.data?.features?.[0];
        expect(customStationFeat?.properties?.routes).toBe('');
      } finally {
        (globalThis as any).document = savedDoc;
      }
    });

    it('toggles periodic live query reruns without pinning scrubber to now, preserves state across remount, and restricts live mode to On Demand mode', async () => {
      const savedDoc = (globalThis as any).document;
      const savedWin = (globalThis as any).window;
      const savedRaf = (globalThis as any).requestAnimationFrame;
      const savedCaf = (globalThis as any).cancelAnimationFrame;

      const parseInnerElements = (html: string) => {
        const playBtn: any = {
          textContent: '▶',
          onclick: null,
          setAttribute: () => {},
        };
        const scrubber: any = {
          value: '1000',
          oninput: null,
        };
        const modeBadge: any = {
          textContent: '',
          style: {},
        };
        const timeLabel: any = {
          textContent: '',
        };
        const classes = new Set<string>(html.includes('dbtc-timelapse-live-btn active') ? ['active'] : []);
        const liveBtn: any = {
          textContent: html.includes('● LIVE ON') ? '● LIVE ON' : '● LIVE',
          disabled: html.includes('disabled'),
          isConnected: true,
          onclick: null,
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            contains: (c: string) => classes.has(c),
          },
          setAttribute: () => {},
        };
        return { playBtn, scrubber, modeBadge, timeLabel, liveBtn, speedBtns: [] };
      };

      const hudMap: Record<string, any> = {};
      const makeContainer = () => {
        const c: any = {
          isConnected: true,
          dataset: {},
          appendChild: (child: any) => {
            hudMap[child.className] = child;
          },
          querySelector: (sel: string) => {
            if (sel === '.dbtc-map-hud-fleet-filter') return hudMap['dbtc-map-hud dbtc-map-hud-fleet-filter'] ?? null;
            if (sel === '.dbtc-map-hud-timelapse') return hudMap['dbtc-map-hud dbtc-map-hud-timelapse'] ?? null;
            return null;
          },
        };
        return c;
      };

      (globalThis as any).window = {};
      (globalThis as any).requestAnimationFrame = () => 101;
      (globalThis as any).cancelAnimationFrame = () => {};
      (globalThis as any).document = {
        createElement: () => {
          let rawHtml = '';
          let subEls = parseInnerElements('');
          return {
            className: '',
            get innerHTML() {
              return rawHtml;
            },
            set innerHTML(val: string) {
              // Simulate real DOM behavior: overwriting innerHTML detaches previous child elements!
              if (subEls.liveBtn) {
                subEls.liveBtn.isConnected = false;
              }
              rawHtml = val;
              subEls = parseInnerElements(val);
            },
            querySelector: (sel: string) => {
              if (sel === '.dbtc-timelapse-play-btn') return subEls.playBtn;
              if (sel === '.dbtc-timelapse-scrubber') return subEls.scrubber;
              if (sel === '.dbtc-timelapse-mode-badge') return subEls.modeBadge;
              if (sel === '.dbtc-timelapse-time') return subEls.timeLabel;
              if (sel === '.dbtc-timelapse-live-btn') return subEls.liveBtn;
              if (sel === '.dbtc-active-trains-count') return { textContent: '' };
              return null;
            },
            querySelectorAll: () => [],
          };
        },
      };

      try {
        const container = makeContainer();
        const sources: Record<string, any> = {};
        const layers: Record<string, any> = {};
        const mockMap: any = {
          getContainer: () => container,
          getSource: (id: string) => sources[id],
          addSource: (id: string, spec: any) => {
            sources[id] = { ...spec, setData: (d: any) => { sources[id].data = d; } };
          },
          getLayer: (id: string) => layers[id],
          addLayer: (spec: any) => {
            layers[spec.id] = spec;
          },
          setFilter: () => {},
          hasImage: () => true,
          addImage: () => {},
          on: () => {},
        };

        const rows = [
          {
            vehicle_id: 'V1',
            trip_id: 'T1',
            route_id: '7',
            latitude: 40.75178,
            longitude: -73.97675,
            event_time: 1000,
            station_id: '723N',
            station_name: 'Grand Central-42 St',
            status: 'STOPPED_AT',
          },
          {
            vehicle_id: 'V1',
            trip_id: 'T1',
            route_id: '7',
            latitude: 40.74262,
            longitude: -73.95358,
            event_time: 1600,
            station_id: '721N',
            station_name: 'Vernon Blvd-Jackson Av',
            status: 'STOPPED_AT',
          },
        ];

        let refreshCalls = 0;
        let syncingBadgeDuringRefresh = '';
        renderTrainPositions(mockMap, rows, undefined, {
          liveModeAllowed: true,
          onRefreshLive: async () => {
            refreshCalls++;
            const currentHud = hudMap['dbtc-map-hud dbtc-map-hud-timelapse']!;
            syncingBadgeDuringRefresh = currentHud.querySelector('.dbtc-timelapse-mode-badge')?.textContent ?? '';
            // Simulate chart-router re-rendering with updated rows
            renderTrainPositions(mockMap, rows, undefined, {
              liveModeAllowed: true,
              onRefreshLive: mockMap._onRefreshLive,
            });
          },
        });

        const timelapseHud = hudMap['dbtc-map-hud dbtc-map-hud-timelapse']!;
        const initialScrubber = timelapseHud.querySelector('.dbtc-timelapse-scrubber');
        const initialBadge = timelapseHud.querySelector('.dbtc-timelapse-mode-badge');
        const initialLiveBtn = timelapseHud.querySelector('.dbtc-timelapse-live-btn');

        // Initially in browser mount, starts at 75% (1450) in REPLAY mode, and LIVE button is not yet active
        expect(initialScrubber.value).toBe('1450');
        expect(initialBadge.textContent).toBe('REPLAY');
        expect(initialLiveBtn.classList.contains('active')).toBe(false);
        expect(initialLiveBtn.textContent).toBe('● LIVE');

        // Click ● LIVE button -> triggers refresh without pinning scrubber to maxEpoch (1600), and switches to ✓ LIVE SYNCED · 1 train
        await initialLiveBtn.onclick();
        expect(refreshCalls).toBe(1);
        expect(syncingBadgeDuringRefresh).toBe('↻ SYNCING FEED...');
        expect(initialLiveBtn.isConnected).toBe(false);

        const afterScrubber = timelapseHud.querySelector('.dbtc-timelapse-scrubber');
        const afterBadge = timelapseHud.querySelector('.dbtc-timelapse-mode-badge');
        const afterLiveBtn = timelapseHud.querySelector('.dbtc-timelapse-live-btn');

        expect(afterScrubber.value).toBe('1450');
        expect(afterBadge.textContent).toBe('✓ LIVE SYNCED · 1 train');
        expect(afterLiveBtn.classList.contains('active')).toBe(true);
        expect(afterLiveBtn.textContent).toBe('● LIVE ON');
        expect(mockMap.getContainer().dataset['liveSyncPinned']).toBe('true');

        // Even if a fresh map instance is mounted into the same container, live auto-refresh state is preserved
        const freshMap: any = {
          ...mockMap,
          _liveSyncPinned: undefined,
          _justSyncedLiveAt: Date.now(),
        };
        renderTrainPositions(freshMap, rows, undefined, { liveModeAllowed: true });
        const remountedLiveBtn = timelapseHud.querySelector('.dbtc-timelapse-live-btn');
        expect(remountedLiveBtn.classList.contains('active')).toBe(true);
        expect(remountedLiveBtn.textContent).toBe('● LIVE ON');

        // When not in On Demand mode (liveModeAllowed: false), live mode is disabled and clicking does not refresh
        renderTrainPositions(freshMap, rows, undefined, {
          liveModeAllowed: false,
          onRefreshLive: async () => {
            refreshCalls++;
            return true;
          },
        });
        const disabledLiveBtn = timelapseHud.querySelector('.dbtc-timelapse-live-btn');
        expect(disabledLiveBtn.disabled).toBe(true);
        expect(disabledLiveBtn.classList.contains('active')).toBe(false);
        expect(disabledLiveBtn.textContent).toBe('● LIVE');
        await disabledLiveBtn.onclick();
        expect(refreshCalls).toBe(1);

        if (mockMap._liveSyncBadgeTimer) {
          clearTimeout(mockMap._liveSyncBadgeTimer);
        }
        if (freshMap._liveSyncBadgeTimer) {
          clearTimeout(freshMap._liveSyncBadgeTimer);
        }
        if (mockMap._livePollIntervalId) {
          clearInterval(mockMap._livePollIntervalId);
        }
        if (freshMap._livePollIntervalId) {
          clearInterval(freshMap._livePollIntervalId);
        }
      } finally {
        (globalThis as any).document = savedDoc;
        (globalThis as any).window = savedWin;
        (globalThis as any).requestAnimationFrame = savedRaf;
        (globalThis as any).cancelAnimationFrame = savedCaf;
      }
    });

    it('checks HEAD catalog.db ETag before re-downloading in refreshRemoteCatalog and de-collides cross-borough train trajectories onto physical subway tracks', async () => {
      const {
        checkCatalogHeadUpdate,
        refreshRemoteCatalog,
        resetCatalogHeaderStateForTest,
      } = await import('../src/data/duckdb-client.js');
      const { snapPointToSubwayTrack } = await import('../src/viz/map/mta-subway-overlay.js');

      resetCatalogHeaderStateForTest({
        etag: '"etag-v1"',
        lastModified: 'Tue, 10 Nov 2026 21:00:00 GMT',
        contentLength: '12345',
      });

      let headCalls = 0;
      let getCalls = 0;
      let registeredBuffers = 0;
      let currentEtag = '"etag-v1"';
      const duckHeaderBytes = new Uint8Array(4096);
      // Magic "DUCK" at offset 8..11
      duckHeaderBytes[8] = 0x44;
      duckHeaderBytes[9] = 0x55;
      duckHeaderBytes[10] = 0x43;
      duckHeaderBytes[11] = 0x4b;

      const mockDb = {
        registerFileBuffer: async () => {
          registeredBuffers++;
        },
        dropFile: async () => {},
      };

      const mockFetch = async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          headCalls++;
          return {
            ok: true,
            headers: {
              get: (h: string) => {
                const k = h.toLowerCase();
                if (k === 'etag') return currentEtag;
                if (k === 'last-modified') return 'Tue, 10 Nov 2026 21:00:00 GMT';
                if (k === 'content-length') return '12345';
                return null;
              },
            },
          } as unknown as Response;
        }
        getCalls++;
        return {
          ok: true,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'etag' ? currentEtag : null),
          },
          arrayBuffer: async () => duckHeaderBytes.buffer.slice(0),
        } as unknown as Response;
      };

      const unchangedCheck = await checkCatalogHeadUpdate('https://example.com/catalog.db', mockFetch as typeof fetch);
      expect(unchangedCheck.changed).toBe(false);
      expect(headCalls).toBe(1);

      const mockConnQueries: string[] = [];
      const mockConn = {
        query: async (sql: string) => {
          mockConnQueries.push(sql);
          return {};
        },
      };

      // 1. When ETag has not changed, refreshRemoteCatalog returns false without downloading catalog.db
      const refreshedUnchanged = await refreshRemoteCatalog(mockConn as never, {
        force: true,
        catalogUrl: 'https://example.com/catalog.db',
        fetchImpl: mockFetch as typeof fetch,
        dbOverride: mockDb,
      });
      expect(refreshedUnchanged).toBe(false);
      expect(getCalls).toBe(0);

      // 2. When ETag updates on R2, HEAD detects the change -> GET downloads fresh catalog.db and swaps prod in RAM
      currentEtag = '"etag-v2"';
      const refreshedChanged = await refreshRemoteCatalog(mockConn as never, {
        force: true,
        catalogUrl: 'https://example.com/catalog.db',
        fetchImpl: mockFetch as typeof fetch,
        dbOverride: mockDb,
      });
      expect(refreshedChanged).toBe(true);
      expect(getCalls).toBe(1);
      expect(registeredBuffers).toBe(1);
      expect(mockConnQueries.some(q => q.includes('AS prod'))).toBe(true);

      // 3. Cross-borough colliding trip_id (Bronx Wakefield 241 St vs Brooklyn New Lots Av on route 2) never flies across Flushing Bay / Queens
      const groups = new Map();
      groups.set('MTA_NYCT_SUBWAY:095950_2..N06R', {
        routeId: '2',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          {
            tripId: '095950_2..N06R',
            vehicleId: '095950_2..N06R',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.90313,
            lon: -73.85062,
            bearing: 210,
            speedMph: 18,
            eventTime: 1000,
            stationId: '201S',
            stationName: 'Wakefield-241 St',
            status: 'IN_TRANSIT_TO',
          },
          {
            tripId: '095950_2..N06R',
            vehicleId: '095950_2..N06R',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.66472,
            lon: -73.8949,
            bearing: 270,
            speedMph: 20,
            eventTime: 1030,
            stationId: '254N',
            stationName: 'Junius St',
            status: 'IN_TRANSIT_TO',
          },
          {
            tripId: '095950_2..N06R',
            vehicleId: '095950_2..N06R',
            routeId: '2',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: 40.66624,
            lon: -73.90298,
            bearing: 270,
            speedMph: 21,
            eventTime: 1090,
            stationId: '253N',
            stationName: 'Rockaway Av',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });

      for (const sampleT of [undefined, 1000, 1030, 1045, 1060, 1090] as const) {
        const { geojson } = buildTrainFeatures(groups, sampleT, { minEpoch: 1000, maxEpoch: 1090 });
        const [lon, lat] = (geojson.features[0]!.geometry as GeoJSON.Point).coordinates;
        // Must stay on New Lots Brooklyn tracks (~40.665), never in Queens / Flushing Bay (40.73..40.82)
        expect(lat).toBeLessThan(40.68);
        const snap = snapPointToSubwayTrack('2', lon!, lat!, undefined, 0.005);
        expect(snap).not.toBeNull();
        expect(Math.sqrt(snap!.distSq)).toBeLessThan(0.001);
      }
    });

    it('uses legend speed-tier colors on Corridor Speeds map even when SQL rows include dim_service_lines color_hex', () => {
      const rows = [
        {
          route_id: '7',
          color_hex: '#B933AD',
          from_station_id: '720',
          from_station_name: 'Hunters Point Av',
          from_lat: 40.74222,
          from_lon: -73.94891,
          to_station_id: '721',
          to_station_name: 'Vernon Blvd-Jackson Av',
          to_lat: 40.74263,
          to_lon: -73.95358,
          speed_mph: 11.4,
          effective_speed_mph: 11.4,
        },
        {
          route_id: 'E',
          color_hex: '#0039A6',
          from_station_id: 'F11',
          from_station_name: 'Lexington Av/53 St',
          from_lat: 40.75755,
          from_lon: -73.96906,
          to_station_id: 'F12',
          to_station_name: '5 Av/53 St',
          to_lat: 40.76017,
          to_lon: -73.97522,
          speed_mph: 18.2,
          effective_speed_mph: 18.2,
        },
        {
          route_id: 'F',
          color_hex: '#FF6319',
          from_station_id: 'B08',
          from_station_name: 'Lexington Av/63 St',
          from_lat: 40.76463,
          from_lon: -73.96611,
          to_station_id: 'B06',
          to_station_name: 'Roosevelt Island',
          to_lat: 40.75915,
          to_lon: -73.95326,
          speed_mph: 26.5,
          effective_speed_mph: 26.5,
        },
      ];

      const { segmentsGeoJson } = buildRouteSegmentGeoJson(rows, {
        metricColumn: 'speed_mph',
        followServiceLines: true,
      });
      expect(segmentsGeoJson.features).toHaveLength(3);

      const byRoute = new Map(
        segmentsGeoJson.features.map(f => [String(f.properties?.['routeId']), f.properties!])
      );
      // Segment ribbon colors strictly match the Corridor Speed Performance legend (#FF007F, #00E5FF, #00F59B)
      expect(byRoute.get('7')?.['speedTierColor']).toBe(getSpeedTierColor('slow'));
      expect(byRoute.get('7')?.['color']).toBe('#B933AD');
      expect(byRoute.get('E')?.['speedTierColor']).toBe(getSpeedTierColor('standard'));
      expect(byRoute.get('E')?.['color']).toBe('#0039A6');
      expect(byRoute.get('F')?.['speedTierColor']).toBe(getSpeedTierColor('express'));
      expect(byRoute.get('F')?.['color']).toBe('#FF6319');
    });

    it('filters multi-agency Ferry/LIRR/Metro-North stations and aligns subway stops onto tracks when switching to Tauranac / Hertz', async () => {
      const tauranacPreset = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === 'tauranac-hertz-1979')!;
      expect(tauranacPreset.theme).toBe('tauranac-hertz');

      const mockMultiAgencyCatalog: Record<string, { columns: { name: string; type: string }[]; rows: Record<string, unknown>[] }> = {
        'prod.transit_v2.view_dim_routes': {
          columns: [
            { name: 'route_id', type: 'VARCHAR' },
            { name: 'agency_id', type: 'VARCHAR' },
            { name: 'route_name', type: 'VARCHAR' },
            { name: 'color_hex', type: 'VARCHAR' },
          ],
          rows: [
            { route_id: '6', agency_id: 'MTA_NYCT_SUBWAY', route_name: 'Lexington Av Local', color_hex: '#00933C' },
            { route_id: '6', agency_id: 'MTA_METRO_NORTH', route_name: 'Waterbury Branch', color_hex: '#EE0034' },
            { route_id: 'ER', agency_id: 'NYC_FERRY', route_name: 'East River', color_hex: '#00839B' },
          ],
        },
        'prod.transit_v2.view_dim_service_lines': {
          columns: [
            { name: 'route_id', type: 'VARCHAR' },
            { name: 'agency_id', type: 'VARCHAR' },
            { name: 'color_hex', type: 'VARCHAR' },
            { name: 'geom_geojson', type: 'VARCHAR' },
          ],
          rows: [
            {
              route_id: '6',
              agency_id: 'MTA_NYCT_SUBWAY',
              color_hex: '#00933C',
              geom_geojson: JSON.stringify({
                type: 'MultiLineString',
                coordinates: [[[-73.9767, 40.7518], [-73.9719, 40.7571], [-73.9685, 40.7614]]],
              }),
            },
          ],
        },
        'prod.transit_v2.view_dim_stations': {
          columns: [
            { name: 'station_id', type: 'VARCHAR' },
            { name: 'agency_id', type: 'VARCHAR' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'latitude', type: 'DOUBLE' },
            { name: 'longitude', type: 'DOUBLE' },
            { name: 'gtfs_stop_id', type: 'VARCHAR' },
            { name: 'complex_id', type: 'VARCHAR' },
            { name: 'daytime_routes', type: 'VARCHAR' },
          ],
          rows: [
            // Subway station with numeric station_id ('399') and GTFS stop ID ('630' = 51 St), slightly offset from track
            {
              station_id: '399',
              agency_id: 'MTA_NYCT_SUBWAY',
              name: '51 St',
              latitude: 40.7574,
              longitude: -73.9712,
              gtfs_stop_id: '630',
              complex_id: '399',
              daytime_routes: '6',
            },
            // Subway Times Sq sibling platforms sharing complex_id '611'
            {
              station_id: '317',
              agency_id: 'MTA_NYCT_SUBWAY',
              name: 'Times Sq-42 St',
              latitude: 40.75529,
              longitude: -73.98715,
              gtfs_stop_id: '127',
              complex_id: '611',
              daytime_routes: '1 2 3',
            },
            {
              station_id: '11',
              agency_id: 'MTA_NYCT_SUBWAY',
              name: 'Times Sq-42 St',
              latitude: 40.75467,
              longitude: -73.98675,
              gtfs_stop_id: 'R16',
              complex_id: '611',
              daytime_routes: 'N Q R W',
            },
            // NYC Ferry pier in the East River (must be excluded!)
            {
              station_id: 'FERRY_HPS',
              agency_id: 'NYC_FERRY',
              name: 'Hunters Point South',
              latitude: 40.7418,
              longitude: -73.9613,
              gtfs_stop_id: 'FERRY_HPS',
              complex_id: 'FERRY_HPS',
              daytime_routes: 'ER',
            },
            // LIRR station with colliding numeric ID '131' (must be excluded!)
            {
              station_id: '131',
              agency_id: 'MTA_LIRR',
              name: 'Great Neck',
              latitude: 40.7873,
              longitude: -73.726,
              gtfs_stop_id: '131',
              complex_id: 'LIRR_131',
              daytime_routes: '9',
            },
          ],
        },
      };

      const mockExec = async (sql: string) => {
        for (const [tbl, data] of Object.entries(mockMultiAgencyCatalog)) {
          if (sql.includes(tbl)) return data;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      };

      try {
        const netTauranac = await bootstrapMapNetworkFromDuckDb(mockExec, tauranacPreset.config);
        // Metro-North route '6' (#EE0034) and NYC_FERRY 'ER' must NOT overwrite Subway '6' (#00933C)
        expect(netTauranac.routes['6']?.colorHex).toBe('#00933C');
        expect(netTauranac.routes['ER']).toBeUndefined();

        // East River ferry piers and LIRR stations must NOT appear in subway stations
        expect(netTauranac.stations['FERRY_HPS']).toBeUndefined();
        expect(netTauranac.stations['131']).toBeUndefined();

        // Subway station keyed by gtfs_stop_id ('630', not '399') and snapped cleanly onto the 6 track
        const st630 = netTauranac.stations['630'];
        expect(st630).toBeDefined();
        const snap630 = snapPointToSubwayTrack('6', st630!.lon, st630!.lat, netTauranac.serviceLines, 0.001);
        expect(snap630).not.toBeNull();
        expect(Math.sqrt(snap630!.distSq)).toBeLessThan(1e-4);

        // Co-located Times Sq platforms ('127' + 'R16') merge into primary hub '127'
        expect(netTauranac.stations['127']?.routes).toEqual(['1', '2', '3', 'N', 'Q', 'R', 'W']);
        expect(netTauranac.stations['R16']).toBeUndefined();
      } finally {
        resetActiveMapNetworkData();
      }
    });

    it('removes post-1953 lines and stations (Archer Ave 1988, 63rd St Tunnel 1989, 2nd Ave 2017, Rockaway 1956, Hudson Yards 2015) on the 1953 IND map', async () => {
      const preset1953 = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === 'ind-1953')!;
      expect(preset1953.config.tracksTable).toBe('prod.transit_v2.view_dim_service_lines_1953');
      expect(preset1953.config.stationsTable).toBe('prod.transit_v2.view_dim_stations_1953');

      const baseNet = getActiveMapNetworkData();
      const post1953RouteSet = new Set(['W', 'Z', 'T', 'IBX', '6X', '7X', 'FX', 'H']);
      const post1953StationSet = new Set(['G05', 'G06', 'G07', 'B04', 'B06', 'B08', 'Q03', 'Q04', 'Q05', 'H04', 'H11', '726', '301', 'D13', 'B10', 'D22']);
      const filtered1953Net = {
        ...baseNet,
        routes: Object.fromEntries(
          Object.entries(baseNet.routes).filter(([rid]) => !post1953RouteSet.has(rid))
        ),
        serviceLines: {
          type: 'FeatureCollection' as const,
          features: baseNet.serviceLines.features
            .filter(f => !post1953RouteSet.has(String(f.properties?.['route_id'] ?? '')))
            .map(f => {
              const rid = String(f.properties?.['route_id'] ?? '');
              if (rid === 'E') {
                return {
                  ...f,
                  geometry: {
                    type: 'MultiLineString' as const,
                    coordinates: [[[-74.0091, 40.7128], [-73.9691, 40.7575], [-73.9372, 40.7490], [-73.8160, 40.7080]]],
                  },
                };
              }
              if (rid === 'F') {
                return {
                  ...f,
                  geometry: {
                    type: 'MultiLineString' as const,
                    coordinates: [[[-73.9810, 40.5760], [-73.9752, 40.7602], [-73.9453, 40.7470], [-73.7900, 40.7120]]],
                  },
                };
              }
              if (rid === 'Q') {
                return {
                  ...f,
                  geometry: {
                    type: 'MultiLineString' as const,
                    coordinates: [[[-73.9750, 40.5750], [-73.9810, 40.6850], [-73.9906, 40.7347], [-73.9808, 40.7646]]],
                  },
                };
              }
              return f;
            }),
        },
        stations: Object.fromEntries(
          Object.entries(baseNet.stations).filter(([sid]) => !post1953StationSet.has(sid))
        ),
      };
      const indGeo = buildMtaSubwayMapGeoJson(filtered1953Net, 'ind');

      // Post-1953 routes (W, Z, T) must not appear
      const trunkRoutes = new Set(indGeo.subwayTrunks.features.map(f => String(f.properties?.['route_id'])));
      expect(trunkRoutes.has('W')).toBe(false);
      expect(trunkRoutes.has('Z')).toBe(false);
      expect(trunkRoutes.has('T')).toBe(false);
      expect(trunkRoutes.has('E')).toBe(true);
      expect(trunkRoutes.has('F')).toBe(true);

      // Post-1953 stations (Archer Ave G05/G06/G07, 63rd St B04/B06/B08, 2nd Ave Q03/Q04/Q05, Rockaway H04/H11, Hudson Yards 726, Harlem-148 St 301) must be excluded
      const stopIds = new Set([
        ...indGeo.stationStops.features.map(f => String(f.properties?.['stopId'])),
        ...indGeo.transferCapsules.features.map(f => String(f.properties?.['stopId'])),
      ]);
      for (const post1953Id of ['G05', 'G06', 'G07', 'B04', 'B06', 'B08', 'Q03', 'Q04', 'Q05', 'H04', 'H11', '726', '301', 'D13', 'B10', 'D22']) {
        expect(stopIds.has(post1953Id)).toBe(false);
      }

      // Route E and J must NOT dip south-east onto the 1988 Archer Ave extension in Jamaica
      const routeE = indGeo.subwayTrunks.features.find(f => f.properties?.['route_id'] === 'E')!;
      const eCoords = (routeE.geometry as GeoJSON.MultiLineString).coordinates.flat();
      const archerCoordsE = eCoords.filter(([lon, lat]) => lon! > -73.812 && lat! < 40.706);
      expect(archerCoordsE).toHaveLength(0);

      // Route F must follow the 1933 53rd St Tunnel (~40.757..40.761) and never cross the 1989 63rd St / Roosevelt Island Tunnel (~40.764)
      const routeF = indGeo.subwayTrunks.features.find(f => f.properties?.['route_id'] === 'F')!;
      const fEastRiverLats = (routeF.geometry as GeoJSON.MultiLineString).coordinates
        .flat()
        .filter(([lon]) => lon! > -73.972 && lon! < -73.945)
        .map(([, lat]) => lat!);
      expect(fEastRiverLats.length).toBeGreaterThan(0);
      expect(Math.max(...fEastRiverLats)).toBeLessThan(40.7625);

      // Route Q must terminate at 57 St-7 Av (never extending to 96 St on 2nd Ave)
      const routeQ = indGeo.subwayTrunks.features.find(f => f.properties?.['route_id'] === 'Q')!;
      const qManhattanLats = (routeQ.geometry as GeoJSON.MultiLineString).coordinates
        .flat()
        .filter(([, lat]) => lat! > 40.74)
        .map(([, lat]) => lat!);
      expect(Math.max(...qManhattanLats)).toBeLessThan(40.768);
    });

    it('renders Metro-North and LIRR branch badges, snaps commuter trains to regional corridors, and renders M60-SBS corridor on Geographic basemaps', async () => {
      const { ensureMtaSubwayOverlay } = await import('../src/viz/map/mta-subway-overlay.js');

      // 1. Metro-North Hudson ('1' -> 'HUD' #009B3A) and LIRR Babylon ('1' -> 'BAB' #00985F) disambiguate cleanly from IRT '1' (#EE352E)
      const commuterGroups = new Map<string, any>();
      commuterGroups.set('MTA_METRO_NORTH:MNR_101', {
        routeId: '1',
        agencyId: 'MTA_METRO_NORTH',
        positions: [
          {
            tripId: 'MNR_HUD_1',
            vehicleId: 'MNR_101',
            routeId: '1',
            agencyId: 'MTA_METRO_NORTH',
            lat: 40.9355,
            lon: -73.9022,
            bearing: 185,
            speedMph: 48.0,
            eventTime: 1000,
            stationId: '19',
            stationName: 'Yonkers',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });
      commuterGroups.set('MTA_LIRR:LIRR_202', {
        routeId: '1',
        agencyId: 'MTA_LIRR',
        positions: [
          {
            tripId: 'LIRR_BAB_2',
            vehicleId: 'LIRR_202',
            routeId: '1',
            agencyId: 'MTA_LIRR',
            lat: 40.6568,
            lon: -73.6085,
            bearing: 90,
            speedMph: 52.0,
            eventTime: 1000,
            stationId: '45',
            stationName: 'Freeport',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });

      const { geojson: commuterGeo } = buildTrainFeatures(commuterGroups, 1000, { minEpoch: 1000, maxEpoch: 1000 });
      expect(commuterGeo.features).toHaveLength(2);
      const mnrFeat = commuterGeo.features.find(f => f.properties?.['agencyId'] === 'MTA_METRO_NORTH')!;
      const lirrFeat = commuterGeo.features.find(f => f.properties?.['agencyId'] === 'MTA_LIRR')!;
      expect(mnrFeat.properties?.['badge']).toBe('HUD');
      expect(mnrFeat.properties?.['color']).toBe('#009B3A');
      expect(lirrFeat.properties?.['badge']).toBe('BAB');
      expect(lirrFeat.properties?.['color']).toBe('#00985F');
      expect(buildTrainPopupHtml(mnrFeat.properties!, true)).toContain('Metro-North Hudson Line');
      expect(buildTrainPopupHtml(lirrFeat.properties!, true)).toContain('LIRR Babylon Branch');

      // 2. Geographic map overlay with hideSubwayOverlay + corridorOverlay='M60-SBS' hides subway trunks and mounts M60 corridor layers
      const sources: Record<string, any> = {};
      const layers: Record<string, any> = {};
      const visibility: Record<string, string> = {};
      const mockGeoMap: any = {
        getSource: (id: string) => sources[id],
        addSource: (id: string, spec: any) => {
          sources[id] = { ...spec, setData: (d: any) => { sources[id].data = d; } };
        },
        getLayer: (id: string) => layers[id],
        addLayer: (spec: any) => {
          layers[spec.id] = spec;
        },
        setLayoutProperty: (id: string, prop: string, val: string) => {
          if (prop === 'visibility') visibility[id] = val;
        },
        hasImage: () => true,
        addImage: () => {},
      };

      ensureMtaSubwayOverlay(mockGeoMap, {
        theme: 'geo-light',
        hideSubwayOverlay: true,
        corridorOverlay: 'M60-SBS',
      });

      expect(visibility['mta-trunks-line']).toBe('none');
      expect(visibility['mta-commuter-rail-casing']).toBe('none');
      expect(visibility['dbtc-corridor-line']).toBe('visible');
      expect(visibility['dbtc-corridor-stops-circle']).toBe('visible');
      expect(sources['dbtc-corridor-line-src']?.data?.features?.[0]?.properties?.route_id).toBe('M60-SBS');
      expect(sources['openfreemap-planet']?.url).toBe('https://tiles.openfreemap.org/planet');
      expect(visibility['dbtc-ofm-geo-light-road-major']).toBe('visible');
    });

    it('extends schematic landmasses across Long Island, Westchester/CT, and NJ, includes PATH corridors, and prevents LIRR trains from jumping to subway stops or Fulton St A/C when switching maps', async () => {
      const {
        resolveStationInfo,
        hydrateStationCache,
        snapPointToSubwayTrack,
      } = await import('../src/viz/map/mta-subway-overlay.js');
      const { STARTER_CELLS } = await import('../src/state/local-state-schema.js');

      const pointInRing = (pt: [number, number], ring: readonly [number, number][]): boolean => {
        let inside = false;
        const [px, py] = pt;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]!;
          const [xj, yj] = ring[j]!;
          const intersect =
            yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-18) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const pointOnLand = (fc: GeoJSON.FeatureCollection, pt: [number, number]): boolean => {
        for (const feat of fc.features) {
          const geom = feat.geometry as any;
          if (!geom) continue;
          if (geom.type === 'Polygon') {
            if (pointInRing(pt, geom.coordinates[0])) return true;
          } else if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates) {
              if (pointInRing(pt, poly[0])) return true;
            }
          }
        }
        return false;
      };

      // 1. Schematic landmass covers Long Island, Westchester/Hudson Valley/CT, and NJ/Rockland/Orange while preserving waterways
      const mtaGeo = buildMtaSubwayMapGeoJson(undefined, 'mta');
      // Long Island
      expect(pointOnLand(mtaGeo.land, [-73.6412, 40.7403])).toBe(true); // Mineola
      expect(pointOnLand(mtaGeo.land, [-73.1155, 40.8080])).toBe(true); // Ronkonkoma
      expect(pointOnLand(mtaGeo.land, [-71.9532, 41.0472])).toBe(true); // Montauk
      expect(pointOnLand(mtaGeo.land, [-73.6625, 40.5892])).toBe(true); // Long Beach Island
      // Westchester, Hudson Valley & Connecticut
      expect(pointOnLand(mtaGeo.land, [-73.7752, 41.0338])).toBe(true); // White Plains
      expect(pointOnLand(mtaGeo.land, [-73.9380, 41.7072])).toBe(true); // Poughkeepsie
      expect(pointOnLand(mtaGeo.land, [-73.5562, 41.8145])).toBe(true); // Wassaic
      expect(pointOnLand(mtaGeo.land, [-72.9268, 41.2975])).toBe(true); // New Haven
      expect(pointOnLand(mtaGeo.land, [-73.0472, 41.5468])).toBe(true); // Waterbury
      expect(pointOnLand(mtaGeo.land, [-73.4488, 41.3962])).toBe(true); // Danbury
      // New Jersey & West-of-Hudson NY
      expect(pointOnLand(mtaGeo.land, [-74.0278, 40.7358])).toBe(true); // Hoboken Terminal
      expect(pointOnLand(mtaGeo.land, [-74.0629, 40.7330])).toBe(true); // Journal Square
      expect(pointOnLand(mtaGeo.land, [-74.1645, 40.7345])).toBe(true); // Newark Penn Station
      expect(pointOnLand(mtaGeo.land, [-74.0438, 41.1132])).toBe(true); // Spring Valley (PV)
      expect(pointOnLand(mtaGeo.land, [-74.6922, 41.3728])).toBe(true); // Port Jervis (PJ)
      // Key waterways remain water (not covered by land polygons)
      expect(pointOnLand(mtaGeo.land, [-74.0180, 40.7500])).toBe(false); // Hudson River
      expect(pointOnLand(mtaGeo.land, [-74.1380, 40.6880])).toBe(false); // Newark Bay
      expect(pointOnLand(mtaGeo.land, [-73.3000, 41.0200])).toBe(false); // Long Island Sound

      // 2. PATH corridors, route colors, and #19 starter query include PORT_AUTHORITY_PATH
      const pathCorridors = mtaGeo.commuterRail.features.filter(
        f => f.properties?.['agency_id'] === 'PORT_AUTHORITY_PATH'
      );
      expect(pathCorridors.map(f => f.properties?.['badge'])).toEqual(['NWK', 'JSQ', 'H33', 'HWT']);
      const { expandOssieQueryCalls } = await import('../src/data/ossie-loader.js');
      const commuterStarter = STARTER_CELLS.find(c => c.cellId === 'cell_commuter_rail_map')!;
      expect(expandOssieQueryCalls(commuterStarter.sqlText)).toContain('PORT_AUTHORITY_PATH');

      // 3. LIRR trains with station_ids colliding with NYC Subway ('233' Hoyt St, '236' Bergen St)
      // and LIRR BAB trains on the Brooklyn Atlantic Branch NEVER jump to subway stations or Fulton St A/C when switching maps
      try {
        setActiveMapNetworkData({
          routes: {
            '2': { routeId: '2', routeName: '7 Av Express', colorHex: '#EE352E', textColorHex: '#FFFFFF' },
            C: { routeId: 'C', routeName: '8 Av Local', colorHex: '#0039A6', textColorHex: '#FFFFFF' },
          },
          serviceLines: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { route_id: 'C' },
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [-73.9900, 40.6870],
                    [-73.9658, 40.6832], // Clinton-Washington Avs (Fulton St A/C)
                    [-73.9504, 40.6804], // Nostrand Av (Fulton St A/C)
                    [-73.9356, 40.6798], // Kingston-Throop Avs
                  ],
                },
              },
            ],
          },
          stations: {
            '233': { stationId: '233', name: 'Hoyt St', lat: 40.68848, lon: -73.9850, borough: 'Brooklyn', routes: ['2', '3'] },
            '236': { stationId: '236', name: 'Bergen St', lat: 40.68083, lon: -73.9751, borough: 'Brooklyn', routes: ['2', '3'] },
          },
          auxiliaryCorridors: getActiveMapNetworkData().auxiliaryCorridors ?? [],
          config: {
            routesTable: 'prod.transit_v2.view_dim_routes',
            tracksTable: 'prod.transit_v2.view_dim_service_lines',
            stationsTable: 'prod.transit_v2.view_dim_stations',
            presetId: 'tauranac-hertz',
            theme: 'tauranac-hertz',
          },
        });

        // Agency-scoped station lookup returns null for unhydrated LIRR stop '233' instead of subway Hoyt St
        expect(resolveStationInfo('233', 'MTA_LIRR')).toBeNull();
        expect(resolveStationInfo('233', 'MTA_NYCT_SUBWAY')?.name).toBe('Hoyt St');

        hydrateStationCache([
          {
            agency_id: 'MTA_LIRR',
            station_id: '233',
            station_name: 'Wyandanch',
            latitude: 40.7548,
            longitude: -73.3582,
          },
        ]);
        expect(resolveStationInfo('233', 'MTA_LIRR')?.name).toBe('Wyandanch');
        expect(resolveStationInfo('233', 'MTA_NYCT_SUBWAY')?.name).toBe('Hoyt St');

        // Simulate RON (LIRR route '4', station_id '233'), LB (LIRR route '6', station_id '236'),
        // BAB on the Brooklyn Atlantic Branch, and PATH NWK-WTC across consecutive GPS pings
        const groups = new Map<string, any>();
        groups.set('MTA_LIRR:RON_TRAIN', {
          routeId: '4',
          agencyId: 'MTA_LIRR',
          positions: [
            {
              tripId: 'RON_1',
              vehicleId: 'RON_TRAIN',
              routeId: '4',
              agencyId: 'MTA_LIRR',
              lat: 40.7510,
              lon: -73.3850,
              bearing: 80,
              speedMph: 58,
              eventTime: 1000,
              stationId: '233',
              stationName: 'Wyandanch',
              status: 'IN_TRANSIT_TO',
            },
            {
              tripId: 'RON_1',
              vehicleId: 'RON_TRAIN',
              routeId: '4',
              agencyId: 'MTA_LIRR',
              lat: 40.7548,
              lon: -73.3582,
              bearing: 80,
              speedMph: 55,
              eventTime: 1030,
              stationId: '233',
              stationName: 'Wyandanch',
              status: 'IN_TRANSIT_TO',
            },
          ],
        });
        groups.set('MTA_LIRR:LB_TRAIN', {
          routeId: '6',
          agencyId: 'MTA_LIRR',
          positions: [
            {
              tripId: 'LB_1',
              vehicleId: 'LB_TRAIN',
              routeId: '6',
              agencyId: 'MTA_LIRR',
              lat: 40.6258,
              lon: -73.6542,
              bearing: 180,
              speedMph: 42,
              eventTime: 1000,
              stationId: '236',
              stationName: 'Oceanside',
              status: 'IN_TRANSIT_TO',
            },
            {
              tripId: 'LB_1',
              vehicleId: 'LB_TRAIN',
              routeId: '6',
              agencyId: 'MTA_LIRR',
              lat: 40.6002,
              lon: -73.6558,
              bearing: 180,
              speedMph: 38,
              eventTime: 1030,
              stationId: '236',
              stationName: 'Island Park',
              status: 'IN_TRANSIT_TO',
            },
          ],
        });
        groups.set('MTA_LIRR:BAB_ATL', {
          routeId: '1',
          agencyId: 'MTA_LIRR',
          positions: [
            {
              tripId: 'BAB_ATL_1',
              vehicleId: 'BAB_ATL',
              routeId: '1',
              agencyId: 'MTA_LIRR',
              lat: 40.6784,
              lon: -73.9488, // Nostrand Av LIRR Atlantic Branch (south of Fulton St C at 40.6804)
              bearing: 95,
              speedMph: 40,
              eventTime: 1030,
              stationId: '15',
              stationName: 'Nostrand Avenue',
              status: 'IN_TRANSIT_TO',
            },
          ],
        });
        groups.set('PORT_AUTHORITY_PATH:PATH_1', {
          routeId: 'NWK-WTC',
          agencyId: 'PORT_AUTHORITY_PATH',
          positions: [
            {
              tripId: 'PATH_NWK_1',
              vehicleId: 'PATH_1',
              routeId: 'NWK-WTC',
              agencyId: 'PORT_AUTHORITY_PATH',
              lat: 40.7330,
              lon: -74.0629,
              bearing: 110,
              speedMph: 35,
              eventTime: 1030,
              stationId: 'JSQ',
              stationName: 'Journal Square',
              status: 'IN_TRANSIT_TO',
            },
          ],
        });

        const { geojson } = buildTrainFeatures(groups, 1015, { minEpoch: 1000, maxEpoch: 1030 });
        const ron = geojson.features.find(f => f.properties?.['vehicleId'] === 'RON_TRAIN')!;
        const lb = geojson.features.find(f => f.properties?.['vehicleId'] === 'LB_TRAIN')!;
        const bab = geojson.features.find(f => f.properties?.['vehicleId'] === 'BAB_ATL')!;
        const pathTrain = geojson.features.find(f => f.properties?.['vehicleId'] === 'PATH_1')!;

        expect(ron.properties?.['badge']).toBe('RON');
        // RON stays out in Suffolk County (~-73.37), NEVER teleported to Hoyt St (-73.985)
        expect((ron.geometry as any).coordinates[0]).toBeGreaterThan(-73.45);
        expect(lb.properties?.['badge']).toBe('LB');
        // LB stays in Nassau County (~-73.655), NEVER teleported to Bergen St (-73.975)
        expect((lb.geometry as any).coordinates[0]).toBeGreaterThan(-73.70);
        // BAB on Brooklyn Atlantic Branch snaps to LIRR Atlantic Branch (~40.6784), NEVER Fulton St C (40.6804)
        expect((bab.geometry as any).coordinates[1]).toBeLessThan(40.6792);
        const babSnap = snapPointToSubwayTrack('MTA_LIRR:BAB', -73.9488, 40.6784, undefined, 0.012);
        expect(babSnap?.matchedRouteId).toBe('MTA_LIRR:BAB');
        expect(babSnap?.lat).toBeCloseTo(40.6784, 3);
        // PATH NWK-WTC renders with NWK badge and official PATH red (#D93A30)
        expect(pathTrain.properties?.['badge']).toBe('NWK');
        expect(pathTrain.properties?.['color']).toBe('#D93A30');
        expect(buildTrainPopupHtml(pathTrain.properties!, true)).toContain('PATH Newark - World Trade Center');
      } finally {
        resetActiveMapNetworkData();
      }
    });

    it('draws complete Grand Central Madison -> 63rd St -> Sunnyside Yard LIRR tunnel on current maps and omits it on 1953 historical map', () => {
      const mtaGeo = buildMtaSubwayMapGeoJson(undefined, 'mta');
      const ctzFeat = mtaGeo.commuterRail.features.find(f => f.properties?.['id'] === 'LIRR_CTZ')!;
      const pwFeat = mtaGeo.commuterRail.features.find(f => f.properties?.['id'] === 'LIRR_PW')!;
      expect(ctzFeat).toBeDefined();
      expect(pwFeat).toBeDefined();

      const ctzChains = (ctzFeat.geometry as GeoJSON.MultiLineString).coordinates;
      const gcmChain = ctzChains.find(
        ch => Math.abs(ch[0]![0]! - (-73.9772)) < 0.001 && Math.abs(ch[0]![1]! - 40.7527) < 0.001
      );
      expect(gcmChain).toBeDefined();
      // Verify East Side Access passes north under Park Ave to 63rd St (~40.7646), across Roosevelt Island (~-73.9577, 40.7610),
      // through Sunnyside Yard (~-73.9305, 40.7484) and Harold Interlocking (~-73.9225, 40.7472) into Woodside (~-73.9029, 40.7458)
      expect(gcmChain!.some(pt => Math.abs(pt[0]! - (-73.9658)) < 0.002 && Math.abs(pt[1]! - 40.7646) < 0.002)).toBe(true);
      expect(gcmChain!.some(pt => Math.abs(pt[0]! - (-73.9577)) < 0.002 && Math.abs(pt[1]! - 40.7610) < 0.002)).toBe(true);
      expect(gcmChain!.some(pt => Math.abs(pt[0]! - (-73.9305)) < 0.002 && Math.abs(pt[1]! - 40.7484) < 0.002)).toBe(true);
      expect(gcmChain!.some(pt => Math.abs(pt[0]! - (-73.9029)) < 0.002 && Math.abs(pt[1]! - 40.7458) < 0.002)).toBe(true);

      // Port Washington branch also carries the Grand Central Madison -> 63rd St -> Sunnyside Yard -> Woodside tunnel
      const pwChains = (pwFeat.geometry as GeoJSON.MultiLineString).coordinates;
      expect(
        pwChains.some(ch => Math.abs(ch[0]![0]! - (-73.9772)) < 0.001 && ch.some(pt => Math.abs(pt[1]! - 40.7646) < 0.002))
      ).toBe(true);

      // 1953 historical IND map omits the 2023 Grand Central Madison tunnel while preserving Penn Station 33rd St Tunnel
      const ind1953Geo = buildMtaSubwayMapGeoJson(undefined, 'ind');
      const ind1953Ctz = ind1953Geo.commuterRail.features.find(f => f.properties?.['id'] === 'LIRR_CTZ')!;
      const ind1953Chains =
        ind1953Ctz.geometry.type === 'MultiLineString'
          ? ind1953Ctz.geometry.coordinates
          : [(ind1953Ctz.geometry as GeoJSON.LineString).coordinates];
      expect(
        ind1953Chains.some(ch => Math.abs(ch[0]![0]! - (-73.9772)) < 0.001 && Math.abs(ch[0]![1]! - 40.7527) < 0.001)
      ).toBe(false);
      expect(
        ind1953Chains.some(ch => Math.abs(ch[0]![0]! - (-73.9910)) < 0.001 && Math.abs(ch[0]![1]! - 40.7506) < 0.001)
      ).toBe(true);
    });

    it('interpolates NYC Subway fleet icons smoothly and continuously across express runs and river curves without freezing', () => {
      // 1. Express 4 train run from Grand Central-42 St (631) to 86 St (626) to 125 St (621)
      const gct = { lat: 40.751776, lon: -73.976848 };
      const st125 = { lat: 40.804138, lon: -73.937594 };
      const steps = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map(r =>
        interpolateAlongServiceLine('4', gct.lon, gct.lat, st125.lon, st125.lat, r)
      );
      for (let i = 1; i < steps.length; i++) {
        // Must strictly advance northward on every frame, never freezing at p1 for r < 0.5
        expect(steps[i]!.lat).toBeGreaterThan(steps[i - 1]!.lat + 0.003);
      }

      // 2. Curved East River tunnel run on A train (Jay St-MetroTech A41 -> Fulton St A38) via buildTrainFeatures
      const jaySt = resolveStationInfo('A41')!;
      const fultonSt = resolveStationInfo('A38')!;
      const groups = new Map();
      groups.set('MTA_NYCT_SUBWAY:A_RIVER', {
        routeId: 'A',
        agencyId: 'MTA_NYCT_SUBWAY',
        positions: [
          {
            tripId: 'A_RIVER',
            vehicleId: 'A_RIVER',
            routeId: 'A',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: jaySt.lat,
            lon: jaySt.lon,
            bearing: 310,
            speedMph: 28,
            eventTime: 1000,
            stationId: 'A41N',
            stationName: 'Jay St-MetroTech',
            status: 'IN_TRANSIT_TO',
          },
          {
            tripId: 'A_RIVER',
            vehicleId: 'A_RIVER',
            routeId: 'A',
            agencyId: 'MTA_NYCT_SUBWAY',
            lat: fultonSt.lat,
            lon: fultonSt.lon,
            bearing: 310,
            speedMph: 28,
            eventTime: 1120,
            stationId: 'A38N',
            stationName: 'Fulton St',
            status: 'IN_TRANSIT_TO',
          },
        ],
      });

      const coordsAt = [1000, 1030, 1060, 1090, 1120].map(t => {
        const { geojson } = buildTrainFeatures(groups, t, { minEpoch: 1000, maxEpoch: 1120 });
        return (geojson.features[0]!.geometry as GeoJSON.Point).coordinates as [number, number];
      });
      for (let i = 1; i < coordsAt.length; i++) {
        const movedDist = Math.hypot(
          coordsAt[i]![0] - coordsAt[i - 1]![0],
          coordsAt[i]![1] - coordsAt[i - 1]![1]
        );
        expect(movedDist).toBeGreaterThan(0.0015);
      }
    });
  });
});



