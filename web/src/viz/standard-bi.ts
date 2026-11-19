import type { EChartsOption } from 'echarts';
import type { BaseChartConfig, ChartType } from '../types/cell-state.js';
import {
  CHART_COLOR_PALETTES,
  applyChartColorOverrides,
  buildRouteBulletHtml,
  inferRouteBulletColorFromLabel,
  resolveCustomColorForKey,
} from './echarts-theme-mta.js';

export function buildStandardBiOption(
  chartType: ChartType,
  rows: readonly Record<string, unknown>[],
  config: BaseChartConfig = {}
): EChartsOption {
  const option = buildRawStandardBiOption(chartType, rows, config);
  return applyChartColorOverrides(option, config);
}

function buildRawStandardBiOption(
  chartType: ChartType,
  rows: readonly Record<string, unknown>[],
  config: BaseChartConfig = {}
): EChartsOption {
  if (rows.length === 0) {
    return {
      title: { text: 'No data returned', left: 'center', top: 'center' },
    };
  }

  const sample = rows[0] ?? {};
  const keys = Object.keys(sample);

  // Auto-detect X and Y columns if not specified
  let xCol = config.xColumn;
  if (!xCol || !keys.includes(xCol)) {
    // Pick first string or date column
    xCol = keys.find(k => {
      const v = sample[k];
      return typeof v === 'string' || v instanceof Date;
    }) ?? keys[0] ?? '';
  }

  let yCols = config.yColumns ? Array.from(config.yColumns) : [];
  if (yCols.length === 0) {
    // Pick numeric columns
    yCols = keys.filter(k => k !== xCol && typeof sample[k] === 'number');
    if (yCols.length === 0 && keys.length > 1) {
      yCols = [keys[1]!];
    }
  }

  const xData = rows.map(r => String(r[xCol] ?? ''));

  switch (chartType) {
    case 'bar':
    case 'stacked-bar': {
      const isStacked = chartType === 'stacked-bar';
      const isSingleSeriesBar = !isStacked && yCols.length === 1;
      const useLog =
        config['yAxisScale'] === 'log' ||
        config['useLogScale'] === true ||
        config['scaleType'] === 'log' ||
        config['logScale'] === true;

      const series = yCols.map(yCol => ({
        name: yCol,
        type: 'bar' as const,
        barMaxWidth: 36,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        ...(isStacked ? { stack: 'total' } : {}),
        data: rows.map((r, rIdx) => {
          const rawNum = Number(r[yCol] ?? 0);
          const numVal = useLog && rawNum <= 0 ? 1 : rawNum;
          if (isSingleSeriesBar) {
            const catLabel = xData[rIdx] ?? '';
            const inferred = inferRouteBulletColorFromLabel(catLabel);
            if (inferred) {
              return { value: numVal, itemStyle: { color: inferred.colorHex } };
            }
          }
          return numVal;
        }),
      }));

      return {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { top: 8 },
        grid: { left: 60, right: 30, top: 40, bottom: 40, containLabel: true },
        xAxis: { type: 'category', data: xData },
        yAxis: {
          type: useLog ? 'log' : 'value',
          ...(useLog ? { min: 1 } : {}),
        },
        series,
      };
    }

    case 'line':
    case 'area':
    case 'stacked-area': {
      const isArea = chartType === 'area' || chartType === 'stacked-area';
      const isStacked = chartType === 'stacked-area';
      const useLog =
        config['yAxisScale'] === 'log' ||
        config['useLogScale'] === true ||
        config['scaleType'] === 'log' ||
        config['logScale'] === true;

      const series = yCols.map(yCol => ({
        name: yCol,
        type: 'line' as const,
        lineStyle: { width: 2.5 },
        symbol: 'circle',
        symbolSize: 6,
        ...(isStacked ? { stack: 'total' } : {}),
        ...(isArea ? { areaStyle: { opacity: 0.16 } } : {}),
        smooth: true,
        data: rows.map(r => {
          const val = Number(r[yCol] ?? 0);
          return useLog && val <= 0 ? 1 : val;
        }),
      }));

      return {
        tooltip: { trigger: 'axis' },
        legend: { top: 8 },
        grid: { left: 60, right: 30, top: 40, bottom: 40, containLabel: true },
        xAxis: { type: 'category', data: xData },
        yAxis: {
          type: useLog ? 'log' : 'value',
          ...(useLog ? { min: 1 } : {}),
        },
        series,
      };
    }

    case 'scatter': {
      const yCol = yCols[0] ?? keys[1] ?? '';
      const groupCol =
        typeof config.colorColumn === 'string' && config.colorColumn
          ? config.colorColumn
          : typeof config['groupColumn'] === 'string' && config['groupColumn']
          ? config['groupColumn']
          : undefined;

      if (groupCol) {
        const grouped = new Map<string, number[][]>();
        for (const r of rows) {
          const gKey = String(r[groupCol] ?? 'Other');
          const xVal = Number(r[xCol] ?? 0);
          const yVal = Number(r[yCol] ?? 0);
          if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) continue;
          const bucket = grouped.get(gKey);
          if (bucket) {
            bucket.push([xVal, yVal]);
          } else {
            grouped.set(gKey, [[xVal, yVal]]);
          }
        }
        const series = Array.from(grouped.entries()).map(([name, pts]) => {
          const inferred = inferRouteBulletColorFromLabel(name);
          return {
            name,
            type: 'scatter' as const,
            data: pts,
            ...(inferred ? { itemStyle: { color: inferred.colorHex } } : {}),
          };
        });
        return {
          tooltip: { trigger: 'item' },
          legend: { top: 8 },
          grid: { left: 60, right: 30, top: 44, bottom: 40, containLabel: true },
          xAxis: { type: 'value', name: xCol },
          yAxis: { type: 'value', name: yCol },
          series,
        };
      }

      const data = rows.map(r => [Number(r[xCol] ?? 0), Number(r[yCol] ?? 0)]);

      return {
        tooltip: { trigger: 'item' },
        grid: { left: 60, right: 30, top: 40, bottom: 40, containLabel: true },
        xAxis: { type: 'value', name: xCol },
        yAxis: { type: 'value', name: yCol },
        series: [{ type: 'scatter', data }],
      };
    }

    case 'pie':
    case 'donut': {
      const yCol = yCols[0] ?? keys[1] ?? '';
      const pieData = rows.map(r => {
        const sliceName = String(r[xCol] ?? '');
        const inferred = inferRouteBulletColorFromLabel(sliceName);
        return {
          name: sliceName,
          value: Number(r[yCol] ?? 0),
          ...(inferred ? { itemStyle: { color: inferred.colorHex } } : {}),
        };
      });

      return {
        tooltip: {
          trigger: 'item',
          formatter: (params: any) => {
            const name = String(params?.name ?? '');
            const val = Number(params?.value ?? 0).toLocaleString();
            const pct = params?.percent !== undefined ? ` (${params.percent}%)` : '';
            const inferred = inferRouteBulletColorFromLabel(name);
            const badge =
              inferred && !/other/i.test(name)
                ? `${buildRouteBulletHtml(inferred.routeId, 'MTA_NYCT_SUBWAY', params?.color ?? inferred.colorHex, 18)} `
                : '';
            return `<div style="display:flex;align-items:center;gap:6px;font-weight:600;">${badge}<span>${escapeHtml(name)}</span><span style="margin-left:6px;font-variant-numeric:tabular-nums;">${val}${pct}</span></div>`;
          },
        },
        legend: { top: 8 },
        series: [
          {
            type: 'pie',
            radius: chartType === 'donut' ? ['45%', '70%'] : '65%',
            itemStyle: {
              borderColor: '#FFFFFF',
              borderWidth: 2,
            },
            data: pieData,
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)',
              },
            },
          },
        ],
      };
    }

    case 'gauge': {
      const yCol = yCols[0] ?? keys[0] ?? '';
      const rawVal = Number(rows[0]?.[yCol] ?? 0);
      return {
        tooltip: { formatter: '{a} <br/>{b} : {c}%' },
        series: [
          {
            name: yCol,
            type: 'gauge',
            progress: { show: true },
            detail: { valueAnimation: true, formatter: '{value}' },
            data: [{ value: rawVal, name: yCol }],
          },
        ],
      };
    }

    case 'treemap': {
      const yCol = yCols[0] ?? keys[1] ?? '';
      const treeData = rows.map(r => {
        const itemName = String(r[xCol] ?? '');
        const inferred = inferRouteBulletColorFromLabel(itemName);
        return {
          name: itemName,
          value: Number(r[yCol] ?? 0),
          ...(inferred ? { itemStyle: { color: inferred.colorHex } } : {}),
        };
      });

      return {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'treemap',
            data: treeData,
          },
        ],
      };
    }

    case 'funnel': {
      const yCol = yCols[0] ?? keys[1] ?? '';
      const funnelData = rows.map(r => {
        const itemName = String(r[xCol] ?? '');
        const inferred = inferRouteBulletColorFromLabel(itemName);
        return {
          name: itemName,
          value: Number(r[yCol] ?? 0),
          ...(inferred ? { itemStyle: { color: inferred.colorHex } } : {}),
        };
      });

      return {
        tooltip: { trigger: 'item' },
        series: [
          {
            type: 'funnel',
            data: funnelData,
          },
        ],
      };
    }

    case 'radar': {
      let maxVal = 0;
      for (const col of yCols) {
        for (const r of rows) {
          const v = Number(r[col] ?? 0);
          if (Number.isFinite(v) && v > maxVal) {
            maxVal = v;
          }
        }
      }
      const indicators = yCols.map(col => ({ name: col, max: maxVal > 0 ? maxVal * 1.2 : 100 }));
      const seriesData = rows.slice(0, 5).map(r => ({
        name: String(r[xCol] ?? ''),
        value: yCols.map(c => {
          const v = Number(r[c] ?? 0);
          return Number.isFinite(v) ? v : 0;
        }),
      }));

      return {
        tooltip: { trigger: 'item' },
        radar: { indicator: indicators },
        series: [{ type: 'radar', data: seriesData }],
      };
    }

    case 'choropleth-borough': {
      // Borough comparison horizontal bar breakdown
      const yCol = yCols[0] ?? keys[1] ?? '';
      const boroughData = rows.map(r => ({
        name: String(r[xCol] ?? r['borough'] ?? ''),
        value: Number(r[yCol] ?? 0),
      }));

      return {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 100, right: 30, top: 20, bottom: 30, containLabel: true },
        xAxis: { type: 'value', name: yCol },
        yAxis: {
          type: 'category',
          data: boroughData.map(b => b.name),
        },
        series: [
          {
            type: 'bar',
            data: boroughData.map(b => b.value),
            itemStyle: { color: '#0039A6' },
          },
        ],
      };
    }

    case 'heatmap': {
      const explicitGroupCol =
        typeof config.colorColumn === 'string' && config.colorColumn
          ? config.colorColumn
          : typeof config['groupColumn'] === 'string' && config['groupColumn']
          ? config['groupColumn']
          : undefined;
      const yCategoryCol: string =
        explicitGroupCol ??
        keys.find(k => k !== xCol && typeof sample[k] === 'string') ??
        (yCols[0] ?? '');
      const valCol =
        yCols.find(c => c !== yCategoryCol) ??
        keys.find(k => k !== xCol && k !== yCategoryCol) ??
        yCols[0] ??
        '';
      const xCategories = Array.from(new Set(rows.map(r => String(r[xCol] ?? ''))));
      const yCategories = Array.from(new Set(rows.map(r => String(r[yCategoryCol] ?? ''))));
      let maxVal = 0;
      const heatData = rows.map(r => {
        const xIdx = Math.max(0, xCategories.indexOf(String(r[xCol] ?? '')));
        const yIdx = Math.max(0, yCategories.indexOf(String(r[yCategoryCol] ?? '')));
        const v = Number(r[valCol] ?? 0);
        if (v > maxVal) maxVal = v;
        return [xIdx, yIdx, v];
      });
      return {
        tooltip: { position: 'top' },
        grid: { containLabel: true, bottom: 48 },
        xAxis: { type: 'category', data: xCategories, splitArea: { show: true } },
        yAxis: { type: 'category', data: yCategories, splitArea: { show: true } },
        visualMap: {
          min: 0,
          max: maxVal > 0 ? maxVal : 100,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 4,
          inRange: { color: ['#F8FAFC', '#00ADD0', '#0039A6'] },
        },
        series: [
          {
            name: valCol || 'Series 1',
            type: 'heatmap',
            data: heatData,
          },
        ],
      };
    }

    default: {
      // Fallback simple bar
      return {
        tooltip: { trigger: 'axis' },
        grid: { containLabel: true },
        xAxis: { type: 'category', data: xData },
        yAxis: { type: 'value' },
        series: [{ type: 'bar', data: rows.map(r => Number(r[yCols[0] ?? ''] ?? 0)) }],
      };
    }
  }
}

