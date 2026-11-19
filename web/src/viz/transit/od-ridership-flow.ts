import type { EChartsOption } from 'echarts';
import { KNOWN_NYC_STATION_NAMES } from './station-progression.js';

export interface OdRidershipFlowOptions {
  topStationsLimit?: number;
  selectedStations?: string[];
  displayMode?: 'sankey' | 'heatmap' | 'ranked-bars';
  chartTitle?: string;
  chartSubtitle?: string;
  sourceNote?: string;
  containerWidth?: number;
}

const MTA_TRUNK_PALETTE = [
  '#0039A6', // Eighth Ave (A, C, E)
  '#FF6319', // Sixth Ave (B, D, F, M)
  '#00933C', // Lexington Ave (4, 5, 6)
  '#EE352E', // Seventh Ave (1, 2, 3)
  '#B933AD', // Flushing (7)
  '#6CBE45', // Crosstown (G)
  '#FCCC0A', // Broadway (N, Q, R, W)
  '#996633', // Nassau (J, Z)
  '#00ADD0', // Second Ave (T)
  '#A7A9AC', // Canarsie (L)
];

const DESTINATION_SLATE_PALETTE = [
  '#475569',
  '#0284C7',
  '#0D9488',
  '#64748B',
  '#7C3AED',
  '#D97706',
  '#2563EB',
  '#059669',
];

function resolveStationName(rawIdOrName: string): string {
  const clean = rawIdOrName.trim();
  const known = KNOWN_NYC_STATION_NAMES[clean] || KNOWN_NYC_STATION_NAMES[clean.toUpperCase().replace(/[NS]$/, '')];
  if (known) return known.name;
  return clean;
}

