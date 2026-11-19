import { store, persistCellToDuckDb, executeCellQuery } from '../state/store.js';
import type { ChartType } from '../types/cell-state.js';
import { OSSIE_FACT_GRAPH, type OssieThemeName } from '../types/straphanger-schema.gen.js';
import {
  compileOssieConfigToSql,
  DBTC_OSSIE_LENS_META,
  DBTC_OSSIE_THEMES,
  getAllowedWindowPresetsForDataset,
  formatOssieConfigAsQueryCall,
} from '../data/ossie-loader.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';
import {
  buildRouteBulletHtml,
  LIRR_ROUTE_BULLET_SWATCHES,
  METRO_NORTH_ROUTE_BULLET_SWATCHES,
  PATH_ROUTE_BULLET_SWATCHES,
} from '../viz/echarts-theme-mta.js';
import { showToast } from './toast.js';

const DBTC_LENS_CHART_TYPE: Record<string, ChartType> = {
  subway_station_headways: 'station-progression',
  train_stringline_marey: 'marey-chart',
  live_subway_fleet: 'train-position-map',
  live_commuter_rail_fleet: 'train-position-map',
  live_bus_fleet: 'train-position-map',
  subway_headway_horizon: 'headway-horizon',
  multimodal_station_pulse: 'multimodal-pulse',
  od_ridership_flows: 'od-ridership-flow',
  route_segment_speeds: 'route-segment-map',
  station_isochrones: 'isochrone-map',
  schedule_adherence_hourly: 'adherence-waterfall',
  station_turnstile_ranking: 'bar',
  hourly_turnstile_profile: 'line',
  fleet_route_share: 'donut',
};

const COMMON_SUBWAY_ROUTES = [
  '1', '2', '3', '4', '5', '6', '7', '7X',
  'A', 'C', 'E', 'B', 'D', 'F', 'M',
  'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W', 'S',
] as const;

const COMMON_BUS_ROUTES = [
  'M60-SBS', 'M15-SBS', 'M14A-SBS', 'M14D-SBS', 'M23-SBS', 'M34-SBS', 'M79-SBS', 'M86-SBS',
  'B44-SBS', 'B46-SBS', 'B82-SBS', 'Q44-SBS', 'Q52-SBS', 'Q53-SBS', 'Q70-SBS',
  'Bx12-SBS', 'Bx41-SBS', 'S79-SBS', 'M1', 'M4', 'M5', 'B63', 'Q10',
] as const;

const OSSIE_AGENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'MTA_NYCT_SUBWAY', label: 'Subway (NYCT)' },
  { value: 'MTA_NYCT_SIR', label: 'Staten Island Railway' },
  { value: 'MTA_BUS', label: 'NYC Bus' },
  { value: 'MTA_LIRR', label: 'LIRR' },
  { value: 'MTA_METRO_NORTH', label: 'Metro-North' },
  { value: 'PORT_AUTHORITY_PATH', label: 'PATH' },
  { value: 'ALL', label: 'All Agencies' },
];

function getRoutesForAgency(agency: string): Array<{ route: string; agencyId: string; color?: string | null }> {
  switch (agency) {
    case 'MTA_BUS':
      return COMMON_BUS_ROUTES.map(route => ({ route, agencyId: 'MTA_BUS' }));
    case 'MTA_NYCT_SIR':
      return [{ route: 'SI', agencyId: 'MTA_NYCT_SIR' }];
    case 'MTA_LIRR': {
      if (LIRR_ROUTE_BULLET_SWATCHES.length > 0) {
        return LIRR_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'MTA_LIRR',
          color: s.colorHex,
        }));
      }
      return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map(route => ({
        route,
        agencyId: 'MTA_LIRR',
      }));
    }
    case 'MTA_METRO_NORTH': {
      if (METRO_NORTH_ROUTE_BULLET_SWATCHES.length > 0) {
        return METRO_NORTH_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'MTA_METRO_NORTH',
          color: s.colorHex,
        }));
      }
      return ['1', '2', '3'].map(route => ({ route, agencyId: 'MTA_METRO_NORTH' }));
    }
    case 'PORT_AUTHORITY_PATH': {
      if (PATH_ROUTE_BULLET_SWATCHES.length > 0) {
        return PATH_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'PORT_AUTHORITY_PATH',
          color: s.colorHex,
        }));
      }
      return ['JSQ-33', 'HOB-33', 'NWK-WTC', 'HOB-WTC'].map(route => ({
        route,
        agencyId: 'PORT_AUTHORITY_PATH',
      }));
    }
    case 'ALL':
      return [
        ...COMMON_SUBWAY_ROUTES.map(route => ({ route, agencyId: 'MTA_NYCT_SUBWAY' })),
        { route: 'SI', agencyId: 'MTA_NYCT_SIR' },
        ...COMMON_BUS_ROUTES.slice(0, 8).map(route => ({ route, agencyId: 'MTA_BUS' })),
        ...LIRR_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'MTA_LIRR',
          color: s.colorHex,
        })),
        ...METRO_NORTH_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'MTA_METRO_NORTH',
          color: s.colorHex,
        })),
        ...PATH_ROUTE_BULLET_SWATCHES.map(s => ({
          route: s.bulletRoute,
          agencyId: 'PORT_AUTHORITY_PATH',
          color: s.colorHex,
        })),
      ];
    case 'MTA_NYCT_SUBWAY':
    default:
      return COMMON_SUBWAY_ROUTES.map(route => ({ route, agencyId: 'MTA_NYCT_SUBWAY' }));
  }
}

