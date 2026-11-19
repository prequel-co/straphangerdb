import type { EChartsOption } from 'echarts';

export interface AdherenceWaterfallOptions {
  routeFilter?: string;
  splitGhostTrips?: boolean;
}

export function buildAdherenceWaterfallOption(
  rows: readonly Record<string, unknown>[],
  options: AdherenceWaterfallOptions = {}
): EChartsOption {
  // Aggregate across rows (or filtered route)
  let scheduled = 0;
  let observed = 0;
  let ghost = 0;
  let unscheduled = 0;
  let detectedRouteId: string | undefined = options.routeFilter;
  let detectedRouteName: string | undefined;

  for (const r of rows) {
    const rawRoute = r['route_id'] ?? r['route'] ?? r['line'];
    const routeId = rawRoute != null ? String(rawRoute).trim() : undefined;
    if (options.routeFilter && routeId !== options.routeFilter) {
      continue;
    }
    if (!detectedRouteId && routeId) {
      detectedRouteId = routeId;
    }
    if (!detectedRouteName && r['route_name']) {
      detectedRouteName = String(r['route_name']).trim();
    }

    const sched = Math.max(0, Number(r['scheduled_trips_count'] ?? r['scheduled_trips'] ?? r['scheduled'] ?? 0));
    const obs = Math.max(0, Number(r['observed_trips_count'] ?? r['observed_trips'] ?? r['observed'] ?? 0));
    scheduled += isNaN(sched) ? 0 : sched;
    observed += isNaN(obs) ? 0 : obs;

    const g = Math.max(0, Number(r['ghost_trips_count'] ?? r['ghost_trips'] ?? r['ghost'] ?? 0));
    const u = Math.max(0, Number(r['unscheduled_trips_count'] ?? r['unscheduled_trips'] ?? r['unscheduled'] ?? 0));
    ghost += isNaN(g) ? 0 : g;
    unscheduled += isNaN(u) ? 0 : u;
  }

  // If ghost/unscheduled not explicitly provided, estimate from scheduled vs observed
  if (ghost === 0 && unscheduled === 0 && (scheduled > 0 || observed > 0)) {
    if (observed < scheduled) {
      ghost = scheduled - observed;
    } else {
      unscheduled = observed - scheduled;
    }
  }

  // Fallback for empty data
  if (scheduled === 0 && observed === 0) {
    return {
      title: {
        text: 'No Schedule Adherence Telemetry',
        subtext: 'No scheduled or observed trips recorded for the selected filter.',
        left: 'center',
        top: 'center',
        textStyle: {
          fontFamily: "'Georgia', 'Times New Roman', serif",
          fontSize: 15,
          fontWeight: 600,
          color: '#64748B',
        },
        subtextStyle: {
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          fontSize: 12,
          color: '#94A3B8',
        },
      },
    };
  }

  const completionPct =
    scheduled > 0
      ? Math.round((observed / scheduled) * 1000) / 10
      : observed > 0
        ? 100
        : 0;
  const afterGhost = Math.max(0, scheduled - ghost);

  // Status rating headline
  let adherenceRating = 'Good Adherence';
  let ratingColor = '#00933C';
  if (scheduled === 0 && observed > 0) {
    adherenceRating = 'Unscheduled Service';
    ratingColor = '#0039A6';
  } else if (completionPct < 88) {
    adherenceRating = 'Degraded Service';
    ratingColor = '#DC2626';
  } else if (completionPct < 95) {
    adherenceRating = 'Moderate Adherence';
    ratingColor = '#D97706';
  }

  // Resolve observed bar color (MTA Orange #FF6319 editorial highlight)
  const finalColor = '#FF6319';

  const categories = ['Scheduled Service', 'Ghost / Missing', 'Unscheduled Added', 'Observed Operated'];

  // Base invisible stack
  const baseData = [0, afterGhost, afterGhost, 0];

  // Visible delta / total stack
  const valData = [
    {
      value: scheduled,
      itemStyle: { color: '#0039A6', borderRadius: [3, 3, 0, 0] }, // MTA Blue
    },
    {
      value: ghost,
      itemStyle: { color: '#D82222', borderRadius: [3, 3, 0, 0] }, // Red drop
    },
    {
      value: unscheduled,
      itemStyle: { color: '#00933C', borderRadius: [3, 3, 0, 0] }, // Green rise
    },
    {
      value: observed,
      itemStyle: { color: finalColor, borderRadius: [3, 3, 0, 0] }, // Observed net
    },
  ];

  return {
    title: {
      text: `{pct|Service Completion: ${completionPct}%} {status|${adherenceRating}}`,
      subtext: `${detectedRouteName || (detectedRouteId ? `${detectedRouteId} Line` : 'Subway Service')}: ${observed.toLocaleString()} observed of ${scheduled.toLocaleString()} scheduled trips (${ghost > 0 ? `-${ghost.toLocaleString()} ghost` : '0 ghost'}${unscheduled > 0 ? ` · +${unscheduled.toLocaleString()} unscheduled` : ''})`,
      left: 'center',
      top: 8,
      textStyle: {
        rich: {
          pct: {
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: 16,
            fontWeight: 700,
            color: '#0F172A',
          },
          status: {
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: ratingColor,
            backgroundColor: `${ratingColor}15`,
            borderColor: `${ratingColor}40`,
            borderWidth: 1,
            borderRadius: 4,
            padding: [2, 6],
          },
        },
      },
      subtextStyle: {
        fontFamily: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontSize: 12,
        color: '#475569',
      },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
        shadowStyle: { color: 'rgba(241, 245, 249, 0.65)' },
      },
      backgroundColor: '#FFFFFF',
      borderColor: '#E2E8F0',
      borderWidth: 1,
      padding: [10, 14],
      extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return '';
        const item = params.find((p: any) => p.seriesName === 'Trips Change') as any;
        if (!item) return '';

        const name = item.name as string;
        const val = Number(item.value ?? 0);
        let desc = '';
        let pctBadge = '';

        if (name === 'Scheduled Service') {
          desc = 'Total timetable planned trips published in official MTA schedule.';
          pctBadge = '100% Timetable';
        } else if (name === 'Ghost / Missing') {
          const pct = scheduled > 0 ? ((val / scheduled) * 100).toFixed(1) : '0.0';
          desc = 'Scheduled trains never detected in feed (cancelled, crew shortage, or untracked).';
          pctBadge = `-${pct}% Deficit`;
        } else if (name === 'Unscheduled Added') {
          const pct = scheduled > 0 ? ((val / scheduled) * 100).toFixed(1) : (val > 0 ? '100.0' : '0.0');
          desc = 'Supplemental or gap-filler trains injected into service without timetable entry.';
          pctBadge = scheduled > 0 ? `+${pct}% Added` : '+100% Unscheduled';
        } else if (name === 'Observed Operated') {
          const pct = scheduled > 0 ? ((val / scheduled) * 100).toFixed(1) : (val > 0 ? '100.0' : '0.0');
          desc = 'Net actual trains operated to passenger terminals across the corridor.';
          pctBadge = `${pct}% Net Completion`;
        }

        return `
          <div style="font-family:'Inter','Helvetica Neue',Arial,sans-serif; min-width:210px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <span style="font-weight:700; font-size:13px; color:#0F172A;">${name}</span>
              <span style="font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:600; color:#64748B;">${pctBadge}</span>
            </div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:16px; font-weight:700; color:#0F172A; margin-bottom:6px;">
              ${val.toLocaleString()} <span style="font-size:12px; font-weight:400; color:#64748B;">trips</span>
            </div>
            <div style="font-size:11px; color:#475569; line-height:1.4; border-top:1px solid #F1F5F9; padding-top:6px;">
              ${desc}
            </div>
          </div>
        `;
      },
    },
    grid: {
      left: 70,
      right: 40,
      top: 68,
      bottom: 40,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: '#CBD5E1', width: 1.5 } },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontWeight: 600,
        fontSize: 12,
        color: '#1E293B',
        margin: 12,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: 'Trips Count',
      nameTextStyle: {
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: '#64748B',
        padding: [0, 0, 4, 0],
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: '#64748B',
        formatter: (val: number) => val.toLocaleString(),
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#E2E8F0',
          type: 'dashed',
          width: 1,
        },
      },
    },
    series: [
      {
        name: 'Placeholder Base',
        type: 'bar',
        stack: 'waterfall',
        silent: true,
        itemStyle: {
          borderColor: 'transparent',
          color: 'transparent',
        },
        emphasis: {
          itemStyle: {
            borderColor: 'transparent',
            color: 'transparent',
          },
        },
        data: baseData,
      },
      {
        name: 'Trips Change',
        type: 'bar',
        stack: 'waterfall',
        barMaxWidth: 56,
        label: {
          show: true,
          position: 'top',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontWeight: 700,
          fontSize: 11,
          color: '#1E293B',
          formatter: (p: any) => {
            const val = Number(p.value ?? 0);
            if (val === 0) return '';
            if (p.name === 'Ghost / Missing') {
              return `-${val.toLocaleString()}`;
            }
            if (p.name === 'Unscheduled Added') {
              return `+${val.toLocaleString()}`;
            }
            return val.toLocaleString();
          },
        },
        data: valData,
      },
    ],
  };
}
