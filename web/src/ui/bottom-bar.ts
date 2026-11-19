import {
  store,
  watchReactive,
  CellRuntimeRegistry,
  persistCellToDuckDb,
  persistNotebookToDuckDb,
  cancelCellQuery,
} from '../state/store.js';
import { exportDataToCsv, exportDataToJson } from '../viz/card-image-export.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';
import { showToast } from './toast.js';

function formatCatalogLabel(): string {
  if (store.notebook.mode === 'offline') {
    return 'Offline Cache (Local DuckDB)';
  }
  const urlStr = store.notebook.catalogUrl;
  if (!urlStr) return 'Local DuckDB';
  try {
    const parsed = new URL(urlStr);
    return `prod.transit_v2 (${parsed.hostname})`;
  } catch {
    return 'prod.transit_v2';
  }
}

function escapeBottomHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderBottomBar(container: HTMLElement): () => void {
  const draw = () => {
    const activeCell = store.cells.find(c => c.cellId === store.notebook.activeCellId);
    const artifacts = activeCell ? CellRuntimeRegistry.get(activeCell.cellId) : undefined;
    const rows = artifacts?.normalized?.rows ?? [];
    const numRows = artifacts?.normalized?.totalRowCount ?? 0;

    let execTimeMs = 0;
    if (activeCell?.executionState.status === 'success') {
      execTimeMs = activeCell.executionState.executionMs;
    }

    const isRunning = activeCell?.executionState.status === 'running';
    const isEngineBooting =
      store.notebook.engineStatus === 'booting' || activeCell?.executionState.status === 'booting';
    const isStory = store.notebook.readOnlyStoryMode;

    container.innerHTML = `
      <footer class="dbtc-bottom-bar">
        <div class="status-left">
          <span class="status-item" data-engine-status="${isEngineBooting ? 'booting' : 'ready'}">
            <span class="status-indicator-dot ${isEngineBooting ? 'dot-booting' : 'dot-online'}" style="${
              isEngineBooting
                ? 'background: #F59E0B; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.25);'
                : ''
            }"></span>
            ${isEngineBooting ? 'Spinning up DuckDB-Wasm...' : 'DuckDB-Wasm Active'}
          </span>
          <span class="status-item">
            Catalog: <b>${escapeBottomHtml(formatCatalogLabel())}</b>
          </span>
        </div>

        <div class="status-center">
          <span class="status-item">
            Active Cell: <b>${activeCell ? `#${activeCell.ordinal} — ${escapeBottomHtml(activeCell.title)}` : 'None'}</b>
          </span>
          <span class="status-item">
            Rows: <b>${numRows.toLocaleString()}</b>
          </span>
          ${
            execTimeMs > 0
              ? `
            <span class="status-item">
              Time: <b>${execTimeMs}ms</b>
            </span>
          `
              : ''
          }
          ${
            isRunning
              ? `
            <button id="cancel-query-btn" class="dbtc-btn btn-xs btn-danger" title="Cancel running query">
              Cancel Query
            </button>
          `
              : ''
          }
          ${
            rows.length > 0
              ? `
            <span class="status-item quick-exports">
              <button id="quick-csv-btn" class="dbtc-btn btn-xs btn-ghost" title="Export cell data to CSV">CSV</button>
              <button id="quick-json-btn" class="dbtc-btn btn-xs btn-ghost" title="Export cell data to JSON">JSON</button>
            </span>
          `
              : ''
          }
        </div>

        ${
          isEngineBooting || isRunning
            ? `
          <div class="mobile-status-strip" role="status" aria-live="polite">
            <span class="status-indicator-dot ${isEngineBooting ? 'dot-booting' : 'dot-running'}"></span>
            <span class="mobile-status-text">${isEngineBooting ? 'Booting DuckDB...' : `Running #${activeCell?.ordinal ?? ''}...`}</span>
            ${
              isRunning
                ? `<button id="mobile-cancel-query-btn" type="button" class="dbtc-btn btn-xs btn-danger">Cancel</button>`
                : ''
            }
          </div>
        `
            : ''
        }

        <div class="status-right mobile-mode-switcher">
          <button class="dbtc-btn btn-xs btn-ghost mobile-tab-btn ${!isStory && activeCell && !activeCell.showSqlEditor && !activeCell.showOssiePillBar ? 'active' : ''}" data-mobile-tab="chart">Chart</button>
          <button class="dbtc-btn btn-xs btn-ghost mobile-tab-btn mobile-only-tab" data-mobile-tab="visuals">Visuals</button>
          <button class="dbtc-btn btn-xs btn-ghost mobile-tab-btn ${!isStory && activeCell && (activeCell.showSqlEditor || activeCell.showOssiePillBar) ? 'active' : ''}" data-mobile-tab="pills-sql"><span class="tab-label-desktop">Metrics &amp; SQL</span><span class="tab-label-mobile">SQL</span></button>
          <button class="dbtc-btn btn-xs btn-ghost mobile-tab-btn ${!isStory && activeCell?.chartType === 'table' ? 'active' : ''}" data-mobile-tab="table">Table</button>
          <button class="dbtc-btn btn-xs btn-ghost mobile-tab-btn ${isStory ? 'active' : ''}" data-mobile-tab="story">Story</button>
        </div>
      </footer>
    `;

    // Attach mobile tab switchers
    container.querySelectorAll('.mobile-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.getAttribute('data-mobile-tab');
        const conn = getDuckDbConnection();

        if (tab === 'visuals') {
          if (store.notebook.activeView !== 'studio') {
            store.notebook.activeView = 'studio';
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dbtc:toggle-mobile-sidebar'));
          }
          return;
        }

        if (tab === 'story') {
          store.notebook.readOnlyStoryMode = !store.notebook.readOnlyStoryMode;
          if (conn) {
            await persistNotebookToDuckDb(conn, store.notebook);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dbtc:notebook-updated'));
            window.dispatchEvent(new CustomEvent('dbtc:cell-updated'));
          }
          draw();
          return;
        }

        // Ensure we are in studio view
        if (store.notebook.activeView !== 'studio') {
          store.notebook.activeView = 'studio';
        }

        let targetCell = store.cells.find(c => c.cellId === store.notebook.activeCellId);
        if (!targetCell) {
          targetCell = store.cells.find(c => c.kind === 'question') || store.cells[0];
          if (targetCell) {
            store.notebook.activeCellId = targetCell.cellId;
          }
        }
        if (!targetCell) return;

        // If story mode was active, exit story mode to view and edit cell
        if (store.notebook.readOnlyStoryMode) {
          store.notebook.readOnlyStoryMode = false;
          if (conn) {
            await persistNotebookToDuckDb(conn, store.notebook);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dbtc:notebook-updated'));
          }
        }

        if (tab === 'chart') {
          targetCell.showSqlEditor = false;
          targetCell.showOssiePillBar = false;
          if (targetCell.chartType === 'table') {
            const prev = targetCell.chartConfig?.['previousChartType'] as any;
            const fallbackType = targetCell.cellId === 'cell_marey' ? 'marey-chart' : 'station-progression';
            targetCell.chartType = prev || fallbackType;
          }
        } else if (tab === 'pills-sql') {
          if (targetCell.showOssiePillBar) {
            targetCell.showOssiePillBar = false;
            targetCell.showSqlEditor = true;
          } else {
            targetCell.showOssiePillBar = true;
            targetCell.showSqlEditor = false;
          }
        } else if (tab === 'table') {
          if (targetCell.chartType !== 'table') {
            targetCell.chartConfig = {
              ...targetCell.chartConfig,
              previousChartType: targetCell.chartType,
            };
            targetCell.chartType = 'table';
          }
        }

        if (conn) {
          await persistCellToDuckDb(conn, targetCell);
          await persistNotebookToDuckDb(conn, store.notebook);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('dbtc:cell-updated', { detail: { cellId: targetCell.cellId } }));
        }
        draw();

        const cellEl = document.getElementById(`cell-container-${targetCell.cellId}`);
        cellEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });

    // Cancel query handler (desktop & mobile)
    const cancelBtn = container.querySelector('#cancel-query-btn') as HTMLButtonElement | null;
    const mobileCancelBtn = container.querySelector('#mobile-cancel-query-btn') as HTMLButtonElement | null;
    const handleCancel = () => {
      if (activeCell && activeCell.executionState.status === 'running') {
        cancelCellQuery(getDuckDbConnection(), activeCell.cellId);
        showToast(`Cancelled query for #${activeCell.ordinal}.`, 'warning');
        draw();
      }
    };
    cancelBtn?.addEventListener('click', handleCancel);
    mobileCancelBtn?.addEventListener('click', handleCancel);

    // Quick export handlers
    const quickCsvBtn = container.querySelector('#quick-csv-btn') as HTMLButtonElement | null;
    quickCsvBtn?.addEventListener('click', () => {
      if (activeCell && rows.length > 0) {
        exportDataToCsv(rows, `${activeCell.cellId}_data.csv`);
        showToast(`Exported ${rows.length} rows to CSV.`, 'success');
      }
    });

    const quickJsonBtn = container.querySelector('#quick-json-btn') as HTMLButtonElement | null;
    quickJsonBtn?.addEventListener('click', () => {
      if (activeCell && rows.length > 0) {
        exportDataToJson(rows, `${activeCell.cellId}_data.json`);
        showToast(`Exported ${rows.length} rows to JSON.`, 'success');
      }
    });
  };

  draw();

  const watcherBottom = watchReactive(
    () => {
      const activeCell = store.cells.find(c => c.cellId === store.notebook.activeCellId);
      return [
        store.notebook.activeCellId,
        store.notebook.readOnlyStoryMode,
        store.notebook.engineStatus,
        activeCell?.executionState.status,
        activeCell?.executionState.status === 'success' ? activeCell.executionState.executionMs : undefined,
        activeCell?.showSqlEditor,
        activeCell?.showOssiePillBar,
        activeCell?.chartType,
      ];
    },
    () => {
      draw();
    }
  );
  const unwatchBottom = watcherBottom[1];

  return () => {
    unwatchBottom();
    container.innerHTML = '';
  };
}
