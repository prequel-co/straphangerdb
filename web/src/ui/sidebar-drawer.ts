import { store, watchReactive, CellRuntimeRegistry, persistCellToDuckDb } from '../state/store.js';
import type { ChartType } from '../types/cell-state.js';
import {
  detectUnlockedTransitTiles,
  isChartSchemaCompatible,
  CHART_DEFAULT_SCHEMAS,
  TILE_CONTRACTS,
  type TileContractKey,
} from '../types/schema-contracts.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';

interface TileInfo {
  readonly id: ChartType;
  readonly label: string;
  readonly icon: string;
  readonly isTransit: boolean;
}

const ALL_TILES: readonly TileInfo[] = [
  // Standard BI
  {
    id: 'table',
    label: 'Table',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 8h14M3 13h14M8 8v9M13 8v9"/></svg>',
    isTransit: false,
  },
  {
    id: 'bar',
    label: 'Bar Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M5 17V10h3v7M12 17V4h3v13"/></svg>',
    isTransit: false,
  },
  {
    id: 'stacked-bar',
    label: 'Stacked Bar',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M5 17v-4h3v4M5 13V8h3v5M12 17v-6h3v6M12 11V4h3v7"/></svg>',
    isTransit: false,
  },
  {
    id: 'line',
    label: 'Line Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 13l4-5 4 4 6-8"/></svg>',
    isTransit: false,
  },
  {
    id: 'area',
    label: 'Area Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 13l4-5 4 4 6-8v9H3z" fill="currentColor" fill-opacity="0.15"/></svg>',
    isTransit: false,
  },
  {
    id: 'stacked-area',
    label: 'Stacked Area',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 15l4-3 5 2 5-6v9H3z" fill="currentColor" fill-opacity="0.15"/><path d="M3 10l5-4 4 2 5-5v3l-5 4-4-2-5 3z" fill="currentColor" fill-opacity="0.25"/></svg>',
    isTransit: false,
  },
  {
    id: 'scatter',
    label: 'Scatter Plot',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 3v14"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/><circle cx="10" cy="7" r="1.5" fill="currentColor"/><circle cx="13" cy="11" r="1.5" fill="currentColor"/><circle cx="15" cy="5" r="1.5" fill="currentColor"/></svg>',
    isTransit: false,
  },
  {
    id: 'pie',
    label: 'Pie Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2a8 8 0 1 0 8 8h-8V2z"/><path d="M12 2.25A8.004 8.004 0 0 1 17.75 8H12V2.25z"/></svg>',
    isTransit: false,
  },
  {
    id: 'donut',
    label: 'Donut Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.25"/></svg>',
    isTransit: false,
  },
  {
    id: 'kpi-metric',
    label: 'KPI Metric',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M7 8h2v5M6 13h4M12 8h2M12 10.5h2M12 13h2"/></svg>',
    isTransit: false,
  },
  {
    id: 'gauge',
    label: 'Gauge',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 14a7.5 7.5 0 1 1 13 0"/><path d="M10 10l3-3"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/></svg>',
    isTransit: false,
  },
  {
    id: 'heatmap',
    label: 'Heatmap',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.3"/><rect x="8.25" y="3" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.7"/><rect x="13.5" y="3" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.5"/><rect x="3" y="8.25" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.8"/><rect x="8.25" y="8.25" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.4"/><rect x="13.5" y="8.25" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.9"/><rect x="3" y="13.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.5"/><rect x="8.25" y="13.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.2"/><rect x="13.5" y="13.5" width="3.5" height="3.5" rx="0.5" fill="currentColor" fill-opacity="0.6"/></svg>',
    isTransit: false,
  },
  {
    id: 'treemap',
    label: 'Treemap',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M10 3v14M10 10h7M3 11h7"/></svg>',
    isTransit: false,
  },
  {
    id: 'funnel',
    label: 'Funnel',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14l-5 6v5l-4 2v-7L3 4z"/></svg>',
    isTransit: false,
  },
  {
    id: 'radar',
    label: 'Radar',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="10,2 18,7.5 15,17 5,17 2,7.5"/><polygon points="10,6 14.5,9.5 13,14 7,14 5.5,9.5"/><path d="M10 2v15M2 7.5l13 9.5M18 7.5L5 17"/></svg>',
    isTransit: false,
  },
  {
    id: 'choropleth-borough',
    label: 'Borough Chart',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14l3-6 4 2 5-7 1 8-4 5-5-1z"/></svg>',
    isTransit: false,
  },

  // Schema-Unlocked Transit Visualizations
  {
    id: 'marey-chart',
    label: 'Marey Diagram',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 3v14M4 5l12 11M6 3l11 11M3 9l8 8M9 3l8 8"/></svg>',
    isTransit: true,
  },
  {
    id: 'station-progression',
    label: 'Station Progression',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h14M6 6v8M10 6v8M14 6v8"/><circle cx="6" cy="10" r="1.5" fill="currentColor"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><circle cx="14" cy="10" r="1.5" fill="currentColor"/></svg>',
    isTransit: true,
  },
  {
    id: 'route-segment-map',
    label: 'Route Speed Map',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16l4-7 6 3 4-8"/><circle cx="3" cy="16" r="1.5" fill="currentColor"/><circle cx="7" cy="9" r="1.5" fill="currentColor"/><circle cx="13" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="4" r="1.5" fill="currentColor"/></svg>',
    isTransit: true,
  },
  {
    id: 'isochrone-map',
    label: 'Isochrone Map',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2" fill="currentColor"/><circle cx="10" cy="10" r="5" stroke-dasharray="2 2"/><circle cx="10" cy="10" r="8"/></svg>',
    isTransit: true,
  },
  {
    id: 'train-position-map',
    label: 'Train Position Map',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="12" height="12" rx="2.5"/><path d="M4 10h12M4 6h12"/><circle cx="7" cy="12.5" r="1" fill="currentColor"/><circle cx="13" cy="12.5" r="1" fill="currentColor"/><path d="M6 15l-2 2M14 15l2 2"/></svg>',
    isTransit: true,
  },
  {
    id: 'headway-horizon',
    label: 'Headway Horizon',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M3 14c2-3 4-3 6 0s4 3 6 0 2-1 2-1v4H3z" fill="currentColor" fill-opacity="0.15"/><path d="M3 9c2-2 4-2 6 0s4 2 6 0 2-1 2-1"/></svg>',
    isTransit: true,
  },
  {
    id: 'adherence-waterfall',
    label: 'Adherence Waterfall',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h14M4 7h3v4H4zM8 9h3v5H8zM12 5h3v6h-3z" fill="currentColor" fill-opacity="0.25"/><path d="M4 7h3v4H4zM8 9h3v5H8zM12 5h3v6h-3z"/></svg>',
    isTransit: true,
  },
  {
    id: 'multimodal-pulse',
    label: 'Multimodal Pulse',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h3l2-5 3 10 3-7 2 4 3-2h2"/></svg>',
    isTransit: true,
  },
  {
    id: 'od-ridership-flow',
    label: 'O-D Flow Matrix',
    icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M13 3l3 3-3 3M16 14H4M7 11l-3 3 3 3"/></svg>',
    isTransit: true,
  },
];