export function buildOdRidershipFlowOption(
  rows: readonly Record<string, unknown>[],
  options: OdRidershipFlowOptions = {}
): EChartsOption {
  const isCompact = options.containerWidth !== undefined && options.containerWidth < 520;
  const sankeySideMargin = isCompact
    ? Math.max(76, Math.min(110, Math.floor((options.containerWidth ?? 360) * 0.26)))
    : 150;
  if (!rows || rows.length === 0) {
    return {
      title: {
        text: options.chartTitle ?? 'No Origin-Destination Flow Data',
        subtext: options.chartSubtitle ?? 'No passenger travel pairs found for the specified query filters.',
        left: 'center',
        top: 'middle',
        textStyle: {
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 16,
          color: '#64748B',
        },
        subtextStyle: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          color: '#94A3B8',
        },
      },
    };
  }

  const limit = Math.max(5, Math.min(50, options.topStationsLimit ?? 10));
  const mode = options.displayMode ?? 'sankey';

  // Aggregate OD pairs
  const odMap = new Map<string, number>();
  const originTotals = new Map<string, number>();
  const destTotals = new Map<string, number>();
  const stationTotals = new Map<string, number>();

  const firstNonEmpty = (...vals: unknown[]): string => {
    for (const v of vals) {
      if (v != null) {
        const s = String(v).trim();
        if (s.length > 0) return s;
      }
    }
    return 'Unknown';
  };

  for (const r of rows) {
    const rawOrig = firstNonEmpty(
      r['origin_station_name'],
      r['origin_station'],
      r['from_station_name'],
      r['from_station'],
      r['origin_borough'],
      r['origin'],
      r['source'],
      r['from'],
      r['origin_station_id'],
      r['from_station_id']
    );
    const rawDest = firstNonEmpty(
      r['destination_station_name'],
      r['destination_station'],
      r['to_station_name'],
      r['to_station'],
      r['destination_borough'],
      r['destination'],
      r['target'],
      r['to'],
      r['destination_station_id'],
      r['to_station_id']
    );

    const orig = resolveStationName(rawOrig);
    const dest = resolveStationName(rawDest);

    const count = Number(
      r['passenger_count'] ??
        r['estimated_ridership'] ??
        r['ridership'] ??
        r['entries'] ??
        r['flow_count'] ??
        r['count'] ??
        r['passengers'] ??
        0
    );
    if (isNaN(count) || count <= 0) continue;

    const key = `${orig}:::${dest}`;
    odMap.set(key, (odMap.get(key) ?? 0) + count);
    originTotals.set(orig, (originTotals.get(orig) ?? 0) + count);
    destTotals.set(dest, (destTotals.get(dest) ?? 0) + count);
    stationTotals.set(orig, (stationTotals.get(orig) ?? 0) + count);
    stationTotals.set(dest, (stationTotals.get(dest) ?? 0) + count);
  }

  if (odMap.size === 0) {
    return {
      title: {
        text: options.chartTitle ?? 'Zero Travel Volume Recorded',
        subtext: 'Passenger counts for all queried origin-destination pairs were zero or invalid.',
        left: 'center',
        top: 'middle',
        textStyle: {
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 16,
          color: '#64748B',
        },
        subtextStyle: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          color: '#94A3B8',
        },
      },
    };
  }

  // Determine distinct active stations vs Other Stations
  let distinctSet: Set<string>;
  if (options.selectedStations && options.selectedStations.length > 0) {
    distinctSet = new Set(options.selectedStations.map(s => resolveStationName(s)));
  } else {
    const sortedStations = Array.from(stationTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([st]) => st);
    distinctSet = new Set(sortedStations.slice(0, limit));
  }

  // Group pairs beyond threshold into Other Stations
  const groupedOdMap = new Map<string, number>();
  for (const [key, count] of odMap.entries()) {
    const [orig, dest] = key.split(':::');
    if (!orig || !dest) continue;
    const gOrig = distinctSet.has(orig) ? orig : 'Other Stations';
    const gDest = distinctSet.has(dest) ? dest : 'Other Stations';
    const gKey = `${gOrig}:::${gDest}`;
    groupedOdMap.set(gKey, (groupedOdMap.get(gKey) ?? 0) + count);
  }

  // Sankey Mode (Default)
  if (mode === 'sankey') {
    const sortedPairs = Array.from(groupedOdMap.entries())
      .sort((a, b) => b[1] - a[1]);

    const originSet = new Set<string>();
    const destSet = new Set<string>();

    for (const [key] of sortedPairs) {
      const [orig, dest] = key.split(':::');
      if (orig && dest) {
        originSet.add(orig);
        destSet.add(dest);
      }
    }

    // Sort distinct origins by volume descending, Other Stations at the bottom
    const sortedOrigins = Array.from(originSet).sort((a, b) => {
      if (a === 'Other Stations') return 1;
      if (b === 'Other Stations') return -1;
      return (originTotals.get(b) ?? 0) - (originTotals.get(a) ?? 0);
    });

    // Sort distinct destinations by volume descending, Other Stations at the bottom
    const sortedDests = Array.from(destSet).sort((a, b) => {
      if (a === 'Other Stations') return 1;
      if (b === 'Other Stations') return -1;
      return (destTotals.get(b) ?? 0) - (destTotals.get(a) ?? 0);
    });

    const nodes: Array<{
      name: string;
      depth: number;
      itemStyle: { color: string };
    }> = [];

    const links: Array<{
      source: string;
      target: string;
      value: number;
    }> = [];

    let origIdx = 0;
    for (const orig of sortedOrigins) {
      const isOther = orig === 'Other Stations';
      nodes.push({
        name: `${orig} (Origin)`,
        depth: 0,
        itemStyle: {
          color: isOther ? '#94A3B8' : MTA_TRUNK_PALETTE[origIdx % MTA_TRUNK_PALETTE.length]!,
        },
      });
      if (!isOther) origIdx++;
    }

    let destIdx = 0;
    for (const dest of sortedDests) {
      const isOther = dest === 'Other Stations';
      nodes.push({
        name: `${dest} (Dest)`,
        depth: 1,
        itemStyle: {
          color: isOther ? '#94A3B8' : DESTINATION_SLATE_PALETTE[destIdx % DESTINATION_SLATE_PALETTE.length]!,
        },
      });
      if (!isOther) destIdx++;
    }

    for (const [key, count] of sortedPairs) {
      const [orig, dest] = key.split(':::');
      if (orig && dest) {
        links.push({
          source: `${orig} (Origin)`,
          target: `${dest} (Dest)`,
          value: count,
        });
      }
    }

    return {
      ...(options.chartTitle
        ? {
            title: {
              text: options.chartTitle,
              ...(options.chartSubtitle ? { subtext: options.chartSubtitle } : {}),
              left: 10,
              top: 10,
              textStyle: {
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 16,
                fontWeight: 'bold',
                color: '#1E293B',
              },
              subtextStyle: {
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                fontSize: 12,
                color: '#64748B',
              },
            },
          }
        : {}),
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          color: '#1E293B',
        },
        extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
        formatter: (params: unknown) => {
          const p = params as {
            dataType?: string;
            data?: {
              source?: string;
              target?: string;
              value?: number;
              name?: string;
            };
            value?: number;
          };

          if (p.dataType === 'edge') {
            const src = (p.data?.source ?? '').replace(/\s*\((?:Origin|Dest)\)$/, '');
            const tgt = (p.data?.target ?? '').replace(/\s*\((?:Origin|Dest)\)$/, '');
            const val = Number(p.data?.value ?? 0).toLocaleString();
            return (
              `<div style="font-family: Georgia, serif; font-size: 14px; font-weight: bold; color: #1E293B; margin-bottom: 4px;">Ridership Flow</div>` +
              `<div style="font-size: 12px; color: #64748B;">Origin: <span style="font-weight: 600; color: #0039A6;">${src}</span></div>` +
              `<div style="font-size: 12px; color: #64748B;">Destination: <span style="font-weight: 600; color: #1E293B;">${tgt}</span></div>` +
              `<div style="margin-top: 6px; font-size: 13px; font-family: 'JetBrains Mono', monospace; font-weight: bold; color: #0F172A;">${val} passengers</div>`
            );
          }

          const rawName = p.data?.name ?? '';
          const cleanName = rawName.replace(/\s*\((?:Origin|Dest)\)$/, '');
          const isOrigin = rawName.includes('(Origin)');
          const isOther = cleanName === 'Other Stations';
          const role = isOther ? 'Aggregated Hubs' : (isOrigin ? 'Origin Station' : 'Destination Station');
          const val = Number(p.value ?? p.data?.value ?? 0).toLocaleString();
          const noteHtml = isOther
            ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">Aggregated travel outside selected active hubs</div>`
            : '';
          return (
            `<div style="font-family: Georgia, serif; font-size: 14px; font-weight: bold; color: #1E293B; margin-bottom: 4px;">${cleanName}</div>` +
            `<div style="font-size: 11px; text-transform: uppercase; color: #64748B; letter-spacing: 0.5px;">${role}</div>` +
            noteHtml +
            (val !== '0'
              ? `<div style="margin-top: 6px; font-size: 13px; font-family: 'JetBrains Mono', monospace; font-weight: bold; color: #0F172A;">${val} total volume</div>`
              : '')
          );
        },
      },
      series: [
        {
          type: 'sankey',
          layoutIterations: 32,
          nodeWidth: isCompact ? 12 : 16,
          nodeGap: isCompact ? 10 : 14,
          left: sankeySideMargin,
          right: sankeySideMargin,
          top: options.chartTitle ? 60 : 25,
          bottom: options.sourceNote ? 40 : 25,
          draggable: false,
          emphasis: {
            focus: 'adjacency',
            lineStyle: {
              opacity: 0.65,
            },
          },
          data: nodes,
          links: links,
          lineStyle: {
            color: 'gradient',
            curveness: 0.5,
            opacity: 0.32,
          },
          label: {
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            fontSize: isCompact ? 10 : 11,
            fontWeight: 500,
            color: '#1E293B',
            overflow: 'truncate',
            width: isCompact ? sankeySideMargin - 12 : 130,
            formatter: (params: unknown) => {
              const item = params as { name: string };
              return item.name.replace(/\s*\((?:Origin|Dest)\)$/, '');
            },
          },
          levels: [
            {
              depth: 0,
              label: { position: 'left', distance: 10 },
            },
            {
              depth: 1,
              label: { position: 'right', distance: 10 },
            },
          ],
        },
      ],
      ...(options.sourceNote
        ? {
            graphic: [
              {
                type: 'text',
                right: 15,
                bottom: 8,
                style: {
                  text: options.sourceNote,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontSize: 10,
                  fill: '#94A3B8',
                },
              },
            ],
          }
        : {}),
    };
  }

  if (mode === 'ranked-bars') {
    // Top OD pairs by volume (using grouped active hubs and Other Stations)
    const sortedPairs = Array.from(groupedOdMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(limit * 2, 15));

    const labels = sortedPairs.map(([key]) => {
      const [orig, dest] = key.split(':::');
      return `${orig} -> ${dest}`;
    });
    const values = sortedPairs.map(([, val]) => val);

    return {
      ...(options.chartTitle
        ? {
            title: {
              text: options.chartTitle,
              ...(options.chartSubtitle ? { subtext: options.chartSubtitle } : {}),
              left: 10,
              top: 10,
              textStyle: {
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 16,
                fontWeight: 'bold',
                color: '#1E293B',
              },
              subtextStyle: {
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                fontSize: 12,
                color: '#64748B',
              },
            },
          }
        : {}),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: {
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 12,
          color: '#1E293B',
        },
        extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const p = params[0] as { name: string; value: number };
          return (
            `<div style="font-family: Georgia, serif; font-size: 13px; font-weight: bold; color: #1E293B; margin-bottom: 2px;">${p.name}</div>` +
            `<div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #0039A6; font-weight: bold;">${p.value.toLocaleString()} passengers</div>`
          );
        },
      },
      grid: {
        left: 220,
        right: 40,
        top: options.chartTitle ? 60 : 30,
        bottom: options.sourceNote ? 40 : 30,
      },
      xAxis: {
        type: 'value',
        name: 'Passengers',
        nameTextStyle: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#64748B',
        },
        axisLabel: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#64748B',
          formatter: (v: number) => v.toLocaleString(),
        },
        splitLine: {
          lineStyle: { color: '#E2E8F0', type: 'dashed' },
        },
      },
      yAxis: {
        type: 'category',
        data: [...labels].reverse(),
        axisLabel: {
          interval: 0,
          fontSize: 11,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: '#1E293B',
          width: 200,
          overflow: 'truncate',
        },
        axisLine: { lineStyle: { color: '#CBD5E1' } },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'Passengers',
          type: 'bar',
          data: [...values].reverse(),
          itemStyle: {
            color: '#0039A6',
            borderRadius: [0, 3, 3, 0],
          },
          label: {
            show: true,
            position: 'right',
            formatter: (p: { value: unknown }) => Number(p.value).toLocaleString(),
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#64748B',
          },
        },
      ],
      ...(options.sourceNote
        ? {
            graphic: [
              {
                type: 'text',
                right: 15,
                bottom: 8,
                style: {
                  text: options.sourceNote,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  fontSize: 10,
                  fill: '#94A3B8',
                },
              },
            ],
          }
        : {}),
    };
  }

  // Heatmap mode: Top origins and top destinations from grouped pairs
  const topOrigins = Array.from(new Set(Array.from(groupedOdMap.keys()).map(k => k.split(':::')[0]!)))
    .sort((a, b) => {
      if (a === 'Other Stations') return 1;
      if (b === 'Other Stations') return -1;
      return (originTotals.get(b) ?? 0) - (originTotals.get(a) ?? 0);
    });

  const topDests = Array.from(new Set(Array.from(groupedOdMap.keys()).map(k => k.split(':::')[1]!)))
    .sort((a, b) => {
      if (a === 'Other Stations') return 1;
      if (b === 'Other Stations') return -1;
      return (destTotals.get(b) ?? 0) - (destTotals.get(a) ?? 0);
    });

  const origIndex = new Map(topOrigins.map((o, i) => [o, i]));
  const destIndex = new Map(topDests.map((d, i) => [d, i]));

  const heatmapData: [number, number, number][] = [];
  let maxVal = 1;

  for (const [key, count] of groupedOdMap.entries()) {
    const [orig, dest] = key.split(':::');
    if (!orig || !dest) continue;
    const oi = origIndex.get(orig);
    const di = destIndex.get(dest);
    if (oi !== undefined && di !== undefined) {
      heatmapData.push([di, oi, count]);
      if (count > maxVal) maxVal = count;
    }
  }

  return {
    ...(options.chartTitle
      ? {
          title: {
            text: options.chartTitle,
            ...(options.chartSubtitle ? { subtext: options.chartSubtitle } : {}),
            left: 10,
            top: 10,
            textStyle: {
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 16,
              fontWeight: 'bold',
              color: '#1E293B',
            },
            subtextStyle: {
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 12,
              color: '#64748B',
            },
          },
        }
      : {}),
    tooltip: {
      position: 'top',
      backgroundColor: '#FFFFFF',
      borderColor: '#E2E8F0',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 12,
        color: '#1E293B',
      },
      extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
      formatter: (p: unknown) => {
        const item = p as { data: [number, number, number] };
        const [di, oi, count] = item.data;
        const d = topDests[di];
        const o = topOrigins[oi];
        return (
          `<div style="font-family: Georgia, serif; font-size: 13px; font-weight: bold; color: #1E293B; margin-bottom: 2px;">Travel Flow</div>` +
          `<div style="font-size: 12px; color: #64748B;">From: <span style="font-weight: 600; color: #0039A6;">${o}</span></div>` +
          `<div style="font-size: 12px; color: #64748B;">To: <span style="font-weight: 600; color: #1E293B;">${d}</span></div>` +
          `<div style="margin-top: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: bold; color: #0F172A;">${count.toLocaleString()} passengers</div>`
        );
      },
    },
    grid: {
      left: 140,
      right: 60,
      top: options.chartTitle ? 70 : 40,
      bottom: options.sourceNote ? 100 : 80,
    },
    xAxis: {
      type: 'category',
      data: topDests,
      name: 'Destination Station',
      nameLocation: 'middle',
      nameGap: 45,
      nameTextStyle: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1E293B',
      },
      axisLabel: {
        rotate: 40,
        interval: 0,
        fontSize: 10,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: '#475569',
      },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: topOrigins,
      name: 'Origin Station',
      nameTextStyle: {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1E293B',
      },
      axisLabel: {
        interval: 0,
        fontSize: 10,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: '#475569',
      },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: options.sourceNote ? 25 : 10,
      inRange: {
        color: ['#F8FAFC', '#E0F2FE', '#38BDF8', '#0284C7', '#0039A6'],
      },
      textStyle: {
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        color: '#64748B',
      },
    },
    series: [
      {
        name: 'OD Flow',
        type: 'heatmap',
        data: heatmapData,
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.25)',
          },
        },
      },
    ],
    ...(options.sourceNote
      ? {
          graphic: [
            {
              type: 'text',
              right: 15,
              bottom: 8,
              style: {
                text: options.sourceNote,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                fontSize: 10,
                fill: '#94A3B8',
              },
            },
          ],
        }
      : {}),
  };
}
