import { describe, it, expect } from 'vitest';
import { buildHeadwayHorizonOption } from '../src/viz/transit/headway-horizon.js';

describe('Headway Horizon Visualizations', () => {
  it('handles low-variance headways (e.g. 7 and 7X) with linear scale and route bullets', () => {
    const baseTime = 1729000000000;
    const rows = [
      { route_id: '7', event_time: baseTime, headway_sec: 240, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '7', event_time: baseTime + 300000, headway_sec: 320, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '7', event_time: baseTime + 600000, headway_sec: 180, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '7X', event_time: baseTime + 120000, headway_sec: 600, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: '7X', event_time: baseTime + 420000, headway_sec: 720, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const option = buildHeadwayHorizonOption(rows, {
      bunchingThresholdSec: 120,
      gappingThresholdSec: 900,
    });

    // Expect linear scale since max is 720s (720 / 900 < 3 and < 2700)
    const yAxis = option.yAxis as any;
    expect(yAxis.type).toBe('value');
    expect(yAxis.min).toBe(0);

    // Expect legend to contain authentic route bullet icons
    const legend = option.legend as any;
    expect(legend.data).toHaveLength(2);
    expect(legend.data[0].icon).toContain('image://data:image/svg+xml');
    expect(legend.data[1].icon).toContain('image://data:image/svg+xml');

    // Series checks
    const series = option.series as any[];
    expect(series).toHaveLength(2);

    // MarkLine should only be present on the first series
    expect(series[0].markLine).toBeDefined();
    expect(series[1].markLine).toBeUndefined();

    // Verify non-overlapping markLine label positions and plain-English text
    const markLineData = series[0].markLine.data;
    expect(markLineData).toHaveLength(2);
    expect(markLineData[0].label.position).toBe('insideStartBottom');
    expect(markLineData[0].label.formatter).toContain('Bunched');
    expect(markLineData[0].label.formatter).toContain('Nose-to-tail');
    expect(markLineData[1].label.position).toBe('insideEndTop');
    expect(markLineData[1].label.formatter).toContain('Gapped');
    expect(markLineData[1].label.formatter).toContain('Long wait');

    // Verify markArea background highlight
    expect(series[0].markArea).toBeDefined();
  });

  it('handles high-variance headways (e.g. R and M with overnight resumption) with auto log scale', () => {
    const baseTime = 1729000000000;
    const rows = [
      // Morning M resumption after overnight gap
      { route_id: 'M', event_time: baseTime, headway_sec: 35000, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'M', event_time: baseTime + 360000, headway_sec: 600, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'M', event_time: baseTime + 720000, headway_sec: 480, agency_id: 'MTA_NYCT_SUBWAY' },
      // R train running normal local headways
      { route_id: 'R', event_time: baseTime + 180000, headway_sec: 540, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'R', event_time: baseTime + 540000, headway_sec: 90, agency_id: 'MTA_NYCT_SUBWAY' }, // bunched
    ];

    const option = buildHeadwayHorizonOption(rows, {
      bunchingThresholdSec: 120,
      gappingThresholdSec: 900,
    });

    // Auto scale should switch to 'log' because max (35000) / 900 >= 3
    const yAxis = option.yAxis as any;
    expect(yAxis.type).toBe('log');
    expect(yAxis.name).toBe('Wait Between Trains (log scale)');
    expect(yAxis.min).toBeGreaterThanOrEqual(30);

    // Tooltip formatter test
    const tooltip = option.tooltip as any;
    const formatted = tooltip.formatter([
      { seriesName: 'M', value: [baseTime, 35000], color: '#FF6319' },
      { seriesName: 'R', value: [baseTime + 540000, 90], color: '#FCCC0A' },
    ]);
    expect(formatted).toContain('border-radius:50%'); // route bullet badge
    expect(formatted).toContain('GAPPED');
    expect(formatted).toContain('BUNCHED');
    expect(formatted).toContain('Line M');
    expect(formatted).toContain('Line R');

    const formattedWithStation = tooltip.formatter([
      {
        seriesName: 'R',
        value: [baseTime + 540000, 90],
        data: { stationName: 'Queens Plaza' },
        color: '#FCCC0A',
      },
    ]);
    expect(formattedWithStation).toContain('at Queens Plaza');
  });

  it('supports custom bunching and gapping thresholds and linear scale override', () => {
    const baseTime = 1729000000000;
    const rows = [
      { route_id: 'R', event_time: baseTime, headway_sec: 200, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'R', event_time: baseTime + 600000, headway_sec: 1400, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'M', event_time: baseTime + 300000, headway_sec: 150, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const option = buildHeadwayHorizonOption(rows, {
      bunchingThresholdSec: 180, // 3 min
      gappingThresholdSec: 1200, // 20 min
      yAxisScale: 'linear',
    });

    const yAxis = option.yAxis as any;
    expect(yAxis.type).toBe('value');
    expect(yAxis.name).toBe('Wait Between Trains');

    const series = option.series as any[];
    const markLine = series[0].markLine;
    expect(markLine).toBeDefined();

    const bunchLine = markLine.data[0];
    expect(bunchLine.yAxis).toBe(180);
    expect(bunchLine.label.formatter).toBe('Bunched (< 3m · Nose-to-tail)');

    const gapLine = markLine.data[1];
    expect(gapLine.yAxis).toBe(1200);
    expect(gapLine.label.formatter).toBe('Gapped (> 20m · Long wait)');

    const markArea = series[0].markArea;
    expect(markArea.data[0][1].yAxis).toBe(180);
    expect(markArea.data[1][0].yAxis).toBe(1200);
  });

  it('defaults to 2m bunching (120s) and 10m gapping (600s) when options are omitted', () => {
    const baseTime = 1729000000000;
    const rows = [
      { route_id: 'R', event_time: baseTime, headway_sec: 240, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'R', event_time: baseTime + 300000, headway_sec: 480, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const option = buildHeadwayHorizonOption(rows);
    const series = option.series as any[];
    const markLine = series[0].markLine;
    expect(markLine).toBeDefined();

    const bunchLine = markLine.data[0];
    expect(bunchLine.yAxis).toBe(120);
    expect(bunchLine.label.formatter).toBe('Bunched (< 2m · Nose-to-tail)');

    const gapLine = markLine.data[1];
    expect(gapLine.yAxis).toBe(600);
    expect(gapLine.label.formatter).toBe('Gapped (> 10m · Long wait)');
  });

  it('generates categorical distribution mode when event_time is absent', () => {
    const rows = [
      { route_id: 'R', headway_sec: 90, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'R', headway_sec: 300, agency_id: 'MTA_NYCT_SUBWAY' },
      { route_id: 'M', headway_sec: 950, agency_id: 'MTA_NYCT_SUBWAY' },
    ];

    const option = buildHeadwayHorizonOption(rows);
    const xAxis = option.xAxis as any;
    expect(xAxis.type).toBe('category');
    expect(xAxis.data).toContain('< 2m (Bunched)');
    expect(xAxis.data).toContain('> 12m (Gapped)');

    const series = option.series as any[];
    expect(series).toHaveLength(2);
    expect(series[0].type).toBe('bar');
  });
});