export function renderSidebarDrawer(container: HTMLElement): () => void {
  const draw = () => {
    const activeCell = store.cells.find(c => c.cellId === store.notebook.activeCellId);
    const isMarkdownOrNone = !activeCell || activeCell.kind === 'markdown';
    const artifacts = activeCell ? CellRuntimeRegistry.get(activeCell.cellId) : undefined;
    const cols = artifacts?.normalized?.columns.map(c => c.name) ?? [];
    const unlockedTransitTiles = new Set<ChartType>(detectUnlockedTransitTiles(cols));

    const standardTiles = ALL_TILES.filter(t => !t.isTransit);
    const transitTiles = ALL_TILES.filter(t => t.isTransit);

    const escapeSidebarHtml = (str: string): string =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const targetBannerHtml = activeCell
      ? activeCell.kind === 'markdown'
        ? `<div class="sidebar-target-banner" style="position: sticky; top: 0; z-index: 2; padding: 8px 10px; background: #FFFBEB; border-bottom: 1px solid #FDE68A; font-size: 11px; color: #92400E;">
             Target: <strong>#${activeCell.ordinal} — ${escapeSidebarHtml(activeCell.title)}</strong> (Markdown cell — select a query cell to change visual)
           </div>`
        : `<div class="sidebar-target-banner" style="position: sticky; top: 0; z-index: 2; padding: 8px 10px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; font-size: 11px; color: #334155;">
             Target: <strong>#${activeCell.ordinal} — ${escapeSidebarHtml(activeCell.title)}</strong>
           </div>`
      : `<div class="sidebar-target-banner" style="position: sticky; top: 0; z-index: 2; padding: 8px 10px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; font-size: 11px; color: #64748B;">
           Select a query cell to configure its visual
         </div>`;

    const renderTileHtml = (tile: TileInfo) => {
      const isSelected = activeCell?.chartType === tile.id;
      const isCompatible = tile.isTransit
        ? cols.length === 0 || unlockedTransitTiles.has(tile.id)
        : cols.length === 0 || isChartSchemaCompatible(tile.id, cols);

      const roles = CHART_DEFAULT_SCHEMAS[tile.id] ?? [];
      const defaultColsHint = roles
        .filter(r => r.required !== false)
        .map(r => `${r.label}: ${r.canonicalColumn}`)
        .join(', ');

      let tileTooltip = tile.label;
      if (tile.isTransit && !isCompatible) {
        const contract = TILE_CONTRACTS[tile.id as TileContractKey];
        if (contract) {
          const reqs = contract.requiredAnyOfSets.map(set => `(${set.join(' or ')})`).join(' and ');
          tileTooltip = `${tile.label} - Default schema expects: ${reqs}. Selectable: use the Columns widget on the card to remap any query columns.`;
        }
      } else if (defaultColsHint) {
        tileTooltip = `${tile.label} - Default schema (${defaultColsHint}). Remappable via the Columns widget.`;
      }

      const stateClass = isSelected
        ? 'selected compatible'
        : isCompatible
          ? 'unlocked compatible'
          : 'remappable';

      const badgeHtml = tile.isTransit
        ? `<div class="tile-badge ${isCompatible ? 'badge-unlocked' : 'badge-remappable'}">${isCompatible ? 'Compatible' : 'Remap'}</div>`
        : cols.length > 0 && isCompatible
          ? `<div class="tile-badge badge-unlocked">Compatible</div>`
          : '';

      return `
        <button type="button" class="viz-tile ${stateClass}" data-chart-type="${tile.id}" title="${escapeSidebarHtml(tileTooltip)}" ${isMarkdownOrNone ? 'disabled aria-disabled="true"' : ''} aria-pressed="${isSelected ? 'true' : 'false'}">
          <div class="tile-icon">${tile.icon}</div>
          <div class="tile-label">${tile.label}</div>
          ${badgeHtml}
        </button>
      `;
    };

    container.innerHTML = `
      <aside class="dbtc-sidebar">
        ${targetBannerHtml}
        <div class="sidebar-section">
          <div class="section-header">Transit Visuals</div>
          <div class="viz-tiles-grid">
            ${transitTiles.map(renderTileHtml).join('')}
          </div>
        </div>

        <div class="sidebar-section">
          <div class="section-header">Standard Analytics &amp; BI</div>
          <div class="viz-tiles-grid">
            ${standardTiles.map(renderTileHtml).join('')}
          </div>
        </div>
      </aside>
    `;

    // Attach click listeners to tiles
    container.querySelectorAll('.viz-tile').forEach(tileEl => {
      tileEl.addEventListener('click', async () => {
        const chartType = tileEl.getAttribute('data-chart-type') as ChartType | null;
        if (!chartType || !activeCell || activeCell.kind === 'markdown') return;

        // Prune incompatible columnMapping keys when switching chartType
        const existingMapping = activeCell.chartConfig?.['columnMapping'] as Record<string, string> | undefined;
        if (existingMapping && typeof existingMapping === 'object') {
          const validRoleKeys = new Set((CHART_DEFAULT_SCHEMAS[chartType] ?? []).map(r => r.roleKey));
          const prunedEntries = Object.entries(existingMapping).filter(([k]) => validRoleKeys.has(k));
          activeCell.chartConfig = {
            ...activeCell.chartConfig,
            columnMapping: prunedEntries.length > 0 ? Object.fromEntries(prunedEntries) : undefined,
          };
        }

        activeCell.chartType = chartType;
        const conn = getDuckDbConnection();
        if (conn) {
          await persistCellToDuckDb(conn, activeCell);
        }
        draw();
      });
    });
  };

  draw();

  const watcherSidebar = watchReactive(
    () => {
      const activeCell = store.cells.find(c => c.cellId === store.notebook.activeCellId);
      return [
        store.notebook.activeCellId,
        activeCell?.chartType,
        activeCell?.executionState.status,
        activeCell?.executionState.status === 'success' ? activeCell.executionState.executedAt : undefined,
      ];
    },
    () => {
      draw();
    }
  );
  const unwatchSidebar = watcherSidebar[1];

  return () => {
    unwatchSidebar();
    container.innerHTML = '';
  };
}
