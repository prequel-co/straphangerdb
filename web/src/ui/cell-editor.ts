import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { sql } from '@codemirror/lang-sql';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { EditorState, Prec } from '@codemirror/state';
import {
  store,
  watchReactive,
  persistCellToDuckDb,
  executeCellQuery,
  checkPartitionGuardrail,
  markDownstreamCellsStale,
} from '../state/store.js';
import {
  RECOMMENDED_ANALYTICS_RELATIONS,
  TRANSIT_SCHEMA_COLUMNS,
} from '../types/straphanger-schema.gen.js';
import { getDuckDbConnection } from '../data/duckdb-client.js';

const editorCleanups = new WeakMap<HTMLElement, () => void>();

function escapeEditorHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSqlAutocompleteSchema(): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  for (const [table, cols] of Object.entries(TRANSIT_SCHEMA_COLUMNS)) {
    const colNames = cols.map(c => c.name);
    schema[table] = colNames;
    schema[`prod.transit_v2.${table}`] = colNames;
  }
  return schema;
}

export function renderCellEditor(container: HTMLElement, cellId: string): () => void {
  const prevCleanup = editorCleanups.get(container);
  if (prevCleanup) {
    prevCleanup();
  }
  const cell = store.cells.find(c => c.cellId === cellId);
  if (!cell || cell.kind !== 'question') {
    container.innerHTML = '';
    return () => {};
  }

  container.innerHTML = `
    <div class="cell-editor-container">
      <div class="editor-status-banners"></div>

      <div class="editor-toolbar">
        <span class="editor-title">SQL Query (local.main.${escapeEditorHtml(cell.cellId)})</span>
        <div class="editor-actions">
          <button type="button" class="dbtc-btn btn-sm btn-primary run-cell-btn" title="Run query (Shift+Enter or Cmd/Ctrl+Enter)">
            ▶ Run Query <span style="opacity:0.75;font-size:10px;margin-left:3px;">⌘↵</span>
          </button>
        </div>
      </div>

      <div class="cm-mount-point" id="cm-mount-${escapeEditorHtml(cell.cellId)}"></div>

      <div class="editor-params-mount"></div>
      <div class="editor-error-mount"></div>

      <div class="editor-footer-tip" style="font-size: 11px; color: #64748B; padding: 4px 10px; border-top: 1px solid #E2E8F0; background: #F8FAFC;">
        Tip: Press <kbd>⌘↵</kbd> / <kbd>Shift+Enter</kbd> to run · Reference upstream cells as <code>local.main.&lt;cell_id&gt;</code> · Use <code>{{param}}</code> for inputs.
      </div>
    </div>
  `;

  // Mount CodeMirror
  const cmMount = container.querySelector(`#cm-mount-${cell.cellId}`) as HTMLElement | null;
  const bannersMount = container.querySelector('.editor-status-banners') as HTMLElement | null;
  const paramsMount = container.querySelector('.editor-params-mount') as HTMLElement | null;
  const errorMount = container.querySelector('.editor-error-mount') as HTMLElement | null;
  let cmView: EditorView | null = null;
  const runBtn = container.querySelector('.run-cell-btn') as HTMLButtonElement | null;

  const syncEditorOverlays = () => {
    if (bannersMount) {
      const guardrail = checkPartitionGuardrail(cell.sqlText);
      const isStale = cell.executionState.status === 'stale-upstream';
      const upstreamId = isStale ? (cell.executionState as { upstreamCellId?: string }).upstreamCellId : undefined;
      bannersMount.innerHTML = `
        ${
          isStale
            ? `<div class="stale-banner stale-rerun-banner" role="button" tabindex="0">⚠️ Upstream ${escapeEditorHtml(upstreamId ?? 'cell')} has updated. Click here to re-run this cell.</div>`
            : ''
        }
        ${
          !guardrail.ok && guardrail.warning
            ? `<div class="guardrail-warning-banner">⚠️ Guardrail Notice: ${escapeEditorHtml(guardrail.warning)}</div>`
            : ''
        }
      `;
      const staleEl = bannersMount.querySelector('.stale-rerun-banner') as HTMLElement | null;
      staleEl?.addEventListener('click', async () => {
        const conn = getDuckDbConnection();
        if (!conn) return;
        await executeCellQuery(conn, cell.cellId);
      });
    }

    if (paramsMount) {
      const paramMatches = Array.from(cell.sqlText.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)).map(m => m[1]!);
      const uniqueParams = Array.from(new Set(paramMatches));
      if (uniqueParams.length === 0) {
        paramsMount.innerHTML = '';
      } else {
        paramsMount.innerHTML = `
          <div class="cell-params-bar">
            <span class="params-label">Parameters:</span>
            ${uniqueParams
              .map(p => {
                const val = cell.params[p] ?? '';
                return `
                  <label class="param-input-label">
                    ${escapeEditorHtml(p)}:
                    <input type="text" class="dbtc-input-sm param-input" data-param-key="${escapeEditorHtml(p)}" value="${escapeEditorHtml(val)}" />
                  </label>
                `;
              })
              .join('')}
          </div>
        `;
        paramsMount.querySelectorAll('.param-input').forEach(inputEl => {
          inputEl.addEventListener('input', async e => {
            const key = inputEl.getAttribute('data-param-key');
            if (!key) return;
            const val = (e.target as HTMLInputElement).value;
            cell.params = { ...cell.params, [key]: val };
            const conn = getDuckDbConnection();
            if (conn) {
              await persistCellToDuckDb(conn, cell);
            }
          });
          inputEl.addEventListener('keydown', e => {
            const ke = e as KeyboardEvent;
            if (ke.key === 'Enter' && (ke.shiftKey || ke.metaKey || ke.ctrlKey)) {
              ke.preventDefault();
              void handleRunCell();
            }
          });
        });
      }
    }

    if (errorMount) {
      errorMount.innerHTML =
        cell.executionState.status === 'error'
          ? `<div class="query-error-banner">Query Error: ${escapeEditorHtml(cell.executionState.error)}</div>`
          : '';
    }
  };

  const runQueryNow = async () => {
    const conn = getDuckDbConnection();
    if (!conn) return;
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
    }
    try {
      await executeCellQuery(conn, cell.cellId);
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run Query';
      }
    }
  };

  const handleRunCell = async () => {
    const guardrail = checkPartitionGuardrail(cell.sqlText);
    if (!guardrail.ok) {
      showPartitionPushdownModal(async choice => {
        if (choice === 'cancel') {
          return;
        }
        if (choice === 'yesterday') {
          cell.sqlText = injectPartitionFilter(cell.sqlText, "event_date = CURRENT_DATE - INTERVAL '1 day'");
          if (cmView) {
            cmView.dispatch({
              changes: { from: 0, to: cmView.state.doc.length, insert: cell.sqlText },
            });
          }
        } else if (choice === 'today') {
          cell.sqlText = injectPartitionFilter(cell.sqlText, "event_date = CURRENT_DATE");
          if (cmView) {
            cmView.dispatch({
              changes: { from: 0, to: cmView.state.doc.length, insert: cell.sqlText },
            });
          }
        }
        await runQueryNow();
      });
      return;
    }

    await runQueryNow();
  };

  if (cmMount) {
    const dbtcCompletions = (context: CompletionContext) => {
      const word = context.matchBefore(/\w*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const options = RECOMMENDED_ANALYTICS_RELATIONS.map(rel => ({
        label: `prod.transit_v2.${rel}`,
        type: 'keyword',
        info: `DuckLake Lakehouse relation`,
      }));

      return {
        from: word.from,
        options,
      };
    };

    const state = EditorState.create({
      doc: cell.sqlText,
      extensions: [
        Prec.highest(
          keymap.of([
            {
              key: 'Shift-Enter',
              run: () => {
                void handleRunCell();
                return true;
              },
            },
            {
              key: 'Mod-Enter',
              run: () => {
                void handleRunCell();
                return true;
              },
            },
          ])
        ),
        basicSetup,
        sql({ schema: buildSqlAutocompleteSchema() }),
        autocompletion({ override: [dbtcCompletions] }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            cell.sqlText = update.state.doc.toString();
            markDownstreamCellsStale(cell.cellId);
            const conn = getDuckDbConnection();
            if (conn) {
              void persistCellToDuckDb(conn, cell);
            }
          }
        }),
      ],
    });

    cmView = new EditorView({
      state,
      parent: cmMount,
    });

    const [, unwatchSql] = watchReactive(
      () => cell.sqlText,
      newSql => {
        if (cmView && newSql !== cmView.state.doc.toString()) {
          cmView.dispatch({
            changes: { from: 0, to: cmView.state.doc.length, insert: newSql },
          });
        }
      }
    );
    const [, unwatchOverlays] = watchReactive(
      () => [
        cell.sqlText,
        cell.executionState.status,
        cell.executionState.status === 'error' ? cell.executionState.error : undefined,
      ],
      () => {
        syncEditorOverlays();
      }
    );

    const cleanup = () => {
      unwatchSql();
      unwatchOverlays();
      cmView?.destroy();
    };
    editorCleanups.set(container, cleanup);
  }

  syncEditorOverlays();

  // Handle Run Query button
  runBtn?.addEventListener('click', () => {
    void handleRunCell();
  });

  return () => {
    const c = editorCleanups.get(container);
    if (c) {
      c();
      editorCleanups.delete(container);
    }
  };
}

