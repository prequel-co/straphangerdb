import type { EChartsOption } from 'echarts';
import {
  resolveRouteColor,
  buildRouteBulletSvgDataUri,
  buildRouteBulletHtml,
} from '../echarts-theme-mta.js';
import { differentiateTrunkShade } from './station-progression.js';

export interface HeadwayHorizonOptions {
  bunchingThresholdSec?: number;
  gappingThresholdSec?: number;
  timeColumn?: string;
  headwayColumn?: string;
  yAxisScale?: 'auto' | 'log' | 'linear';
  containerWidth?: number;
}

export function buildHeadwayHorizonOption(
  rows: readonly Record<string, unknown>[],
  options: HeadwayHorizonOptions = {}
): EChartsOption {
  const isCompact = options.containerWidth !== undefined && options.containerWidth < 520;
  const bunchingThreshold = options.bunchingThresholdSec ?? 120;
  const gappingThreshold = options.gappingThresholdSec ?? 600;
  const headwayCol = options.headwayColumn ?? 'headway_sec';
  const timeCol = options.timeColumn ?? 'event_time';

  // Group by route
  const routesMap = new Map<
    string,
    {
      time: number;
      headway: number;
      agencyId?: string | undefined;
      displayValue?: string | undefined;
      stationName?: string | undefined;
    }[]
  >();

  let globalMinHeadway = Infinity;
  let globalMaxHeadway = 0;

  for (const r of rows) {
    const routeId = String(r['route_id'] ?? 'Unknown').trim();
    if (!routeId) continue;
    const rawHeadway = r[headwayCol] ?? r['avg_headway_sec'];
    const headway = Number(rawHeadway ?? 0);
    if (isNaN(headway) || headway <= 0) continue;

    if (headway < globalMinHeadway) globalMinHeadway = headway;
    if (headway > globalMaxHeadway) globalMaxHeadway = headway;

    const rawTime = r[timeCol] ?? r['reading_time'] ?? r['departure_time'] ?? r['arrival_time'];
    let timeVal = 0;
    const normalizeEpochMs = (val: number): number => {
      if (!Number.isFinite(val) || val <= 0) return 0;
      if (val > 1e17) return Math.round(val / 1e6);
      if (val > 1e14) return Math.round(val / 1e3);
      if (val < 10_000_000_000) return val * 1000;
      return val;
    };
    if (typeof rawTime === 'number') {
      timeVal = normalizeEpochMs(rawTime);
    } else if (rawTime instanceof Date) {
      timeVal = rawTime.getTime();
    } else if (typeof rawTime === 'string' && rawTime.trim().length > 0) {
      const trimmed = rawTime.trim();
      const asNum = Number(trimmed);
      if (!Number.isNaN(asNum) && trimmed.length >= 9) {
        timeVal = normalizeEpochMs(asNum);
      } else {
        const parsed = new Date(trimmed).getTime();
        if (!Number.isNaN(parsed)) timeVal = parsed;
      }
    }

    const agencyId = r['agency_id'] ? String(r['agency_id']).trim() : undefined;
    const displayValue = r['display_value'] ? String(r['display_value']).trim() : undefined;
    const stationName = r['station_name'] ? String(r['station_name']).trim() : undefined;

    if (!routesMap.has(routeId)) {
      routesMap.set(routeId, []);
    }
    routesMap.get(routeId)!.push({
      time: timeVal,
      headway,
      agencyId,
      displayValue,
      stationName,
    });
  }

  if (globalMinHeadway === Infinity) globalMinHeadway = 60;
  if (globalMaxHeadway === 0) globalMaxHeadway = 1200;

  // Determine scale type:
  // Whether or not to use log scaling is an explicit option ('linear' vs 'log').
  // If 'log' or useLogScale is true, use logarithmic scale.
  // If 'linear', use linear scale.
  // If not explicitly set or in 'auto' mode, fall back to log if high variance compresses threshold lines.
  const isHighVariance = globalMaxHeadway / gappingThreshold >= 3 || globalMaxHeadway >= 2700;
  const useLogScale =
    options.yAxisScale === 'log' ||
    (options as any).useLogScale === true ||
    ((options.yAxisScale === 'auto' || options.yAxisScale === undefined) && isHighVariance);

  // Build authentic route styling and MTA bullet legend data
  const routeMetaMap = new Map<
    string,
    { color: string; bulletUri: string; agencyId?: string | undefined }
  >();
  const trunkColorCounts = new Map<string, number>();

  for (const [routeId, pts] of routesMap.entries()) {
    const agencyId = pts[0]?.agencyId;
    const trunkColor = resolveRouteColor(routeId, agencyId);
    const seen = trunkColorCounts.get(trunkColor) ?? 0;
    trunkColorCounts.set(trunkColor, seen + 1);
    const color = differentiateTrunkShade(trunkColor, seen);
    const bulletUri = buildRouteBulletSvgDataUri(routeId, agencyId, color);
    routeMetaMap.set(routeId, { color, bulletUri, agencyId });
  }

  const routeNames = Array.from(routesMap.keys());
  const legendData = routeNames.map(routeId => {
    const meta = routeMetaMap.get(routeId);
    return {
      name: routeId,
      icon: meta?.bulletUri ?? buildRouteBulletSvgDataUri(routeId, meta?.agencyId, meta?.color),
    };
  });

  const hasTime = Array.from(routesMap.values()).some(list => list.some(pt => pt.time > 0));
  const series: NonNullable<EChartsOption['series']> = [];

  if (hasTime) {
    // Time-series mode: plot headway over time with bunching and gapping thresholds
    let isFirstSeries = true;

    for (const [routeId, pts] of routesMap.entries()) {
      const validPts = pts.filter(p => p.time > 0).sort((a, b) => a.time - b.time);
      if (validPts.length === 0) continue;
      const meta = routeMetaMap.get(routeId)!;

      const seriesItem: any = {
        name: routeId,
        type: 'line',
        showSymbol: false,
        smooth: true,
        data: validPts.map(p => ({
          value: [p.time, Math.round(p.headway)],
          stationName: p.stationName,
          displayValue: p.displayValue,
        })),
        itemStyle: { color: meta.color },
        lineStyle: { width: 2.5 },
      };

      if (isFirstSeries) {
        isFirstSeries = false;
        const logAxisFloor = Math.max(30, Math.min(60, Math.floor(globalMinHeadway / 10) * 10));

        seriesItem.markLine = {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: bunchingThreshold,
              lineStyle: { color: '#DC2626', type: 'dashed', width: 2 },
              label: {
                formatter: isCompact
                  ? `Bunched (< ${Math.round(bunchingThreshold / 60)}m)`
                  : `Bunched (< ${Math.round(bunchingThreshold / 60)}m · Nose-to-tail)`,
                position: isCompact ? 'insideStartTop' : 'insideStartBottom',
                color: '#DC2626',
                fontWeight: 700,
                fontSize: isCompact ? 10 : 11,
                padding: isCompact ? [1, 4] : [2, 6],
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                borderRadius: 3,
              },
            },
            {
              yAxis: gappingThreshold,
              lineStyle: { color: '#7C3AED', type: 'dotted', width: 2 },
              label: {
                formatter: isCompact
                  ? `Gapped (> ${Math.round(gappingThreshold / 60)}m)`
                  : `Gapped (> ${Math.round(gappingThreshold / 60)}m · Long wait)`,
                position: 'insideEndTop',
                color: '#7C3AED',
                fontWeight: 700,
                fontSize: isCompact ? 10 : 11,
                padding: isCompact ? [1, 4] : [2, 6],
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                borderRadius: 3,
              },
            },
          ],
        };

        seriesItem.markArea = {
          silent: true,
          data: [
            [
              {
                yAxis: useLogScale ? logAxisFloor : 0,
                itemStyle: { color: 'rgba(220, 38, 38, 0.04)' },
              },
              {
                yAxis: bunchingThreshold,
              },
            ],
            [
              {
                yAxis: gappingThreshold,
                itemStyle: { color: 'rgba(124, 58, 237, 0.035)' },
              },
              {
                yAxis: Math.max(globalMaxHeadway * 1.05, gappingThreshold * 1.5),
              },
            ],
          ],
        };
      }

      series.push(seriesItem);
    }

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          color: '#0F172A',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
        extraCssText: 'box-shadow: 0 4px 14px rgba(0,0,0,0.09); border-radius: 6px;',
        formatter: (params: unknown) => {
          if (!Array.isArray(params)) return '';
          let out = '';
          for (const p of params) {
            const item = p as {
              seriesName: string;
              value: [number, number];
              data?: { stationName?: string; displayValue?: string };
              color: string;
            };
            const [time, headway] = item.value;
            const dateStr = new Date(time).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour12: false,
            });
            const meta = routeMetaMap.get(item.seriesName);
            const bulletHtml = buildRouteBulletHtml(item.seriesName, meta?.agencyId, item.color, 18);
            const mins = Math.floor(headway / 60);
            const secs = Math.round(headway % 60);
            const timeFormatted = mins > 0 ? `${mins}m ${secs > 0 ? `${secs}s` : ''}` : `${secs}s`;

            let badgeHtml = '';
            if (headway < bunchingThreshold) {
              badgeHtml = ' <span style="display:inline-block;padding:1px 5px;font-size:10px;font-weight:700;color:#DC2626;background:#FEE2E2;border-radius:3px;">BUNCHED</span>';
            } else if (headway > gappingThreshold) {
              badgeHtml = ' <span style="display:inline-block;padding:1px 5px;font-size:10px;font-weight:700;color:#7C3AED;background:#EDE9FE;border-radius:3px;">GAPPED</span>';
            }

            const stationSuffix = item.data?.stationName
              ? ` <span style="color:#64748B;font-size:11px;font-weight:400;">at ${item.data.stationName}</span>`
              : '';

            out += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;">${bulletHtml} <span style="font-weight:700;color:#0F172A;">Line ${item.seriesName}</span>${stationSuffix}: <span style="font-variant-numeric:tabular-nums;font-weight:600;">${timeFormatted}</span> <span style="color:#64748B;font-size:11px;">(${headway}s)</span>${badgeHtml} <span style="color:#94A3B8;font-size:11px;margin-left:auto;">${dateStr} ET</span></div>`;
          }
          return out;
        },
      },
      legend: {
        top: isCompact ? 4 : 6,
        type: isCompact ? 'scroll' : 'plain',
        data: legendData,
        itemWidth: isCompact ? 16 : 20,
        itemHeight: isCompact ? 16 : 20,
        itemGap: isCompact ? 10 : 14,
        textStyle: {
          color: '#1E293B',
          fontSize: isCompact ? 11 : 13,
          fontWeight: 700,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        formatter: (name: string) => {
          if (name === '7X') return '<7> Express';
          if (name === '6X') return '<6> Express';
          if (name.endsWith('X') && name.length > 1) return `<${name.slice(0, -1)}> Express`;
          return `Line ${name}`;
        },
      },
      grid: isCompact
        ? { left: 42, right: 14, top: 64, bottom: 34 }
        : { left: 60, right: 110, top: 48, bottom: 40 },
      xAxis: {
        type: 'time',
        name: isCompact ? '' : 'Time (ET)',
        ...(isCompact ? { splitNumber: 4 } : {}),
        nameTextStyle: {
          color: '#64748B',
          fontSize: 11,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        axisLabel: {
          color: '#64748B',
          fontSize: isCompact ? 10 : 11,
          fontFamily: '"JetBrains Mono", monospace',
          ...(isCompact ? { hideOverlap: true } : {}),
          formatter: (value: number) =>
            new Date(value).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }),
        },
        splitLine: {
          lineStyle: {
            color: '#E2E8F0',
            type: 'dashed',
          },
        },
      },
      yAxis: {
        type: useLogScale ? 'log' : 'value',
        name: isCompact
          ? useLogScale
            ? 'Wait (log)'
            : 'Wait'
          : useLogScale
            ? 'Wait Between Trains (log scale)'
            : 'Wait Between Trains',
        ...(isCompact ? { nameGap: 10 } : {}),
        nameTextStyle: {
          color: '#64748B',
          fontSize: isCompact ? 10 : 11,
          fontWeight: 600,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          padding: [0, 0, 4, 0],
        },
        min: useLogScale
          ? Math.max(30, Math.min(60, Math.floor(globalMinHeadway / 10) * 10))
          : 0,
        axisLabel: {
          color: '#64748B',
          fontSize: isCompact ? 10 : 11,
          fontFamily: '"JetBrains Mono", monospace',
          formatter: (sec: number) => {
            if (sec <= 0) return '0';
            if (sec < 60) return `${sec}s`;
            const m = Math.round(sec / 60);
            if (m < 60) return `${m}m`;
            const h = +(sec / 3600).toFixed(1);
            return `${h}h`;
          },
        },
        splitLine: {
          lineStyle: {
            color: '#E2E8F0',
            type: 'dashed',
          },
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'filter',
        },
        {
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
        },
      ],
      series,
    };
  } else {
    // Categorical / Binned distribution mode: bar distribution
    const bins = ['< 2m (Bunched)', '2 - 4m', '4 - 6m', '6 - 8m', '8 - 12m', '> 12m (Gapped)'];

    for (const [routeId, pts] of routesMap.entries()) {
      const counts = [0, 0, 0, 0, 0, 0];
      for (const p of pts) {
        const m = p.headway / 60;
        const idx = m < 2 ? 0 : m < 4 ? 1 : m < 6 ? 2 : m < 8 ? 3 : m < 12 ? 4 : 5;
        const current = counts[idx] ?? 0;
        counts[idx] = current + 1;
      }

      const meta = routeMetaMap.get(routeId)!;
      series.push({
        name: routeId,
        type: 'bar',
        data: counts,
        itemStyle: { color: meta.color, borderRadius: [3, 3, 0, 0] },
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          color: '#0F172A',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
        formatter: (params: unknown) => {
          if (!Array.isArray(params)) return '';
          let out = '';
          for (const p of params) {
            const item = p as { seriesName: string; value: number; color: string; name: string };
            const meta = routeMetaMap.get(item.seriesName);
            const bulletHtml = buildRouteBulletHtml(item.seriesName, meta?.agencyId, item.color, 18);
            out += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;">${bulletHtml} <span style="font-weight:700;">Line ${item.seriesName}</span> (${item.name}): <span style="font-variant-numeric:tabular-nums;font-weight:600;">${item.value} trips</span></div>`;
          }
          return out;
        },
      },
      legend: {
        top: isCompact ? 4 : 6,
        type: isCompact ? 'scroll' : 'plain',
        data: legendData,
        itemWidth: isCompact ? 16 : 20,
        itemHeight: isCompact ? 16 : 20,
        itemGap: isCompact ? 10 : 14,
        textStyle: {
          color: '#1E293B',
          fontSize: isCompact ? 11 : 13,
          fontWeight: 700,
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        formatter: (name: string) => {
          if (name === '7X') return '<7> Express';
          if (name === '6X') return '<6> Express';
          if (name.endsWith('X') && name.length > 1) return `<${name.slice(0, -1)}> Express`;
          return `Line ${name}`;
        },
      },
      grid: isCompact
        ? { left: 40, right: 12, top: 56, bottom: 40 }
        : { left: 60, right: 30, top: 48, bottom: 40 },
      xAxis: {
        type: 'category',
        data: bins,
        name: isCompact ? '' : 'Headway Interval',
        axisLabel: {
          color: '#64748B',
          fontSize: isCompact ? 10 : 11,
          ...(isCompact ? { rotate: 20, interval: 0 } : {}),
        },
      },
      yAxis: {
        type: 'value',
        name: 'Observations Count',
        axisLabel: {
          color: '#64748B',
          fontSize: 11,
          fontFamily: '"JetBrains Mono", monospace',
        },
        splitLine: {
          lineStyle: {
            color: '#E2E8F0',
            type: 'dashed',
          },
        },
      },
      series,
    };
  }
}
