import { describe, it, expect } from 'vitest';
import { buildMareyChartOption } from '../src/viz/transit/marey-chart.js';

describe('Marey Chart Builder', () => {
  const stationOrder = ['ST_A', 'ST_B', 'ST_C', 'ST_D'];

  it('builds continuous epoch time x-axis and categorical station y-axis', () => {
    const baseEpoch = new Date('2026-10-28T23:50:00Z').getTime();
    const rows = [
      // Trip 1 crosses midnight
      { trip_id: 'TRIP_1', route_id: '7', station_id: 'ST_A', departure_time: baseEpoch },
      { trip_id: 'TRIP_1', route_id: '7', station_id: 'ST_B', departure_time: baseEpoch + 300000 },
      { trip_id: 'TRIP_1', route_id: '7', station_id: 'ST_C', departure_time: baseEpoch + 600000 }, // 00:00:00Z
      { trip_id: 'TRIP_1', route_id: '7', station_id: 'ST_D', departure_time: baseEpoch + 900000 }, // 00:05:00Z
    ];

    const option = buildMareyChartOption(rows, stationOrder);

    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe('time');

    const yAxis = option.yAxis as any;
    expect(yAxis.type).toBe('category');
    expect(yAxis.data).toEqual(stationOrder);

    const series = option.series as any[];
    expect(series).toHaveLength(1);
    expect(series[0].name).toContain('7 (TRIP_1)');
    expect(series[0].data).toHaveLength(4);

    // Continuous monotonic epoch time across midnight
    expect(series[0].data[0][0]).toBe(baseEpoch);
    expect(series[0].data[1][0]).toBe(baseEpoch + 300000);
    expect(series[0].data[2][0]).toBe(baseEpoch + 600000);
    expect(series[0].data[3][0]).toBe(baseEpoch + 900000);
  });

  it('draws express skip stringlines between non-adjacent corridor stations', () => {
    const baseEpoch = 1700000000000;
    const rows = [
      // Express skips ST_B and ST_C
      { trip_id: 'EXPRESS_TRIP', route_id: '6X', station_id: 'ST_A', departure_time: baseEpoch },
      { trip_id: 'EXPRESS_TRIP', route_id: '6X', station_id: 'ST_D', departure_time: baseEpoch + 400000 },
    ];

    const option = buildMareyChartOption(rows, stationOrder);
    const series = option.series as any[];
    expect(series).toHaveLength(1);
    expect(series[0].data).toEqual([
      [baseEpoch, 0], // ST_A is index 0
      [baseEpoch + 400000, 3], // ST_D is index 3
    ]);
  });

  it('renders MTA subway bullets in legend and origin markPoints, horizontal borough bands, and dwell steps', () => {
    const baseEpoch = new Date('2026-10-28T12:00:00Z').getTime();
    const rows = [
      {
        trip_id: '070000_7..S',
        route_id: '7',
        station_id: '701',
        station_name: 'Flushing-Main St',
        arrival_time: baseEpoch,
        departure_time: baseEpoch + 30000, // 30s dwell step
        display_value: '3m 10s headway',
        agency_id: 'MTA_NYCT_SUBWAY',
      },
      {
        trip_id: '070000_7..S',
        route_id: '7',
        station_id: '718',
        station_name: 'Queensboro Plaza',
        arrival_time: baseEpoch + 900000,
        departure_time: baseEpoch + 900000,
        display_value: '3m 15s headway',
        agency_id: 'MTA_NYCT_SUBWAY',
      },
      {
        trip_id: '070000_7..S',
        route_id: '7',
        station_id: '723',
        station_name: 'Grand Central-42 St',
        arrival_time: baseEpoch + 1200000,
        departure_time: baseEpoch + 1200000,
        display_value: '3m 05s headway',
        agency_id: 'MTA_NYCT_SUBWAY',
      },
    ];

    const option = buildMareyChartOption(rows, { showBoroughBands: true });
    const legend = option.legend as any;
    expect(legend.data).toHaveLength(1);
    expect(legend.data[0].name).toBe('7');
    expect(legend.data[0].icon).toContain('image://data:image/svg+xml;utf8,');

    const series = option.series as any[];
    expect(series).toHaveLength(1);
    // 3 stations + 1 extra point for the 30s dwell step at Flushing-Main St = 4 points
    expect(series[0].data).toHaveLength(4);
    expect(series[0].markPoint).toBeDefined();
    expect(series[0].markPoint.data[0].symbol).toContain('image://data:image/svg+xml;utf8,');

    // Horizontal borough bands (QUEENS -> MANHATTAN)
    expect(series[0].markArea).toBeDefined();
    expect(series[0].markArea.data).toHaveLength(2);
    expect(series[0].markArea.data[0][0].name).toBe('QUEENS');
    expect(series[0].markArea.data[1][0].name).toBe('MANHATTAN');

    // Tooltip includes custom display_value and MTA bullet
    const tooltip = option.tooltip as any;
    const html = tooltip.formatter({
      seriesIndex: 0,
      dataIndex: 0,
      seriesName: '7',
      value: [baseEpoch, 0],
    });
    expect(html).toContain('3m 10s headway');
    expect(html).toContain('Flushing-Main St');
  });

  it('places G line borough boundary between 21 St (Queens) and Greenpoint Av (Brooklyn) without misclassifying Fulton St (G36) as Manhattan', () => {
    const baseEpoch = new Date('2026-10-28T12:00:00Z').getTime();
    const gStops = [
      { id: 'G22', name: 'Court Sq' },
      { id: 'G24', name: '21 St' },
      { id: 'G26', name: 'Greenpoint Av' },
      { id: 'G30', name: 'Broadway' },
      { id: 'G35', name: 'Clinton-Washington Avs' },
      { id: 'G36', name: 'Fulton St' },
      { id: 'A42', name: 'Hoyt-Schermerhorn Sts' },
      { id: 'F20', name: 'Bergen St' },
      { id: 'F24', name: '7 Av' },
      { id: 'F27', name: 'Church Av' },
    ];
    const rows = gStops.map((s, idx) => ({
      trip_id: 'G_TRIP_1',
      route_id: 'G',
      station_id: s.id,
      station_name: s.name,
      arrival_time: baseEpoch + idx * 120000,
      departure_time: baseEpoch + idx * 120000,
      agency_id: 'MTA_NYCT_SUBWAY',
    }));

    const option = buildMareyChartOption(rows, { showBoroughBands: true });
    const series = option.series as any[];
    expect(series).toHaveLength(1);

    const spans = series[0].markArea.data;
    expect(spans).toHaveLength(2);
    expect(spans[0][0].name).toBe('QUEENS');
    expect(spans[0][0].yAxis).toBe('Court Sq');
    expect(spans[0][1].yAxis).toBe('21 St');

    expect(spans[1][0].name).toBe('BROOKLYN');
    expect(spans[1][0].yAxis).toBe('Greenpoint Av');
    expect(spans[1][1].yAxis).toBe('Church Av');

    const lines = series[0].markLine.data;
    expect(lines).toEqual([{ yAxis: 'Greenpoint Av' }]);
  });

  it('places F line borough boundaries cleanly across Queens, Manhattan, and Brooklyn even with 53rd St and 63rd St branches and short-turns', () => {
    const baseEpoch = new Date('2026-10-28T12:00:00Z').getTime();
    // Trip 1: 53rd St express branch (starts at Parsons Blvd F03 to test prefix insertion of F01/F02)
    const trip53Stops = [
      { id: 'F03', name: 'Parsons Blvd' },
      { id: 'G08', name: 'Forest Hills-71 Av' },
      { id: 'G14', name: 'Jackson Hts-Roosevelt Av' },
      { id: 'G21', name: 'Queens Plaza' },
      { id: 'F09', name: 'Court Sq-23 St' },
      { id: 'F11', name: 'Lexington Av/53 St' },
      { id: 'F12', name: '5 Av/53 St' },
      { id: 'D15', name: '47-50 Sts-Rockefeller Ctr' },
      { id: 'F14', name: '23 St' },
      { id: 'F16', name: 'East Broadway' },
      { id: 'F18', name: 'York St' },
      { id: 'A41', name: 'Jay St-MetroTech' },
      { id: 'F24', name: '7 Av' },
      { id: 'F27', name: 'Church Av' },
      { id: 'D43', name: 'Coney Island-Stillwell Av' },
    ];
    // Trip 2: 63rd St branch starting at Jamaica-179 St (F01 -> F02 -> F03)
    const trip63Stops = [
      { id: 'F01', name: 'Jamaica-179 St' },
      { id: 'F02', name: '169 St' },
      { id: 'F03', name: 'Parsons Blvd' },
      { id: 'G08', name: 'Forest Hills-71 Av' },
      { id: 'G14', name: 'Jackson Hts-Roosevelt Av' },
      { id: 'G20', name: '36 St' },
      { id: 'B04', name: '21 St-Queensbridge' },
      { id: 'B06', name: 'Roosevelt Island' },
      { id: 'B08', name: 'Lexington Av/63 St' },
      { id: 'B10', name: '57 St' },
      { id: 'D15', name: '47-50 Sts-Rockefeller Ctr' },
      { id: 'F14', name: '23 St' },
      { id: 'F16', name: 'East Broadway' },
      { id: 'F18', name: 'York St' },
      { id: 'A41', name: 'Jay St-MetroTech' },
    ];

    const rows = [
      ...trip53Stops.map((s, idx) => ({
        trip_id: 'F_TRIP_53',
        route_id: 'F',
        station_id: s.id,
        station_name: s.name,
        arrival_time: baseEpoch + idx * 120000,
        departure_time: baseEpoch + idx * 120000,
        agency_id: 'MTA_NYCT_SUBWAY',
      })),
      ...trip63Stops.map((s, idx) => ({
        trip_id: 'F_TRIP_63',
        route_id: 'F',
        station_id: s.id,
        station_name: s.name,
        arrival_time: baseEpoch + 300000 + idx * 120000,
        departure_time: baseEpoch + 300000 + idx * 120000,
        agency_id: 'MTA_NYCT_SUBWAY',
      })),
    ];

    const option = buildMareyChartOption(rows, { showBoroughBands: true });
    const series = option.series as any[];
    const spans = series[0].markArea.data;

    // Must have exactly 3 contiguous borough spans: QUEENS -> MANHATTAN -> BROOKLYN
    expect(spans).toHaveLength(3);
    expect(spans[0][0].name).toBe('QUEENS');
    expect(spans[0][0].yAxis).toBe('Jamaica-179 St');
    expect(spans[1][0].name).toBe('MANHATTAN');
    expect(spans[1][1].yAxis).toBe('East Broadway');
    expect(spans[2][0].name).toBe('BROOKLYN');
    expect(spans[2][0].yAxis).toBe('York St');
    expect(spans[2][1].yAxis).toBe('Coney Island-Stillwell Av');

    const lines = series[0].markLine.data;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ yAxis: 'York St' });
  });

  it('filters out single-point retrograde GTFS-RT station bounces and normalizes microsecond timestamps', () => {
    const baseEpochMs = new Date('2026-11-10T12:00:00Z').getTime();
    const baseEpochUs = baseEpochMs * 1000;
    const rows = [
      { trip_id: 'T_7_BOUNCE', route_id: '7', station_id: 'ST_A', arrival_time: baseEpochUs },
      { trip_id: 'T_7_BOUNCE', route_id: '7', station_id: 'ST_B', arrival_time: baseEpochUs + 120_000_000 },
      { trip_id: 'T_7_BOUNCE', route_id: '7', station_id: 'ST_C', arrival_time: baseEpochUs + 240_000_000 },
      // Stray out-of-order bounce back to ST_A at +300s
      { trip_id: 'T_7_BOUNCE', route_id: '7', station_id: 'ST_A', arrival_time: baseEpochUs + 300_000_000 },
      { trip_id: 'T_7_BOUNCE', route_id: '7', station_id: 'ST_D', arrival_time: baseEpochUs + 360_000_000 },
    ];

    const option = buildMareyChartOption(rows, stationOrder);
    const series = option.series as any[];
    expect(series).toHaveLength(1);
    const yIndices = series[0].data.map((pt: [number, number]) => pt[1]);
    expect(yIndices).toEqual([0, 1, 2, 3]);
    expect(series[0].data[0][0]).toBe(baseEpochMs);
    expect(series[0].data[3][0]).toBe(baseEpochMs + 360_000);
  });
});