export function renderTableHtml(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '<div class="table-empty">No rows returned.</div>';
  }

  const columns = Object.keys(rows[0] ?? {});
  const headerHtml = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');

  const bodyHtml = rows
    .slice(0, 1000) // Render up to 1000 rows in DOM
    .map(r => {
      const cells = columns
        .map(c => {
          const val = r[c];
          let formatted = '';
          if (val === null || val === undefined) {
            formatted = '<span class="cell-null">null</span>';
          } else if (typeof val === 'number') {
            const lowerCol = c.toLowerCase();
            if ((lowerCol.endsWith('_date') || lowerCol === 'date') && val > 946684800000 && val < 4102444800000) {
              formatted = new Date(val).toISOString().slice(0, 10);
            } else if ((lowerCol.endsWith('_time') || lowerCol.endsWith('_at') || lowerCol === 'timestamp') && val > 946684800000 && val < 4102444800000) {
              formatted = new Date(val).toISOString().replace('T', ' ').slice(0, 19);
            } else {
              formatted = val.toLocaleString();
            }
          } else {
            formatted = escapeHtml(String(val));
          }
          return `<td>${formatted}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="data-table-container">
      <table class="dbtc-data-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
      ${rows.length > 1000 ? `<div class="table-capped-notice">Showing first 1,000 of ${rows.length.toLocaleString()} rows</div>` : ''}
    </div>
  `;
}

export function renderKpiHtml(
  rows: readonly Record<string, unknown>[],
  config: BaseChartConfig = {}
): string {
  if (rows.length === 0) {
    return '<div class="kpi-empty">No data</div>';
  }

  const sample = rows[0] ?? {};
  const keys = Object.keys(sample);
  const metricCol = config.yColumns?.[0] ?? keys[0] ?? '';
  const labelCol = config.xColumn ?? keys[1];

  const val = sample[metricCol];
  const label = labelCol ? String(sample[labelCol] ?? metricCol) : metricCol;

  let displayVal = '0';
  if (typeof val === 'number') {
    displayVal = val.toLocaleString();
  } else if (val !== null && val !== undefined) {
    displayVal = String(val);
  }

  const customColors =
    config.customColors && typeof config.customColors === 'object'
      ? (config.customColors as Readonly<Record<string, string>>)
      : undefined;
  const paletteSpec =
    typeof config.colorPalette === 'string' ? CHART_COLOR_PALETTES[config.colorPalette] : undefined;
  const kpiColor =
    resolveCustomColorForKey(metricCol, customColors) ??
    resolveCustomColorForKey(label, customColors) ??
    resolveCustomColorForKey('Series 1', customColors) ??
    (paletteSpec ? paletteSpec.colors[0] : null);
  const styleAttr = kpiColor ? ` style="color: ${escapeHtml(kpiColor)};"` : '';

  return `
    <div class="kpi-metric-card">
      <div class="kpi-metric-value"${styleAttr}>${escapeHtml(displayVal)}</div>
      <div class="kpi-metric-label">${escapeHtml(label)}</div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
