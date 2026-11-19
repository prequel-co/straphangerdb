import {
  store,
  persistCellToDuckDb,
  deleteCellFromDuckDb,
  executeCellQuery,
  findCellDependencies,
} from '../state/store.js';
import { asCellId, asCellViewIdentifier } from '../types/brands.js';
import { renderCellEditor } from './cell-editor.js';
import { renderOssiePillBar } from './ossie-pill-bar.js';
import { renderEditorialCard } from './editorial-card.js';
import { buildLlmSystemPrompt } from './data-uploads-view.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';

export function renderNotebookView(container: HTMLElement): () => void {
  const cleanups: (() => void)[] = [];
  const isStory = store.notebook.readOnlyStoryMode;
  const expiredCells = store.cells.filter(c => c.snapshotState.status === 'expired-fallback-live');

  container.innerHTML = `
    <main class="dbtc-notebook-view ${isStory ? 'story-mode' : ''}">
      ${
        expiredCells.length > 0
          ? `
        <div class="snapshot-fallback-banner" id="snapshot-fallback-banner">
          <span>⚠️ Original DuckLake snapshot (${expiredCells.length} visual${expiredCells.length > 1 ? 's' : ''}) expired (>7 days) · Showing latest live data</span>
          <button id="switch-live-banner-btn" class="dbtc-btn btn-xs btn-primary">Switch to Latest Live Data</button>
        </div>
      `
          : ''
      }

      <div class="notebook-header-toolbar">
        <h1 class="notebook-title">${escapeHtml(store.notebook.title)}</h1>
        ${
          !isStory
            ? `
          <div class="notebook-actions">
            <button id="add-question-cell-btn" class="dbtc-btn btn-sm btn-secondary">+ Add Question Cell</button>
            <button id="add-markdown-cell-btn" class="dbtc-btn btn-sm btn-secondary">+ Add Markdown Cell</button>
            <button id="run-all-cells-btn" class="dbtc-btn btn-sm btn-primary">▶ Run All Cells</button>
          </div>
        `
            : ''
        }
      </div>

      <div class="cells-stack" id="cells-stack-container">
        ${store.cells
          .map(cell => {
            const isActive = cell.cellId === store.notebook.activeCellId;
            return `
            <section class="notebook-cell ${isActive ? 'cell-active' : ''}" id="cell-container-${cell.cellId}" data-cell-id="${cell.cellId}">
              <header class="cell-header">
                <div class="cell-header-left">
                  <span class="cell-ordinal">#${cell.ordinal}</span>
                  <span class="cell-title-tag">${escapeHtml(cell.title || (cell.kind === 'markdown' ? 'Markdown Story' : 'Untitled Question'))}</span>
                  <span class="cell-type-badge">${cell.kind === 'markdown' ? 'Story' : cell.chartType}</span>
                  ${
                    cell.executionState.status === 'stale-upstream'
                      ? `<button class="cell-stale-badge rerun-stale-btn" data-cell-id="${cell.cellId}" title="Upstream view changed. Click to re-run.">⚠️ Stale (Re-run)</button>`
                      : ''
                  }
                  ${
                    cell.snapshotState.status === 'pinned-valid'
                      ? `<button class="cell-pinned-badge switch-cell-live-btn" data-cell-id="${cell.cellId}" title="Pinned to DuckLake snapshot ${cell.snapshotState.snapshotId}. Click to switch to latest live data.">📌 Pinned (Switch to Live)</button>`
                      : ''
                  }
                </div>
                ${
                  !isStory
                    ? `
                  <div class="cell-header-right">
                    ${
                      cell.kind === 'markdown'
                        ? `
                      <button class="dbtc-btn btn-xs btn-ghost toggle-markdown-btn" data-cell-id="${cell.cellId}">
                        ${cell.showSqlEditor ? 'Preview' : 'Edit Story'}
                      </button>
                    `
                        : `
                      <button class="dbtc-btn btn-xs btn-ghost copy-cell-prompt-btn" data-cell-id="${cell.cellId}" title="Copy LLM schema, table, semantic model, and visual contract prompt to clipboard">
                        Copy Prompt
                      </button>
                      <button class="dbtc-btn btn-xs btn-ghost toggle-sql-btn" data-cell-id="${cell.cellId}">
                        ${cell.showSqlEditor ? 'Hide SQL' : 'Show SQL'}
                      </button>
                      <button class="dbtc-btn btn-xs btn-ghost toggle-ossie-btn" data-cell-id="${cell.cellId}">
                        ${cell.showOssiePillBar ? 'Hide Builder' : 'Metric Builder'}
                      </button>
                    `
                    }
                    <button class="dbtc-btn btn-xs btn-danger delete-cell-btn" data-cell-id="${cell.cellId}">
                      ✕
                    </button>
                  </div>
                `
                    : ''
                }
              </header>

              <div class="cell-body">
                ${
                  !isStory && cell.kind === 'question'
                    ? `<div class="cell-ossie-mount" id="ossie-mount-${cell.cellId}" style="${cell.showOssiePillBar ? '' : 'display: none;'}"></div>
                       <div class="cell-editor-mount" id="editor-mount-${cell.cellId}" style="${cell.showSqlEditor ? '' : 'display: none;'}"></div>`
                    : ''
                }
                <div class="cell-card-mount" id="card-mount-${cell.cellId}"></div>
              </div>
            </section>
          `;
          })
          .join('')}
      </div>
    </main>
  `;

  const editorCleanups = new Map<string, () => void>();
  const ossieCleanups = new Map<string, () => void>();

  const syncCellPanelsInPlace = (cellId: string) => {
    const cell = store.cells.find(c => c.cellId === cellId);
    if (!cell || cell.kind !== 'question' || isStory) return;

    const ossieMount = container.querySelector(`#ossie-mount-${cellId}`) as HTMLElement | null;
    const editorMount = container.querySelector(`#editor-mount-${cellId}`) as HTMLElement | null;
    const sqlBtn = container.querySelector(`.toggle-sql-btn[data-cell-id="${cellId}"]`) as HTMLElement | null;
    const ossieBtn = container.querySelector(`.toggle-ossie-btn[data-cell-id="${cellId}"]`) as HTMLElement | null;

    if (sqlBtn) sqlBtn.textContent = cell.showSqlEditor ? 'Hide SQL' : 'Show SQL';
    if (ossieBtn) ossieBtn.textContent = cell.showOssiePillBar ? 'Hide Builder' : 'Metric Builder';

    if (ossieMount) {
      if (cell.showOssiePillBar) {
        ossieMount.style.display = '';
        if (!ossieCleanups.has(cellId)) {
          const c = renderOssiePillBar(ossieMount, cell.cellId) as unknown;
          ossieCleanups.set(cellId, typeof c === 'function' ? (c as () => void) : () => { ossieMount.innerHTML = ''; });
        }
      } else {
        ossieMount.style.display = 'none';
        const prev = ossieCleanups.get(cellId);
        if (prev) {
          prev();
          ossieCleanups.delete(cellId);
        }
        ossieMount.innerHTML = '';
      }
    }

    if (editorMount) {
      if (cell.showSqlEditor) {
        editorMount.style.display = '';
        if (!editorCleanups.has(cellId)) {
          const c = renderCellEditor(editorMount, cell.cellId) as unknown;
          editorCleanups.set(cellId, typeof c === 'function' ? (c as () => void) : () => { editorMount.innerHTML = ''; });
        }
      } else {
        editorMount.style.display = 'none';
        const prev = editorCleanups.get(cellId);
        if (prev) {
          prev();
          editorCleanups.delete(cellId);
        }
        editorMount.innerHTML = '';
      }
    }
  };

  cleanups.push(() => {
    editorCleanups.forEach(c => c());
    editorCleanups.clear();
    ossieCleanups.forEach(c => c());
    ossieCleanups.clear();
  });

  // Mount active cell subcomponents
  for (const cell of store.cells) {
    if (!isStory && cell.kind === 'question' && (cell.showOssiePillBar || cell.showSqlEditor)) {
      syncCellPanelsInPlace(cell.cellId);
    }

    const cardMount = container.querySelector(`#card-mount-${cell.cellId}`) as HTMLElement | null;
    if (cardMount) {
      const cleanup = renderEditorialCard(cardMount, cell.cellId);
      cleanups.push(cleanup);
    }
  }

  // Cell selection on click
  container.querySelectorAll('.notebook-cell').forEach(cellEl => {
    cellEl.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('input') || target.closest('select')) return;
      const cellId = cellEl.getAttribute('data-cell-id');
      if (cellId && store.notebook.activeCellId !== cellId) {
        store.notebook.activeCellId = asCellId(cellId);
        container.querySelectorAll('.notebook-cell').forEach(c => c.classList.remove('cell-active'));
        cellEl.classList.add('cell-active');
      }
    });
  });

  // Re-run stale cell button
  container.querySelectorAll('.rerun-stale-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cellId = btn.getAttribute('data-cell-id');
      if (!cellId) return;
      const conn = getDuckDbConnection();
      if (!conn) return;
      await executeCellQuery(conn, asCellId(cellId));
      cleanups.forEach(c => c());
      renderNotebookView(container);
    });
  });

  // Switch pinned cell to live data button
  container.querySelectorAll('.switch-cell-live-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cellId = btn.getAttribute('data-cell-id');
      if (!cellId) return;
      const cell = store.cells.find(c => c.cellId === cellId);
      if (!cell) return;
      const conn = getDuckDbConnection();
      if (!conn) return;

      cell.ducklakeSnapshotId = null;
      cell.snapshotState = { status: 'unpinned' };
      await executeCellQuery(conn, cell.cellId);
      await persistCellToDuckDb(conn, cell);
      cleanups.forEach(c => c());
      renderNotebookView(container);
    });
  });

  // Toggle Markdown button
  container.querySelectorAll('.toggle-markdown-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cellId = btn.getAttribute('data-cell-id');
      const cell = store.cells.find(c => c.cellId === cellId);
      if (cell) {
        cell.showSqlEditor = !cell.showSqlEditor;
        cleanups.forEach(c => c());
        renderNotebookView(container);
      }
    });
  });

  // Copy LLM Prompt button on question cells
  container.querySelectorAll('.copy-cell-prompt-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const buttonEl = btn as HTMLButtonElement;
      const promptText = buildLlmSystemPrompt();
      const originalLabel = buttonEl.textContent ?? 'Copy Prompt';
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(promptText);
        } else {
          copyTextFallback(promptText);
        }
      } catch {
        copyTextFallback(promptText);
      }
      buttonEl.textContent = '✓ Copied Prompt!';
      setTimeout(() => {
        buttonEl.textContent = originalLabel.trim();
      }, 2000);
    });
  });

  // Toggle SQL button
  container.querySelectorAll('.toggle-sql-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cellId = btn.getAttribute('data-cell-id');
      const cell = store.cells.find(c => c.cellId === cellId);
      if (cell) {
        cell.showSqlEditor = !cell.showSqlEditor;
        if (cell.showSqlEditor) {
          cell.showOssiePillBar = false;
        }
        syncCellPanelsInPlace(cell.cellId);
      }
    });
  });

  // Toggle Ossie button
  container.querySelectorAll('.toggle-ossie-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cellId = btn.getAttribute('data-cell-id');
      const cell = store.cells.find(c => c.cellId === cellId);
      if (cell) {
        cell.showOssiePillBar = !cell.showOssiePillBar;
        if (cell.showOssiePillBar) {
          cell.showSqlEditor = false;
        }
        syncCellPanelsInPlace(cell.cellId);
      }
    });
  });

  // Delete Cell button with DAG warning
  container.querySelectorAll('.delete-cell-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cellId = btn.getAttribute('data-cell-id');
      if (!cellId) return;

      // Check if downstream cells depend on this cell
      const dependents = store.cells.filter(c => c.cellId !== cellId && findCellDependencies(c.sqlText).includes(asCellId(cellId)));
      if (dependents.length > 0) {
        const depNames = dependents.map(d => `#${d.ordinal} (${d.title})`).join(', ');
        if (!confirm(`Warning: Downstream cells [${depNames}] depend on cell_${cellId}. Deleting this cell will break those queries. Continue?`)) {
          return;
        }
      } else {
        if (!confirm(`Delete cell #${cellId}?`)) return;
      }

      store.cells = store.cells.filter(c => c.cellId !== cellId);
      if (store.notebook.activeCellId === cellId) {
        store.notebook.activeCellId = store.cells[0]?.cellId ?? null;
      }

      const conn = getDuckDbConnection();
      if (conn) {
        await deleteCellFromDuckDb(conn, asCellId(cellId));
      }
      cleanups.forEach(c => c());
      renderNotebookView(container);
    });
  });

  // Add Question Cell button
  const addQuestionBtn = container.querySelector('#add-question-cell-btn') as HTMLButtonElement | null;
  addQuestionBtn?.addEventListener('click', async () => {
    const newId = asCellId(`cell_${Date.now()}`);
    const ordinal = store.cells.length + 1;
    const newCell = {
      cellId: newId,
      ordinal,
      viewName: asCellViewIdentifier(`local.main.${newId}`),
      kind: 'question' as const,
      title: 'New Transit Visual',
      subtitle: 'Click to configure question',
      sourceNote: 'Source: StraphangerDB',
      markdownText: '',
      sqlText: 'SELECT * FROM prod.transit_v2.view_current_vehicle_positions LIMIT 50;',
      params: {},
      ossieConfig: null,
      chartType: 'table' as const,
      chartConfig: {},
      ducklakeSnapshotId: null,
      executionState: { status: 'idle' as const },
      snapshotState: { status: 'unpinned' as const },
      showSqlEditor: false,
      showOssiePillBar: true,
    };

    store.cells.push(newCell);
    store.notebook.activeCellId = newId;

    const conn = getDuckDbConnection();
    if (conn) {
      await persistCellToDuckDb(conn, newCell);
    }
    cleanups.forEach(c => c());
    renderNotebookView(container);
    const createdEl = container.querySelector(`#cell-container-${newId}`) as HTMLElement | null;
    createdEl?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  });

  // Add Markdown Cell button
  const addMarkdownBtn = container.querySelector('#add-markdown-cell-btn') as HTMLButtonElement | null;
  addMarkdownBtn?.addEventListener('click', async () => {
    const newId = asCellId(`cell_md_${Date.now()}`);
    const ordinal = store.cells.length + 1;
    const newCell = {
      cellId: newId,
      ordinal,
      viewName: asCellViewIdentifier(`local.main.${newId}`),
      kind: 'markdown' as const,
      title: 'Section Header',
      subtitle: '',
      sourceNote: '',
      markdownText: '### Narrative Context\n\nAdd civic advocacy commentary or transit journalism story notes here.',
      sqlText: '',
      params: {},
      ossieConfig: null,
      chartType: 'table' as const,
      chartConfig: {},
      ducklakeSnapshotId: null,
      executionState: { status: 'idle' as const },
      snapshotState: { status: 'unpinned' as const },
      showSqlEditor: false,
      showOssiePillBar: false,
    };

    store.cells.push(newCell);
    store.notebook.activeCellId = newId;

    const conn = getDuckDbConnection();
    if (conn) {
      await persistCellToDuckDb(conn, newCell);
    }
    cleanups.forEach(c => c());
    renderNotebookView(container);
    const createdEl = container.querySelector(`#cell-container-${newId}`) as HTMLElement | null;
    createdEl?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  });

  // Run all cells button
  const runAllBtn = container.querySelector('#run-all-cells-btn') as HTMLButtonElement | null;
  runAllBtn?.addEventListener('click', async () => {
    const conn = getDuckDbConnection();
    if (!conn) return;
    runAllBtn.disabled = true;
    runAllBtn.textContent = 'Running All...';
    try {
      for (const cell of store.cells) {
        if (cell.kind === 'question') {
          await executeCellQuery(conn, cell.cellId);
        }
      }
      cleanups.forEach(c => c());
      cleanups.forEach(c => c());
      renderNotebookView(container);
    } finally {
      runAllBtn.disabled = false;
      runAllBtn.textContent = '▶ Run All Cells';
    }
  });

  // Switch to live data banner button
  const switchLiveBtn = container.querySelector('#switch-live-banner-btn') as HTMLButtonElement | null;
  switchLiveBtn?.addEventListener('click', async () => {
    const conn = getDuckDbConnection();
    if (!conn) return;
    switchLiveBtn.disabled = true;
    switchLiveBtn.textContent = 'Updating to Live...';
    try {
      for (const cell of expiredCells) {
        cell.ducklakeSnapshotId = null;
        cell.snapshotState = { status: 'unpinned' };
        await executeCellQuery(conn, cell.cellId);
        await persistCellToDuckDb(conn, cell);
      }
      cleanups.forEach(c => c());
      renderNotebookView(container);
    } finally {
      switchLiveBtn.disabled = false;
    }
  });

  const handleCellUpdated = () => {
    cleanups.forEach(c => c());
    renderNotebookView(container);
  };
  window.addEventListener('dbtc:cell-updated', handleCellUpdated);
  cleanups.push(() => {
    window.removeEventListener('dbtc:cell-updated', handleCellUpdated);
  });

  return () => {
    cleanups.forEach(c => c());
    container.innerHTML = '';
  };
}

function copyTextFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