export function renderOssiePillBar(container: HTMLElement, targetCellId?: string | null): void {
  const cellId = targetCellId ?? store.notebook.activeCellId;
  const activeCell = store.cells.find(c => c.cellId === cellId);
  if (!activeCell || activeCell.kind !== 'question') {
    container.innerHTML = '';
    return;
  }

  // DBTC only renders the unified 'dbtc' Ossie spec
  const currentTheme: OssieThemeName = 'dbtc';
  const themeGraph = (OSSIE_FACT_GRAPH as Record<string, any>)[currentTheme];
  const factDatasets = themeGraph ? (themeGraph.factDatasets as readonly string[]) : [];
  const lensNames = new Set(DBTC_OSSIE_LENS_META.map(l => l.name));
  const lensDatasets = DBTC_OSSIE_LENS_META.map(l => l.name).filter(n => factDatasets.includes(n) || DBTC_OSSIE_THEMES[0]?.datasets.some(d => d.name === n));
  const rawFactDatasets = factDatasets.filter(f => !lensNames.has(f));

  const rawFact = activeCell.ossieConfig?.factDataset;
  const currentFact: string =
    rawFact && (lensDatasets.includes(rawFact) || factDatasets.includes(rawFact))
      ? rawFact
      : (lensDatasets[0] ?? factDatasets[0] ?? '');

  const currentLensMeta = DBTC_OSSIE_LENS_META.find(l => l.name === currentFact);
  const activeDatasetInfo = themeGraph?.datasets ? (themeGraph.datasets as Record<string, { reachableDatasets: readonly string[]; dimensions: readonly string[]; metrics: readonly string[] }>)[currentFact] : undefined;
  const reachableDims = new Set(activeDatasetInfo?.dimensions ?? []);
  const reachableMetrics = new Set(activeDatasetInfo?.metrics ?? []);

  const themeObj = DBTC_OSSIE_THEMES[0];
  const allThemeDims = Array.from(new Set(themeObj?.datasets.flatMap(d => d.fields.map(c => `${d.name}.${c.name}`)) ?? []));
  const allThemeMetrics = themeObj?.metrics.map(m => m.name) ?? [];
  const metricMetaByName = new Map(
    (themeObj?.metrics ?? []).map(m => [m.name, m as { name: string; description?: string; expression?: string }])
  );

  const selectedDims = new Set(activeCell.ossieConfig?.selectedDimensions ?? []);
  const selectedMetrics = new Set(activeCell.ossieConfig?.selectedMetrics ?? []);

  const currentFilters = activeCell.ossieConfig?.filters ?? [];
  const windowFilter = currentFilters.find(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').toLowerCase();
    return fn === 'window' || fn.endsWith('.window');
  });
  const currentWindow = windowFilter ? String(windowFilter.value ?? '') : (currentLensMeta?.defaultWindow ?? 'yesterday_am_rush');

  const agencyFilter = currentFilters.find(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').split('.').pop();
    return fn === 'agency_id';
  });
  const currentAgency = agencyFilter
    ? Array.isArray((agencyFilter as any).value)
      ? String((agencyFilter as any).value[0] ?? 'ALL')
      : String((agencyFilter as any).value ?? 'ALL')
    : (currentLensMeta?.defaultAgency ?? 'MTA_NYCT_SUBWAY');

  const routeFilter = currentFilters.find(f => {
    const fn = ((f as any).dimension ?? (f as any).field ?? '').split('.').pop();
    return fn === 'route_id';
  });
  const selectedRoutes = new Set<string>(
    routeFilter
      ? Array.isArray((routeFilter as any).value)
        ? ((routeFilter as any).value as unknown[]).map(String)
        : [String((routeFilter as any).value ?? '')]
      : (currentLensMeta?.defaultRoutes ?? [])
  );

  const agencyRouteItems = getRoutesForAgency(currentAgency);
  const knownRouteKeys = new Set(agencyRouteItems.map(i => i.route));
  for (const r of selectedRoutes) {
    if (r && !knownRouteKeys.has(r)) {
      agencyRouteItems.push({
        route: r,
        agencyId: currentAgency === 'ALL' ? 'MTA_NYCT_SUBWAY' : currentAgency,
      });
    }
  }
  const currentLimit = activeCell.ossieConfig?.limit ?? currentLensMeta?.defaultLimit ?? 0;

  const reachableDimsList = allThemeDims.filter(d => reachableDims.has(d));
  const unreachableDimsList = allThemeDims.filter(d => !reachableDims.has(d));
  const sortedDims = [...reachableDimsList, ...unreachableDimsList.slice(0, Math.max(0, 36 - reachableDimsList.length))];

  container.innerHTML = `
    <div class="ossie-pill-bar">
      <div class="ossie-bar-header">
        <div>
          <span class="ossie-label">SEMANTIC METRIC BUILDER (dbtc.ossie.yaml)</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 2px;">
            ${currentLensMeta
              ? `Lens mode: <strong>${currentLensMeta.label}</strong> — select agency, routes, and time window, then click Run Visual.`
              : 'Raw fact mode: select at least one reachable metric and optional dimensions, then click Run Visual or Show SQL.'}
          </div>
        </div>
        <div class="ossie-selectors">
          <label>View / Lens:
            <select id="ossie-fact-select" class="dbtc-select-sm">
              <optgroup label="Chart-Ready Lenses (No SQL)">
                ${lensDatasets.map(f => {
                  const meta = DBTC_OSSIE_LENS_META.find(l => l.name === f);
                  return `<option value="${f}" ${f === currentFact ? 'selected' : ''}>${meta?.label ?? f}</option>`;
                }).join('')}
              </optgroup>
              <optgroup label="Raw Fact Tables (Advanced)">
                ${rawFactDatasets.map(f => `<option value="${f}" ${f === currentFact ? 'selected' : ''}>${f}</option>`).join('')}
              </optgroup>
            </select>
          </label>
          <label>Agency / Mode:
            <select id="ossie-agency-select" class="dbtc-select-sm">
              ${OSSIE_AGENCY_OPTIONS.map(opt => `<option value="${opt.value}" ${opt.value === currentAgency ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
          </label>
          <label>Time Window:
            <select id="ossie-window-select" class="dbtc-select-sm">
              ${(() => {
                const allowedPresets = getAllowedWindowPresetsForDataset(currentFact);
                const hasCurrent = allowedPresets.some(([k]) => k === currentWindow);
                const effectiveWindow = hasCurrent ? currentWindow : (allowedPresets[0]?.[0] ?? currentWindow);
                return allowedPresets
                  .map(([key, info]) => `<option value="${key}" ${key === effectiveWindow ? 'selected' : ''}>${info.label}</option>`)
                  .join('');
              })()}
            </select>
          </label>
          <label>Limit:
            <select id="ossie-limit-select" class="dbtc-select-sm">
              <option value="0" ${!currentLimit ? 'selected' : ''}>All</option>
              <option value="10" ${currentLimit === 10 ? 'selected' : ''}>Top 10</option>
              <option value="25" ${currentLimit === 25 ? 'selected' : ''}>Top 25</option>
              <option value="50" ${currentLimit === 50 ? 'selected' : ''}>Top 50</option>
            </select>
          </label>
          <button id="ossie-run-btn" class="dbtc-btn btn-sm btn-primary" title="Run visual directly without opening SQL">
            Run Visual
          </button>
          <button id="ossie-compile-btn" class="dbtc-btn btn-sm" title="Compile selected lens/metrics into SQL and open editor">
            Show SQL
          </button>
        </div>
      </div>

      <div class="ossie-pills-row">
        <div class="pills-group-label">Routes:</div>
        <div class="pills-list">
          ${agencyRouteItems.map(item => {
            const isSelected = selectedRoutes.has(item.route);
            const bulletHtml = buildRouteBulletHtml(item.route, item.agencyId, item.color ?? null, 18);
            return `<button type="button" class="ossie-pill ${isSelected ? 'pill-selected' : 'pill-reachable'}" data-route="${item.route}" title="Filter route ${item.route}" style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px;">${bulletHtml}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="ossie-pills-row">
        <div class="pills-group-label">Metrics:</div>
        <div class="pills-list">
          ${allThemeMetrics
            .map(m => {
              const isReachable = reachableMetrics.has(m);
              const isSelected = selectedMetrics.has(m);
              const cls = isSelected ? 'pill-selected' : isReachable ? 'pill-reachable' : 'pill-disabled';
              const meta = metricMetaByName.get(m);
              const detailParts = [meta?.description, meta?.expression ? `Expr: ${meta.expression}` : ''].filter(Boolean);
              const title = isReachable
                ? (detailParts.length > 0 ? `${m} — ${detailParts.join(' | ')}` : m)
                : `Metric not reachable from '${currentFact}'`;
              const safeTitle = title.replace(/"/g, '&quot;');
              return `<button type="button" class="ossie-pill ${cls}" data-metric="${m}" title="${safeTitle}" ${!isReachable ? 'disabled' : ''}>${m}</button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="ossie-pills-row">
        <div class="pills-group-label">Dimensions:</div>
        <div class="pills-list">
          ${sortedDims
            .map(d => {
              const isReachable = reachableDims.has(d);
              const isSelected = selectedDims.has(d);
              const cls = isSelected ? 'pill-selected' : isReachable ? 'pill-reachable' : 'pill-disabled';
              const title = isReachable ? d : `Dimension not reachable from '${currentFact}'`;
              return `<button class="ossie-pill ${cls}" data-dimension="${d}" title="${title}" ${!isReachable ? 'disabled' : ''}>${d}</button>`;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
  const factSelect = container.querySelector('#ossie-fact-select') as HTMLSelectElement | null;
  const agencySelect = container.querySelector('#ossie-agency-select') as HTMLSelectElement | null;
  const windowSelect = container.querySelector('#ossie-window-select') as HTMLSelectElement | null;
  const limitSelect = container.querySelector('#ossie-limit-select') as HTMLSelectElement | null;
  const runBtn = container.querySelector('#ossie-run-btn') as HTMLButtonElement | null;
  const compileBtn = container.querySelector('#ossie-compile-btn') as HTMLButtonElement | null;

  const getSeededFilters = (): any[] => {
    if (activeCell.ossieConfig?.filters && activeCell.ossieConfig.filters.length > 0) {
      return [...activeCell.ossieConfig.filters];
    }
    const seeded: any[] = [];
    if (currentWindow) seeded.push({ field: 'window', operator: '=', value: currentWindow });
    if (currentAgency && currentAgency !== 'ALL') {
      seeded.push({ field: `${currentFact}.agency_id`, operator: '=', value: currentAgency });
    }
    if (selectedRoutes.size > 0) {
      seeded.push({ field: `${currentFact}.route_id`, operator: 'IN', value: Array.from(selectedRoutes) });
    }
    return seeded;
  };

  const updateFilters = async (mutate: (filters: any[]) => any[], nextLimit?: number) => {
    const existing = getSeededFilters();
    const nextFilters = mutate(existing);
    const resolvedLimit = nextLimit !== undefined ? nextLimit : (activeCell.ossieConfig?.limit ?? currentLimit);
    activeCell.ossieConfig = {
      theme: currentTheme,
      factDataset: currentFact as any,
      selectedMetrics: activeCell.ossieConfig?.selectedMetrics ?? [],
      selectedDimensions: activeCell.ossieConfig?.selectedDimensions ?? [],
      filters: nextFilters,
      ...(resolvedLimit && resolvedLimit > 0 ? { limit: resolvedLimit } : {}),
    };
    const conn = getDuckDbConnection();
    if (conn) {
      await persistCellToDuckDb(conn, activeCell);
    }
    renderOssiePillBar(container, cellId);
  };

  factSelect?.addEventListener('change', async e => {
    const newFact = (e.target as HTMLSelectElement).value;
    const meta = DBTC_OSSIE_LENS_META.find(l => l.name === newFact);
    const defaultFilters: any[] = [];
    if (meta?.defaultWindow) {
      defaultFilters.push({ field: 'window', operator: '=', value: meta.defaultWindow });
    }
    if (meta?.defaultAgency) {
      defaultFilters.push({ field: `${newFact}.agency_id`, operator: '=', value: meta.defaultAgency });
    }
    if (meta?.defaultRoutes && meta.defaultRoutes.length > 0) {
      defaultFilters.push({ field: `${newFact}.route_id`, operator: 'IN', value: [...meta.defaultRoutes] });
    }
    activeCell.ossieConfig = {
      theme: currentTheme,
      factDataset: newFact as any,
      selectedMetrics: [],
      selectedDimensions: [],
      filters: defaultFilters,
      ...(meta?.defaultLimit ? { limit: meta.defaultLimit } : {}),
    };
    const isLens = Boolean(meta);
    if (isLens) {
      activeCell.sqlText = formatOssieConfigAsQueryCall(activeCell.ossieConfig);
      const nextChartType = DBTC_LENS_CHART_TYPE[newFact];
      if (nextChartType) {
        activeCell.chartType = nextChartType;
      }
    }
    const conn = getDuckDbConnection();
    if (conn) {
      await persistCellToDuckDb(conn, activeCell);
    }
    renderOssiePillBar(container, cellId);
    if (isLens) {
      if (conn) {
        await executeCellQuery(conn, activeCell.cellId);
      }
      window.dispatchEvent(new CustomEvent('dbtc:cell-updated', { detail: { cellId: activeCell.cellId } }));
    }
  });

  agencySelect?.addEventListener('change', async e => {
    const nextAgency = (e.target as HTMLSelectElement).value;
    await updateFilters(filters => {
      const rest = filters.filter(f => {
        const fn = ((f as any).dimension ?? (f as any).field ?? '').split('.').pop();
        return fn !== 'agency_id' && fn !== 'route_id';
      });
      if (nextAgency === 'ALL') {
        return rest;
      }
      return [...rest, { field: `${currentFact}.agency_id`, operator: '=', value: nextAgency }];
    });
    if (currentLensMeta) {
      activeCell.sqlText = formatOssieConfigAsQueryCall(activeCell.ossieConfig!);
      const conn = getDuckDbConnection();
      if (conn) {
        await persistCellToDuckDb(conn, activeCell);
        await executeCellQuery(conn, activeCell.cellId);
      }
      window.dispatchEvent(new CustomEvent('dbtc:cell-updated', { detail: { cellId: activeCell.cellId } }));
    }
  });

  windowSelect?.addEventListener('change', async e => {
    const winVal = (e.target as HTMLSelectElement).value;
    await updateFilters(filters => {
      const rest = filters.filter(f => {
        const fn = ((f as any).dimension ?? (f as any).field ?? '').toLowerCase();
        return fn !== 'window' && !fn.endsWith('.window');
      });
      return [...rest, { field: 'window', operator: '=', value: winVal }];
    });
  });

  limitSelect?.addEventListener('change', async e => {
    const lim = parseInt((e.target as HTMLSelectElement).value, 10) || 0;
    await updateFilters(filters => filters, lim);
  });

  container.querySelectorAll('.ossie-pill[data-route]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const route = btn.getAttribute('data-route');
      if (!route) return;
      const nextRoutes = new Set(selectedRoutes);
      if (nextRoutes.has(route)) nextRoutes.delete(route);
      else nextRoutes.add(route);
      await updateFilters(filters => {
        const rest = filters.filter(f => ((f as any).dimension ?? (f as any).field ?? '').split('.').pop() !== 'route_id');
        if (nextRoutes.size === 0) return rest;
        return [...rest, { field: `${currentFact}.route_id`, operator: 'IN', value: Array.from(nextRoutes) }];
      });
    });
  });

  container.querySelectorAll('.ossie-pill[data-metric]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const metric = btn.getAttribute('data-metric');
      if (!metric || !activeCell) return;
      const currentList = activeCell.ossieConfig?.selectedMetrics ?? [];
      const updated = currentList.includes(metric as any)
        ? currentList.filter(m => m !== metric)
        : [...currentList, metric as any];
      const resolvedLimit = activeCell.ossieConfig?.limit ?? currentLimit;

      activeCell.ossieConfig = {
        theme: currentTheme,
        factDataset: currentFact as any,
        selectedMetrics: updated,
        selectedDimensions: activeCell.ossieConfig?.selectedDimensions ?? [],
        filters: getSeededFilters(),
        ...(resolvedLimit && resolvedLimit > 0 ? { limit: resolvedLimit } : {}),
      };
      const conn = getDuckDbConnection();
      if (conn) {
        await persistCellToDuckDb(conn, activeCell);
      }
      renderOssiePillBar(container, cellId);
    });
  });

  container.querySelectorAll('.ossie-pill[data-dimension]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dim = btn.getAttribute('data-dimension');
      if (!dim || !activeCell) return;
      const currentList = activeCell.ossieConfig?.selectedDimensions ?? [];
      const updated = currentList.includes(dim as any)
        ? currentList.filter(d => d !== dim)
        : [...currentList, dim as any];
      const resolvedLimit = activeCell.ossieConfig?.limit ?? currentLimit;

      activeCell.ossieConfig = {
        theme: currentTheme,
        factDataset: currentFact as any,
        selectedMetrics: activeCell.ossieConfig?.selectedMetrics ?? [],
        selectedDimensions: updated,
        filters: getSeededFilters(),
        ...(resolvedLimit && resolvedLimit > 0 ? { limit: resolvedLimit } : {}),
      };
      const conn = getDuckDbConnection();
      if (conn) {
        await persistCellToDuckDb(conn, activeCell);
      }
      renderOssiePillBar(container, cellId);
    });
  });

  const runCompiled = async (openSqlEditor: boolean, triggerBtn: HTMLButtonElement | null) => {
    const isLens = DBTC_OSSIE_LENS_META.some(l => l.name === currentFact);
    const currentConfig = activeCell.ossieConfig ?? {
      theme: currentTheme,
      factDataset: currentFact as any,
      selectedMetrics: [],
      selectedDimensions: [],
      filters: getSeededFilters(),
      ...(currentLimit > 0 ? { limit: currentLimit } : {}),
    };

    const validMetrics = currentConfig.selectedMetrics.filter(m => reachableMetrics.has(m));
    const validDimensions = currentConfig.selectedDimensions.filter(d => reachableDims.has(d));

    if (!isLens && validMetrics.length === 0) {
      showToast('Please select at least one reachable metric to compile.', 'warning');
      return;
    }

    const sanitizedConfig = {
      ...currentConfig,
      selectedMetrics: validMetrics,
      selectedDimensions: validDimensions,
    };
    activeCell.ossieConfig = sanitizedConfig;

    const origText = triggerBtn?.textContent ?? null;
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Running...';
    }

    try {
      // Validate compilability first, then write the concise ossie_query(...) call to the cell.
      compileOssieConfigToSql(sanitizedConfig);
      activeCell.sqlText = formatOssieConfigAsQueryCall(sanitizedConfig);
      if (openSqlEditor) {
        activeCell.showSqlEditor = true;
        activeCell.showOssiePillBar = false;
      } else {
        activeCell.showSqlEditor = false;
      }
      const conn = getDuckDbConnection();
      if (conn) {
        await persistCellToDuckDb(conn, activeCell);
        await executeCellQuery(conn, activeCell.cellId);
      }
      if (triggerBtn) {
        triggerBtn.textContent = '✓ Updated!';
        triggerBtn.style.backgroundColor = '#16a34a';
        triggerBtn.style.borderColor = '#15803d';
        setTimeout(() => {
          if (triggerBtn) {
            triggerBtn.textContent = origText;
            triggerBtn.style.backgroundColor = '';
            triggerBtn.style.borderColor = '';
          }
        }, 1600);
      }
      window.dispatchEvent(new CustomEvent('dbtc:cell-updated', { detail: { cellId: activeCell.cellId } }));
    } catch (err) {
      console.error('Error compiling Ossie config to SQL:', err);
      showToast(`Error compiling Ossie config: ${err instanceof Error ? err.message : String(err)}`, 'error');
      if (triggerBtn) {
        triggerBtn.textContent = origText;
      }
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
      }
    }
  };

  runBtn?.addEventListener('click', () => runCompiled(false, runBtn));
  compileBtn?.addEventListener('click', () => runCompiled(true, compileBtn));
}
