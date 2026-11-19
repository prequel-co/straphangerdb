import * as echarts from 'echarts';
import type { BaseChartConfig, ChartType } from '../types/cell-state.js';
import { buildMareyChartOption } from './transit/marey-chart.js';
import { buildStationProgressionOption } from './transit/station-progression.js';
import { buildHeadwayHorizonOption } from './transit/headway-horizon.js';
import { buildAdherenceWaterfallOption } from './transit/adherence-waterfall.js';
import { buildMultimodalPulseOption } from './transit/multimodal-pulse.js';
import { buildOdRidershipFlowOption } from './transit/od-ridership-flow.js';
import { renderRouteSegmentMap } from './transit/route-segment-map.js';
import { renderIsochroneMap } from './transit/isochrone-map.js';
import { renderTrainPositions } from './transit/train-position-map.js';
import { DbtcMapController } from './map/maplibre-controller.js';
import {
  DEFAULT_MAP_NETWORK_TABLE_CONFIG,
  MAP_NETWORK_TABLE_PRESETS,
  MAP_TABLE_SCHEMA_CONTRACTS,
  MAP_VISUAL_THEMES,
  validateMapTableSchema,
  listDuckDbMapCandidateTables,
  bootstrapMapNetworkFromDuckDb,
  getActiveMapNetworkData,
  setActiveMapNetworkData,
  setMapInstanceNetworkData,
  setMapInstanceVisualTheme,
  setActiveMapVisualTheme,
  type MapNetworkTableConfig,
  type MapVisualThemeId,
} from './map/mta-subway-overlay.js';
import { buildStandardBiOption, renderKpiHtml, renderTableHtml } from './standard-bi.js';
import {
  applyChartColorOverrides,
  formatRouteBadge,
  resolveCustomColorForKey,
} from './echarts-theme-mta.js';

import { store, CellRuntimeRegistry, persistCellToDuckDb, executeCellQuery, expandCellSql } from '../state/store.js';
import { asCellId } from '../types/brands.js';
import { applyChartColumnMapping } from '../types/schema-contracts.js';
import {
  getDuckDbConnection,
  refreshRemoteCatalog,
  ensureFastDimensionCaches,
  prepareExecutableCellSql,
} from '../data/duckdb-client.js';
import { normalizeArrowTable } from '../data/arrow-normalizer.js';

export function buildMapTableCustomizationModalHtml(
  initialTables: MapNetworkTableConfig,
  selectedPresetId = 'current',
  selectedTheme: MapVisualThemeId = initialTables.theme ?? 'mta'
): string {
  const routesReq = MAP_TABLE_SCHEMA_CONTRACTS.routes.requiredColumns.join(', ');
  const routesDesc = MAP_TABLE_SCHEMA_CONTRACTS.routes.description;
  const tracksReq = MAP_TABLE_SCHEMA_CONTRACTS.tracks.requiredColumns.join(', ');
  const tracksDesc = MAP_TABLE_SCHEMA_CONTRACTS.tracks.description;
  const stationsReq = MAP_TABLE_SCHEMA_CONTRACTS.stations.requiredColumns.join(', ');
  const stationsDesc = MAP_TABLE_SCHEMA_CONTRACTS.stations.description;

  return `
    <div class="dbtc-map-tables-modal-card" role="dialog" aria-label="Customize Map DuckDB Tables">
      <div class="dbtc-map-tables-modal-header">
        <div>
          <div class="dbtc-map-tables-modal-title">Customize Map Network Tables &amp; Theme (StraphangerDB)</div>
          <div class="dbtc-map-tables-modal-subtitle">
            Select a combined network era and visual theme preset, or bootstrap routes, track geometry, and station placement from any StraphangerDB or DuckDB table/view.
          </div>
        </div>
        <button type="button" class="dbtc-btn btn-xs btn-secondary map-tables-modal-close-btn" title="Close modal">✕</button>
      </div>

      <div class="dbtc-map-tables-modal-body">
        <div class="dbtc-map-tables-field">
          <label class="dbtc-map-tables-label">Map Preset &amp; Network Era</label>
          <select class="dbtc-select-sm map-tables-preset-select">
            ${MAP_NETWORK_TABLE_PRESETS.map(
              p =>
                `<option value="${p.id}" ${p.id === selectedPresetId ? 'selected' : ''}>${p.label}</option>`
            ).join('')}
            <option value="custom" ${selectedPresetId === 'custom' ? 'selected' : ''}>Custom StraphangerDB / DuckDB Tables...</option>
          </select>
          <div class="dbtc-map-tables-preset-desc">
            ${MAP_NETWORK_TABLE_PRESETS.find(p => p.id === selectedPresetId)?.description ?? 'Select custom StraphangerDB or DuckDB tables/views matching the required schema contracts below.'}
          </div>
        </div>

        <div class="dbtc-map-tables-field">
          <label class="dbtc-map-tables-label">Map Visual Theme</label>
          <select class="dbtc-select-sm map-tables-theme-select">
            ${MAP_VISUAL_THEMES.map(
              t =>
                `<option value="${t.id}" ${t.id === selectedTheme ? 'selected' : ''}>${t.label}</option>`
            ).join('')}
          </select>
          <div class="dbtc-map-tables-schema-hint map-tables-theme-desc">
            ${MAP_VISUAL_THEMES.find(t => t.id === selectedTheme)?.description ?? ''}
          </div>
        </div>

        <datalist class="map-tables-candidates-datalist" id="dbtc-map-tables-datalist"></datalist>

        <div class="dbtc-map-tables-field">
          <div class="dbtc-map-tables-label-row">
            <label class="dbtc-map-tables-label">1. Routes Table / View</label>
            <span class="dbtc-map-tables-status" data-role-status="routes"></span>
          </div>
          <input type="text" class="dbtc-input-sm map-tables-input" data-role-input="routes" list="dbtc-map-tables-datalist" value="${initialTables.routesTable}" placeholder="prod.transit_v2.view_dim_routes" />
          <div class="dbtc-map-tables-schema-hint">
            <strong>Required schema:</strong> <code>${routesReq}</code> &middot; <span>${routesDesc}</span>
          </div>
        </div>

        <div class="dbtc-map-tables-field">
          <div class="dbtc-map-tables-label-row">
            <label class="dbtc-map-tables-label">2. Track Geometry Table / View</label>
            <span class="dbtc-map-tables-status" data-role-status="tracks"></span>
          </div>
          <input type="text" class="dbtc-input-sm map-tables-input" data-role-input="tracks" list="dbtc-map-tables-datalist" value="${initialTables.tracksTable}" placeholder="prod.transit_v2.view_dim_service_lines" />
          <div class="dbtc-map-tables-schema-hint">
            <strong>Required schema:</strong> <code>${tracksReq}</code> &middot; <span>${tracksDesc}</span>
          </div>
        </div>

        <div class="dbtc-map-tables-field">
          <div class="dbtc-map-tables-label-row">
            <label class="dbtc-map-tables-label">3. Station Placement Table / View</label>
            <span class="dbtc-map-tables-status" data-role-status="stations"></span>
          </div>
          <input type="text" class="dbtc-input-sm map-tables-input" data-role-input="stations" list="dbtc-map-tables-datalist" value="${initialTables.stationsTable}" placeholder="prod.transit_v2.view_dim_stations" />
          <div class="dbtc-map-tables-schema-hint">
            <strong>Required schema:</strong> <code>${stationsReq}</code> &middot; <span>${stationsDesc}</span>
          </div>
        </div>

        <div class="dbtc-map-tables-banner" style="display: none;"></div>
      </div>

      <div class="dbtc-map-tables-modal-footer">
        <button type="button" class="dbtc-btn btn-xs btn-secondary map-tables-reset-btn">Reset to Default</button>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button type="button" class="dbtc-btn btn-xs btn-secondary map-tables-validate-btn">Validate Schema</button>
          <button type="button" class="dbtc-btn btn-xs btn-primary map-tables-apply-btn">Apply &amp; Bootstrap Map</button>
        </div>
      </div>
    </div>
  `;
}

