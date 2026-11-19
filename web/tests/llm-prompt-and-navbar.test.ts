import { describe, it, expect } from 'vitest';
import { buildLlmSystemPrompt } from '../src/ui/data-uploads-view.js';
import { renderNavbar } from '../src/ui/navbar.js';
import { renderSidebarDrawer } from '../src/ui/sidebar-drawer.js';

describe('LLM System Prompt Generator', () => {
  it('generates a comprehensive prompt with catalog, agencies, semantic metrics, and visual contracts', () => {
    const prompt = buildLlmSystemPrompt();

    // Check Lakehouse catalog reference
    expect(prompt).toContain('prod.transit_v2');
    expect(prompt).toContain('local.main');
    expect(prompt).toContain('event_date');

    // Check all 7 canonical NYC agencies
    expect(prompt).toContain('MTA_NYCT_SUBWAY');
    expect(prompt).toContain('MTA_BUS');
    expect(prompt).toContain('MTA_LIRR');
    expect(prompt).toContain('MTA_METRO_NORTH');
    expect(prompt).toContain('CITIBIKE');
    expect(prompt).toContain('NYC_FERRY');
    expect(prompt).toContain('MTA_NYCT_SIR');

    // Check recommended views & tables from straphanger-schema.gen.ts
    expect(prompt).toContain('view_dim_stations');
    expect(prompt).toContain('view_dim_routes');
    expect(prompt).toContain('view_station_complexes');
    expect(prompt).toContain('view_station_headways');
    expect(prompt).toContain('view_station_to_station_legs');
    expect(prompt).toContain('view_schedule_adherence');
    expect(prompt).toContain('view_station_hourly_summary');
    expect(prompt).toContain('fact_ridership');

    // Check all 9 transit visuals
    expect(prompt).toContain('marey-chart');
    expect(prompt).toContain('station-progression');
    expect(prompt).toContain('route-segment-map');
    expect(prompt).toContain('isochrone-map');
    expect(prompt).toContain('train-position-map');
    expect(prompt).toContain('headway-horizon');
    expect(prompt).toContain('adherence-waterfall');
    expect(prompt).toContain('multimodal-pulse');
    expect(prompt).toContain('od-ridership-flow');

    // Check that DBTC LLM prompt only renders the dbtc Ossie spec
    expect(prompt).toContain('### Spec: `dbtc`');
    expect(prompt).toContain("ossie_query('dbtc'");
    expect(prompt).not.toContain('network_accessibility_and_demand');
    expect(prompt).not.toContain('rail_operations');
    expect(prompt).not.toContain('service_reliability_and_micromobility');
    expect(prompt).not.toContain('### Spec: `surface_kinematics`');
    expect(prompt).not.toContain('### Theme: `surface_kinematics`');
    expect(prompt).not.toContain('unified_transit_network');

    // Strict constraint: absolutely no em-dashes
    expect(prompt).not.toContain('\u2014');
  });
});

describe('Navbar UI Modes', () => {
  it('renders On Demand, Offline, and Auto Refresh mode options', () => {
    const mockContainer: { innerHTML: string; querySelector: (sel: string) => null; querySelectorAll: (sel: string) => never[] } = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    renderNavbar(mockContainer as unknown as HTMLElement);

    expect(mockContainer.innerHTML).toContain('>On Demand</option>');
    expect(mockContainer.innerHTML).toContain('>Offline</option>');
    expect(mockContainer.innerHTML).toContain('>Auto Refresh</option>');
    expect(mockContainer.innerHTML).not.toContain('Standard (Views)');
    expect(mockContainer.innerHTML).not.toContain('Live Auto-Refresh');
  });
});

