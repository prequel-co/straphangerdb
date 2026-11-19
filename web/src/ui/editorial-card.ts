import type { ReactiveCellState } from '../types/cell-state.js';
import {
  CHART_DEFAULT_SCHEMAS,
  resolveChartColumnMapping,
  isChartSchemaCompatible,
} from '../types/schema-contracts.js';
import { store, watchReactive, CellRuntimeRegistry, persistCellToDuckDb } from '../state/store.js';
import { renderCellVisual } from '../viz/chart-router.js';
import {
  CHART_COLOR_PALETTES,
  buildRouteBulletHtml,
  getThemeColorSwatches,
  inferRouteBulletColorFromLabel,
  resolveCommuterOrBusRouteSpec,
  resolveCustomColorForKey,
  resolveRouteColor,
} from '../viz/echarts-theme-mta.js';
import { KNOWN_NYC_STATION_NAMES } from '../viz/transit/station-progression.js';
import { exportCardImage, exportDataToCsv, exportDataToJson } from '../viz/card-image-export.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';
import { getBilevel53rdLoadingSvg, getViaduct125LoadingSvg } from './logo.js';
import { renderMarkdownWithSafeHtml, sanitizeMarkdownHtml } from './markdown-renderer.js';
import { showToast } from './toast.js';

export { renderMarkdownWithSafeHtml, sanitizeMarkdownHtml };

function supportsScaleToggle(chartType: string): boolean {
  return ['headway-horizon', 'line', 'area', 'stacked-area', 'bar', 'stacked-bar'].includes(chartType);
}

export interface ChartColorTargetItem {
  readonly key: string;
  readonly label: string;
  readonly defaultColor: string;
  readonly currentColor: string;
  readonly routeId?: string;
  readonly agencyId?: string;
}

export function renderColorSwatchesHtml(paletteId?: string): string {
  const group = getThemeColorSwatches(paletteId);
  return group.swatches
    .map(sw => {
      const iconHtml =
        sw.kind === 'route-bullet' && sw.bulletRoute
          ? buildRouteBulletHtml(sw.bulletRoute, sw.agencyId ?? 'MTA_NYCT_SUBWAY', sw.colorHex, 16)
          : `<span class="color-preset-chip" style="width: 14px; height: 14px; border-radius: 3px; background: ${escapeHtml(sw.colorHex)}; border: 1px solid rgba(15,23,42,0.16); display: inline-block; flex-shrink: 0;"></span>`;
      return `
        <button type="button" class="mta-bullet-color-swatch" data-swatch-kind="${sw.kind}" data-color-hex="${escapeHtml(sw.colorHex)}" ${sw.bulletRoute ? `data-bullet-route="${escapeHtml(sw.bulletRoute)}"` : ''} ${sw.agencyId ? `data-agency-id="${escapeHtml(sw.agencyId)}"` : ''} title="${escapeHtml(sw.name)} - ${escapeHtml(sw.colorHex)}" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 5px; border: 1px solid #E2E8F0; border-radius: 5px; background: #F8FAFC; cursor: pointer; font-size: 9.5px; font-weight: 600; color: #1E293B;">
          ${iconHtml}
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(sw.label)}</span>
        </button>
      `;
    })
    .join('');
}

export function extractChartColorTargets(cell: ReactiveCellState): ChartColorTargetItem[] {
  const norm = CellRuntimeRegistry.get(cell.cellId)?.normalized;
  const rows = norm?.rows ?? [];
  const customColors =
    cell.chartConfig?.['customColors'] && typeof cell.chartConfig['customColors'] === 'object'
      ? (cell.chartConfig['customColors'] as Readonly<Record<string, string>>)
      : undefined;
  const paletteId = typeof cell.chartConfig?.['colorPalette'] === 'string' ? cell.chartConfig['colorPalette'] : 'mta-trunk';
  const palette = CHART_COLOR_PALETTES[paletteId]?.colors ?? CHART_COLOR_PALETTES['mta-trunk']!.colors;

  const makeItem = (
    key: string,
    label: string,
    fallbackColor: string,
    explicitRouteId?: string,
    explicitAgencyId?: string
  ): ChartColorTargetItem => {
    const inferred =
      inferRouteBulletColorFromLabel(key, explicitAgencyId) ??
      inferRouteBulletColorFromLabel(label, explicitAgencyId);
    const routeId = explicitRouteId ?? inferred?.routeId;
    const agencyId = explicitAgencyId ?? inferred?.agencyId;
    const defaultColor =
      (paletteId === 'mta-trunk' || paletteId === 'metro-north' ? inferred?.colorHex : undefined) ??
      fallbackColor;
    const currentColor =
      resolveCustomColorForKey(key, customColors) ??
      resolveCustomColorForKey(label, customColors) ??
      defaultColor;
    return {
      key,
      label,
      defaultColor,
      currentColor,
      ...(routeId ? { routeId } : {}),
      ...(agencyId ? { agencyId } : {}),
    };
  };

  if (
    cell.chartType === 'marey-chart' ||
    cell.chartType === 'station-progression' ||
    cell.chartType === 'headway-horizon' ||
    cell.chartType === 'route-segment-map' ||
    cell.chartType === 'train-position-map'
  ) {
    const seen = new Map<string, { routeId: string; agencyId?: string }>();
    for (const r of rows) {
      let rId = String(r['route_id'] ?? r['routeId'] ?? r['route_short_name'] ?? '').trim();
      if (!rId) continue;
      if (cell.chartType === 'marey-chart' && rId.toUpperCase() === '7X') {
        rId = '<7>';
      }
      const agId = r['agency_id'] ? String(r['agency_id']).trim() : undefined;
      const spec = resolveCommuterOrBusRouteSpec(rId, agId);
      const displayKey = spec ? spec.code : rId;
      if (!seen.has(displayKey)) {
        seen.set(displayKey, { routeId: displayKey, ...(agId ? { agencyId: agId } : {}) });
      }
      if (seen.size >= 14) break;
    }
    if (seen.size === 0) {
      const paramRoutes = String(cell.params?.['route_id'] ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      for (const pr of paramRoutes) {
        const key = cell.chartType === 'marey-chart' && pr === '7X' ? '<7>' : pr;
        seen.set(key, { routeId: key });
      }
    }
    if (seen.size === 0) {
      for (const fallback of ['1', '4', '7', 'A', 'F', 'Q', 'L']) {
        seen.set(fallback, { routeId: fallback, agencyId: 'MTA_NYCT_SUBWAY' });
      }
    }
    const routeItems = Array.from(seen.values()).map((entry, idx) => {
      const { routeId: rId, agencyId: agId } = entry;
      const spec = resolveCommuterOrBusRouteSpec(rId, agId);
      const def =
        (paletteId === 'mta-trunk' || paletteId === 'metro-north'
          ? resolveRouteColor(rId, agId ?? 'MTA_NYCT_SUBWAY')
          : undefined) || palette[idx % palette.length]!;
      const seriesKey = cell.chartType === 'headway-horizon' ? `Line ${rId}` : rId;
      const itemLabel = spec
        ? spec.label
        : agId === 'MTA_BUS'
          ? `${rId} Bus`
          : `${rId} Train`;
      return makeItem(seriesKey, itemLabel, def, rId, agId ?? 'MTA_NYCT_SUBWAY');
    });
    if (cell.chartType === 'route-segment-map') {
      return [
        makeItem('express', 'Express Pace (>= 22 mph)', '#00F59B'),
        makeItem('standard', 'Standard Pace (14-22 mph)', '#00E5FF'),
        makeItem('slow', 'Slow Zone (< 14 mph)', '#FF007F'),
      ];
    }
    return routeItems;
  }

  if (cell.chartType === 'isochrone-map') {
    return [
      makeItem('10 min', '<= 10 min Transit Shed', '#0039A6'),
      makeItem('20 min', '10-20 min Transit Shed', '#00ADD0'),
      makeItem('30 min', '20-30 min Transit Shed', '#6CBE45'),
      makeItem('45 min', '30-45 min Transit Shed', '#FF6319'),
    ];
  }

  if (cell.chartType === 'adherence-waterfall') {
    return [
      makeItem('Scheduled Service', 'Scheduled Service', '#0039A6'),
      makeItem('Ghost / Missing', 'Ghost / Missing', '#D82222'),
      makeItem('Unscheduled Added', 'Unscheduled Added', '#00933C'),
      makeItem('Observed Operated', 'Observed Operated', '#FF6319'),
    ];
  }

  if (cell.chartType === 'multimodal-pulse') {
    return [
      makeItem('Subway Entries', 'Subway Entries', '#0039A6'),
      makeItem('Citi Bikes Available', 'Citi Bikes Available', '#0072CE'),
      makeItem('Citi E-Bikes Available', 'Citi E-Bikes Available', '#059669'),
      makeItem('Empty Bike Docks', 'Empty Bike Docks', '#64748B'),
    ];
  }

  if (cell.chartType === 'od-ridership-flow') {
    const resolveStName = (raw: string): string => {
      const clean = raw.trim();
      const known =
        KNOWN_NYC_STATION_NAMES[clean] ||
        KNOWN_NYC_STATION_NAMES[clean.toUpperCase().replace(/[NS]$/, '')];
      return known ? known.name : clean;
    };
    const stationTotals = new Map<string, number>();
    for (const r of rows) {
      const rawOrig = String(
        r['origin_station_name'] ??
          r['origin_station'] ??
          r['from_station_name'] ??
          r['from_station'] ??
          r['origin_borough'] ??
          r['origin'] ??
          r['source'] ??
          r['from'] ??
          r['origin_station_id'] ??
          r['from_station_id'] ??
          ''
      ).trim();
      const rawDest = String(
        r['destination_station_name'] ??
          r['destination_station'] ??
          r['to_station_name'] ??
          r['to_station'] ??
          r['destination_borough'] ??
          r['destination'] ??
          r['target'] ??
          r['to'] ??
          r['destination_station_id'] ??
          r['to_station_id'] ??
          ''
      ).trim();
      const vol = Number(
        r['estimated_ridership'] ??
          r['ridership'] ??
          r['trip_count'] ??
          r['passenger_count'] ??
          r['flow'] ??
          r['value'] ??
          1
      );
      if (rawOrig) {
        const orig = resolveStName(rawOrig);
        stationTotals.set(orig, (stationTotals.get(orig) ?? 0) + (isNaN(vol) ? 1 : vol));
      }
      if (rawDest) {
        const dest = resolveStName(rawDest);
        stationTotals.set(dest, (stationTotals.get(dest) ?? 0) + (isNaN(vol) ? 1 : vol));
      }
    }
    const topStations = Array.from(stationTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([st]) => st);
    if (!topStations.includes('Other Stations')) topStations.push('Other Stations');
    return topStations.map((st, idx) =>
      makeItem(st, st, st === 'Other Stations' ? '#94A3B8' : palette[idx % palette.length]!)
    );
  }

  const sample = rows[0] ?? {};
  const keys = Object.keys(sample);
  const xCol =
    (cell.chartConfig?.['xColumn'] as string | undefined) && keys.includes(cell.chartConfig['xColumn'] as string)
      ? (cell.chartConfig['xColumn'] as string)
      : (keys.find(k => typeof sample[k] === 'string' || sample[k] instanceof Date) ?? keys[0] ?? '');
  const yCols = Array.isArray(cell.chartConfig?.['yColumns']) && (cell.chartConfig['yColumns'] as string[]).length > 0
    ? (cell.chartConfig['yColumns'] as string[])
    : keys.filter(k => k !== xCol && typeof sample[k] === 'number');
  const effectiveYCols = yCols.length > 0 ? yCols : keys.length > 1 ? [keys[1]!] : keys.slice(0, 1);

  if (
    cell.chartType === 'pie' ||
    cell.chartType === 'donut' ||
    cell.chartType === 'treemap' ||
    cell.chartType === 'funnel' ||
    cell.chartType === 'choropleth-borough' ||
    cell.chartType === 'radar'
  ) {
    const slices: ChartColorTargetItem[] = [];
    const seen = new Set<string>();
    const maxItems = cell.chartType === 'radar' ? 5 : 15;
    for (const r of rows) {
      const label = String(r[xCol] ?? '').trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      const rowAgency = r['agency_id'] ? String(r['agency_id']).trim() : undefined;
      const inferred = inferRouteBulletColorFromLabel(label, rowAgency);
      const fallback =
        (paletteId === 'mta-trunk' || paletteId === 'metro-north' ? inferred?.colorHex : undefined) ??
        palette[slices.length % palette.length]!;
      slices.push(makeItem(label, label, fallback, inferred?.routeId, inferred?.agencyId ?? rowAgency));
      if (slices.length >= maxItems) break;
    }
    if (slices.length > 0) return slices;
  }

  const items: ChartColorTargetItem[] = effectiveYCols.map((yCol, idx) =>
    makeItem(yCol, yCol, palette[idx % palette.length]!)
  );

  // For single-series bar charts, also expose individual category bars so users can color specific bars or routes
  if (cell.chartType === 'bar' && effectiveYCols.length <= 1 && rows.length > 0) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cat = String(rows[i]?.[xCol] ?? '').trim();
      if (!cat || items.some(it => it.key === cat)) continue;
      const rowAgency = rows[i]?.['agency_id'] ? String(rows[i]?.['agency_id']).trim() : undefined;
      const inferred = inferRouteBulletColorFromLabel(cat, rowAgency);
      items.push(
        makeItem(
          cat,
          cat,
          (paletteId === 'mta-trunk' || paletteId === 'metro-north' ? inferred?.colorHex : undefined) ??
            palette[i % palette.length]!,
          inferred?.routeId,
          inferred?.agencyId ?? rowAgency
        )
      );
    }
  }

  if (items.length === 0) {
    items.push(makeItem('Series 1', 'Primary Series', palette[0]!));
  }

  return items;
}

