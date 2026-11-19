import { describe, it, expect } from 'vitest';
import { buildMareyChartOption } from '../src/viz/transit/marey-chart.js';
import { buildHeadwayHorizonOption } from '../src/viz/transit/headway-horizon.js';
import { buildOdRidershipFlowOption } from '../src/viz/transit/od-ridership-flow.js';
import { buildMultimodalPulseOption } from '../src/viz/transit/multimodal-pulse.js';
import { buildAdherenceWaterfallOption } from '../src/viz/transit/adherence-waterfall.js';
import { renderNavbar } from '../src/ui/navbar.js';
import { renderBottomBar } from '../src/ui/bottom-bar.js';
import { getAllowedWindowPresetsForDataset } from '../src/data/ossie-loader.js';

describe('Mobile UX Responsive Layouts', () => {
  it('truncates Marey Y-axis station labels and hides overlapping X-axis ticks on compact viewports (< 520px)', () => {
    const baseEpoch = new Date('2026-10-28T12:00:00Z').getTime();
    const rows = [
      {
        trip_id: 'T1',
        route_id: '7',
        station_id: '701',
        station_name: '74 St-Broadway / Jackson Hts-Roosevelt Ave',
        departure_time: baseEpoch,
      },
      {
        trip_id: 'T1',
        route_id: '7',
        station_id: '725',
        station_name: 'Times Sq-42 St / 42 St-Port Authority Bus Terminal',
        departure_time: baseEpoch + 900000,
      },
    ];

    const compactOpt = buildMareyChartOption(rows, { containerWidth: 340 });
    const yAxis = compactOpt.yAxis as any;
    const xAxis = compactOpt.xAxis as any;
    const grid = compactOpt.grid as any;

    expect(yAxis.axisLabel.overflow).toBe('truncate');
    expect(yAxis.axisLabel.width).toBeLessThanOrEqual(115);
    expect(yAxis.axisLabel.width).toBeGreaterThanOrEqual(84);
    expect(xAxis.axisLabel.hideOverlap).toBe(true);
    expect(grid.left).toBeLessThanOrEqual(10);

    // Desktop default remains untouched
    const desktopOpt = buildMareyChartOption(rows);
    expect((desktopOpt.yAxis as any).axisLabel.overflow).toBeUndefined();
    expect((desktopOpt.grid as any).left).toBe(16);
  });

  it('prevents Headway Horizon label collisions and recovers horizontal margin on compact viewports', () => {
    const baseTime = 1729000000000;
    const rows = [
      { route_id: 'R', event_time: baseTime, headway_sec: 240, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'M', event_time: baseTime + 300000, headway_sec: 600, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const compactOpt = buildHeadwayHorizonOption(rows, {
      bunchingThresholdSec: 120,
      gappingThresholdSec: 600,
      containerWidth: 340,
    });

    const grid = compactOpt.grid as any;
    const xAxis = compactOpt.xAxis as any;
    const series = compactOpt.series as any[];

    expect(grid.right).toBeLessThanOrEqual(20);
    expect(grid.top).toBeGreaterThanOrEqual(60);
    expect(xAxis.axisLabel.hideOverlap).toBe(true);
    expect(series[0].markLine.data[0].label.formatter).toBe('Bunched (< 2m)');
    expect(series[0].markLine.data[1].label.formatter).toBe('Gapped (> 10m)');

    // Desktop default retains full labels and margins
    const desktopOpt = buildHeadwayHorizonOption(rows, {
      bunchingThresholdSec: 120,
      gappingThresholdSec: 600,
    });
    expect((desktopOpt.grid as any).right).toBe(110);
    expect((desktopOpt.series as any[])[0].markLine.data[0].label.formatter).toContain('Nose-to-tail');
  });

  it('shrinks O-D Sankey side margins on compact viewports so flow ribbons remain wide', () => {
    const rows = [
      { origin_station_name: 'Times Sq-42 St', destination_station_name: 'Grand Central-42 St', passenger_count: 1500 },
      { origin_station_name: '34 St-Penn Station', destination_station_name: 'Fulton St', passenger_count: 1200 },
    ];

    const compactOpt = buildOdRidershipFlowOption(rows, { containerWidth: 340 });
    const sankey = (compactOpt.series as any[])[0];
    expect(sankey.left).toBeLessThanOrEqual(100);
    expect(sankey.right).toBeLessThanOrEqual(100);
    expect(sankey.nodeWidth).toBe(12);

    const desktopOpt = buildOdRidershipFlowOption(rows);
    expect((desktopOpt.series as any[])[0].left).toBe(150);
  });

  it('renders mobile menu trigger in navbar and Visuals tab in bottom bar', () => {
    const navMock: any = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    renderNavbar(navMock);
    expect(navMock.innerHTML).toContain('id="mobile-nav-menu-btn"');
    expect(navMock.innerHTML).toContain('class="navbar-collapsible"');
    expect(navMock.innerHTML).toContain('class="navbar-brand-short">DBTC</span>');

    const bottomMock: any = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const cleanup = renderBottomBar(bottomMock);
    expect(bottomMock.innerHTML).toContain('data-mobile-tab="visuals"');
    cleanup();
  });

  it('prevents Multimodal Pulse legend/axis overlap and tightens Adherence Waterfall margins on compact viewports', () => {
    const pulseRows = [
      { service_hour: '8:00 AM', entry_count: 15000, num_bikes_available: 20, num_docks_available: 15 },
      { service_hour: '9:00 AM', entry_count: 25000, num_bikes_available: 10, num_docks_available: 25 },
    ];
    const compactPulse = buildMultimodalPulseOption(pulseRows, { containerWidth: 340 });
    expect((compactPulse.legend as any).type).toBe('scroll');
    expect((compactPulse.grid as any).top).toBeGreaterThanOrEqual(60);
    expect((compactPulse.grid as any).left).toBeLessThanOrEqual(12);
    expect((compactPulse.yAxis as any[])[0].name).toBe('Subway');

    const waterfallRows = [
      { route_id: '7', scheduled_trips_count: 100, observed_trips_count: 92 },
    ];
    const compactWaterfall = buildAdherenceWaterfallOption(waterfallRows, { containerWidth: 340 });
    expect((compactWaterfall.grid as any).left).toBeLessThanOrEqual(15);
    expect((compactWaterfall.xAxis as any).axisLabel.rotate).toBe(18);
  });

  it('filters time window presets conditionally based on selected lens or fact dataset', () => {
    const odWindows = getAllowedWindowPresetsForDataset('od_ridership_flows').map(([k]) => k);
    expect(odWindows).toEqual(['od_baseline']);

    const headwayWindows = getAllowedWindowPresetsForDataset('subway_station_headways').map(([k]) => k);
    expect(headwayWindows).not.toContain('od_baseline');
    expect(headwayWindows).not.toContain('latest_turnstiles');
    expect(headwayWindows).toContain('yesterday_am_rush');

    const turnstileWindows = getAllowedWindowPresetsForDataset('station_turnstile_ranking').map(([k]) => k);
    expect(turnstileWindows[0]).toBe('latest_turnstiles');
    expect(turnstileWindows).not.toContain('od_baseline');
  });
});
