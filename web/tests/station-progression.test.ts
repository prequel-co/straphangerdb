import { describe, it, expect } from 'vitest';
import { buildStationProgressionOption } from '../src/viz/transit/station-progression.js';

describe('Station Progression Chart Builder', () => {
  const sampleRows = [
    { route_id: '6', station_id: 'PELHAM', station_name: 'Pelham Bay Park', headway_sec: 180, agency_id: 'MTA_NYCT_SUBWAY' },
    { route_id: '6', station_id: 'BUHRE', station_name: 'Buhre Av', headway_sec: 210, agency_id: 'MTA_NYCT_SUBWAY' },
    { route_id: '6', station_id: 'MIDDLETOWN', station_name: 'Middletown Rd', headway_sec: 195, agency_id: 'MTA_NYCT_SUBWAY' },
    { route_id: '6X', station_id: 'PELHAM', station_name: 'Pelham Bay Park', headway_sec: 240, agency_id: 'MTA_NYCT_SUBWAY' },
    // 6X skips BUHRE (express)
    { route_id: '6X', station_id: 'MIDDLETOWN', station_name: 'Middletown Rd', headway_sec: 250, agency_id: 'MTA_NYCT_SUBWAY' },
  ];

  it('builds corridor alignment with categorical station x-axis, hides cluttered x-axis labels by default, and renders authentic MTA subway bullets', () => {
    const option = buildStationProgressionOption(sampleRows, { alignmentMode: 'corridor' });
    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe('category');
    expect(xAxis.data).toEqual(['Pelham Bay Park', 'Buhre Av', 'Middletown Rd']);
    expect(xAxis.axisLabel.show).toBe(false);
    expect(xAxis.axisTick.show).toBe(true);

    const legend = option.legend as any;
    expect(legend.data).toHaveLength(2);
    expect(legend.data[0].icon).toContain('image://data:image/svg+xml;utf8,');

    const series = option.series as any[];
    expect(series).toHaveLength(2);

    const local6 = series.find(s => s.name === '6');
    expect(local6).toBeDefined();
    expect(local6.data).toEqual([180, 210, 195]);
    expect(local6.connectNulls).toBe(true);
    expect(local6.markPoint).toBeDefined();
    expect(local6.markPoint.data[0].symbol).toContain('image://data:image/svg+xml;utf8,');

    const express6X = series.find(s => s.name === '6X');
    expect(express6X).toBeDefined();
    // Buhre Av is skipped, so it should be null
    expect(express6X.data).toEqual([240, null, 250]);
    expect(express6X.connectNulls).toBe(true);
  });

  it('resolves human-readable station name from GTFS ID lookup when station_name is absent', () => {
    const rows = [
      { route_id: '1', station_id: '101', headway_sec: 120 },
      { route_id: 'R', station_id: 'R16', headway_sec: 180 },
    ];
    const option = buildStationProgressionOption(rows, { alignmentMode: 'corridor' });
    const xAxis = option.xAxis as any;
    expect(xAxis.data).toEqual(['Van Cortlandt Park-242 St', 'Times Sq-42 St']);
  });

  it('builds normalized 0 to 100 percent progression axis', () => {
    const option = buildStationProgressionOption(sampleRows, { alignmentMode: 'normalized' });
    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe('value');
    expect(xAxis.min).toBe(0);
    expect(xAxis.max).toBe(100);

    const series = option.series as any[];
    const local6 = series.find(s => s.name === '6');
    expect(local6.data).toHaveLength(3);
    // 0%, 50%, 100%
    expect(local6.data[0][0]).toBe(0);
    expect(local6.data[1][0]).toBe(50);
    expect(local6.data[2][0]).toBe(100);
  });

  it('renders borough bands markArea when showBoroughBands is enabled', () => {
    const rowsWithBorough = [
      { route_id: '4', station_id: '161st-Yankee', headway_sec: 240, borough: 'Bronx', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '4', station_id: '125th-Lex', headway_sec: 220, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '4', station_id: '86th-Lex', headway_sec: 200, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
    ];
    const option = buildStationProgressionOption(rowsWithBorough, {
      alignmentMode: 'corridor',
      showBoroughBands: true,
    });
    const series = option.series as any[];
    expect(series[0].markArea).toBeDefined();
    expect(series[0].markArea.data).toHaveLength(2);
    expect(series[0].markArea.data[0][0].name).toBe('THE BRONX');
    expect(series[0].markArea.data[1][0].name).toBe('MANHATTAN');
  });

  it('classifies Cypress Av (617) and Brook Av (618) in THE BRONX even if SQL row has borough = Manhattan', () => {
    const pelhamSouthBronxRows = [
      { route_id: '6', station_id: '616', station_name: 'E 143 St-St Mary\'s St', headway_sec: 210, borough: 'Bronx', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '6', station_id: '617', station_name: 'Cypress Av', headway_sec: 215, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '6', station_id: '618', station_name: 'Brook Av', headway_sec: 220, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '6', station_id: '619', station_name: '3 Av-138 St', headway_sec: 225, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '6', station_id: '621', station_name: '125 St', headway_sec: 190, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '6', station_id: '622', station_name: '116 St', headway_sec: 195, borough: 'Manhattan', agency_id: 'MTA_NYCT_SUBWAY' },
    ];
    const option = buildStationProgressionOption(pelhamSouthBronxRows, {
      alignmentMode: 'corridor',
      showBoroughBands: true,
    });
    const series = option.series as any[];
    const spans = series[0].markArea.data;
    expect(spans).toHaveLength(2);
    expect(spans[0][0].name).toBe('THE BRONX');
    expect(spans[0][0].xAxis).toBe("E 143 St-St Mary's St");
    expect(spans[0][1].xAxis).toBe('3 Av-138 St');
    expect(spans[1][0].name).toBe('MANHATTAN');
    expect(spans[1][0].xAxis).toBe('125 St');
  });

  it('supports non-seconds measures and optional SQL display_value, measure_label, station_label, and route_label columns', () => {
    const incomeRows = [
      {
        route_id: '2',
        route_label: 'Line 2 (7 Av Express)',
        station_id: '201',
        station_name: 'Wakefield-241 St',
        station_label: 'Wakefield (241 St)',
        median_income: 68500,
        display_value: '$68,500',
        measure_label: 'Median Household Income',
        measure_unit: 'USD',
        agency_id: 'MTA_NYCT_SUBWAY',
      },
      {
        route_id: '2',
        route_label: 'Line 2 (7 Av Express)',
        station_id: '228',
        station_name: 'Park Pl',
        station_label: 'Park Pl (Lower Manhattan)',
        median_income: 175200,
        display_value: '$175,200',
        measure_label: 'Median Household Income',
        measure_unit: 'USD',
        agency_id: 'MTA_NYCT_SUBWAY',
      },
    ];

    const option = buildStationProgressionOption(incomeRows, { alignmentMode: 'corridor' });
    const xAxis = option.xAxis as any;
    expect(xAxis.data).toEqual(['Wakefield (241 St)', 'Park Pl (Lower Manhattan)']);

    const yAxis = option.yAxis as any;
    expect(yAxis.name).toBe('Median Household Income');
    expect(yAxis.axisLabel.formatter(85000)).toBe('$85k');

    const legend = option.legend as any;
    expect(legend.formatter('2')).toBe('Line 2 (7 Av Express)');

    const tooltip = option.tooltip as any;
    const html = tooltip.formatter([
      {
        axisValue: 'Wakefield (241 St)',
        dataIndex: 0,
        seriesName: '2',
        value: 68500,
      },
    ]);
    expect(html).toContain('$68,500');
    expect(html).toContain('Line 2 (7 Av Express)');
  });

  it('renders clean contiguous borough bands, monotonic branch station order, and solid trunk lines for 4, 5, 6 and 1, 2, 3', () => {
    // 1/2/3 rows where Upper Manhattan (1 line: 106-117) and Bronx (2 line: 208-222) overlap in latitude,
    // and Brooklyn New Lots branch (251-257) curves northeast in latitude
    const irt123Rows = [
      { route_id: '2', station_id: '201', station_name: 'Wakefield-241 St', borough: 'Bronx', headway_sec: 421, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '1', station_id: '101', station_name: 'Van Cortlandt Park-242 St', borough: 'Bronx', headway_sec: 363, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '1', station_id: '106', station_name: 'Marble Hill-225 St', borough: 'Manhattan', headway_sec: 341, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '222', station_name: '149 St-Hostos', borough: 'Bronx', headway_sec: 422, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '220', station_name: 'Jackson Av', borough: 'Bronx', headway_sec: 421, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '221', station_name: '3 Av-149 St', borough: 'Bronx', headway_sec: 424, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '301', station_name: 'Harlem-148 St', borough: 'Manhattan', headway_sec: 463, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '224', station_name: '135 St (2,3)', borough: 'Manhattan', headway_sec: 428, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '1', station_id: '120', station_name: '96 St (1,2,3)', borough: 'Manhattan', headway_sec: 326, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '120', station_name: '96 St (1,2,3)', borough: 'Manhattan', headway_sec: 420, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '120', station_name: '96 St (1,2,3)', borough: 'Manhattan', headway_sec: 467, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '2', station_id: '231', station_name: 'Clark St', borough: 'Brooklyn', headway_sec: 428, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '231', station_name: 'Clark St', borough: 'Brooklyn', headway_sec: 475, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '250', station_name: 'Crown Hts-Utica Av', borough: 'Brooklyn', headway_sec: 473, agency_id: 'MTA_NYCT_SUBWAY' },
      // Simulated latitude-ordered inversion on Livonia Ave (New Lots 257 is slightly north of Saratoga Av 252)
      { route_id: '3', station_id: '257', station_name: 'New Lots Av (3)', borough: 'Brooklyn', headway_sec: 471, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '251', station_name: 'Sutter Av-Rutland Rd', borough: 'Brooklyn', headway_sec: 458, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '3', station_id: '252', station_name: 'Saratoga Av', borough: 'Brooklyn', headway_sec: 456, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const option = buildStationProgressionOption(irt123Rows, {
      alignmentMode: 'corridor',
      showBoroughBands: true,
    });
    const series = option.series as any[];
    expect(series).toHaveLength(3);
    for (const s of series) {
      expect(s.lineStyle.type).toBe('solid');
    }

    // Should produce exactly 3 contiguous borough spans: THE BRONX, MANHATTAN, BROOKLYN
    const spans = series[0].markArea.data;
    expect(spans).toHaveLength(3);
    expect(spans[0][0].name).toBe('THE BRONX');
    expect(spans[1][0].name).toBe('MANHATTAN');
    expect(spans[2][0].name).toBe('BROOKLYN');

    // Within Bronx, 220 -> 221 -> 222 should be monotonically ordered
    const xData = (option.xAxis as any).data as string[];
    expect(xData.indexOf('Jackson Av')).toBeLessThan(xData.indexOf('3 Av-149 St'));
    expect(xData.indexOf('3 Av-149 St')).toBeLessThan(xData.indexOf('149 St-Hostos'));

    // Within Brooklyn, 250 -> 251 -> 252 -> 257 should be monotonically ordered
    expect(xData.indexOf('Crown Hts-Utica Av')).toBeLessThan(xData.indexOf('Sutter Av-Rutland Rd'));
    expect(xData.indexOf('Sutter Av-Rutland Rd')).toBeLessThan(xData.indexOf('Saratoga Av'));
    expect(xData.indexOf('Saratoga Av')).toBeLessThan(xData.indexOf('New Lots Av (3)'));
  });
});