export function renderEditorialCard(container: HTMLElement, cellId: string): () => void {
  const cell = store.cells.find(c => c.cellId === cellId);
  if (!cell) {
    container.innerHTML = '';
    return () => {};
  }

  if (cell.kind === 'markdown') {
    let unwatchMd: (() => void) | null = null;

    const renderMarkdownContent = () => {
      if (cell.showSqlEditor) {
        container.innerHTML = `
          <div class="dbtc-markdown-card editing">
            <div class="markdown-editor-toolbar">
              <input type="text" class="dbtc-input-sm dbtc-markdown-title-input" value="${escapeHtml(cell.title)}" placeholder="Section Title..." style="flex: 1; max-width: 280px; margin-right: 8px;" title="Edit Section Title" />
              <button class="dbtc-btn btn-xs btn-primary save-markdown-btn">Done</button>
            </div>
            <textarea class="dbtc-markdown-textarea" placeholder="Write Markdown or safe HTML narrative...">${escapeHtml(cell.markdownText)}</textarea>
          </div>
        `;
        const titleInput = container.querySelector('.dbtc-markdown-title-input') as HTMLInputElement | null;
        const textarea = container.querySelector('.dbtc-markdown-textarea') as HTMLTextAreaElement | null;
        const doneBtn = container.querySelector('.save-markdown-btn') as HTMLButtonElement | null;

        const saveAndExit = async () => {
          if (titleInput) {
            cell.title = titleInput.value.trim() || 'Section Header';
          }
          if (textarea) {
            cell.markdownText = textarea.value;
          }
          cell.showSqlEditor = false;
          const conn = getDuckDbConnection();
          if (conn) {
            await persistCellToDuckDb(conn, cell);
          }
          renderMarkdownContent();
          window.dispatchEvent(new CustomEvent('dbtc:cell-updated', { detail: { cellId: cell.cellId } }));
        };

        titleInput?.addEventListener('input', () => {
          cell.title = titleInput.value;
        });
        textarea?.addEventListener('input', () => {
          cell.markdownText = textarea.value;
        });
        doneBtn?.addEventListener('click', saveAndExit);
      } else {
        const parsedHtml = renderMarkdownWithSafeHtml(cell.markdownText);
        const trimmedMd = cell.markdownText.trim();
        const showTitle =
          cell.title &&
          !trimmedMd.startsWith('#') &&
          !/^<h[1-6]\b/i.test(trimmedMd);
        container.innerHTML = `
          <div class="dbtc-markdown-card preview" title="Double-click to edit story narrative">
            ${showTitle ? `<h3 class="markdown-card-title">${escapeHtml(cell.title)}</h3>` : ''}
            <div class="markdown-content">${parsedHtml}</div>
          </div>
        `;
        const previewEl = container.querySelector('.dbtc-markdown-card');
        previewEl?.addEventListener('dblclick', () => {
          cell.showSqlEditor = true;
          renderMarkdownContent();
        });
      }
    };

    renderMarkdownContent();

    const watcherMd = watchReactive(
      () => cell.showSqlEditor,
      () => {
        renderMarkdownContent();
      }
    );
    unwatchMd = watcherMd[1];

    return () => {
      if (unwatchMd) unwatchMd();
      container.innerHTML = '';
    };
  }

  // Question Cell publication card
  const initialBunchingSec = Number(cell.chartConfig?.['bunchingThresholdSec']) || 120;
  const initialGappingSec = Number(cell.chartConfig?.['gappingThresholdSec']) || 600;
  const rawScale = (cell.chartConfig?.['yAxisScale'] as string) || (cell.chartConfig?.['useLogScale'] ? 'log' : 'linear');
  const initialScale: 'linear' | 'log' = rawScale === 'log' ? 'log' : 'linear';
  const initialBunchingMin = +(initialBunchingSec / 60).toFixed(1).replace(/\.0$/, '');
  const initialGappingMin = +(initialGappingSec / 60).toFixed(1).replace(/\.0$/, '');
  const initialTopStationsLimit = Math.max(5, Math.min(50, Number(cell.chartConfig?.['topStationsLimit'] ?? 10)));
  const initialSelectedStations: string[] = Array.isArray(cell.chartConfig?.['selectedStations'])
    ? (cell.chartConfig['selectedStations'] as string[])
    : [];

  container.innerHTML = `
    <article class="editorial-card" id="card-${cell.cellId}">
      <header class="card-header">
        <div class="card-title-row">
          <h2 class="card-title" contenteditable="true" id="card-title-${cell.cellId}">${escapeHtml(cell.title || 'Untitled Visual')}</h2>
          <div class="card-actions">
            <div class="scale-toggle-wrapper" id="scale-wrapper-${cell.cellId}" style="display: ${supportsScaleToggle(cell.chartType) ? 'inline-flex' : 'none'};">
              <div class="scale-segmented-btn" role="group" aria-label="Vertical scale">
                <button class="scale-segment-btn ${initialScale === 'linear' ? 'active' : ''}" data-scale="linear" type="button" title="Linear scale">Linear</button>
                <button class="scale-segment-btn ${initialScale === 'log' ? 'active' : ''}" data-scale="log" type="button" title="Logarithmic scale">Log</button>
              </div>
            </div>
            <div class="thresholds-dropdown-wrapper" id="thresholds-wrapper-${cell.cellId}" style="display: ${cell.chartType === 'headway-horizon' ? 'inline-block' : 'none'};">
              <button class="dbtc-btn btn-xs btn-secondary thresholds-menu-btn" id="thresholds-btn-${cell.cellId}" title="Set Bunching and Gapping Thresholds">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="margin-right: 4px; vertical-align: -1.5px;">
                  <path d="M4 6h12M4 10h12M4 14h12M7 4v4M13 8v4M9 12v4"/>
                </svg>
                Thresholds ▾
              </button>
              <div class="thresholds-dropdown-menu" id="thresholds-menu-${cell.cellId}" style="display: none;">
                <div class="thresholds-panel-header">
                  <span class="thresholds-panel-title">Headway Thresholds</span>
                  <button class="thresholds-reset-btn" id="thresholds-reset-${cell.cellId}" title="Reset to standard 2m bunching and 10m gapping">Reset</button>
                </div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row">
                    <span class="threshold-indicator red-dot"></span>
                    <label class="threshold-label">Bunching (&lt; <span id="bunching-val-label-${cell.cellId}">${initialBunchingMin}m</span>)</label>
                  </div>
                  <div class="threshold-input-row">
                    <input type="range" class="threshold-slider" id="bunching-slider-${cell.cellId}" min="30" max="600" step="15" value="${initialBunchingSec}" />
                    <div class="threshold-num-input-wrap">
                      <input type="number" class="dbtc-input-sm threshold-num-input" id="bunching-num-${cell.cellId}" min="0.5" max="10" step="0.5" value="${initialBunchingMin}" />
                      <span class="threshold-unit">min</span>
                    </div>
                  </div>
                  <div class="threshold-presets" id="bunching-presets-${cell.cellId}">
                    <button class="preset-pill ${initialBunchingSec === 60 ? 'active' : ''}" data-sec="60">1m</button>
                    <button class="preset-pill ${initialBunchingSec === 120 ? 'active' : ''}" data-sec="120">2m</button>
                    <button class="preset-pill ${initialBunchingSec === 180 ? 'active' : ''}" data-sec="180">3m</button>
                    <button class="preset-pill ${initialBunchingSec === 240 ? 'active' : ''}" data-sec="240">4m</button>
                    <button class="preset-pill ${initialBunchingSec === 300 ? 'active' : ''}" data-sec="300">5m</button>
                  </div>
                </div>

                <div class="threshold-divider"></div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row">
                    <span class="threshold-indicator purple-dot"></span>
                    <label class="threshold-label">Gapping (&gt; <span id="gapping-val-label-${cell.cellId}">${initialGappingMin}m</span>)</label>
                  </div>
                  <div class="threshold-input-row">
                    <input type="range" class="threshold-slider" id="gapping-slider-${cell.cellId}" min="300" max="3600" step="60" value="${initialGappingSec}" />
                    <div class="threshold-num-input-wrap">
                      <input type="number" class="dbtc-input-sm threshold-num-input" id="gapping-num-${cell.cellId}" min="5" max="60" step="1" value="${initialGappingMin}" />
                      <span class="threshold-unit">min</span>
                    </div>
                  </div>
                  <div class="threshold-presets" id="gapping-presets-${cell.cellId}">
                    <button class="preset-pill ${initialGappingSec === 600 ? 'active' : ''}" data-sec="600">10m</button>
                    <button class="preset-pill ${initialGappingSec === 720 ? 'active' : ''}" data-sec="720">12m</button>
                    <button class="preset-pill ${initialGappingSec === 900 ? 'active' : ''}" data-sec="900">15m</button>
                    <button class="preset-pill ${initialGappingSec === 1200 ? 'active' : ''}" data-sec="1200">20m</button>
                    <button class="preset-pill ${initialGappingSec === 1800 ? 'active' : ''}" data-sec="1800">30m</button>
                  </div>
                </div>

                <div class="threshold-divider"></div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row">
                    <label class="threshold-label">Vertical Scale</label>
                  </div>
                  <div class="threshold-scale-toggles" id="scale-toggles-${cell.cellId}">
                    <button class="scale-toggle-btn ${initialScale === 'linear' ? 'active' : ''}" data-scale="linear">Linear</button>
                    <button class="scale-toggle-btn ${initialScale === 'log' ? 'active' : ''}" data-scale="log">Log</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="od-controls-dropdown-wrapper" id="od-controls-wrapper-${cell.cellId}" style="display: ${cell.chartType === 'od-ridership-flow' ? 'inline-block' : 'none'};">
              <button class="dbtc-btn btn-xs btn-secondary od-controls-menu-btn" id="od-controls-btn-${cell.cellId}" title="Configure Hub Stations and Other Grouping Threshold">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="margin-right: 4px; vertical-align: -1.5px;">
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="14" cy="14" r="3"/>
                  <path d="M8.5 8.5l3 3"/>
                </svg>
                Hubs &amp; Thresholds ▾
              </button>
              <div class="od-controls-dropdown-menu" id="od-controls-menu-${cell.cellId}" style="display: none;">
                <div class="thresholds-panel-header">
                  <span class="thresholds-panel-title">Hub Station Display</span>
                  <button class="thresholds-reset-btn" id="od-reset-${cell.cellId}" title="Reset to Top 10 Hubs">Reset</button>
                </div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row">
                    <label class="threshold-label">Top Hub Threshold (<span id="od-limit-val-label-${cell.cellId}">Top ${initialTopStationsLimit}</span>)</label>
                    <span class="od-label-hint">Rest grouped into Other</span>
                  </div>
                  <div class="threshold-input-row">
                    <input type="range" class="threshold-slider" id="od-limit-slider-${cell.cellId}" min="5" max="30" step="1" value="${initialTopStationsLimit}" />
                    <div class="threshold-num-input-wrap">
                      <input type="number" class="dbtc-input-sm threshold-num-input" id="od-limit-num-${cell.cellId}" min="5" max="30" step="1" value="${initialTopStationsLimit}" />
                      <span class="threshold-unit">hubs</span>
                    </div>
                  </div>
                  <div class="threshold-presets" id="od-limit-presets-${cell.cellId}">
                    <button class="preset-pill ${initialTopStationsLimit === 5 && initialSelectedStations.length === 0 ? 'active' : ''}" data-limit="5">Top 5</button>
                    <button class="preset-pill ${initialTopStationsLimit === 8 && initialSelectedStations.length === 0 ? 'active' : ''}" data-limit="8">Top 8</button>
                    <button class="preset-pill ${initialTopStationsLimit === 10 && initialSelectedStations.length === 0 ? 'active' : ''}" data-limit="10">Top 10</button>
                    <button class="preset-pill ${initialTopStationsLimit === 15 && initialSelectedStations.length === 0 ? 'active' : ''}" data-limit="15">Top 15</button>
                    <button class="preset-pill ${initialTopStationsLimit === 20 && initialSelectedStations.length === 0 ? 'active' : ''}" data-limit="20">Top 20</button>
                  </div>
                </div>

                <div class="threshold-divider"></div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row" style="display: flex; justify-content: space-between; align-items: center;">
                    <label class="threshold-label">Select Custom Stations</label>
                    <button class="thresholds-reset-btn" id="od-clear-override-btn-${cell.cellId}" style="display: ${initialSelectedStations.length > 0 ? 'inline-block' : 'none'};">Clear Selection</button>
                  </div>
                  <div class="od-picker-desc">Check specific stations to override default rank:</div>
                  <div class="od-stations-picker" id="od-stations-picker-${cell.cellId}">
                    <div style="padding: 8px; color: #94A3B8; font-size: 11px;">Run query to populate stations</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="thresholds-dropdown-wrapper schema-remap-dropdown-wrapper" id="schema-remap-wrapper-${cell.cellId}">
              <button class="dbtc-btn btn-xs btn-secondary schema-remap-btn" id="schema-remap-btn-${cell.cellId}" title="View default schema and remap query columns to chart functions">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="margin-right: 4px; vertical-align: -1.5px;">
                  <path d="M4 6h5l3 8h4M16 6h-4l-3 8H4"/>
                </svg>
                Columns ▾
              </button>
              <div class="thresholds-dropdown-menu schema-remap-menu" id="schema-remap-menu-${cell.cellId}" style="display: none; min-width: 265px;">
                <div class="thresholds-panel-header">
                  <span class="thresholds-panel-title">Column Schema Mapping</span>
                  <button class="thresholds-reset-btn" id="schema-remap-reset-${cell.cellId}" title="Reset column mappings to default schema">Reset</button>
                </div>
                <div class="schema-remap-status" id="schema-remap-status-${cell.cellId}" style="font-size: 11px; color: #475569; margin-bottom: 8px;"></div>
                <div class="schema-remap-roles" id="schema-remap-roles-${cell.cellId}" style="display: flex; flex-direction: column; gap: 8px;"></div>
              </div>
            </div>

            <div class="thresholds-dropdown-wrapper colors-dropdown-wrapper" id="colors-wrapper-${cell.cellId}" style="display: ${cell.chartType !== 'table' ? 'inline-block' : 'none'};">
              <button class="dbtc-btn btn-xs btn-secondary colors-menu-btn" id="colors-btn-${cell.cellId}" title="Customize chart series colors and theme swatches">
                <span class="colors-btn-swatch-dots" id="colors-btn-dots-${cell.cellId}" style="display: inline-flex; align-items: center; gap: 2px; margin-right: 4px; vertical-align: -1px;">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #EE352E;"></span>
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #00933C;"></span>
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #0039A6;"></span>
                </span>
                Colors ▾
              </button>
              <div class="thresholds-dropdown-menu colors-dropdown-menu" id="colors-menu-${cell.cellId}" style="display: none; min-width: 325px; max-width: 360px; z-index: 30;">
                <div class="thresholds-panel-header">
                  <span class="thresholds-panel-title">Chart Colors &amp; Theme Presets</span>
                  <button class="thresholds-reset-btn" id="colors-reset-${cell.cellId}" title="Reset custom colors to default MTA route bullet colors">Reset</button>
                </div>

                <div class="threshold-control-group" style="margin-bottom: 8px;">
                  <div class="threshold-label-row" style="margin-bottom: 4px;">
                    <label class="threshold-label" style="font-size: 11px;">Color Palette Preset</label>
                  </div>
                  <select class="dbtc-select-sm colors-palette-select" id="colors-palette-select-${cell.cellId}" style="width: 100%; font-size: 11.5px; padding: 4px 6px;">
                    ${Object.entries(CHART_COLOR_PALETTES)
                      .map(
                        ([id, spec]) =>
                          `<option value="${escapeHtml(id)}" ${(cell.chartConfig?.['colorPalette'] ?? 'mta-trunk') === id ? 'selected' : ''}>${escapeHtml(spec.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>

                <div class="threshold-divider"></div>

                <div class="threshold-control-group" style="margin-bottom: 8px;">
                  <div class="threshold-label-row" style="margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;">
                    <label class="threshold-label" id="colors-swatches-title-${cell.cellId}" style="font-size: 11px;">${escapeHtml(getThemeColorSwatches(cell.chartConfig?.['colorPalette'] as string | undefined).sectionTitle)}</label>
                    <span id="colors-active-target-hint-${cell.cellId}" style="font-size: 10px; color: #64748B;">${escapeHtml(getThemeColorSwatches(cell.chartConfig?.['colorPalette'] as string | undefined).hintText)}</span>
                  </div>
                  <div class="mta-bullet-swatches-grid" id="mta-bullet-swatches-${cell.cellId}" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;">
                    ${renderColorSwatchesHtml(cell.chartConfig?.['colorPalette'] as string | undefined)}
                  </div>
                </div>

                <div class="threshold-divider"></div>

                <div class="threshold-control-group">
                  <div class="threshold-label-row" style="margin-bottom: 5px;">
                    <label class="threshold-label" style="font-size: 11px;">Series &amp; Category Colors</label>
                  </div>
                  <div class="colors-series-list" id="colors-series-list-${cell.cellId}" style="display: flex; flex-direction: column; gap: 5px; max-height: 210px; overflow-y: auto; padding-right: 2px;"></div>
                </div>
              </div>
            </div>

            <div class="export-dropdown-wrapper">
              <button class="dbtc-btn btn-xs btn-secondary export-menu-btn" id="export-menu-btn-${cell.cellId}" title="Export options">
                Export ▾
              </button>
              <div class="export-dropdown-menu" id="export-menu-${cell.cellId}" style="display: none;">
                <button class="export-action-item" data-export-type="card-png">Card PNG (2x Retina)</button>
                <button class="export-action-item" data-export-type="card-svg">Card SVG</button>
                <button class="export-action-item" data-export-type="canvas-png">Bare Visual PNG</button>
                <button class="export-action-item" data-export-type="canvas-svg">Bare Visual SVG</button>
                <div class="export-menu-divider"></div>
                <button class="export-action-item" data-export-type="csv">Export Data (CSV)</button>
                <button class="export-action-item" data-export-type="json">Export Data (JSON)</button>
              </div>
            </div>
          </div>
        </div>
        <p class="card-subtitle" contenteditable="true" id="card-subtitle-${cell.cellId}">${escapeHtml(cell.subtitle || 'Click to add subtitle')}</p>
      </header>

      <div class="card-threshold-chips" id="threshold-chips-${cell.cellId}" style="display: ${cell.chartType === 'headway-horizon' ? 'flex' : 'none'};">
        <button class="threshold-chip-btn" id="chip-bunching-${cell.cellId}" title="Click to adjust bunching threshold">
          <span class="threshold-indicator red-dot"></span>
          <span>Bunched: &lt; <b id="chip-bunching-val-${cell.cellId}">${initialBunchingMin}m</b></span>
        </button>
        <button class="threshold-chip-btn" id="chip-gapping-${cell.cellId}" title="Click to adjust gapping threshold">
          <span class="threshold-indicator purple-dot"></span>
          <span>Gapped: &gt; <b id="chip-gapping-val-${cell.cellId}">${initialGappingMin}m</b></span>
        </button>
        <button class="threshold-chip-btn" id="chip-scale-${cell.cellId}" title="Click to adjust vertical scale">
          <span style="color: #64748B;">Scale:</span> <b id="chip-scale-val-${cell.cellId}">${initialScale.toUpperCase()}</b>
        </button>
      </div>

      <div class="card-threshold-chips od-threshold-chips" id="od-chips-${cell.cellId}" style="display: ${cell.chartType === 'od-ridership-flow' ? 'flex' : 'none'};">
        <button class="threshold-chip-btn" id="chip-od-threshold-${cell.cellId}" title="Click to adjust hub threshold">
          <span class="threshold-indicator" style="background-color: #0039A6;"></span>
          <span>Displaying: <b id="chip-od-val-${cell.cellId}">${initialSelectedStations.length > 0 ? `${initialSelectedStations.length} custom stations` : `Top ${initialTopStationsLimit} Hubs`}</b></span>
        </button>
        <span class="od-chips-note" style="font-size: 11px; color: #64748B; margin-left: 8px; align-self: center;">Long-tail flow grouped into <b>Other Stations</b></span>
      </div>

      <div class="card-viz-canvas" id="canvas-${cell.cellId}"></div>

      <footer class="card-footer">
        <div class="card-source-note">
          ${escapeHtml(cell.sourceNote || 'Source: StraphangerDB')}
        </div>
        <div class="card-timestamp">
          ${formatFreshness(cell)}
        </div>
      </footer>
    </article>
  `;

  // Mount visual
  let cleanupVisual = () => {};
  const mountVisual = () => {
    cleanupVisual();
    const vizCanvas = container.querySelector(`#canvas-${cell.cellId}`) as HTMLElement | null;
    if (vizCanvas) {
      vizCanvas.innerHTML = '';

      const isEngineBooting =
        cell.executionState.status === 'booting' ||
        (cell.executionState.status === 'running' && store.notebook.engineStatus === 'booting');

      if (isEngineBooting) {
        vizCanvas.innerHTML = `
          <div class="card-viz-loading card-viz-engine-booting" data-loading-phase="engine-booting" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 240px; gap: 0.65rem;">
            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #FEF3C7; border: 1px solid #F59E0B; color: #B45309; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: #F59E0B; display: inline-block; animation: pulse 1s infinite ease-in-out;"></span>
              DuckDB-Wasm Engine Booting
            </div>
            <div style="display: flex; align-items: center; justify-content: center;">
              ${getBilevel53rdLoadingSvg()}
            </div>
            <span style="font-size: 0.84rem; font-weight: 600; color: #92400E;">Spinning up DuckDB-Wasm runtime...</span>
            <span style="font-size: 0.74rem; color: #78716C; max-width: 320px; text-align: center;">Initializing WebAssembly worker &amp; attaching DuckLake catalog before cell queries run</span>
          </div>
        `;
        return;
      }

      if (cell.executionState.status === 'running') {
        vizCanvas.innerHTML = `
          <div class="card-viz-loading card-viz-query-running" data-loading-phase="query-running" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 240px; gap: 0.65rem;">
            <div style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: #EFF6FF; border: 1px solid #93C5FD; color: #1D4ED8; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: #2563EB; display: inline-block; animation: pulse 1s infinite ease-in-out;"></span>
              Executing Cell SQL Query
            </div>
            <div style="display: flex; align-items: center; justify-content: center;">${getViaduct125LoadingSvg()}</div>
            <span style="font-size: 0.84rem; font-weight: 600; color: #1E3A8A;">Querying transit lakehouse...</span>
            <span style="font-size: 0.74rem; color: var(--mta-subtext, #64748B);">DuckDB-Wasm active · Executing cell SQL over R2 Parquet partitions</span>
          </div>
        `;
        return;
      }

      if (cell.executionState.status === 'error') {
        vizCanvas.innerHTML = `
          <div class="card-viz-error" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 240px; padding: 1.5rem; text-align: center; gap: 0.5rem;">
            <span style="color: var(--mta-red, #d9381e); font-weight: 600; font-size: 0.9rem;">Query Execution Error</span>
            <span style="color: var(--mta-subtext, #888888); font-size: 0.8rem; font-family: var(--font-mono, monospace); max-width: 90%; overflow-wrap: break-word;">${escapeHtml(cell.executionState.error)}</span>
          </div>
        `;
        return;
      }

      const artifacts = CellRuntimeRegistry.get(cell.cellId);
      const rows = artifacts?.normalized?.rows ?? [];
      cleanupVisual = renderCellVisual(vizCanvas, cell.chartType, rows, cell.chartConfig, cell.cellId);
    }
  };

  mountVisual();

  const timestampEl = container.querySelector('.card-timestamp') as HTMLElement | null;
  const updateTimestamp = () => {
    if (timestampEl) {
      timestampEl.textContent = formatFreshness(cell);
    }
  };

  // Handle title/subtitle inline editing
  const titleEl = container.querySelector(`#card-title-${cell.cellId}`) as HTMLElement | null;
  const subtitleEl = container.querySelector(`#card-subtitle-${cell.cellId}`) as HTMLElement | null;

  const saveTitleSubtitle = async () => {
    cell.title = titleEl?.textContent ?? '';
    cell.subtitle = subtitleEl?.textContent ?? '';
    const conn = getDuckDbConnection();
    if (conn) {
      await persistCellToDuckDb(conn, cell);
    }
  };

  titleEl?.addEventListener('blur', saveTitleSubtitle);
  subtitleEl?.addEventListener('blur', saveTitleSubtitle);

  // Handle export menu toggle and actions
  const menuBtn = container.querySelector(`#export-menu-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const menuEl = container.querySelector(`#export-menu-${cell.cellId}`) as HTMLElement | null;
  const cardEl = container.querySelector(`#card-${cell.cellId}`) as HTMLElement | null;

  // Thresholds popover controls
  const thresholdsBtn = container.querySelector(`#thresholds-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const thresholdsMenu = container.querySelector(`#thresholds-menu-${cell.cellId}`) as HTMLElement | null;
  const chipBunching = container.querySelector(`#chip-bunching-${cell.cellId}`) as HTMLButtonElement | null;
  const chipGapping = container.querySelector(`#chip-gapping-${cell.cellId}`) as HTMLButtonElement | null;
  const chipScale = container.querySelector(`#chip-scale-${cell.cellId}`) as HTMLButtonElement | null;

  const toggleThresholdsMenu = (e: Event) => {
    e.stopPropagation();
    if (thresholdsMenu) {
      const isVisible = thresholdsMenu.style.display !== 'none';
      if (menuEl) menuEl.style.display = 'none';
      thresholdsMenu.style.display = isVisible ? 'none' : 'block';
    }
  };

  thresholdsBtn?.addEventListener('click', toggleThresholdsMenu);
  chipBunching?.addEventListener('click', toggleThresholdsMenu);
  chipGapping?.addEventListener('click', toggleThresholdsMenu);

  thresholdsMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  let skipNextWatcherMount = false;

  const schemaRemapBtn = container.querySelector(`#schema-remap-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const schemaRemapMenu = container.querySelector(`#schema-remap-menu-${cell.cellId}`) as HTMLElement | null;
  const schemaRemapStatus = container.querySelector(`#schema-remap-status-${cell.cellId}`) as HTMLElement | null;
  const schemaRemapList = container.querySelector(`#schema-remap-roles-${cell.cellId}`) as HTMLElement | null;
  const schemaRemapResetBtn = container.querySelector(`#schema-remap-reset-${cell.cellId}`) as HTMLButtonElement | null;

  const odControlsMenu = container.querySelector(`#od-controls-menu-${cell.cellId}`) as HTMLElement | null;
  const colorsBtn = container.querySelector(`#colors-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const colorsBtnDots = container.querySelector(`#colors-btn-dots-${cell.cellId}`) as HTMLElement | null;
  const colorsMenu = container.querySelector(`#colors-menu-${cell.cellId}`) as HTMLElement | null;
  const colorsSwatchesTitle = container.querySelector(`#colors-swatches-title-${cell.cellId}`) as HTMLElement | null;
  const colorsSwatchesGrid = container.querySelector(`#mta-bullet-swatches-${cell.cellId}`) as HTMLElement | null;
  const colorsSeriesList = container.querySelector(`#colors-series-list-${cell.cellId}`) as HTMLElement | null;
  const colorsPaletteSelect = container.querySelector(`#colors-palette-select-${cell.cellId}`) as HTMLSelectElement | null;
  const colorsResetBtn = container.querySelector(`#colors-reset-${cell.cellId}`) as HTMLButtonElement | null;
  const colorsActiveHint = container.querySelector(`#colors-active-target-hint-${cell.cellId}`) as HTMLElement | null;

  const closeAllPopovers = (except?: HTMLElement | null) => {
    for (const pop of [menuEl, thresholdsMenu, odControlsMenu, schemaRemapMenu, colorsMenu]) {
      if (pop && pop !== except) {
        pop.style.display = 'none';
      }
    }
  };

  const populateSchemaRemapMenu = () => {
    if (!schemaRemapList) return;
    const norm = CellRuntimeRegistry.get(cell.cellId)?.normalized;
    const colMetas = norm?.columns ?? [];
    const cols = colMetas.map((c) => c.name);
    const roles = CHART_DEFAULT_SCHEMAS[cell.chartType] ?? [];
    const currentMapping = (cell.chartConfig['columnMapping'] as Readonly<Record<string, string>> | undefined) ?? undefined;
    const resolved = resolveChartColumnMapping(cell.chartType, colMetas, currentMapping, cell.chartConfig);
    const compatible = isChartSchemaCompatible(cell.chartType, cols);
    const hasCustomMapping = Boolean(
      currentMapping && Object.keys(currentMapping).length > 0
    );

    if (schemaRemapBtn) {
      if (!compatible && !hasCustomMapping && cols.length > 0) {
        schemaRemapBtn.style.borderColor = '#D97706';
        schemaRemapBtn.style.color = '#B45309';
      } else if (hasCustomMapping) {
        schemaRemapBtn.style.borderColor = '#2563EB';
        schemaRemapBtn.style.color = '#1D4ED8';
      } else {
        schemaRemapBtn.style.borderColor = '';
        schemaRemapBtn.style.color = '';
      }
    }

    if (schemaRemapStatus) {
      if (roles.length === 0) {
        schemaRemapStatus.textContent = 'Passthrough schema (all query columns displayed).';
        schemaRemapStatus.style.color = '#475569';
      } else if (cols.length === 0) {
        schemaRemapStatus.textContent = 'Default schema roles shown below. Run query to remap result columns.';
        schemaRemapStatus.style.color = '#64748B';
      } else if (hasCustomMapping) {
        schemaRemapStatus.textContent = 'Custom column mapping active.';
        schemaRemapStatus.style.color = '#1D4ED8';
      } else if (compatible) {
        schemaRemapStatus.textContent = 'Compatible with default schema (auto-matched).';
        schemaRemapStatus.style.color = '#15803D';
      } else {
        schemaRemapStatus.textContent = 'Auto-mapped fallback active. Select columns below to customize.';
        schemaRemapStatus.style.color = '#B45309';
      }
    }

    if (roles.length === 0) {
      schemaRemapList.innerHTML = `<div style="font-size: 11px; color: var(--text-muted, #6B655D); padding: 4px 0;">Table renders all query columns directly.</div>`;
      return;
    }

    schemaRemapList.innerHTML = roles
      .map((role) => {
        const selectedCol = resolved[role.roleKey] ?? '';
        const candidateCols = cols.length > 0
          ? cols
          : (selectedCol ? [selectedCol] : [role.canonicalColumn]);
        const optionsHtml = [
          `<option value="" ${!selectedCol ? 'selected' : ''}>(Auto / ${escapeHtml(role.canonicalColumn)})</option>`,
          ...candidateCols.map(
            (c) =>
              `<option value="${escapeHtml(c)}" ${c === selectedCol ? 'selected' : ''}>${escapeHtml(c)}</option>`
          ),
        ].join('');
        return `
          <div class="schema-remap-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px;">
            <label style="color: var(--text-primary, #1F1E1B); font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(role.label)} (${escapeHtml(role.canonicalColumn)})">
              ${escapeHtml(role.label)}${role.required ? ' <span style="color:#DC2626;">*</span>' : ''}
            </label>
            <select class="schema-role-select" data-role-key="${escapeHtml(role.roleKey)}" style="width: 155px; padding: 3px 6px; font-size: 11px; font-family: var(--font-mono, monospace); border: 1px solid var(--border-subtle, #D4CFC4); border-radius: 4px; background: var(--bg-surface, #fff); color: var(--text-primary, #1F1E1B);">
              ${optionsHtml}
            </select>
          </div>
        `;
      })
      .join('');

    schemaRemapList.querySelectorAll('.schema-role-select').forEach((sel) => {
      sel.addEventListener('change', (ev) => {
        const selectEl = ev.target as HTMLSelectElement;
        const roleKey = selectEl.getAttribute('data-role-key');
        if (!roleKey) return;
        const existingMap = (cell.chartConfig['columnMapping'] as Record<string, string> | undefined) ?? {};
        const nextMapping: Record<string, string> = { ...existingMap };
        if (selectEl.value) {
          nextMapping[roleKey] = selectEl.value;
        } else {
          delete nextMapping[roleKey];
        }
        skipNextWatcherMount = true;
        cell.chartConfig = {
          ...cell.chartConfig,
          columnMapping: Object.keys(nextMapping).length > 0 ? nextMapping : undefined,
        };
        populateSchemaRemapMenu();
        mountVisual();
        const conn = getDuckDbConnection();
        if (conn) {
          void persistCellToDuckDb(conn, cell);
        }
      });
    });
  };

  populateSchemaRemapMenu();

  schemaRemapBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (schemaRemapMenu) {
      const isVisible = schemaRemapMenu.style.display !== 'none';
      closeAllPopovers(schemaRemapMenu);
      if (!isVisible) populateSchemaRemapMenu();
      schemaRemapMenu.style.display = isVisible ? 'none' : 'block';
    }
  });

  schemaRemapMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  schemaRemapResetBtn?.addEventListener('click', () => {
    skipNextWatcherMount = true;
    cell.chartConfig = {
      ...cell.chartConfig,
      columnMapping: undefined,
    };
    populateSchemaRemapMenu();
    mountVisual();
    const conn = getDuckDbConnection();
    if (conn) {
      void persistCellToDuckDb(conn, cell);
    }
  });

  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuEl) {
      closeAllPopovers(menuEl);
      menuEl.style.display = menuEl.style.display === 'none' ? 'block' : 'none';
    }
  });

  let activeColorTargetKey: string | null = null;

  const setCustomColorForSeries = (
    seriesKey: string,
    colorHex: string,
    persist = true,
    rebuildMenu = true
  ) => {
    const existingCustom =
      cell.chartConfig?.['customColors'] && typeof cell.chartConfig['customColors'] === 'object'
        ? { ...(cell.chartConfig['customColors'] as Record<string, string>) }
        : {};
    existingCustom[seriesKey] = colorHex;
    skipNextWatcherMount = true;
    cell.chartConfig = {
      ...cell.chartConfig,
      customColors: existingCustom,
    };
    if (rebuildMenu) {
      populateColorsMenu();
    } else if (colorsSeriesList) {
      colorsSeriesList.querySelectorAll('.colors-series-item').forEach(rowEl => {
        if (rowEl.getAttribute('data-series-key') === seriesKey) {
          const codeEl = rowEl.querySelector('code');
          if (codeEl) codeEl.textContent = colorHex.toUpperCase();
        }
      });
    }
    mountVisual();
    if (persist) {
      const conn = getDuckDbConnection();
      if (conn) void persistCellToDuckDb(conn, cell);
    }
  };

  const populateColorsMenu = () => {
    if (!colorsSeriesList) return;
    const rawPaletteId = (cell.chartConfig?.['colorPalette'] as string | undefined) ?? 'mta-trunk';
    const activePaletteId = rawPaletteId in CHART_COLOR_PALETTES ? rawPaletteId : 'mta-trunk';
    const swatchGroup = getThemeColorSwatches(activePaletteId);
    const targets = extractChartColorTargets(cell);
    const hasCustomColors = Boolean(
      cell.chartConfig?.['customColors'] &&
        Object.keys(cell.chartConfig['customColors'] as Record<string, string>).length > 0
    );
    const hasCustomPalette = Boolean(
      cell.chartConfig?.['colorPalette'] && activePaletteId !== 'mta-trunk'
    );

    if (colorsBtn) {
      if (hasCustomColors || hasCustomPalette) {
        colorsBtn.style.borderColor = '#2563EB';
        colorsBtn.style.color = '#1D4ED8';
      } else {
        colorsBtn.style.borderColor = '';
        colorsBtn.style.color = '';
      }
    }

    if (colorsBtnDots) {
      const dotColors =
        activePaletteId === 'mta-trunk'
          ? ['#EE352E', '#00933C', '#0039A6']
          : (CHART_COLOR_PALETTES[activePaletteId]?.colors.slice(0, 3) ?? ['#EE352E', '#00933C', '#0039A6']);
      colorsBtnDots.innerHTML = dotColors
        .map(
          c =>
            `<span style="width: 6px; height: 6px; border-radius: 50%; background: ${escapeHtml(c)};"></span>`
        )
        .join('');
    }

    if (colorsPaletteSelect) {
      colorsPaletteSelect.value = activePaletteId;
    }

    if (colorsSwatchesTitle) {
      colorsSwatchesTitle.textContent = swatchGroup.sectionTitle;
    }

    if (colorsSwatchesGrid) {
      colorsSwatchesGrid.innerHTML = renderColorSwatchesHtml(activePaletteId);
    }

    if (!activeColorTargetKey || !targets.some(t => t.key === activeColorTargetKey)) {
      activeColorTargetKey = targets[0]?.key ?? null;
    }

    const activeTarget = targets.find(t => t.key === activeColorTargetKey);
    if (colorsActiveHint) {
      colorsActiveHint.textContent = activeTarget
        ? `Applying to: ${activeTarget.label.slice(0, 18)}`
        : swatchGroup.hintText;
    }

    colorsSeriesList.innerHTML = targets
      .map(item => {
        const isSelected = item.key === activeColorTargetKey;
        const badgeHtml =
          swatchGroup.isTransitTheme && item.routeId && !/other/i.test(item.label)
            ? buildRouteBulletHtml(item.routeId, item.agencyId ?? 'MTA_NYCT_SUBWAY', item.currentColor, 16)
            : `<span style="width: 14px; height: 14px; border-radius: ${swatchGroup.isTransitTheme ? '50%' : '3px'}; background: ${escapeHtml(item.currentColor)}; border: 1px solid rgba(15,23,42,0.18); display: inline-block; flex-shrink: 0;"></span>`;
        return `
          <div class="colors-series-item ${isSelected ? 'active' : ''}" data-series-key="${escapeHtml(item.key)}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; border-radius: 5px; border: 1px solid ${isSelected ? '#3B82F6' : '#E2E8F0'}; background: ${isSelected ? '#EFF6FF' : '#FFFFFF'}; cursor: pointer; font-size: 11.5px;">
            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
              ${badgeHtml}
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: ${isSelected ? '600' : '500'}; color: #0F172A;" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <code style="font-size: 10px; color: #64748B;">${escapeHtml(item.currentColor.toUpperCase())}</code>
              <input type="color" class="series-color-picker-input" data-series-key="${escapeHtml(item.key)}" value="${escapeHtml(item.currentColor)}" title="Pick custom hex color for ${escapeHtml(item.label)}" style="width: 22px; height: 22px; padding: 0; border: 1px solid #CBD5E1; border-radius: 4px; background: transparent; cursor: pointer;" />
            </div>
          </div>
        `;
      })
      .join('');

    colorsSeriesList.querySelectorAll('.colors-series-item').forEach(rowEl => {
      rowEl.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
        const key = rowEl.getAttribute('data-series-key');
        if (key) {
          activeColorTargetKey = key;
          populateColorsMenu();
        }
      });
    });

    colorsSeriesList.querySelectorAll('.series-color-picker-input').forEach(inp => {
      inp.addEventListener('input', (ev) => {
        const inputEl = ev.target as HTMLInputElement;
        const key = inputEl.getAttribute('data-series-key');
        if (key && inputEl.value) {
          activeColorTargetKey = key;
          setCustomColorForSeries(key, inputEl.value, false, false);
        }
      });
      inp.addEventListener('change', (ev) => {
        const inputEl = ev.target as HTMLInputElement;
        const key = inputEl.getAttribute('data-series-key');
        if (key && inputEl.value) {
          activeColorTargetKey = key;
          setCustomColorForSeries(key, inputEl.value, true, true);
        }
      });
    });
  };

  populateColorsMenu();

  colorsSwatchesGrid?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest('.mta-bullet-color-swatch');
    if (!btn) return;
    ev.stopPropagation();
    const colorHex = btn.getAttribute('data-color-hex');
    if (!colorHex) return;
    const targets = extractChartColorTargets(cell);
    const targetKey = activeColorTargetKey ?? targets[0]?.key;
    if (targetKey) {
      setCustomColorForSeries(targetKey, colorHex, true);
    }
  });

  colorsPaletteSelect?.addEventListener('change', () => {
    const nextPalette = colorsPaletteSelect.value || 'mta-trunk';
    skipNextWatcherMount = true;
    cell.chartConfig = {
      ...cell.chartConfig,
      colorPalette: nextPalette === 'mta-trunk' ? undefined : nextPalette,
    };
    populateColorsMenu();
    mountVisual();
    const conn = getDuckDbConnection();
    if (conn) void persistCellToDuckDb(conn, cell);
  });

  colorsResetBtn?.addEventListener('click', () => {
    skipNextWatcherMount = true;
    cell.chartConfig = {
      ...cell.chartConfig,
      customColors: undefined,
      colorPalette: undefined,
    };
    populateColorsMenu();
    mountVisual();
    const conn = getDuckDbConnection();
    if (conn) void persistCellToDuckDb(conn, cell);
  });

  colorsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (colorsMenu) {
      const isVisible = colorsMenu.style.display !== 'none';
      if (menuEl) menuEl.style.display = 'none';
      if (thresholdsMenu) thresholdsMenu.style.display = 'none';
      if (odControlsMenu) odControlsMenu.style.display = 'none';
      if (schemaRemapMenu) schemaRemapMenu.style.display = 'none';
      if (!isVisible) populateColorsMenu();
      colorsMenu.style.display = isVisible ? 'none' : 'block';
    }
  });

  colorsMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  const closeMenuHandler = () => {
    closeAllPopovers();
  };
  const escapeKeyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeAllPopovers();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeMenuHandler);
    document.addEventListener('keydown', escapeKeyHandler);
  }

  // OD Controls popover toggle
  const odControlsBtn = container.querySelector(`#od-controls-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const chipOdThreshold = container.querySelector(`#chip-od-threshold-${cell.cellId}`) as HTMLButtonElement | null;

  const toggleOdControlsMenu = (e: Event) => {
    e.stopPropagation();
    if (odControlsMenu) {
      const isVisible = odControlsMenu.style.display !== 'none';
      closeAllPopovers(odControlsMenu);
      odControlsMenu.style.display = isVisible ? 'none' : 'block';
    }
  };

  odControlsBtn?.addEventListener('click', toggleOdControlsMenu);
  chipOdThreshold?.addEventListener('click', toggleOdControlsMenu);
  odControlsMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // OD Top Hubs limit slider and presets
  const odLimitSlider = container.querySelector(`#od-limit-slider-${cell.cellId}`) as HTMLInputElement | null;
  const odLimitNum = container.querySelector(`#od-limit-num-${cell.cellId}`) as HTMLInputElement | null;
  const odLimitValLabel = container.querySelector(`#od-limit-val-label-${cell.cellId}`) as HTMLElement | null;
  const chipOdVal = container.querySelector(`#chip-od-val-${cell.cellId}`) as HTMLElement | null;
  const odLimitPresets = container.querySelectorAll(`#od-limit-presets-${cell.cellId} .preset-pill`);
  const odClearOverrideBtn = container.querySelector(`#od-clear-override-btn-${cell.cellId}`) as HTMLButtonElement | null;
  const odResetBtn = container.querySelector(`#od-reset-${cell.cellId}`) as HTMLButtonElement | null;

  const populateOdStationsList = () => {
    if (cell.chartType !== 'od-ridership-flow') return;
    const pickerEl = container.querySelector(`#od-stations-picker-${cell.cellId}`) as HTMLElement | null;
    if (!pickerEl) return;

    const artifacts = CellRuntimeRegistry.get(cell.cellId);
    const rows = artifacts?.normalized?.rows ?? [];
    if (!rows || rows.length === 0) {
      pickerEl.innerHTML = '<div style="padding: 8px; color: #94A3B8; font-size: 11px;">Run query to populate stations</div>';
      return;
    }

    const stationVolumes = new Map<string, number>();
    for (const r of rows) {
      const orig = String(r['origin_station_name'] ?? r['origin_station_id'] ?? r['origin'] ?? '').trim();
      const dest = String(r['destination_station_name'] ?? r['destination_station_id'] ?? r['destination'] ?? '').trim();
      const count = Number(r['passenger_count'] ?? r['passengers'] ?? r['trips'] ?? 0);
      if (orig) stationVolumes.set(orig, (stationVolumes.get(orig) ?? 0) + count);
      if (dest) stationVolumes.set(dest, (stationVolumes.get(dest) ?? 0) + count);
    }

    const sortedStations = Array.from(stationVolumes.entries())
      .filter(([name]) => name && name !== 'Other' && name !== 'Other Stations')
      .sort((a, b) => b[1] - a[1]);

    if (sortedStations.length === 0) {
      pickerEl.innerHTML = '<div style="padding: 8px; color: #94A3B8; font-size: 11px;">No stations identified in data</div>';
      return;
    }

    const currentSelected = new Set<string>(
      Array.isArray(cell.chartConfig?.['selectedStations'])
        ? (cell.chartConfig['selectedStations'] as string[])
        : []
    );

    const isOverrideActive = currentSelected.size > 0;
    const currentLimit = Math.max(5, Math.min(50, Number(cell.chartConfig?.['topStationsLimit'] ?? 10)));
    const defaultActiveStations = new Set<string>(
      sortedStations.slice(0, currentLimit).map(([name]) => name)
    );

    pickerEl.innerHTML = sortedStations
      .map(([stationName, volume], idx) => {
        const isChecked = isOverrideActive
          ? currentSelected.has(stationName)
          : defaultActiveStations.has(stationName);
        return `
          <label class="od-station-item">
            <input type="checkbox" class="od-station-checkbox" data-station="${escapeHtml(stationName)}" ${isChecked ? 'checked' : ''} />
            <span class="od-station-name" title="${escapeHtml(stationName)}">#${idx + 1} ${escapeHtml(stationName)}</span>
            <span class="od-station-vol">${volume.toLocaleString()}</span>
          </label>
        `;
      })
      .join('');

    pickerEl.querySelectorAll('.od-station-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const checkedBoxes = Array.from(pickerEl.querySelectorAll('.od-station-checkbox:checked')) as HTMLInputElement[];
        const selected = checkedBoxes.map(b => b.getAttribute('data-station')!).filter(Boolean);
        cell.chartConfig = { ...cell.chartConfig, selectedStations: selected };
        if (chipOdVal) {
          chipOdVal.textContent = selected.length > 0 ? `${selected.length} custom stations` : `Top ${currentLimit} Hubs`;
        }
        if (odClearOverrideBtn) {
          odClearOverrideBtn.style.display = selected.length > 0 ? 'inline-block' : 'none';
        }
        odLimitPresets.forEach(p => p.classList.remove('active'));
        mountVisual();
        const conn = getDuckDbConnection();
        if (conn) persistCellToDuckDb(conn, cell);
      });
    });
  };

  const updateOdLimit = (limit: number, persist = false) => {
    const clampedLimit = Math.max(5, Math.min(50, limit));
    cell.chartConfig = { ...cell.chartConfig, topStationsLimit: clampedLimit, selectedStations: [] };
    if (odLimitSlider) odLimitSlider.value = String(clampedLimit);
    if (odLimitNum) odLimitNum.value = String(clampedLimit);
    if (odLimitValLabel) odLimitValLabel.textContent = `Top ${clampedLimit}`;
    if (chipOdVal) chipOdVal.textContent = `Top ${clampedLimit} Hubs`;
    if (odClearOverrideBtn) odClearOverrideBtn.style.display = 'none';
    odLimitPresets.forEach(p => {
      const pLimit = Number(p.getAttribute('data-limit'));
      p.classList.toggle('active', pLimit === clampedLimit);
    });
    populateOdStationsList();
    mountVisual();
    if (persist) {
      const conn = getDuckDbConnection();
      if (conn) persistCellToDuckDb(conn, cell);
    }
  };

  odLimitSlider?.addEventListener('input', () => {
    updateOdLimit(Number(odLimitSlider.value), false);
  });
  odLimitSlider?.addEventListener('change', () => {
    updateOdLimit(Number(odLimitSlider.value), true);
  });
  odLimitNum?.addEventListener('input', () => {
    const val = Number(odLimitNum.value);
    if (!isNaN(val) && val >= 5) updateOdLimit(val, false);
  });
  odLimitNum?.addEventListener('change', () => {
    const val = Number(odLimitNum.value);
    if (!isNaN(val) && val >= 5) updateOdLimit(val, true);
  });
  odLimitPresets.forEach(p => {
    p.addEventListener('click', () => {
      const limit = Number(p.getAttribute('data-limit'));
      if (!isNaN(limit)) updateOdLimit(limit, true);
    });
  });

  odClearOverrideBtn?.addEventListener('click', () => {
    const curLimit = Math.max(5, Math.min(50, Number(cell.chartConfig?.['topStationsLimit'] ?? 10)));
    updateOdLimit(curLimit, true);
  });

  odResetBtn?.addEventListener('click', () => {
    updateOdLimit(10, true);
  });

  if (cell.chartType === 'od-ridership-flow') {
    populateOdStationsList();
  }

  // Bunching Threshold logic
  const bunchingSlider = container.querySelector(`#bunching-slider-${cell.cellId}`) as HTMLInputElement | null;
  const bunchingNum = container.querySelector(`#bunching-num-${cell.cellId}`) as HTMLInputElement | null;
  const bunchingValLabel = container.querySelector(`#bunching-val-label-${cell.cellId}`) as HTMLElement | null;
  const chipBunchingVal = container.querySelector(`#chip-bunching-val-${cell.cellId}`) as HTMLElement | null;
  const bunchingPresets = container.querySelectorAll(`#bunching-presets-${cell.cellId} .preset-pill`);

  const updateBunching = (sec: number, persist = false) => {
    const clampedSec = Math.max(30, Math.min(600, sec));
    cell.chartConfig = { ...cell.chartConfig, bunchingThresholdSec: clampedSec };
    const mins = +(clampedSec / 60).toFixed(1).replace(/\.0$/, '');
    if (bunchingSlider) bunchingSlider.value = String(clampedSec);
    if (bunchingNum) bunchingNum.value = String(mins);
    if (bunchingValLabel) bunchingValLabel.textContent = `${mins}m`;
    if (chipBunchingVal) chipBunchingVal.textContent = `${mins}m`;
    bunchingPresets.forEach(p => {
      const pSec = Number(p.getAttribute('data-sec'));
      p.classList.toggle('active', pSec === clampedSec);
    });
    mountVisual();
    if (persist) {
      const conn = getDuckDbConnection();
      if (conn) persistCellToDuckDb(conn, cell);
    }
  };

  bunchingSlider?.addEventListener('input', () => {
    updateBunching(Number(bunchingSlider.value), false);
  });
  bunchingSlider?.addEventListener('change', () => {
    updateBunching(Number(bunchingSlider.value), true);
  });
  bunchingNum?.addEventListener('input', () => {
    const mins = Number(bunchingNum.value);
    if (!isNaN(mins) && mins > 0) {
      updateBunching(Math.round(mins * 60), false);
    }
  });
  bunchingNum?.addEventListener('change', () => {
    const mins = Number(bunchingNum.value);
    if (!isNaN(mins) && mins > 0) {
      updateBunching(Math.round(mins * 60), true);
    }
  });
  bunchingPresets.forEach(p => {
    p.addEventListener('click', () => {
      const sec = Number(p.getAttribute('data-sec'));
      if (!isNaN(sec)) updateBunching(sec, true);
    });
  });

  // Gapping Threshold logic
  const gappingSlider = container.querySelector(`#gapping-slider-${cell.cellId}`) as HTMLInputElement | null;
  const gappingNum = container.querySelector(`#gapping-num-${cell.cellId}`) as HTMLInputElement | null;
  const gappingValLabel = container.querySelector(`#gapping-val-label-${cell.cellId}`) as HTMLElement | null;
  const chipGappingVal = container.querySelector(`#chip-gapping-val-${cell.cellId}`) as HTMLElement | null;
  const gappingPresets = container.querySelectorAll(`#gapping-presets-${cell.cellId} .preset-pill`);

  const updateGapping = (sec: number, persist = false) => {
    const clampedSec = Math.max(300, Math.min(3600, sec));
    cell.chartConfig = { ...cell.chartConfig, gappingThresholdSec: clampedSec };
    const mins = +(clampedSec / 60).toFixed(1).replace(/\.0$/, '');
    if (gappingSlider) gappingSlider.value = String(clampedSec);
    if (gappingNum) gappingNum.value = String(mins);
    if (gappingValLabel) gappingValLabel.textContent = `${mins}m`;
    if (chipGappingVal) chipGappingVal.textContent = `${mins}m`;
    gappingPresets.forEach(p => {
      const pSec = Number(p.getAttribute('data-sec'));
      p.classList.toggle('active', pSec === clampedSec);
    });
    mountVisual();
    if (persist) {
      const conn = getDuckDbConnection();
      if (conn) persistCellToDuckDb(conn, cell);
    }
  };

  gappingSlider?.addEventListener('input', () => {
    updateGapping(Number(gappingSlider.value), false);
  });
  gappingSlider?.addEventListener('change', () => {
    updateGapping(Number(gappingSlider.value), true);
  });
  gappingNum?.addEventListener('input', () => {
    const mins = Number(gappingNum.value);
    if (!isNaN(mins) && mins > 0) {
      updateGapping(Math.round(mins * 60), false);
    }
  });
  gappingNum?.addEventListener('change', () => {
    const mins = Number(gappingNum.value);
    if (!isNaN(mins) && mins > 0) {
      updateGapping(Math.round(mins * 60), true);
    }
  });
  gappingPresets.forEach(p => {
    p.addEventListener('click', () => {
      const sec = Number(p.getAttribute('data-sec'));
      if (!isNaN(sec)) updateGapping(sec, true);
    });
  });

  // Vertical Scale logic (Header Segmented Control, Popover, and Quick Chip)
  const scaleSegmentBtns = container.querySelectorAll(`#scale-wrapper-${cell.cellId} .scale-segment-btn`);
  const scalePopoverBtns = container.querySelectorAll(`#scale-toggles-${cell.cellId} .scale-toggle-btn`);
  const chipScaleVal = container.querySelector(`#chip-scale-val-${cell.cellId}`) as HTMLElement | null;

  const updateScale = (scale: 'linear' | 'log', persist = false) => {
    cell.chartConfig = { ...cell.chartConfig, yAxisScale: scale, useLogScale: scale === 'log' };
    scaleSegmentBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-scale') === scale);
    });
    scalePopoverBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-scale') === scale);
    });
    if (chipScaleVal) chipScaleVal.textContent = scale.toUpperCase();
    mountVisual();
    if (persist) {
      const conn = getDuckDbConnection();
      if (conn) persistCellToDuckDb(conn, cell);
    }
  };

  scaleSegmentBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scale = btn.getAttribute('data-scale') as 'linear' | 'log' | null;
      if (scale) updateScale(scale, true);
    });
  });

  scalePopoverBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const scale = btn.getAttribute('data-scale') as 'linear' | 'log' | null;
      if (scale) updateScale(scale, true);
    });
  });

  chipScale?.addEventListener('click', (e) => {
    e.stopPropagation();
    const current = (cell.chartConfig?.['yAxisScale'] as string) === 'log' ? 'log' : 'linear';
    const next = current === 'log' ? 'linear' : 'log';
    updateScale(next, true);
  });

  // Reset to defaults
  const resetBtn = container.querySelector(`#thresholds-reset-${cell.cellId}`) as HTMLButtonElement | null;
  resetBtn?.addEventListener('click', () => {
    updateBunching(120, false);
    updateGapping(600, false);
    updateScale('linear', true);
  });

  menuEl?.querySelectorAll('.export-action-item').forEach(itemBtn => {
    itemBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeMenuHandler();
      const exportType = itemBtn.getAttribute('data-export-type');
      if (!cardEl) return;

      const runtime = CellRuntimeRegistry.get(cell.cellId as any);
      const title = cell.title || 'dbtc_chart';

      try {
        if (exportType === 'card-png') {
          await exportCardImage(runtime?.echartsInstance ?? null, cardEl, {
            title,
            subtitle: cell.subtitle,
            sourceNote: cell.sourceNote,
            fullCard: true,
            format: 'png',
            dpiScale: 2,
          });
          showToast(`Exported "${title}" as PNG card.`, 'success');
        } else if (exportType === 'card-svg') {
          await exportCardImage(runtime?.echartsInstance ?? null, cardEl, {
            title,
            subtitle: cell.subtitle,
            sourceNote: cell.sourceNote,
            fullCard: true,
            format: 'svg',
            dpiScale: 2,
          });
          showToast(`Exported "${title}" as SVG card.`, 'success');
        } else if (exportType === 'canvas-png') {
          await exportCardImage(runtime?.echartsInstance ?? null, cardEl, {
            title,
            subtitle: cell.subtitle,
            sourceNote: cell.sourceNote,
            fullCard: false,
            format: 'png',
            dpiScale: 2,
          });
          showToast(`Exported "${title}" visual as PNG.`, 'success');
        } else if (exportType === 'canvas-svg') {
          await exportCardImage(runtime?.echartsInstance ?? null, cardEl, {
            title,
            subtitle: cell.subtitle,
            sourceNote: cell.sourceNote,
            fullCard: false,
            format: 'svg',
            dpiScale: 2,
          });
          showToast(`Exported "${title}" visual as SVG.`, 'success');
        } else if (exportType === 'csv') {
          const artifacts = CellRuntimeRegistry.get(cell.cellId);
          const rows = artifacts?.normalized?.rows ?? [];
          if (rows.length === 0) {
            showToast('No rows available to export as CSV.', 'warning');
          } else {
            exportDataToCsv(rows, `${cell.cellId}_data.csv`);
            showToast(`Exported ${rows.length} rows to CSV.`, 'success');
          }
        } else if (exportType === 'json') {
          const artifacts = CellRuntimeRegistry.get(cell.cellId);
          const rows = artifacts?.normalized?.rows ?? [];
          exportDataToJson(rows, `${cell.cellId}_data.json`);
          showToast(`Exported ${rows.length} rows to JSON.`, 'success');
        }
      } catch (err) {
        console.error('Export error:', err);
        showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    });
  });

  // Watch chart type, column mapping, custom colors, and execution status changes to refresh visual reactively
  const watcherVisual = watchReactive(
    () => [
      cell.chartType,
      cell.chartConfig['columnMapping'],
      cell.chartConfig['customColors'],
      cell.chartConfig['colorPalette'],
      cell.executionState.status,
      cell.executionState.status === 'success' ? cell.executionState.executedAt : undefined,
      cell.executionState.status === 'success' ? cell.executionState.executionMs : undefined,
      store.notebook.mode,
      store.notebook.engineStatus,
    ],
    () => {
      if (skipNextWatcherMount) {
        skipNextWatcherMount = false;
        updateTimestamp();
        return;
      }
      const runtime = CellRuntimeRegistry.get(cell.cellId);
      if (runtime?.inPlaceLiveRefresh) {
        runtime.inPlaceLiveRefresh = false;
        updateTimestamp();
        return;
      }
      const thresholdsWrapper = container.querySelector(`#thresholds-wrapper-${cell.cellId}`) as HTMLElement | null;
      const thresholdChips = container.querySelector(`#threshold-chips-${cell.cellId}`) as HTMLElement | null;
      const odWrapper = container.querySelector(`#od-controls-wrapper-${cell.cellId}`) as HTMLElement | null;
      const odChips = container.querySelector(`#od-chips-${cell.cellId}`) as HTMLElement | null;
      const scaleWrapper = container.querySelector(`#scale-wrapper-${cell.cellId}`) as HTMLElement | null;
      const colorsWrapper = container.querySelector(`#colors-wrapper-${cell.cellId}`) as HTMLElement | null;
      const isHorizon = cell.chartType === 'headway-horizon';
      const isOd = cell.chartType === 'od-ridership-flow';
      if (thresholdsWrapper) thresholdsWrapper.style.display = isHorizon ? 'inline-block' : 'none';
      if (thresholdChips) thresholdChips.style.display = isHorizon ? 'flex' : 'none';
      if (odWrapper) odWrapper.style.display = isOd ? 'inline-block' : 'none';
      if (odChips) odChips.style.display = isOd ? 'flex' : 'none';
      if (scaleWrapper) scaleWrapper.style.display = supportsScaleToggle(cell.chartType) ? 'inline-flex' : 'none';
      if (colorsWrapper) colorsWrapper.style.display = cell.chartType !== 'table' ? 'inline-block' : 'none';
      mountVisual();
      if (isOd) {
        populateOdStationsList();
      }
      populateSchemaRemapMenu();
      populateColorsMenu();
      updateTimestamp();
    }
  );
  const unwatchVisual = watcherVisual[1];

  return () => {
    unwatchVisual();
    cleanupVisual();
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', closeMenuHandler);
      document.removeEventListener('keydown', escapeKeyHandler);
    }
    container.innerHTML = '';
  };
}