describe('Sidebar Visuals Selector', () => {
  it('uses clean SVG icons and zero emojis across all tiles', () => {
    const mockContainer: { innerHTML: string; querySelector: (sel: string) => null; querySelectorAll: (sel: string) => never[] } = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    const cleanup = renderSidebarDrawer(mockContainer as unknown as HTMLElement);

    // Verify all 9 transit tiles and standard BI tiles are rendered
    expect(mockContainer.innerHTML).toContain('data-chart-type="marey-chart"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="station-progression"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="route-segment-map"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="isochrone-map"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="train-position-map"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="headway-horizon"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="adherence-waterfall"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="multimodal-pulse"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="od-ridership-flow"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="bar"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="line"');
    expect(mockContainer.innerHTML).toContain('data-chart-type="table"');

    // Verify SVG icon markup is present
    expect(mockContainer.innerHTML).toContain('<svg viewBox="0 0 20 20"');

    // Verify zero emojis exist anywhere in tile icon markup
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u;
    expect(emojiRegex.test(mockContainer.innerHTML)).toBe(false);

    // Strict constraint: no em-dashes
    expect(mockContainer.innerHTML).not.toContain('\u2014');

    cleanup();
  });
});

describe('DBTC Ossie Spec UI & Socrata Visual Signifiers', () => {
  it('renders only the dbtc Ossie spec in renderOssiePillBar and renderDataUploadsView and shows connected signifiers for Socrata sources', async () => {
    const { renderOssiePillBar } = await import('../src/ui/ossie-pill-bar.js');
    const { renderDataUploadsView } = await import('../src/ui/data-uploads-view.js');
    const { store, seedStarterCellsInStore } = await import('../src/state/store.js');

    seedStarterCellsInStore('idle');

    const pillContainer = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    renderOssiePillBar(pillContainer as unknown as HTMLElement);
    expect(pillContainer.innerHTML).toContain('SEMANTIC METRIC BUILDER (dbtc.ossie.yaml)');
    expect(pillContainer.innerHTML).toContain('subway_station_headways');
    expect(pillContainer.innerHTML).toContain('#00933C');
    expect(pillContainer.innerHTML).not.toContain('rail_operations');
    expect(pillContainer.innerHTML).not.toContain('unified_transit_network');
    expect(pillContainer.innerHTML).not.toContain('network_accessibility_and_demand');

    store.sources = [
      {
        sourceName: 'mta_subway_stations_39hk_dx4f',
        kind: 'remote_csv_url',
        urlOrFilename: 'https://data.ny.gov/resource/39hk-dx4f.csv?$limit=50000',
        byteSize: 1024,
        includeInOfflineExport: false,
        createdAt: Date.now(),
      },
    ];

    const uploadsContainer = {
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    renderDataUploadsView(uploadsContainer as unknown as HTMLElement);

    // Section 1 combines NYC DuckLake Catalog and Ossie Semantic Model Reference (dbtc)
    expect(uploadsContainer.innerHTML).toContain('1. NYC DuckLake Catalog (prod.transit_v2) &amp; Ossie Semantic Model (dbtc');
    expect(uploadsContainer.innerHTML).toContain('2. Manual Upload: Local File or Connect Remote URL');
    expect(uploadsContainer.innerHTML).toContain('3. Search NY &amp; NYC Open Data Portals');
    expect(uploadsContainer.innerHTML).not.toContain('(Socrata SODA API)');
    expect(uploadsContainer.innerHTML).toContain('4. User-Defined SQL Views (local.main)');
    expect(uploadsContainer.innerHTML).not.toContain('rail_operations');
    expect(uploadsContainer.innerHTML).not.toContain('unified_transit_network');

    // Connected Socrata row displays connected badge and green button state
    expect(uploadsContainer.innerHTML).toContain('socrata-row-connected');
    expect(uploadsContainer.innerHTML).toContain('socrata-connected-pill');
    expect(uploadsContainer.innerHTML).toContain('✓ Connected in DuckDB');
    expect(uploadsContainer.innerHTML).toContain('✓ Mounted in DuckDB');

    store.sources = [];
  });

  it('formats query duration in formatFreshness and supports column remapping across chart types', async () => {
    const { formatFreshness, formatQueryDuration } = await import('../src/ui/editorial-card.js');
    const {
      CHART_DEFAULT_SCHEMAS,
      resolveChartColumnMapping,
      applyChartColumnMapping,
      isChartSchemaCompatible,
    } = await import('../src/types/schema-contracts.js');
    const { store, seedStarterCellsInStore } = await import('../src/state/store.js');

    expect(formatQueryDuration(142)).toBe('142ms');
    expect(formatQueryDuration(1250)).toBe('1.25s');

    seedStarterCellsInStore('idle');
    const cell = store.cells.find(c => c.kind === 'question')!;
    cell.executionState = {
      status: 'success',
      executionMs: 285,
      rowCount: 42,
      executedAt: Date.now(),
      executedMode: 'standard',
    };
    const freshness = formatFreshness(cell);
    expect(freshness).toContain('On Demand · Updated');
    expect(freshness).toContain('· 285ms');

    // Every chart type has a default schema definition
    expect(Object.keys(CHART_DEFAULT_SCHEMAS).length).toBe(25);
    expect(isChartSchemaCompatible('bar', ['station_name', 'total_entries'])).toBe(true);
    expect(isChartSchemaCompatible('marey-chart', ['station_name', 'total_entries'])).toBe(false);

    // Remapping custom columns onto a chart's target schema aliases them cleanly
    const colMetas = [
      { name: 'borough_label', type: 'VARCHAR' },
      { name: 'riders_count', type: 'BIGINT' },
    ];
    const rawRows = [
      { borough_label: 'Manhattan', riders_count: 1200000 },
      { borough_label: 'Brooklyn', riders_count: 850000 },
    ];
    const resolved = resolveChartColumnMapping('bar', colMetas, {
      x: 'borough_label',
      y: 'riders_count',
    });
    expect(resolved['x']).toBe('borough_label');
    expect(resolved['y']).toBe('riders_count');

    const mapped = applyChartColumnMapping('bar', rawRows, colMetas, {
      columnMapping: {
        x: 'borough_label',
        y: 'riders_count',
      },
    });
    expect(mapped.effectiveConfig['xColumn']).toBe('borough_label');
    expect(mapped.effectiveConfig['yColumns']).toEqual(['riders_count']);
    expect(mapped.mappedRows[0]?.['category']).toBe('Manhattan');
    expect(mapped.mappedRows[0]?.['value']).toBe(1200000);
  });

  it('preserves pre-seeded store.cells object references and running state during cold-start hydrateStoreFromDuckDb', async () => {
    const { store, seedStarterCellsInStore, hydrateStoreFromDuckDb } = await import('../src/state/store.js');
    seedStarterCellsInStore('running');
    const firstQuestionCellBefore = store.cells.find(c => c.kind === 'question');
    expect(firstQuestionCellBefore?.executionState.status).toBe('running');

    const executedQueries: string[] = [];
    const mockConn = {
      query: async (sql: string) => {
        executedQueries.push(sql);
        return {
          numRows: 0,
          schema: { fields: [] },
          getChildAt: () => null,
        };
      },
    } as never;

    await hydrateStoreFromDuckDb(mockConn);
    const firstQuestionCellAfter = store.cells.find(c => c.kind === 'question');
    expect(firstQuestionCellAfter).toBe(firstQuestionCellBefore);
    expect(firstQuestionCellAfter?.executionState.status).toBe('running');
    expect(executedQueries.some(q => q.includes('prod.snapshots()'))).toBe(false);
    expect(executedQueries.some(q => q.includes('information_schema.tables'))).toBe(false);
  });

  it('populates the interactive Columns schema remapping popover in renderEditorialCard and updates columnMapping on selection change', async () => {
    const { renderEditorialCard } = await import('../src/ui/editorial-card.js');
    const { store, CellRuntimeRegistry, seedStarterCellsInStore } = await import('../src/state/store.js');

    seedStarterCellsInStore('idle');
    const barCell = store.cells.find(c => c.cellId === 'cell_basic_bar_turnstiles')!;
    expect(barCell).toBeDefined();

    CellRuntimeRegistry.set(barCell.cellId, {
      normalized: {
        columns: [
          { name: 'station_name', type: 'VARCHAR' },
          { name: 'total_entries', type: 'BIGINT' },
          { name: 'alt_metric', type: 'DOUBLE' },
        ],
        rows: [
          { station_name: 'Times Sq-42 St', total_entries: 145000, alt_metric: 98.5 },
          { station_name: 'Grand Central-42 St', total_entries: 132000, alt_metric: 91.2 },
        ],
        totalRowCount: 2,
      },
    });

    type MockEl = {
      innerHTML: string;
      textContent: string;
      value: string;
      style: { display: string; borderColor: string; color: string };
      listeners: Record<string, Array<(ev: unknown) => void>>;
      addEventListener: (type: string, fn: (ev: unknown) => void) => void;
      getAttribute: (attr: string) => string | null;
      querySelectorAll: (sel: string) => MockEl[];
    };

    const childSelects: MockEl[] = [];
    const makeMockEl = (attrs: Record<string, string> = {}, initialDisplay = ''): MockEl => {
      const listeners: Record<string, Array<(ev: unknown) => void>> = {};
      const el: MockEl = {
        innerHTML: '',
        textContent: '',
        value: '',
        style: { display: initialDisplay, borderColor: '', color: '' },
        listeners,
        addEventListener: (type, fn) => {
          listeners[type] = listeners[type] ?? [];
          listeners[type]!.push(fn);
        },
        getAttribute: (attr) => attrs[attr] ?? null,
        querySelectorAll: (sel) => {
          if (sel === '.schema-role-select') {
            childSelects.length = 0;
            const regex = /data-role-key="([^"]+)"/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(el.innerHTML)) !== null) {
              const roleKey = match[1]!;
              childSelects.push(makeMockEl({ 'data-role-key': roleKey }));
            }
            return childSelects;
          }
          return [];
        },
      };
      return el;
    };

    const remapBtn = makeMockEl();
    const remapMenu = makeMockEl({}, 'none');
    const remapStatus = makeMockEl();
    const remapRoles = makeMockEl();
    const remapReset = makeMockEl();

    const elementsById: Record<string, MockEl> = {
      [`#schema-remap-btn-${barCell.cellId}`]: remapBtn,
      [`#schema-remap-menu-${barCell.cellId}`]: remapMenu,
      [`#schema-remap-status-${barCell.cellId}`]: remapStatus,
      [`#schema-remap-roles-${barCell.cellId}`]: remapRoles,
      [`#schema-remap-reset-${barCell.cellId}`]: remapReset,
    };

    const mountEl = {
      innerHTML: '',
      querySelector: (sel: string) => elementsById[sel] ?? null,
      querySelectorAll: () => [],
    };

    const cleanup = renderEditorialCard(mountEl as unknown as HTMLElement, barCell.cellId);

    // Verify initial populateSchemaRemapMenu populated status and roles
    expect(remapStatus.textContent).toContain('Compatible with default schema');
    expect(remapRoles.innerHTML).toContain('class="schema-role-select"');
    expect(remapRoles.innerHTML).toContain('data-role-key="x"');
    expect(remapRoles.innerHTML).toContain('data-role-key="y"');
    expect(remapRoles.innerHTML).toContain('alt_metric');

    // Click Columns button to open popover
    remapBtn.listeners['click']?.[0]?.({ stopPropagation: () => {} });
    expect(remapMenu.style.display).toBe('block');

    // Remap the 'y' role to 'alt_metric' via the bound change listener
    const ySelect = childSelects.find(s => s.getAttribute('data-role-key') === 'y')!;
    expect(ySelect).toBeDefined();
    ySelect.value = 'alt_metric';
    ySelect.listeners['change']?.[0]?.({ target: ySelect });

    expect((barCell.chartConfig['columnMapping'] as Record<string, string>)?.['y']).toBe('alt_metric');
    expect(remapStatus.textContent).toContain('Custom column mapping active');

    // Trigger reset button
    remapReset.listeners['click']?.[0]?.({});
    expect(barCell.chartConfig['columnMapping']).toBeUndefined();
    expect(remapStatus.textContent).toContain('Compatible with default schema');

    cleanup();
  });
});



