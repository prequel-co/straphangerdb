import './styles/mta-modern.css';
import './styles/workspace.css';

import { initDuckDbClient, refreshRemoteCatalog, syncDuckDbMode } from './data/duckdb-client.js';
import {
  store,
  watchReactive,
  getHydrationEpoch,
  seedStarterCellsInStore,
  hydrateStoreFromDuckDb,
  executeCellQuery,
  hydrateCellRuntime,
  CellRuntimeRegistry,
} from './state/store.js';
import {
  importBentoDocHtml,
  prehydrateFromEmbeddedBentoJson,
  loadDraftFromIndexedDb,
  scheduleDraftAutosave,
} from './state/bento-serializer.js';
import { renderNavbar } from './ui/navbar.js';
import { renderSidebarDrawer } from './ui/sidebar-drawer.js';
import { renderNotebookView } from './ui/notebook-view.js';
import { renderBottomBar } from './ui/bottom-bar.js';
import { renderDataUploadsView } from './ui/data-uploads-view.js';
import { getTransitEmblemSvg } from './ui/logo.js';

async function bootstrap(): Promise<void> {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const bentoDocScript = document.getElementById('bento-doc');
  const embeddedJson = bentoDocScript?.textContent?.trim();
  const hasEmbeddedDoc = Boolean(embeddedJson && embeddedJson.length > 20);
  let prehydratedEmbedded = false;
  if (hasEmbeddedDoc && embeddedJson) {
    try {
      const parsedPayload = JSON.parse(embeddedJson);
      if (
        parsedPayload?.mode === 'offline' ||
        parsedPayload?.mode === 'standard' ||
        parsedPayload?.mode === 'live'
      ) {
        store.notebook.mode = parsedPayload.mode;
      }
    } catch {
      // Ignore malformed JSON preview
    }
    prehydratedEmbedded = await prehydrateFromEmbeddedBentoJson(embeddedJson);
  }

  let cleanupCurrentView = () => {};
  let bodyContainer: HTMLDivElement | null = null;
  let navMountEl: HTMLDivElement | null = null;

  const renderBody = () => {
    if (!bodyContainer) return;
    cleanupCurrentView();
    bodyContainer.innerHTML = '';

    if (store.notebook.activeView === 'studio') {
      const sidebarBackdrop = document.createElement('div');
      sidebarBackdrop.className = 'mobile-sidebar-backdrop';
      bodyContainer.appendChild(sidebarBackdrop);

      const sidebarMount = document.createElement('div');
      sidebarMount.id = 'sidebar-mount';
      bodyContainer.appendChild(sidebarMount);
      const cleanupSidebar = renderSidebarDrawer(sidebarMount);

      const setMobileSidebarOpen = (open: boolean) => {
        sidebarMount.classList.toggle('mobile-sidebar-open', open);
        sidebarBackdrop.classList.toggle('open', open);
      };
      const onToggleSidebar = () => {
        setMobileSidebarOpen(!sidebarMount.classList.contains('mobile-sidebar-open'));
      };
      const onCloseSidebar = () => {
        setMobileSidebarOpen(false);
      };
      sidebarBackdrop.addEventListener('click', onCloseSidebar);
      if (typeof window !== 'undefined') {
        window.addEventListener('dbtc:toggle-mobile-sidebar', onToggleSidebar);
        window.addEventListener('dbtc:close-mobile-sidebar', onCloseSidebar);
      }

      const notebookMount = document.createElement('div');
      notebookMount.id = 'notebook-mount';
      bodyContainer.appendChild(notebookMount);
      const cleanupNb = renderNotebookView(notebookMount);
      cleanupCurrentView = () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('dbtc:toggle-mobile-sidebar', onToggleSidebar);
          window.removeEventListener('dbtc:close-mobile-sidebar', onCloseSidebar);
        }
        cleanupSidebar();
        cleanupNb();
      };
    } else {
      const dataMount = document.createElement('div');
      dataMount.id = 'data-mount';
      bodyContainer.appendChild(dataMount);
      renderDataUploadsView(dataMount);
      cleanupCurrentView = () => {};
    }
  };

  const mountWorkspaceShell = () => {
    if (bodyContainer) return;
    appContainer.innerHTML = '';

    const navMount = document.createElement('div');
    navMount.id = 'navbar-mount';
    appContainer.appendChild(navMount);
    navMountEl = navMount;
    renderNavbar(navMount);

    bodyContainer = document.createElement('div');
    bodyContainer.className = 'dbtc-workspace-body';
    appContainer.appendChild(bodyContainer);

    const bottomMount = document.createElement('div');
    bottomMount.id = 'bottom-mount';
    appContainer.appendChild(bottomMount);
    renderBottomBar(bottomMount);

    renderBody();

    // Reactively watch view switch and story mode toggle immediately from shell mount
    watchReactive(
      () => [store.notebook.activeView, store.notebook.readOnlyStoryMode],
      () => {
        renderBody();
      }
    );

    if (typeof window !== 'undefined') {
      window.addEventListener('dbtc:notebook-updated', () => {
        if (navMountEl) {
          renderNavbar(navMountEl);
        }
        renderBody();
      });
    }
  };

  store.notebook.engineStatus = 'booting';

  if (!hasEmbeddedDoc) {
    // Seed starter cells in booting state and mount UI immediately so incognito / cold start
    // renders the full studio and narrative immediately with a distinct DuckDB-Wasm spin-up indicator.
    seedStarterCellsInStore('booting');
    mountWorkspaceShell();
  } else if (prehydratedEmbedded) {
    // Prehydrated from embedded #bento-doc JSON snapshot; mount UI and cached charts immediately
    // before DuckDB-Wasm finishes initializing.
    mountWorkspaceShell();
  } else {
    appContainer.innerHTML = `
      <div class="dbtc-loading-screen">
        ${getTransitEmblemSvg(44)}
        <div class="loading-title">DATA BASED TRAIN CONTROL</div>
        <div class="loading-subtitle">Restoring embedded notebook snapshot...</div>
      </div>
    `;
  }

  try {
    const { db, conn } = await initDuckDbClient();
    store.notebook.engineStatus = 'ready';

    if (hasEmbeddedDoc && embeddedJson) {
      await importBentoDocHtml(db, conn, embeddedJson, { deferUncachedQueries: true });
      mountWorkspaceShell();
    } else {
      const restoredDraft = await loadDraftFromIndexedDb(store.notebook.docId, db, conn);
      if (!restoredDraft) {
        await hydrateStoreFromDuckDb(conn);
      }
      // Transition waiting question cells from engine-booting/idle to query-running (or success if already cached) now that DuckDB-Wasm is active
      for (const cell of store.cells) {
        if (
          cell.kind === 'question' &&
          (cell.executionState.status === 'booting' || cell.executionState.status === 'idle')
        ) {
          const cached = CellRuntimeRegistry.get(cell.cellId)?.normalized;
          if (cached && cached.columns.length > 0) {
            cell.executionState = {
              status: 'success',
              executionMs: 1,
              rowCount: cached.totalRowCount,
              executedAt: Date.now(),
              executedMode: store.notebook.mode,
            };
          } else {
            cell.executionState = { status: 'running', startTime: Date.now() };
          }
        }
      }
      if (restoredDraft) {
        await syncDuckDbMode(conn);
        renderBody();
      } else {
        await syncDuckDbMode(conn);
      }
    }

    // Hydrate starter or restored queries sequentially; cells already cached in CellRuntimeRegistry
    // from a saved .dbtc.html snapshot complete in <1ms without remote catalog.db calls.
    const startupEpoch = getHydrationEpoch();
    for (const cell of store.cells) {
      if (getHydrationEpoch() !== startupEpoch) {
        break;
      }
      if (cell.kind === 'question') {
        try {
          await hydrateCellRuntime(conn, cell.cellId);
        } catch (err) {
          console.warn(`Initial hydration failed for cell ${cell.cellId}:`, err);
        }
      }
    }
    if (!hasEmbeddedDoc) {
      scheduleDraftAutosave(db, conn, 1500);
    }

    // Set up live auto-refresh timer if mode is live
    let liveTimer: ReturnType<typeof setInterval> | null = null;
    let isLivePolling = false;

    const runLiveRefreshCycle = async () => {
      if (isLivePolling || store.notebook.mode === 'offline') return;
      isLivePolling = true;
      store.notebook.isLiveRefreshing = true;
      try {
        await refreshRemoteCatalog(conn);
        for (const cell of store.cells) {
          if (cell.kind === 'question') {
            try {
              await executeCellQuery(conn, cell.cellId, false, { inPlaceRefresh: true });
            } catch (err) {
              console.error(`Live refresh error on cell ${cell.cellId}:`, err);
            }
          }
        }
        store.notebook.lastLiveRefreshAt = Date.now();
      } finally {
        isLivePolling = false;
        store.notebook.isLiveRefreshing = false;
        if (store.notebook.mode === 'live') {
          store.notebook.nextLiveRefreshAt = Date.now() + (store.notebook.liveIntervalSec || 60) * 1000;
        }
      }
    };

    const updateLiveTimer = () => {
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
      if (store.notebook.mode === 'live') {
        const intervalMs = (store.notebook.liveIntervalSec || 60) * 1000;
        store.notebook.nextLiveRefreshAt = Date.now() + intervalMs;
        liveTimer = setInterval(() => {
          void runLiveRefreshCycle();
        }, intervalMs);
      } else {
        store.notebook.nextLiveRefreshAt = undefined;
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('dbtc:refresh-live-now', () => {
        void runLiveRefreshCycle();
      });
    }

    updateLiveTimer();

    watchReactive(
      () => `${store.notebook.mode}:${store.notebook.liveIntervalSec}`,
      () => {
        void syncDuckDbMode(conn);
        updateLiveTimer();
      }
    );

    // Reactively watch store modifications to schedule draft autosave
    watchReactive(
      () => [
        store.notebook.title,
        store.notebook.mode,
        store.notebook.liveIntervalSec,
        store.cells.length,
        store.sources.length,
      ],
      () => {
        scheduleDraftAutosave(db, conn, 1500);
      }
    );

  } catch (err) {
    store.notebook.engineStatus = 'error';
    console.error('Fatal initialization error:', err);
    appContainer.innerHTML = `
      <div class="dbtc-error-screen">
        <h2>Initialization Error</h2>
        <p>${String(err)}</p>
      </div>
    `;
  }
}

void bootstrap();