export function formatQueryDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) {
    return `${Math.max(1, Math.round(ms))}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatFreshness(cell: ReactiveCellState): string {
  if (
    cell.executionState.status === 'booting' ||
    (cell.executionState.status === 'running' && store.notebook.engineStatus === 'booting')
  ) {
    return 'Spinning up DuckDB-Wasm engine...';
  }
  if (cell.executionState.status === 'running') {
    return 'Running SQL query in DuckDB-Wasm...';
  }

  const durationPart =
    cell.executionState.status === 'success' && typeof cell.executionState.executionMs === 'number'
      ? ` · ${formatQueryDuration(cell.executionState.executionMs)}`
      : '';

  if (cell.ducklakeSnapshotId) {
    return `Snapshot: ${cell.ducklakeSnapshotId.slice(0, 12)}${durationPart}`;
  }
  const mode =
    cell.executionState.status === 'success' && cell.executionState.executedMode
      ? cell.executionState.executedMode
      : store.notebook.mode;

  let modeLabel = 'On Demand';
  if (mode === 'offline') {
    modeLabel = 'Offline';
  } else if (mode === 'live') {
    modeLabel = 'Auto Refresh';
  }

  const execTs =
    cell.executionState.status === 'success' && cell.executionState.executedAt > 0
      ? cell.executionState.executedAt
      : Date.now();
  const timeStr = new Date(execTs).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${modeLabel} · Updated ${timeStr} ET${durationPart}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