export function injectPartitionFilter(sqlText: string, filterClause: string): string {
  const cleanSql = sqlText.trim().replace(/(?:\s*;)+\s*$/, '');
  if (!cleanSql) return `${filterClause};`;

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  let topLevelWhereIndex = -1;
  let postWhereClauseIndex = -1;

  const whereRegex = /^WHERE\b/i;
  const postWhereRegex = /^(?:GROUP\s+BY|HAVING|WINDOW|QUALIFY|ORDER\s+BY|LIMIT)\b/i;

  const len = cleanSql.length;
  let i = 0;

  while (i < len) {
    const ch = cleanSql[i]!;
    const nextCh = i + 1 < len ? cleanSql[i + 1]! : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && nextCh === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      if (ch === "'") {
        if (nextCh === "'") {
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"') {
        if (nextCh === '"') {
          i += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (inBacktick) {
      if (ch === '`') {
        inBacktick = false;
      }
      i++;
      continue;
    }

    if (ch === '-' && nextCh === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && nextCh === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      i++;
      continue;
    }

    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth--;
      i++;
      continue;
    }

    if (depth === 0) {
      const prevChar = i > 0 ? cleanSql[i - 1]! : ' ';
      const isWordBoundary = /\s|[(),;]/.test(prevChar);

      if (isWordBoundary) {
        const remaining = cleanSql.slice(i);
        if (topLevelWhereIndex === -1 && whereRegex.test(remaining)) {
          topLevelWhereIndex = i;
          i += 5;
          continue;
        }

        if (postWhereClauseIndex === -1 && postWhereRegex.test(remaining)) {
          postWhereClauseIndex = i;
          break;
        }
      }
    }

    i++;
  }

  if (topLevelWhereIndex !== -1) {
    if (postWhereClauseIndex !== -1) {
      const before = cleanSql.slice(0, postWhereClauseIndex).trimEnd();
      const after = cleanSql.slice(postWhereClauseIndex).trimStart();
      return `${before} AND (${filterClause}) ${after};`;
    } else {
      return `${cleanSql} AND (${filterClause});`;
    }
  } else {
    if (postWhereClauseIndex !== -1) {
      const before = cleanSql.slice(0, postWhereClauseIndex).trimEnd();
      const after = cleanSql.slice(postWhereClauseIndex).trimStart();
      return `${before} WHERE ${filterClause} ${after};`;
    } else {
      return `${cleanSql} WHERE ${filterClause};`;
    }
  }
}

export function showPartitionPushdownModal(
  onSelect: (choice: 'yesterday' | 'today' | 'unbounded' | 'cancel') => void
): void {
  const overlay = document.createElement('div');
  overlay.className = 'guardrail-modal-overlay';
  overlay.innerHTML = `
    <div class="guardrail-modal-card">
      <h3>Partition Pushdown Guardrail</h3>
      <p>This query references an unbounded partitioned table without an <code>event_date</code> or <code>event_time</code> filter. Scanning across all historical dates may impact memory and query performance.</p>
      <div class="guardrail-modal-actions">
        <button id="modal-opt-yesterday" class="dbtc-btn btn-sm btn-primary">
          1. Add Yesterday Filter (CURRENT_DATE - INTERVAL '1 day')
        </button>
        <button id="modal-opt-today" class="dbtc-btn btn-sm btn-secondary">
          2. Add Today Filter (CURRENT_DATE)
        </button>
        <button id="modal-opt-unbounded" class="dbtc-btn btn-sm btn-danger">
          3. Proceed Unbounded (Run Full Scan)
        </button>
        <button id="modal-opt-cancel" class="dbtc-btn btn-xs btn-ghost" style="text-align: center; margin-top: 8px;">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = () => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  overlay.querySelector('#modal-opt-yesterday')?.addEventListener('click', () => {
    cleanup();
    onSelect('yesterday');
  });
  overlay.querySelector('#modal-opt-today')?.addEventListener('click', () => {
    cleanup();
    onSelect('today');
  });
  overlay.querySelector('#modal-opt-unbounded')?.addEventListener('click', () => {
    cleanup();
    onSelect('unbounded');
  });
  overlay.querySelector('#modal-opt-cancel')?.addEventListener('click', () => {
    cleanup();
    onSelect('cancel');
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      cleanup();
      onSelect('cancel');
    }
  });
}