export function enrichRowsWithCustomColors(
  rows: readonly Record<string, unknown>[],
  config?: BaseChartConfig
): readonly Record<string, unknown>[] {
  const customColors =
    config?.customColors && typeof config.customColors === 'object'
      ? (config.customColors as Readonly<Record<string, string>>)
      : undefined;
  if (!customColors || Object.keys(customColors).length === 0 || rows.length === 0) {
    return rows;
  }
  return rows.map(r => {
    const rId = String(r['route_id'] ?? r['routeId'] ?? r['route_short_name'] ?? '');
    if (!rId) return r;
    const agencyId = String(r['agency_id'] ?? r['agencyId'] ?? 'MTA_NYCT_SUBWAY');
    const badge = formatRouteBadge(rId, agencyId).displayLabel;
    const customColor =
      resolveCustomColorForKey(rId, customColors) ??
      resolveCustomColorForKey(badge, customColors) ??
      resolveCustomColorForKey(`Line ${rId}`, customColors) ??
      resolveCustomColorForKey(`${rId} Train`, customColors);
    if (!customColor) return r;
    return {
      ...r,
      color_hex: customColor,
      colorHex: customColor,
      route_color_hex: customColor,
    };
  });
}

export function renderCellVisual(
  container: HTMLElement,
  chartType: ChartType,
  rawRows: readonly Record<string, unknown>[],
  rawConfig: BaseChartConfig = {},
  cellId?: string
): () => void {
  // Clean up any existing elements
  container.innerHTML = '';

  const availableColumns = cellId
    ? (CellRuntimeRegistry.get(asCellId(cellId))?.normalized?.columns ?? [])
    : [];
  const { mappedRows, effectiveConfig } = applyChartColumnMapping(
    chartType,
    rawRows,
    availableColumns,
    rawConfig
  );
  const config = effectiveConfig as BaseChartConfig;
  const rows = enrichRowsWithCustomColors(mappedRows, config);

  if (chartType === 'table') {
    container.innerHTML = renderTableHtml(rows);
    return () => {
      container.innerHTML = '';
    };
  }

  if (chartType === 'kpi-metric') {
    container.innerHTML = renderKpiHtml(rows, config);
    return () => {
      container.innerHTML = '';
    };
  }

  // Handle MapLibre Maps
  if (
    chartType === 'route-segment-map' ||
    chartType === 'isochrone-map' ||
    chartType === 'train-position-map'
  ) {
    const mapWrapper = document.createElement('div');
    mapWrapper.className = 'dbtc-map-wrapper';
    mapWrapper.style.position = 'relative';
    mapWrapper.style.width = '100%';
    mapWrapper.style.height = '100%';
    mapWrapper.style.minHeight = '360px';
    container.appendChild(mapWrapper);

    const mapDiv = document.createElement('div');
    mapDiv.className = 'dbtc-map-container';
    mapDiv.style.width = '100%';
    mapDiv.style.height = '100%';
    mapWrapper.appendChild(mapDiv);

    const defaultPreset = MAP_NETWORK_TABLE_PRESETS[0]!;
    const rawSavedPresetId = config.mapTables?.presetId ?? 'current';
    const isHistoricalSaved =
      rawSavedPresetId === '1929' ||
      rawSavedPresetId === 'ind-1953' ||
      Boolean(config.mapTables?.tracksTable?.endsWith('_1929')) ||
      Boolean(config.mapTables?.tracksTable?.endsWith('_1953'));
    const rawPresetId = isHistoricalSaved ? 'current' : rawSavedPresetId;
    const matchedPreset = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === rawPresetId);
    const initialPresetId =
      rawPresetId === 'custom' ? 'custom' : (matchedPreset?.id ?? defaultPreset.id);
    const rawTheme = isHistoricalSaved
      ? defaultPreset.theme
      : (config.mapTables?.theme ?? matchedPreset?.theme ?? defaultPreset.theme);
    const initialTheme: MapVisualThemeId =
      MAP_VISUAL_THEMES.find(t => t.id === rawTheme)?.id ?? defaultPreset.theme;
    let currentMapTheme: MapVisualThemeId = initialTheme;

    const activeTableConfig: {
      routesTable: string;
      tracksTable: string;
      stationsTable: string;
      presetId?: string;
      theme?: MapVisualThemeId;
      hideSubwayOverlay?: boolean;
      corridorOverlay?: string;
    } = config.mapTables && !isHistoricalSaved
      ? {
          routesTable: config.mapTables.routesTable,
          tracksTable: config.mapTables.tracksTable,
          stationsTable: config.mapTables.stationsTable,
          presetId: initialPresetId,
          theme: initialTheme,
          ...(config.mapTables.hideSubwayOverlay !== undefined
            ? { hideSubwayOverlay: config.mapTables.hideSubwayOverlay }
            : {}),
          ...(config.mapTables.corridorOverlay
            ? { corridorOverlay: config.mapTables.corridorOverlay }
            : {}),
        }
      : {
          ...defaultPreset.config,
          theme: initialTheme,
          ...(config.mapTables?.hideSubwayOverlay !== undefined
            ? { hideSubwayOverlay: config.mapTables.hideSubwayOverlay }
            : {}),
          ...(config.mapTables?.corridorOverlay
            ? { corridorOverlay: config.mapTables.corridorOverlay }
            : {}),
        };

    // Map control toolbar overlay combining the preset/network-era selector and the theme selector
    const controlsOverlay = document.createElement('div');
    controlsOverlay.className = 'dbtc-map-controls-overlay';
    controlsOverlay.style.position = 'absolute';
    controlsOverlay.style.top = '10px';
    controlsOverlay.style.left = '10px';
    controlsOverlay.style.zIndex = '5';
    controlsOverlay.style.display = 'flex';
    controlsOverlay.style.flexWrap = 'wrap';
    controlsOverlay.style.gap = '6px';
    controlsOverlay.style.alignItems = 'center';
    controlsOverlay.style.background = 'rgba(255, 255, 255, 0.92)';
    controlsOverlay.style.padding = '4px 8px';
    controlsOverlay.style.borderRadius = '6px';
    controlsOverlay.style.border = '1px solid #CBD5E1';
    controlsOverlay.style.boxShadow = '0 2px 6px rgba(15, 23, 42, 0.08)';

    controlsOverlay.innerHTML = `
      <button class="dbtc-btn btn-xs btn-secondary map-tilt-btn" title="Toggle 29 deg Manhattan street grid alignment">
        Tilt 29&deg;
      </button>
      <select class="dbtc-select-sm map-preset-select map-allmaps-select" title="Select Map Network Era Preset (StraphangerDB tables + theme)">
        <optgroup label="StraphangerDB Network Presets">
          ${MAP_NETWORK_TABLE_PRESETS.map(
            p => `<option value="${p.id}" ${p.id === initialPresetId ? 'selected' : ''}>${p.label}</option>`
          ).join('')}
        </optgroup>
        <option value="custom-tables" ${initialPresetId === 'custom' ? 'selected' : ''}>Custom StraphangerDB Tables...</option>
      </select>
      <label class="dbtc-map-theme-label" style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #334155;">
        <span>Theme:</span>
        <select class="dbtc-select-sm map-theme-select" title="Select Map Visual Theme (MTA, Tauranac / Hertz, IND, Geographic Light, Geographic Dark)">
          ${MAP_VISUAL_THEMES.map(
            t => `<option value="${t.id}" ${t.id === initialTheme ? 'selected' : ''}>${t.label}</option>`
          ).join('')}
        </select>
      </label>
      <div class="map-allmaps-custom-group" style="display: none; align-items: center; gap: 4px;">
        <input type="url" class="dbtc-input-sm map-allmaps-custom-input" placeholder="Paste IIIF annotation URL..." style="width: 200px;" title="Paste IIIF Georeference Annotation URL" />
        <button class="dbtc-btn btn-xs btn-primary map-allmaps-custom-load-btn" title="Load custom IIIF annotation">Load</button>
      </div>
      <button class="dbtc-btn btn-xs btn-secondary map-customize-tables-btn" title="Customize StraphangerDB map routes, track geometry, station tables, and visual theme">
        ⚙ Customize Tables
      </button>
    `;
    mapWrapper.appendChild(controlsOverlay);

    // DuckDB Map Network Table Customization Modal
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'dbtc-map-tables-modal-backdrop';
    modalBackdrop.style.display = 'none';
    modalBackdrop.innerHTML = buildMapTableCustomizationModalHtml(
      activeTableConfig,
      initialPresetId,
      initialTheme
    );
    mapWrapper.appendChild(modalBackdrop);

    const cfgCenter = config['initialCenter'];
    const initialCenter: [number, number] =
      Array.isArray(cfgCenter) &&
      cfgCenter.length === 2 &&
      typeof cfgCenter[0] === 'number' &&
      typeof cfgCenter[1] === 'number'
        ? [cfgCenter[0], cfgCenter[1]]
        : [-73.985, 40.748];
    const initialZoom =
      typeof config['initialZoom'] === 'number' && Number.isFinite(config['initialZoom'])
        ? config['initialZoom']
        : 12;

    const controller = new DbtcMapController(mapDiv);
    const map = controller.initMap(initialCenter, initialZoom, currentMapTheme);
    setMapInstanceVisualTheme(map, currentMapTheme);

    // Wire up map controls
    const tiltBtn = controlsOverlay.querySelector('.map-tilt-btn') as HTMLButtonElement | null;
    tiltBtn?.addEventListener('click', () => {
      controller.toggleManhattanTilt();
    });

    const allmapsSelect = controlsOverlay.querySelector('.map-allmaps-select') as HTMLSelectElement | null;
    const toolbarThemeSelect = controlsOverlay.querySelector('.map-theme-select') as HTMLSelectElement | null;
    const customGroup = controlsOverlay.querySelector('.map-allmaps-custom-group') as HTMLElement | null;
    const customInput = controlsOverlay.querySelector('.map-allmaps-custom-input') as HTMLInputElement | null;
    const customLoadBtn = controlsOverlay.querySelector('.map-allmaps-custom-load-btn') as HTMLButtonElement | null;

    const loadCustomAnnotation = async () => {
      const url = customInput?.value.trim();
      if (!url) return;
      if (customLoadBtn) {
        customLoadBtn.disabled = true;
        customLoadBtn.textContent = 'Loading...';
      }
      if (customInput) {
        customInput.style.borderColor = '';
        customInput.title = 'Paste IIIF Georeference Annotation URL';
      }
      try {
        const ok = await controller.enableAllmapsAnnotation(url);
        if (!ok) {
          if (customInput) {
            customInput.style.borderColor = 'var(--mta-red, #d9381e)';
            customInput.title = 'Failed to load IIIF annotation. Verify URL and CORS headers.';
          }
        } else {
          if (customInput) {
            customInput.style.borderColor = 'var(--mta-green, #00933c)';
          }
        }
      } catch {
        if (customInput) {
          customInput.style.borderColor = 'var(--mta-red, #d9381e)';
          customInput.title = 'Error loading IIIF annotation.';
        }
      } finally {
        if (customLoadBtn) {
          customLoadBtn.disabled = false;
          customLoadBtn.textContent = 'Load';
        }
      }
    };

    customLoadBtn?.addEventListener('click', loadCustomAnnotation);
    customInput?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await loadCustomAnnotation();
      }
    });

    if (cellId) {
      const existing = CellRuntimeRegistry.get(asCellId(cellId)) ?? {};
      CellRuntimeRegistry.set(asCellId(cellId), {
        ...existing,
        maplibreInstance: map,
      });
    }

    let disposed = false;
    let activeRows: readonly Record<string, unknown>[] = rows;
    let lastBootstrappedKey = '';

    const applyLayers = () => {
      if (disposed) return;
      setMapInstanceVisualTheme(map, currentMapTheme);

      const tableCfg = {
        routesTable: activeTableConfig.routesTable,
        tracksTable: activeTableConfig.tracksTable,
        stationsTable: activeTableConfig.stationsTable,
        presetId: activeTableConfig.presetId || initialPresetId || 'current',
        theme: currentMapTheme,
        ...(activeTableConfig.hideSubwayOverlay !== undefined
          ? { hideSubwayOverlay: activeTableConfig.hideSubwayOverlay }
          : {}),
        ...(activeTableConfig.corridorOverlay !== undefined
          ? { corridorOverlay: activeTableConfig.corridorOverlay }
          : {}),
      };
      const cfgKey = `${tableCfg.presetId}|${tableCfg.routesTable}|${tableCfg.tracksTable}|${tableCfg.stationsTable}`;
      const mapAnyForNet = map as any;

      const hasCustomNetworkTables =
        Boolean(config?.mapTables) &&
        (config!.mapTables!.routesTable !== DEFAULT_MAP_NETWORK_TABLE_CONFIG.routesTable ||
          config!.mapTables!.tracksTable !== DEFAULT_MAP_NETWORK_TABLE_CONFIG.tracksTable ||
          config!.mapTables!.stationsTable !== DEFAULT_MAP_NETWORK_TABLE_CONFIG.stationsTable ||
          (initialPresetId !== 'current' && initialPresetId !== ''));

      const needsNetworkBootstrap =
        lastBootstrappedKey !== cfgKey &&
        (hasCustomNetworkTables ||
          !mapAnyForNet._dbtcNetworkData ||
          getActiveMapNetworkData().serviceLines.features.length === 0);

      if (needsNetworkBootstrap) {
        lastBootstrappedKey = cfgKey;
        const conn = getDuckDbConnection();
        if (conn) {
          bootstrapMapNetworkFromDuckDb(
            async (sql: string) => normalizeArrowTable(await conn.query(prepareExecutableCellSql(sql))),
            tableCfg
          )
            .then((network) => {
              if (disposed) return;
              setMapInstanceNetworkData(map, network);
              if (!hasCustomNetworkTables) {
                setActiveMapNetworkData(network);
              }
              applyLayers();
            })
            .catch(() => {
              // Fallback to default network if custom table is unavailable
            });
        }
      }

      if (chartType === 'route-segment-map') {
        renderRouteSegmentMap(map, activeRows, config as any);
      } else if (chartType === 'isochrone-map') {
        renderIsochroneMap(map, activeRows, {
          ...(config as any),
          onSelectStation: async (stationId: string) => {
            if (!cellId) return;
            const targetCell = store.cells.find(c => c.cellId === cellId);
            if (!targetCell) return;
            targetCell.params = { ...targetCell.params, origin_station_id: stationId };
            const conn = getDuckDbConnection();
            if (conn) {
              await persistCellToDuckDb(conn, targetCell);
              await executeCellQuery(conn, targetCell.cellId);
            }
          },
        });
      } else if (chartType === 'train-position-map') {
        const mapAny = map as any;
        if (cellId) {
          const brandedId = asCellId(cellId);
          const runtime = CellRuntimeRegistry.get(brandedId);
          if (runtime?.liveSyncPinned) {
            mapAny._liveSyncPinned = true;
            if (runtime.justSyncedLiveAt) {
              mapAny._justSyncedLiveAt = runtime.justSyncedLiveAt;
            }
          }
          mapAny._onLivePinChange = (pinned: boolean) => {
            const cur = CellRuntimeRegistry.get(brandedId) ?? {};
            CellRuntimeRegistry.set(brandedId, {
              ...cur,
              liveSyncPinned: pinned,
              justSyncedLiveAt: pinned ? Date.now() : 0,
            });
          };
        }
        renderTrainPositions(map, activeRows, undefined, {
          theme: currentMapTheme,
          liveModeAllowed: store.notebook.mode === 'standard',
          livePollIntervalMs: Math.max(10, store.notebook.liveIntervalSec || 60) * 1000,
          ...(activeTableConfig.hideSubwayOverlay !== undefined
            ? { hideSubwayOverlay: activeTableConfig.hideSubwayOverlay }
            : {}),
          ...(activeTableConfig.corridorOverlay
            ? { corridorOverlay: activeTableConfig.corridorOverlay }
            : {}),
          onRefreshLive: async (opts?: { forceQuery?: boolean }) => {
            if (!cellId || store.notebook.mode !== 'standard') return false;
            const conn = getDuckDbConnection();
            const targetCell = store.cells.find(c => c.cellId === cellId);
            if (!conn || !targetCell?.sqlText) return false;

            const startTime = Date.now();
            try {
              await refreshRemoteCatalog(conn, { force: false }).catch(() => false);
              await ensureFastDimensionCaches(conn);
              const expandedSql = expandCellSql(targetCell.sqlText, targetCell.params ?? {});
              const cleanSql = prepareExecutableCellSql(expandedSql);
              const res = await conn.query(cleanSql);
              const norm = normalizeArrowTable(res);
              if (norm.rows.length > 0) {
                const remapped = applyChartColumnMapping(
                  chartType,
                  norm.rows,
                  norm.columns,
                  targetCell.chartConfig
                );
                activeRows = enrichRowsWithCustomColors(
                  remapped.mappedRows,
                  targetCell.chartConfig as BaseChartConfig
                );
                const now = Date.now();
                const keepLive = Boolean(mapAny._liveSyncPinned);
                mapAny._justSyncedLiveAt = now;
                const existingRuntime = CellRuntimeRegistry.get(targetCell.cellId) ?? {};
                CellRuntimeRegistry.set(targetCell.cellId, {
                  ...existingRuntime,
                  arrowTable: res,
                  normalized: norm,
                  liveSyncPinned: keepLive,
                  justSyncedLiveAt: now,
                  inPlaceLiveRefresh: true,
                });
                targetCell.executionState = {
                  status: 'success',
                  executionMs: now - startTime,
                  rowCount: norm.totalRowCount,
                  executedAt: now,
                  executedMode: store.notebook.mode,
                };
                renderTrainPositions(map, activeRows, undefined, {
                  onRefreshLive: mapAny._onRefreshLive,
                  theme: currentMapTheme,
                  liveModeAllowed: store.notebook.mode === 'standard',
                  livePollIntervalMs: Math.max(10, store.notebook.liveIntervalSec || 60) * 1000,
                  ...(activeTableConfig.hideSubwayOverlay !== undefined
                    ? { hideSubwayOverlay: activeTableConfig.hideSubwayOverlay }
                    : {}),
                  ...(activeTableConfig.corridorOverlay
                    ? { corridorOverlay: activeTableConfig.corridorOverlay }
                    : {}),
                });
                return true;
              }
            } catch (err) {
              console.warn('Live train feed refresh error:', err);
            }
            return false;
          },
        });
      }
    };

    // Wire up Customize Network Tables Modal
    const customizeBtn = controlsOverlay.querySelector('.map-customize-tables-btn') as HTMLButtonElement | null;
    const modalCloseBtn = modalBackdrop.querySelector('.map-tables-modal-close-btn') as HTMLButtonElement | null;
    const presetSelect = modalBackdrop.querySelector('.map-tables-preset-select') as HTMLSelectElement | null;
    const modalThemeSelect = modalBackdrop.querySelector('.map-tables-theme-select') as HTMLSelectElement | null;
    const modalThemeDesc = modalBackdrop.querySelector('.map-tables-theme-desc') as HTMLElement | null;
    const presetDesc = modalBackdrop.querySelector('.dbtc-map-tables-preset-desc') as HTMLElement | null;
    const routesInput = modalBackdrop.querySelector('[data-role-input="routes"]') as HTMLInputElement | null;
    const tracksInput = modalBackdrop.querySelector('[data-role-input="tracks"]') as HTMLInputElement | null;
    const stationsInput = modalBackdrop.querySelector('[data-role-input="stations"]') as HTMLInputElement | null;
    const routesStatus = modalBackdrop.querySelector('[data-role-status="routes"]') as HTMLElement | null;
    const tracksStatus = modalBackdrop.querySelector('[data-role-status="tracks"]') as HTMLElement | null;
    const stationsStatus = modalBackdrop.querySelector('[data-role-status="stations"]') as HTMLElement | null;
    const modalBanner = modalBackdrop.querySelector('.dbtc-map-tables-banner') as HTMLElement | null;
    const validateBtn = modalBackdrop.querySelector('.map-tables-validate-btn') as HTMLButtonElement | null;
    const applyBtn = modalBackdrop.querySelector('.map-tables-apply-btn') as HTMLButtonElement | null;
    const resetBtn = modalBackdrop.querySelector('.map-tables-reset-btn') as HTMLButtonElement | null;
    const datalistEl = modalBackdrop.querySelector('.map-tables-candidates-datalist') as HTMLDataListElement | null;

    const applyThemeSelection = (themeId: MapVisualThemeId) => {
      currentMapTheme = themeId;
      activeTableConfig.theme = themeId;
      setMapInstanceVisualTheme(map, themeId);
      controller.setVisualTheme(themeId);
      if (toolbarThemeSelect) toolbarThemeSelect.value = themeId;
      if (modalThemeSelect) modalThemeSelect.value = themeId;
      if (modalThemeDesc) {
        modalThemeDesc.textContent =
          MAP_VISUAL_THEMES.find(t => t.id === themeId)?.description ?? '';
      }
      applyLayers();
    };

    toolbarThemeSelect?.addEventListener('change', async () => {
      const nextTheme = (toolbarThemeSelect.value || 'mta') as MapVisualThemeId;
      applyThemeSelection(nextTheme);
      const conn = getDuckDbConnection();
      if (cellId && conn) {
        const targetCell = store.cells.find(c => c.cellId === cellId);
        if (targetCell) {
          const curTables = (targetCell.chartConfig?.['mapTables'] as MapNetworkTableConfig | undefined) ?? activeTableConfig;
          targetCell.chartConfig = {
            ...targetCell.chartConfig,
            mapTables: {
              ...curTables,
              theme: nextTheme,
            },
          };
          await persistCellToDuckDb(conn, targetCell);
        }
      }
    });

    allmapsSelect?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val === 'custom') {
        if (customGroup) customGroup.style.display = 'flex';
        customInput?.focus();
        return;
      }
      if (customGroup) customGroup.style.display = 'none';

      if (val === 'custom-tables') {
        modalBackdrop.style.display = 'flex';
        return;
      }

      if (val.startsWith('iiif:')) {
        const iiifId = val.slice('iiif:'.length);
        await controller.enableAllmapsPreset(iiifId);
        return;
      }

      // Check if it matches a StraphangerDB Map Network Preset
      const preset = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === val || (!val && p.id === 'current'));
      if (preset) {
        controller.removeAllmaps();
        if (presetSelect) presetSelect.value = preset.id;
        if (routesInput) routesInput.value = preset.config.routesTable;
        if (tracksInput) tracksInput.value = preset.config.tracksTable;
        if (stationsInput) stationsInput.value = preset.config.stationsTable;
        if (presetDesc) presetDesc.textContent = preset.description;

        const isGeoPreset = preset.id === 'geo-light' || preset.id === 'geo-dark';
        activeTableConfig.presetId = preset.id;
        activeTableConfig.routesTable = preset.config.routesTable;
        activeTableConfig.tracksTable = preset.config.tracksTable;
        activeTableConfig.stationsTable = preset.config.stationsTable;
        activeTableConfig.hideSubwayOverlay = isGeoPreset
          ? Boolean(config.mapTables?.hideSubwayOverlay)
          : false;

        applyThemeSelection(preset.theme);

        const conn = getDuckDbConnection();
        if (conn) {
          try {
            const network = await bootstrapMapNetworkFromDuckDb(
              async (sql: string) => normalizeArrowTable(await conn.query(prepareExecutableCellSql(sql))),
              {
                ...preset.config,
                presetId: preset.id,
                theme: preset.theme,
              }
            );
            if (disposed) return;
            lastBootstrappedKey = `${preset.id}|${preset.config.routesTable}|${preset.config.tracksTable}|${preset.config.stationsTable}`;
            setMapInstanceNetworkData(map, network);
            const isEphemeralHistorical = preset.id === '1929' || preset.id === 'ind-1953';
            if (cellId && !isEphemeralHistorical) {
              const targetCell = store.cells.find(c => c.cellId === cellId);
              if (targetCell) {
                targetCell.chartConfig = {
                  ...targetCell.chartConfig,
                  mapTables: {
                    ...preset.config,
                    presetId: preset.id,
                    theme: preset.theme,
                    ...(activeTableConfig.hideSubwayOverlay
                      ? { hideSubwayOverlay: true }
                      : {}),
                    ...(activeTableConfig.corridorOverlay
                      ? { corridorOverlay: activeTableConfig.corridorOverlay }
                      : {}),
                  },
                };
                await persistCellToDuckDb(conn, targetCell);
              }
            }
            applyLayers();
          } catch {
            // Keep theme update if DuckDB is offline in unit test
          }
        }
      } else if (val) {
        await controller.enableAllmapsPreset(val);
      } else {
        controller.removeAllmaps();
      }
    });

    const showBanner = (msg: string, isError: boolean) => {
      if (!modalBanner) return;
      modalBanner.style.display = 'block';
      modalBanner.textContent = msg;
      modalBanner.className = `dbtc-map-tables-banner ${isError ? 'error' : 'success'}`;
    };

    const clearStatuses = () => {
      for (const stEl of [routesStatus, tracksStatus, stationsStatus]) {
        if (stEl) {
          stEl.textContent = '';
          stEl.className = 'dbtc-map-tables-status';
        }
      }
      if (modalBanner) modalBanner.style.display = 'none';
    };

    const runSchemaValidation = async () => {
      const conn = getDuckDbConnection();
      if (!conn) {
        showBanner('DuckDB connection is not initialized.', true);
        return null;
      }
      const queryExec = async (sql: string) =>
        normalizeArrowTable(await conn.query(prepareExecutableCellSql(sql)));
      const rTable = routesInput?.value.trim() || '';
      const tTable = tracksInput?.value.trim() || '';
      const sTable = stationsInput?.value.trim() || '';

      const [rCheck, tCheck, sCheck] = await Promise.all([
        validateMapTableSchema(queryExec, rTable, 'routes'),
        validateMapTableSchema(queryExec, tTable, 'tracks'),
        validateMapTableSchema(queryExec, sTable, 'stations'),
      ]);

      const renderStatus = (el: HTMLElement | null, res: Awaited<ReturnType<typeof validateMapTableSchema>>) => {
        if (!el) return;
        if (res.valid) {
          el.textContent = `✓ Schema valid (${res.presentColumns.length} cols)`;
          el.className = 'dbtc-map-tables-status valid';
        } else {
          el.textContent = `✕ ${res.error || 'Invalid schema'}`;
          el.className = 'dbtc-map-tables-status invalid';
        }
      };

      renderStatus(routesStatus, rCheck);
      renderStatus(tracksStatus, tCheck);
      renderStatus(stationsStatus, sCheck);

      const allValid = rCheck.valid && tCheck.valid && sCheck.valid;
      if (allValid) {
        showBanner('All 3 StraphangerDB / DuckDB tables match the required map network schema contracts.', false);
      } else {
        const errs = [rCheck.error, tCheck.error, sCheck.error].filter(Boolean);
        showBanner(errs.join(' | '), true);
      }
      return { allValid, rTable, tTable, sTable };
    };

    customizeBtn?.addEventListener('click', async () => {
      modalBackdrop.style.display = 'flex';
      const conn = getDuckDbConnection();
      if (conn && datalistEl) {
        const candidates = await listDuckDbMapCandidateTables(async (sql: string) => normalizeArrowTable(await conn.query(sql)));
        datalistEl.innerHTML = candidates.map(c => `<option value="${c}"></option>`).join('');
      }
    });

    modalCloseBtn?.addEventListener('click', () => {
      modalBackdrop.style.display = 'none';
    });

    modalBackdrop.addEventListener('click', (ev) => {
      if (ev.target === modalBackdrop) {
        modalBackdrop.style.display = 'none';
      }
    });

    presetSelect?.addEventListener('change', () => {
      const val = presetSelect.value;
      const found = MAP_NETWORK_TABLE_PRESETS.find(p => p.id === val);
      clearStatuses();
      if (found) {
        if (routesInput) routesInput.value = found.config.routesTable;
        if (tracksInput) tracksInput.value = found.config.tracksTable;
        if (stationsInput) stationsInput.value = found.config.stationsTable;
        if (presetDesc) presetDesc.textContent = found.description;
        if (modalThemeSelect) modalThemeSelect.value = found.theme;
        if (modalThemeDesc) {
          modalThemeDesc.textContent =
            MAP_VISUAL_THEMES.find(t => t.id === found.theme)?.description ?? '';
        }
      } else if (presetDesc) {
        presetDesc.textContent =
          'Enter any StraphangerDB or DuckDB table/view names that satisfy the required column schemas below.';
      }
    });

    modalThemeSelect?.addEventListener('change', () => {
      const nextTheme = (modalThemeSelect.value || 'mta') as MapVisualThemeId;
      if (modalThemeDesc) {
        modalThemeDesc.textContent =
          MAP_VISUAL_THEMES.find(t => t.id === nextTheme)?.description ?? '';
      }
    });

    for (const inp of [routesInput, tracksInput, stationsInput]) {
      inp?.addEventListener('input', () => {
        if (presetSelect) presetSelect.value = 'custom';
        clearStatuses();
      });
    }

    validateBtn?.addEventListener('click', async () => {
      await runSchemaValidation();
    });

    applyBtn?.addEventListener('click', async () => {
      const chosenTheme = ((modalThemeSelect?.value || toolbarThemeSelect?.value || 'mta') as MapVisualThemeId);
      applyThemeSelection(chosenTheme);

      const conn = getDuckDbConnection();
      if (!conn) {
        showBanner('Applied visual theme. DuckDB connection is not initialized for table bootstrap.', false);
        return;
      }
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Bootstrapping...';
      }
      try {
        const check = await runSchemaValidation();
        if (!check || !check.allValid) return;

        const chosenPresetId = presetSelect?.value || 'custom';
        const nextConfig: MapNetworkTableConfig = {
          routesTable: check.rTable,
          tracksTable: check.tTable,
          stationsTable: check.sTable,
          presetId: chosenPresetId,
          theme: chosenTheme,
        };
        const network = await bootstrapMapNetworkFromDuckDb(
          async (sql: string) => normalizeArrowTable(await conn.query(prepareExecutableCellSql(sql))),
          nextConfig
        );
        if (disposed) return;
        setMapInstanceNetworkData(map, network);
        if (allmapsSelect) {
          allmapsSelect.value = chosenPresetId === 'custom' ? 'custom-tables' : chosenPresetId;
        }

        if (cellId) {
          const targetCell = store.cells.find(c => c.cellId === cellId);
          if (targetCell) {
            targetCell.chartConfig = {
              ...targetCell.chartConfig,
              mapTables: {
                ...nextConfig,
                presetId: chosenPresetId,
                theme: chosenTheme,
              },
            };
            await persistCellToDuckDb(conn, targetCell);
          }
        }

        applyLayers();
        showBanner(
          `Bootstrapped ${Object.keys(network.routes).length} routes, ${network.serviceLines.features.length} track corridors, and ${Object.keys(network.stations).length} stations from StraphangerDB (${chosenTheme.toUpperCase()} theme).`,
          false
        );
        setTimeout(() => {
          modalBackdrop.style.display = 'none';
        }, 650);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showBanner(msg, true);
      } finally {
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply & Bootstrap Map';
        }
      }
    });

    resetBtn?.addEventListener('click', async () => {
      const def = MAP_NETWORK_TABLE_PRESETS[0]!;
      if (presetSelect) presetSelect.value = def.id;
      if (allmapsSelect) allmapsSelect.value = def.id;
      if (routesInput) routesInput.value = def.config.routesTable;
      if (tracksInput) tracksInput.value = def.config.tracksTable;
      if (stationsInput) stationsInput.value = def.config.stationsTable;
      if (presetDesc) presetDesc.textContent = def.description;
      clearStatuses();
      setMapInstanceNetworkData(map, null);
      applyThemeSelection('mta');
      showBanner('Reset map network tables and theme to default Current MTA Subway Map.', false);
    });

    if (map.loaded()) {
      applyLayers();
    } else {
      map.once('load', applyLayers);
    }

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapDiv);

    return () => {
      disposed = true;
      const mAny = map as any;
      if (mAny._livePollIntervalId) {
        clearInterval(mAny._livePollIntervalId);
        mAny._livePollIntervalId = null;
      }
      if (mAny._liveSyncBadgeTimer) {
        clearTimeout(mAny._liveSyncBadgeTimer);
        mAny._liveSyncBadgeTimer = null;
      }
      if (mAny._timelapseAnimId) {
        cancelAnimationFrame(mAny._timelapseAnimId);
        mAny._timelapseAnimId = null;
      }
      if (cellId) {
        const cur = CellRuntimeRegistry.get(asCellId(cellId));
        if (cur) delete cur.maplibreInstance;
      }
      resizeObserver.disconnect();
      controller.destroy();
      container.innerHTML = '';
    };
  }

  // Handle ECharts Visualizations
  const SCROLL_MIN_WIDTH_BY_CHART: Partial<Record<ChartType, number>> = {
    'marey-chart': 720,
    'station-progression': 680,
    'headway-horizon': 640,
    'multimodal-pulse': 620,
    'od-ridership-flow': 600,
    'adherence-waterfall': 540,
    bar: 540,
    'stacked-bar': 540,
    line: 540,
    area: 540,
    'stacked-area': 540,
    scatter: 540,
    heatmap: 540,
  };

  const getOuterWidth = (): number =>
    container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1024);

  const targetScrollWidth = SCROLL_MIN_WIDTH_BY_CHART[chartType];
  const initialOuterWidth = getOuterWidth();
  const useHorizontalScroll = Boolean(targetScrollWidth && initialOuterWidth < 520);

  const chartDiv = document.createElement('div');
  chartDiv.className = 'dbtc-chart-container';
  chartDiv.style.width = useHorizontalScroll && targetScrollWidth ? `${targetScrollWidth}px` : '100%';
  chartDiv.style.height = '100%';
  let minChartHeight = 320;
  if (chartType === 'marey-chart' && rows.length > 0) {
    const distinctStationCount = new Set(
      rows.map(r => String(r['station_name'] ?? r['name'] ?? r['parent_station_id'] ?? r['station_id'] ?? ''))
        .filter(Boolean)
    ).size;
    if (distinctStationCount > 22) {
      minChartHeight = Math.min(720, Math.max(360, distinctStationCount * 16 + 70));
    }
  }
  chartDiv.style.minHeight = `${minChartHeight}px`;
  container.classList.toggle('dbtc-chart-scrollable', useHorizontalScroll);
  container.appendChild(chartDiv);

  const chart = echarts.init(chartDiv, 'mta-modern');

  if (cellId) {
    const existing = CellRuntimeRegistry.get(asCellId(cellId)) ?? {};
    CellRuntimeRegistry.set(asCellId(cellId), {
      ...existing,
      echartsInstance: chart,
    });
  }

  const buildOptionForWidth = (outerWidth: number): echarts.EChartsOption => {
    const isNarrow = outerWidth < 520;
    const isScrollable = Boolean(targetScrollWidth && isNarrow);
    const effectiveWidth = isScrollable && targetScrollWidth ? targetScrollWidth : outerWidth;
    const isCompact = effectiveWidth < 520;
    const widthConfig = { ...config, containerWidth: effectiveWidth };
    let opt: echarts.EChartsOption;

    switch (chartType) {
      case 'marey-chart':
        opt = buildMareyChartOption(rows, widthConfig as any);
        break;
      case 'station-progression':
        opt = buildStationProgressionOption(rows, widthConfig as any);
        break;
      case 'headway-horizon':
        opt = buildHeadwayHorizonOption(rows, widthConfig as any);
        break;
      case 'adherence-waterfall':
        opt = buildAdherenceWaterfallOption(rows, widthConfig as any);
        break;
      case 'multimodal-pulse':
        opt = buildMultimodalPulseOption(rows, widthConfig as any);
        break;
      case 'od-ridership-flow':
        opt = buildOdRidershipFlowOption(rows, widthConfig as any);
        break;
      default:
        opt = buildStandardBiOption(chartType, rows, config);
        if (isCompact && opt.grid && !Array.isArray(opt.grid)) {
          opt.grid = { ...opt.grid, left: 36, right: 12 };
        }
        break;
    }

    if (isScrollable) {
      // Let native horizontal touch scrolling pan the wide chart smoothly instead of ECharts inside dataZoom
      opt = { ...opt, dataZoom: [] };
    }

    if (isNarrow) {
      if (opt.tooltip && !Array.isArray(opt.tooltip)) {
        opt.tooltip = { ...opt.tooltip, confine: true };
      }
      if (opt.legend && !Array.isArray(opt.legend) && !opt.legend.type) {
        opt.legend = { ...opt.legend, type: 'scroll' };
      }
    }

    return applyChartColorOverrides(opt, config);
  };

  let lastScrollable = useHorizontalScroll;
  let lastCompact = (useHorizontalScroll && targetScrollWidth ? targetScrollWidth : initialOuterWidth) < 520;
  chart.setOption(buildOptionForWidth(initialOuterWidth), true);

  const resizeObserver = new ResizeObserver(() => {
    const nextOuter = getOuterWidth();
    const nextScrollable = Boolean(targetScrollWidth && nextOuter < 520);
    const nextEffective = nextScrollable && targetScrollWidth ? targetScrollWidth : nextOuter;
    const nextCompact = nextEffective < 520;

    if (nextScrollable !== lastScrollable) {
      lastScrollable = nextScrollable;
      chartDiv.style.width = nextScrollable && targetScrollWidth ? `${targetScrollWidth}px` : '100%';
      container.classList.toggle('dbtc-chart-scrollable', nextScrollable);
    }

    chart.resize();

    if (nextCompact !== lastCompact || nextScrollable !== useHorizontalScroll) {
      lastCompact = nextCompact;
      chart.setOption(buildOptionForWidth(nextOuter), true);
    }
  });
  resizeObserver.observe(container);

  return () => {
    if (cellId) {
      const cur = CellRuntimeRegistry.get(asCellId(cellId));
      if (cur) delete cur.echartsInstance;
    }
    resizeObserver.disconnect();
    chart.dispose();
    container.innerHTML = '';
  };
}
