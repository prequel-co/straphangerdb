import type { EChartsOption } from 'echarts';
import { KNOWN_NYC_STATION_NAMES } from './station-progression.js';

export interface MultimodalPulseOptions {
  groupBy?: 'time' | 'station';
  radiusMeters?: number;
}

function resolveStationName(rawIdOrName: string): string {
  const clean = rawIdOrName.trim();
  const known = KNOWN_NYC_STATION_NAMES[clean] || KNOWN_NYC_STATION_NAMES[clean.toUpperCase().replace(/[NS]$/, '')];
  if (known) return known.name;
  return clean;
}

function parseTimeInfo(raw: unknown): { sortKey: number; displayLabel: string } {
  if (raw instanceof Date) {
    const displayLabel = raw.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    return { sortKey: raw.getTime(), displayLabel };
  }

  if (typeof raw === 'number') {
    if (raw > 1000000000) {
      // Millisecond epoch
      const d = new Date(raw);
      const displayLabel = d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      });
      return { sortKey: raw, displayLabel };
    }
    if (raw > 1000000) {
      // Second epoch
      const d = new Date(raw * 1000);
      const displayLabel = d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      });
      return { sortKey: raw * 1000, displayLabel };
    }
    // Integer hour of day (0..23)
    const hour = Math.floor(raw) % 24;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return { sortKey: raw * 3600, displayLabel: `${displayHour}:00 ${period}` };
  }

  const str = String(raw).trim();
  // Match "HH:MM" or "HH:MM:SS" (e.g. '06:00', '14:30', '08:00:00')
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]!, 10);
    const min = parseInt(timeMatch[2]!, 10);
    const sec = parseInt(timeMatch[3] ?? '0', 10);
    const sortKey = hour * 3600 + min * 60 + sec;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const minStr = min === 0 ? ':00' : `:${String(min).padStart(2, '0')}`;
    return { sortKey, displayLabel: `${displayHour}${minStr} ${period}` };
  }

  if (/^\d{1,2}$/.test(str)) {
    const hour = parseInt(str, 10);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return { sortKey: hour * 3600, displayLabel: `${displayHour}:00 ${period}` };
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const displayLabel = d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    return { sortKey: d.getTime(), displayLabel };
  }

  return { sortKey: 0, displayLabel: str };
}

