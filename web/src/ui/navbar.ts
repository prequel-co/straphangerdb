import { store, watchReactive, bumpHydrationEpoch, persistNotebookToDuckDb } from '../state/store.js';
import {
  exportBentoDocHtml,
  importBentoDocHtml,
  prehydrateFromEmbeddedBentoJson,
  clearDraftFromIndexedDb,
} from '../state/bento-serializer.js';
import { getDuckDbConnection, getDuckDbClient, syncDuckDbMode } from '../data/duckdb-client.js';
import { getTransitEmblemSvg } from './logo.js';
import { showToast } from './toast.js';

const navbarCleanups = new WeakMap<HTMLElement, () => void>();

export function renderNavbar(container: HTMLElement): void {
  const prevCleanup = navbarCleanups.get(container);
  if (prevCleanup) {
    prevCleanup();
  }
  container.innerHTML = `
    <header class="dbtc-navbar">
      <div class="navbar-left">
        <a href="https://dbtc.prequel.nyc" target="_blank" rel="noopener noreferrer" class="navbar-brand-link" title="Data Based Train Control (dbtc.prequel.nyc)">
          ${getTransitEmblemSvg(28)}
          <span class="navbar-brand">DATA BASED TRAIN CONTROL</span>
        </a>
        <a href="https://github.com/prequel-co/straphangerdb" target="_blank" rel="noopener noreferrer" class="navbar-subbrand navbar-subbrand-link" title="StraphangerDB GitHub Repository">StraphangerDB</a>

        <div class="view-switcher">
          <button id="view-studio-btn" class="btn-toggle ${store.notebook.activeView === 'studio' ? 'active' : ''}">
            Studio / Notebook
          </button>
          <button id="view-data-btn" class="btn-toggle ${store.notebook.activeView === 'data' ? 'active' : ''}">
            Data &amp; Uploads
          </button>
        </div>
      </div>

      <div class="navbar-center">
        <div class="mode-select-container">
          <label class="mode-select-label" for="mode-select">Mode:</label>
          <select id="mode-select" class="dbtc-select" title="Switch execution mode">
            <option value="standard" ${store.notebook.mode === 'standard' ? 'selected' : ''}>On Demand</option>
            <option value="offline" ${store.notebook.mode === 'offline' ? 'selected' : ''}>Offline</option>
            <option value="live" ${store.notebook.mode === 'live' ? 'selected' : ''}>Auto Refresh</option>
          </select>
          <div class="mode-tooltip-wrapper" id="mode-tooltip-wrapper">
            <button type="button" class="mode-info-btn" id="mode-info-btn" aria-label="Mode Information" aria-haspopup="dialog">ⓘ</button>
            <div class="mode-tooltip-popover" id="mode-tooltip-popover" role="tooltip">
              <div class="mode-tooltip-title">Notebook Execution Modes</div>
              <div class="mode-tooltip-section">
                <span class="mode-tooltip-badge mode-badge-standard">On Demand</span>
                <p class="mode-tooltip-text">Queries run only when executed manually or when notebook loads. Recommended for exploratory analysis.</p>
              </div>
              <div class="mode-tooltip-section">
                <span class="mode-tooltip-badge mode-badge-offline">Offline</span>
                <p class="mode-tooltip-text">Queries execute strictly against local DuckDB-WASM cache without sending remote lakehouse queries.</p>
              </div>
              <div class="mode-tooltip-section">
                <span class="mode-tooltip-badge mode-badge-live">Auto Refresh</span>
                <p class="mode-tooltip-text">Periodically re-executes queries every 1, 2, or 5 minutes for live headway monitoring.</p>
              </div>
            </div>
          </div>
        </div>

        ${
          store.notebook.mode === 'live'
            ? `
          <select id="live-interval-select" class="dbtc-select" aria-label="Auto-refresh interval">
            <option value="60" ${store.notebook.liveIntervalSec === 60 ? 'selected' : ''}>Every 1 min</option>
            <option value="120" ${store.notebook.liveIntervalSec === 120 ? 'selected' : ''}>Every 2 min</option>
            <option value="300" ${store.notebook.liveIntervalSec === 300 ? 'selected' : ''}>Every 5 min</option>
          </select>
          <span class="live-countdown-group">
            <span id="live-countdown-badge" class="live-countdown-badge" title="Time until next automatic live refresh">
              <span class="live-countdown-dot" aria-hidden="true"></span>
              <span id="live-countdown-text">LIVE</span>
            </span>
            <button id="live-refresh-now-btn" type="button" class="dbtc-btn btn-xs btn-secondary" title="Refresh all live queries immediately">
              ↻ Refresh Now
            </button>
          </span>
        `
            : ''
        }
      </div>

      <div class="navbar-right">
        <button id="story-mode-btn" class="dbtc-btn btn-secondary ${store.notebook.readOnlyStoryMode ? 'active' : ''}" title="Toggle Read / Story Presentation Mode">
          ${store.notebook.readOnlyStoryMode ? 'Exit Story' : 'Story Mode'}
        </button>
        <button
          id="save-bento-btn"
          class="dbtc-btn btn-primary"
          title="${
            store.notebook.mode === 'offline'
              ? 'Save Offline .dbtc.html (embeds cached tables & query results for offline viewing without network access)'
              : 'Save Standard .dbtc.html (lightweight notebook spec; re-queries live catalog on open. Switch to Offline Cache mode to embed data.)'
          }"
        >
          ${store.notebook.mode === 'offline' ? 'Save Offline .dbtc.html' : 'Save .dbtc.html'}
        </button>
        <label class="dbtc-btn btn-secondary file-upload-label" title="Open .dbtc.html notebook">
          Open
          <input type="file" id="open-bento-input" accept=".html,.dbtc.html" style="display:none;" />
        </label>
        <button id="reset-nb-btn" class="dbtc-btn btn-danger" title="Reset to starter notebook">
          Reset
        </button>
      </div>
    </header>
  `;

  // Attach event handlers
  const studioBtn = container.querySelector('#view-studio-btn') as HTMLButtonElement | null;
  const dataBtn = container.querySelector('#view-data-btn') as HTMLButtonElement | null;
  const modeSelect = container.querySelector('#mode-select') as HTMLSelectElement | null;
  const liveSelect = container.querySelector('#live-interval-select') as HTMLSelectElement | null;
  const storyModeBtn = container.querySelector('#story-mode-btn') as HTMLButtonElement | null;
  const tiltBtn = container.querySelector('#tilt-btn') as HTMLButtonElement | null;
  const saveBtn = container.querySelector('#save-bento-btn') as HTMLButtonElement | null;
  const openInput = container.querySelector('#open-bento-input') as HTMLInputElement | null;
  const resetBtn = container.querySelector('#reset-nb-btn') as HTMLButtonElement | null;

  storyModeBtn?.addEventListener('click', async () => {
    store.notebook.readOnlyStoryMode = !store.notebook.readOnlyStoryMode;
    const conn = getDuckDbConnection();
    if (conn) {
      await persistNotebookToDuckDb(conn, store.notebook);
    }
    renderNavbar(container);
  });

  const onNotebookUpdated = () => renderNavbar(container);
  if (typeof window !== 'undefined') {
    window.addEventListener('dbtc:notebook-updated', onNotebookUpdated, { once: true });
  }

  const updateViewButtons = () => {
    if (store.notebook.activeView === 'studio') {
      studioBtn?.classList.add('active');
      dataBtn?.classList.remove('active');
    } else {
      studioBtn?.classList.remove('active');
      dataBtn?.classList.add('active');
    }
  };

  const [, unwatchNav] = watchReactive(
    () => store.notebook.activeView,
    () => {
      updateViewButtons();
    }
  );

  studioBtn?.addEventListener('click', () => {
    store.notebook.activeView = 'studio';
    updateViewButtons();
  });

  dataBtn?.addEventListener('click', () => {
    store.notebook.activeView = 'data';
    updateViewButtons();
  });

  modeSelect?.addEventListener('change', async e => {
    const val = (e.target as HTMLSelectElement).value as 'standard' | 'offline' | 'live';
    store.notebook.mode = val;
    const conn = getDuckDbConnection();
    if (conn) {
      await syncDuckDbMode(conn);
      await persistNotebookToDuckDb(conn, store.notebook);
    }
    renderNavbar(container);
  });

  const modeInfoBtn = container.querySelector('#mode-info-btn') as HTMLButtonElement | null;
  const modeTooltipWrapper = container.querySelector('#mode-tooltip-wrapper') as HTMLElement | null;

  modeInfoBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modeTooltipWrapper?.classList.toggle('open');
  });

  const closeModeTooltip = (e: MouseEvent) => {
    if (modeTooltipWrapper && !modeTooltipWrapper.contains(e.target as Node)) {
      modeTooltipWrapper.classList.remove('open');
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeModeTooltip);
  }

  const countdownTextEl = container.querySelector('#live-countdown-text') as HTMLElement | null;
  const liveRefreshNowBtn = container.querySelector('#live-refresh-now-btn') as HTMLButtonElement | null;

  const updateLiveCountdown = () => {
    if (!countdownTextEl) return;
    if (store.notebook.isLiveRefreshing) {
      countdownTextEl.textContent = 'LIVE · Syncing…';
      if (liveRefreshNowBtn) liveRefreshNowBtn.disabled = true;
      return;
    }
    if (liveRefreshNowBtn) liveRefreshNowBtn.disabled = false;
    const nextAt = store.notebook.nextLiveRefreshAt;
    if (!nextAt || nextAt <= 0) {
      countdownTextEl.textContent = 'LIVE';
      return;
    }
    const remSec = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    const mins = Math.floor(remSec / 60);
    const secs = remSec % 60;
    countdownTextEl.textContent = `LIVE · ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  if (store.notebook.mode === 'live') {
    updateLiveCountdown();
    countdownTimer = setInterval(updateLiveCountdown, 1000);
  }

  liveRefreshNowBtn?.addEventListener('click', () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('dbtc:refresh-live-now'));
    }
  });

  navbarCleanups.set(container, () => {
    unwatchNav();
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', closeModeTooltip);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('dbtc:notebook-updated', onNotebookUpdated);
    }
  });

  liveSelect?.addEventListener('change', async e => {
    store.notebook.liveIntervalSec = Number((e.target as HTMLSelectElement).value);
    const conn = getDuckDbConnection();
    if (conn) {
      await persistNotebookToDuckDb(conn, store.notebook);
    }
  });

  tiltBtn?.addEventListener('click', () => {
    store.notebook.manhattanTilt = !store.notebook.manhattanTilt;
  });

  saveBtn?.addEventListener('click', async () => {
    const db = getDuckDbClient();
    const conn = getDuckDbConnection();
    if (!db || !conn) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const exportMode = store.notebook.mode === 'offline' ? 'offline' : 'standard';
      const html = await exportBentoDocHtml(db, conn, exportMode);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${store.notebook.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.dbtc.html`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(
        exportMode === 'offline'
          ? 'Saved Offline .dbtc.html with embedded cache.'
          : 'Saved Standard .dbtc.html notebook.',
        'success'
      );
    } catch (err) {
      console.error('Error saving .dbtc.html:', err);
      showToast(`Error saving .dbtc.html: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = store.notebook.mode === 'offline' ? 'Save Offline .dbtc.html' : 'Save .dbtc.html';
    }
  });

  openInput?.addEventListener('change', async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      bumpHydrationEpoch();
      const text = await file.text();
      const prehydrated = await prehydrateFromEmbeddedBentoJson(text);
      if (prehydrated && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dbtc:notebook-updated'));
      }
      const db = getDuckDbClient();
      const conn = getDuckDbConnection();
      if (db && conn) {
        await importBentoDocHtml(db, conn, text);
      }
      showToast(`Opened "${file.name}"`, 'success');
    } catch (err) {
      console.error('Error opening .dbtc.html:', err);
      showToast(`Error opening .dbtc.html: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      openInput.value = '';
    }
  });

  resetBtn?.addEventListener('click', async () => {
    if (confirm('Reset notebook to starter template? All unsaved cells and draft edits will be lost.')) {
      await clearDraftFromIndexedDb(store.notebook.docId);
      window.location.reload();
    }
  });
}