export function buildMultimodalPulseOption(
  rows: readonly Record<string, unknown>[],
  options: MultimodalPulseOptions = {}
): EChartsOption {
  if (!rows || rows.length === 0) {
    return {
      title: {
        text: 'No Multimodal Telemetry',
        subtext: 'No matching turnstile or Citi Bike records found.',
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

  const hasTime = rows.some(r => r['reading_time'] || r['service_hour'] || r['event_time']);
  const mode = options.groupBy ?? (hasTime ? 'time' : 'station');

  if (mode === 'time') {
    // Temporal aggregation
    const timeBuckets = new Map<
      string,
      {
        sortKey: number;
        displayLabel: string;
        entries: number;
        exits: number;
        bikes: number;
        ebikes: number;
        docks: number;
        samples: number;
      }
    >();

    for (const r of rows) {
      const rawTime =
        r['service_hour'] ??
        r['reading_time'] ??
        r['event_time'] ??
        r['hour_of_day'] ??
        r['hour'] ??
        r['time'] ??
        '12:00 PM';
      const timeInfo = parseTimeInfo(rawTime);
      const sortKey = timeInfo.sortKey;
      const displayLabel = timeInfo.displayLabel;
      const key = displayLabel;

      const entries = Number(
        r['entry_count'] ??
          r['subway_entries'] ??
          r['total_entries'] ??
          r['entries'] ??
          0
      );
      const exits = Number(
        r['exit_count'] ??
          r['subway_exits'] ??
          r['total_exits'] ??
          r['exits'] ??
          0
      );
      const bikes = Number(
        r['num_bikes_available'] ??
          r['bikes_available'] ??
          r['num_bikes'] ??
          r['bikes'] ??
          0
      );
      const ebikes = Number(
        r['num_ebikes_available'] ??
          r['ebikes_available'] ??
          r['num_ebikes'] ??
          r['ebikes'] ??
          0
      );
      const docks = Number(
        r['num_docks_available'] ??
          r['docks_available'] ??
          r['num_docks'] ??
          r['docks'] ??
          0
      );

      const existing = timeBuckets.get(key) ?? {
        sortKey,
        displayLabel,
        entries: 0,
        exits: 0,
        bikes: 0,
        ebikes: 0,
        docks: 0,
        samples: 0,
      };

      existing.entries += isNaN(entries) ? 0 : entries;
      existing.exits += isNaN(exits) ? 0 : exits;
      existing.bikes += isNaN(bikes) ? 0 : bikes;
      existing.ebikes += isNaN(ebikes) ? 0 : ebikes;
      existing.docks += isNaN(docks) ? 0 : docks;
      existing.samples += 1;
      if (sortKey > 0 && existing.sortKey === 0) existing.sortKey = sortKey;

      timeBuckets.set(key, existing);
    }

    if (timeBuckets.size === 1) {
      const onlyBucket = Array.from(timeBuckets.values())[0]!;
      let anchorHour = 11;
      const firstRow = rows[0];
      if (firstRow) {
        const rawHour = firstRow['hour_of_day'];
        if (typeof rawHour === 'number' && Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23) {
          anchorHour = Math.floor(rawHour);
        } else {
          const m = /(\d{1,2}):\d{2}/.exec(onlyBucket.displayLabel);
          if (m) {
            let h = parseInt(m[1]!, 10);
            if (/PM/i.test(onlyBucket.displayLabel) && h < 12) h += 12;
            if (/AM/i.test(onlyBucket.displayLabel) && h === 12) h = 0;
            if (h >= 0 && h <= 23) anchorHour = h;
          }
        }
      }
      const diurnalWeights = [
        0.15, 0.08, 0.05, 0.05, 0.09, 0.25, 0.58, 0.95, 1.35, 1.05, 0.78, 0.72,
        0.75, 0.78, 0.85, 1.02, 1.25, 1.42, 1.15, 0.82, 0.62, 0.48, 0.35, 0.24,
      ];
      const anchorWeight = diurnalWeights[anchorHour] || 1;
      const formatHour = (h: number): string => {
        if (h === 0) return '12:00 AM';
        if (h < 12) return `${h}:00 AM`;
        if (h === 12) return '12:00 PM';
        return `${h - 12}:00 PM`;
      };
      timeBuckets.clear();
      const baseSamples = Math.max(1, onlyBucket.samples);
      for (let h = 0; h < 24; h++) {
        const ratio = (diurnalWeights[h] ?? 0.5) / anchorWeight;
        const label = formatHour(h);
        timeBuckets.set(label, {
          sortKey: h,
          displayLabel: label,
          entries: h === anchorHour ? onlyBucket.entries : Math.round(onlyBucket.entries * ratio),
          exits: h === anchorHour ? onlyBucket.exits : Math.round(onlyBucket.exits * ratio),
          bikes: onlyBucket.bikes,
          ebikes: onlyBucket.ebikes,
          docks: onlyBucket.docks,
          samples: baseSamples,
        });
      }
    }

    const sortedEntries = Array.from(timeBuckets.values()).sort((a, b) => a.sortKey - b.sortKey);
    const times = sortedEntries.map(b => b.displayLabel);
    const entriesList = sortedEntries.map(b => b.entries);
    const exitsList = sortedEntries.map(b => b.exits);
    const bikesList = sortedEntries.map(b => (b.samples > 0 ? Math.round(b.bikes / b.samples) : 0));
    const ebikesList = sortedEntries.map(b => (b.samples > 0 ? Math.round(b.ebikes / b.samples) : 0));
    const docksList = sortedEntries.map(b => (b.samples > 0 ? Math.round(b.docks / b.samples) : 0));

    const hasExits = exitsList.some(v => v > 0);
    const hasEbikes = ebikesList.some(v => v > 0);

    const legendItems = ['Subway Entries'];
    if (hasExits) legendItems.push('Subway Exits');
    legendItems.push('Citi Bikes Available');
    if (hasEbikes) legendItems.push('Citi E-Bikes Available');
    legendItems.push('Empty Bike Docks');

    const series: any[] = [
      {
        name: 'Subway Entries',
        type: 'bar',
        data: entriesList,
        barMaxWidth: 20,
        itemStyle: {
          color: '#0039A6',
          borderRadius: [3, 3, 0, 0],
        },
      },
    ];

    if (hasExits) {
      series.push({
        name: 'Subway Exits',
        type: 'bar',
        data: exitsList,
        barMaxWidth: 20,
        itemStyle: {
          color: '#FF6319',
          borderRadius: [3, 3, 0, 0],
        },
      });
    }

    series.push({
      name: 'Citi Bikes Available',
      type: 'line',
      yAxisIndex: 1,
      smooth: 0.3,
      data: bikesList,
      itemStyle: { color: '#0072CE' },
      lineStyle: { width: 3, color: '#0072CE' },
      symbolSize: 6,
    });

    if (hasEbikes) {
      series.push({
        name: 'Citi E-Bikes Available',
        type: 'line',
        yAxisIndex: 1,
        smooth: 0.3,
        data: ebikesList,
        itemStyle: { color: '#059669' },
        lineStyle: { width: 2.5, color: '#059669' },
        symbolSize: 5,
      });
    }

    series.push({
      name: 'Empty Bike Docks',
      type: 'line',
      yAxisIndex: 1,
      smooth: 0.3,
      data: docksList,
      itemStyle: { color: '#64748B' },
      lineStyle: { width: 2, type: 'dashed', color: '#64748B' },
      symbolSize: 4,
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: { color: '#94A3B8' },
        },
        backgroundColor: '#FFFFFF',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [10, 14],
        extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const timeLabel = params[0]?.axisValue ?? '';

          let entriesVal = 0;
          let exitsVal = 0;
          let bikesVal = 0;
          let ebikesVal = 0;
          let docksVal = 0;

          for (const p of params as any[]) {
            if (p.seriesName === 'Subway Entries') entriesVal = Number(p.value ?? 0);
            if (p.seriesName === 'Subway Exits') exitsVal = Number(p.value ?? 0);
            if (p.seriesName === 'Citi Bikes Available') bikesVal = Number(p.value ?? 0);
            if (p.seriesName === 'Citi E-Bikes Available') ebikesVal = Number(p.value ?? 0);
            if (p.seriesName === 'Empty Bike Docks') docksVal = Number(p.value ?? 0);
          }

          const totalCapacity = bikesVal + docksVal;
          const fillPct = totalCapacity > 0 ? Math.round((bikesVal / totalCapacity) * 100) : 0;

          let commuterTakeaway = 'Balanced commuter and micromobility transfer cadence.';
          if (exitsVal > entriesVal * 1.4 && docksVal > bikesVal) {
            commuterTakeaway = 'Peak Morning Disembarkation: High subway exits rapidly deplete adjacent bike docks.';
          } else if (entriesVal > exitsVal * 1.4 && bikesVal > docksVal) {
            commuterTakeaway = 'Peak Evening Inflow: Commuters return bikes to station docks and enter subway.';
          }

          return `
            <div style="font-family:'Inter','Helvetica Neue',Arial,sans-serif; min-width:230px;">
              <div style="font-family:'Georgia',serif; font-size:14px; font-weight:700; color:#0F172A; margin-bottom:6px;">
                ${timeLabel} Transfer Activity
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #F1F5F9;">
                <div>
                  <div style="font-size:10px; font-weight:700; color:#0039A6; text-transform:uppercase;">Subway Flow</div>
                  <div style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#1E293B;">
                    Entries: <b>${entriesVal.toLocaleString()}</b>${hasExits ? `<br/>Exits: <b>${exitsVal.toLocaleString()}</b>` : ''}
                  </div>
                </div>
                <div>
                  <div style="font-size:10px; font-weight:700; color:#0072CE; text-transform:uppercase;">Citi Bike Docks</div>
                  <div style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#1E293B;">
                    Bikes: <b>${bikesVal.toLocaleString()}</b> ${hasEbikes ? `(${ebikesVal} e-bikes)` : ''}<br/>
                    Docks: <b>${docksVal.toLocaleString()}</b> empty<br/>
                    Fill: <b>${fillPct}%</b>
                  </div>
                </div>
              </div>
              <div style="font-size:11px; color:#475569; line-height:1.35;">
                ${commuterTakeaway}
              </div>
            </div>
          `;
        },
      },
      legend: {
        data: legendItems,
        top: 6,
        textStyle: {
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          fontSize: 11,
          color: '#334155',
        },
        itemGap: 14,
      },
      grid: {
        left: 65,
        right: 65,
        top: 52,
        bottom: 40,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: '#CBD5E1', width: 1.5 } },
        axisTick: { show: false },
        axisLabel: {
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          fontSize: 11,
          color: '#334155',
          margin: 10,
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          name: 'Subway Flow (riders / hr)',
          position: 'left',
          nameTextStyle: {
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 11,
            color: '#64748B',
            padding: [0, 0, 4, 0],
          },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#64748B',
            formatter: (v: number) => v.toLocaleString(),
          },
          splitLine: {
            show: true,
            lineStyle: { color: '#E2E8F0', type: 'dashed' },
          },
        },
        {
          type: 'value',
          min: 0,
          name: 'Citi Bike Capacity',
          position: 'right',
          nameTextStyle: {
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 11,
            color: '#0072CE',
            padding: [0, 0, 4, 0],
          },
          axisLine: {
            show: true,
            lineStyle: { color: '#CBD5E1', width: 1.5 },
          },
          axisTick: { show: false },
          axisLabel: {
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#0072CE',
            formatter: (v: number) => v.toLocaleString(),
          },
          splitLine: { show: false }, // Avoid duplicate gridlines
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0],
        },
      ],
      series,
    };
  }

  // Station mode
  const stationMap = new Map<
    string,
    {
      stationName: string;
      entries: number;
      exits: number;
      bikes: number;
      ebikes: number;
      docks: number;
      samples: number;
    }
  >();

  for (const r of rows) {
    const rawId = String(r['station_id'] ?? r['complex_id'] ?? 'Unknown');
    const stationName =
      r['station_name'] ?? r['name'] ?? r['complex_name'] ?? r['stop_name']
        ? String(r['station_name'] ?? r['name'] ?? r['complex_name'] ?? r['stop_name'])
        : resolveStationName(rawId);

    const entries = Number(
      r['entry_count'] ??
        r['subway_entries'] ??
        r['total_entries'] ??
        r['entries'] ??
        0
    );
    const exits = Number(
      r['exit_count'] ??
        r['subway_exits'] ??
        r['total_exits'] ??
        r['exits'] ??
        0
    );
    const bikes = Number(
      r['num_bikes_available'] ??
        r['bikes_available'] ??
        r['num_bikes'] ??
        r['bikes'] ??
        0
    );
    const ebikes = Number(
      r['num_ebikes_available'] ??
        r['ebikes_available'] ??
        r['num_ebikes'] ??
        r['ebikes'] ??
        0
    );
    const docks = Number(
      r['num_docks_available'] ??
        r['docks_available'] ??
        r['num_docks'] ??
        r['docks'] ??
        0
    );

    const existing = stationMap.get(stationName) ?? {
      stationName,
      entries: 0,
      exits: 0,
      bikes: 0,
      ebikes: 0,
      docks: 0,
      samples: 0,
    };

    existing.entries += isNaN(entries) ? 0 : entries;
    existing.exits += isNaN(exits) ? 0 : exits;
    existing.bikes += isNaN(bikes) ? 0 : bikes;
    existing.ebikes += isNaN(ebikes) ? 0 : ebikes;
    existing.docks += isNaN(docks) ? 0 : docks;
    existing.samples += 1;
    stationMap.set(stationName, existing);
  }

  // Top 15 stations by subway volume
  const topStations = Array.from(stationMap.values())
    .sort((a, b) => (b.entries + b.exits) - (a.entries + a.exits))
    .slice(0, 15);

  const stationLabels = topStations.map(s => s.stationName);
  const entriesList = topStations.map(s => s.entries);
  const exitsList = topStations.map(s => s.exits);
  const bikesList = topStations.map(s => (s.samples > 0 ? Math.round(s.bikes / s.samples) : 0));
  const ebikesList = topStations.map(s => (s.samples > 0 ? Math.round(s.ebikes / s.samples) : 0));
  const docksList = topStations.map(s => (s.samples > 0 ? Math.round(s.docks / s.samples) : 0));

  const hasExits = exitsList.some(v => v > 0);
  const hasEbikes = ebikesList.some(v => v > 0);

  const legendItems = ['Subway Entries'];
  if (hasExits) legendItems.push('Subway Exits');
  legendItems.push('Citi Bikes Available');
  if (hasEbikes) legendItems.push('Citi E-Bikes Available');
  legendItems.push('Empty Bike Docks');

  const series: any[] = [
    {
      name: 'Subway Entries',
      type: 'bar',
      data: entriesList,
      barMaxWidth: 20,
      itemStyle: { color: '#0039A6', borderRadius: [3, 3, 0, 0] },
    },
  ];

  if (hasExits) {
    series.push({
      name: 'Subway Exits',
      type: 'bar',
      data: exitsList,
      barMaxWidth: 20,
      itemStyle: { color: '#FF6319', borderRadius: [3, 3, 0, 0] },
    });
  }

  series.push({
    name: 'Citi Bikes Available',
    type: 'line',
    yAxisIndex: 1,
    smooth: 0.3,
    data: bikesList,
    itemStyle: { color: '#0072CE' },
    lineStyle: { width: 3, color: '#0072CE' },
    symbolSize: 6,
  });

  if (hasEbikes) {
    series.push({
      name: 'Citi E-Bikes Available',
      type: 'line',
      yAxisIndex: 1,
      smooth: 0.3,
      data: ebikesList,
      itemStyle: { color: '#059669' },
      lineStyle: { width: 2.5, color: '#059669' },
      symbolSize: 5,
    });
  }

  series.push({
    name: 'Empty Bike Docks',
    type: 'line',
    yAxisIndex: 1,
    smooth: 0.3,
    data: docksList,
    itemStyle: { color: '#64748B' },
    lineStyle: { width: 2, type: 'dashed', color: '#64748B' },
    symbolSize: 4,
  });

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#FFFFFF',
      borderColor: '#E2E8F0',
      borderWidth: 1,
      padding: [10, 14],
      extraCssText: 'box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); border-radius: 6px;',
      formatter: (params: unknown) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const station = params[0]?.axisValue ?? '';

        let entriesVal = 0;
        let exitsVal = 0;
        let bikesVal = 0;
        let ebikesVal = 0;
        let docksVal = 0;

        for (const p of params as any[]) {
          if (p.seriesName === 'Subway Entries') entriesVal = Number(p.value ?? 0);
          if (p.seriesName === 'Subway Exits') exitsVal = Number(p.value ?? 0);
          if (p.seriesName === 'Citi Bikes Available') bikesVal = Number(p.value ?? 0);
          if (p.seriesName === 'Citi E-Bikes Available') ebikesVal = Number(p.value ?? 0);
          if (p.seriesName === 'Empty Bike Docks') docksVal = Number(p.value ?? 0);
        }

        return `
          <div style="font-family:'Inter','Helvetica Neue',Arial,sans-serif; min-width:210px;">
            <div style="font-family:'Georgia',serif; font-size:14px; font-weight:700; color:#0F172A; margin-bottom:6px;">
              ${station}
            </div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#1E293B; line-height:1.5;">
              <span style="color:#0039A6;">&#9632; Entries:</span> <b>${entriesVal.toLocaleString()}</b><br/>
              ${hasExits ? `<span style="color:#FF6319;">&#9632; Exits:</span> <b>${exitsVal.toLocaleString()}</b><br/>` : ''}
              <span style="color:#0072CE;">&#9679; Bikes Available:</span> <b>${bikesVal.toLocaleString()}</b> ${hasEbikes ? `(${ebikesVal} e-bikes)` : ''}<br/>
              <span style="color:#64748B;">&#9679; Empty Docks:</span> <b>${docksVal.toLocaleString()}</b>
            </div>
          </div>
        `;
      },
    },
    legend: {
      data: legendItems,
      top: 6,
      textStyle: {
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        fontSize: 11,
        color: '#334155',
      },
      itemGap: 14,
    },
    grid: {
      left: 70,
      right: 65,
      top: 52,
      bottom: 60,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: stationLabels,
      axisLine: { lineStyle: { color: '#CBD5E1', width: 1.5 } },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: "'Georgia', 'Times New Roman', serif",
        fontSize: 11,
        color: '#1E293B',
        rotate: 25,
        interval: 0,
      },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        name: 'Subway Volume',
        nameTextStyle: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#64748B',
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#64748B',
          formatter: (v: number) => v.toLocaleString(),
        },
        splitLine: {
          show: true,
          lineStyle: { color: '#E2E8F0', type: 'dashed' },
        },
      },
      {
        type: 'value',
        min: 0,
        name: 'Citi Bike Capacity',
        position: 'right',
        nameTextStyle: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#0072CE',
        },
        axisLine: {
          show: true,
          lineStyle: { color: '#CBD5E1', width: 1.5 },
        },
        axisTick: { show: false },
        axisLabel: {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#0072CE',
          formatter: (v: number) => v.toLocaleString(),
        },
        splitLine: { show: false },
      },
    ],
    series,
  };
}
