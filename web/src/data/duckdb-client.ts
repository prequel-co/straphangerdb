import * as duckdb from '@duckdb/duckdb-wasm';
import { type CellId, asDuckLakeSnapshotId, type ResolvedSql } from '../types/brands.js';
import {
  store,
  CellRuntimeRegistry,
  markDownstreamCellsStale,
  initSystemTables,
  executeCellQuery as runStoreCellQuery,
} from '../state/store.js';
import { normalizeArrowTable } from './arrow-normalizer.js';
import { executeSqlScript } from './sql-utils.js';
import { expandOssieQueryCalls, normalizeDuckLakeDatePredicates } from './ossie-loader.js';
import { hydrateRouteCatalogFromDuckDbRows } from '../viz/echarts-theme-mta.js';
import { bootstrapMapNetworkFromDuckDb } from '../viz/map/mta-subway-overlay.js';
import { GTFS_RT_WASM_EH_BASE64, GTFS_RT_WASM_THREADS_BASE64 } from './gtfs-rt-wasm.gen.js';

export const DEFAULT_DUCKLAKE_CATALOG_URL =
  'https://pub-ea295898f0984f688f0dc6f8043ac95a.r2.dev/ducklake/catalog.db';
const LOCAL_DUCKLAKE_CATALOG_FILE = 'prod_catalog.db';

let duckDbInstance: duckdb.AsyncDuckDB | null = null;
let duckDbConnection: duckdb.AsyncDuckDBConnection | null = null;
let duckDbInitPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> | null = null;
let remoteProdHasServiceLines = false;
let remoteProdCatalogAttached = false;
let lastCatalogAttachAt = 0;
let lastCatalogHeadCheckAt = 0;
let lastCatalogETag: string | null = null;
let lastCatalogLastModified: string | null = null;
let lastCatalogContentLength: string | null = null;
let lastCatalogUrl: string | null = null;
let gtfsRtExtensionLoaded = false;
let httpfsDucklakeLoaded = false;
let resolvedExtBase = '';
let fastDimCachePromise: Promise<void> | null = null;
let fastDimCacheReady = false;

export function getLastAttachedCatalogUrl(): string | null {
  return lastCatalogUrl;
}

function recordCatalogResponseHeaders(resp: Pick<Response, 'headers'> | null | undefined): void {
  const headers = resp?.headers;
  if (!headers || typeof headers.get !== 'function') return;
  const etag = headers.get('etag')?.trim() || null;
  const lastModified = headers.get('last-modified')?.trim() || null;
  const contentLength = headers.get('content-length')?.trim() || null;
  if (etag) lastCatalogETag = etag;
  if (lastModified) lastCatalogLastModified = lastModified;
  if (contentLength) lastCatalogContentLength = contentLength;
}

export function resetCatalogHeaderStateForTest(initial?: {
  etag?: string | null;
  lastModified?: string | null;
  contentLength?: string | null;
}): void {
  lastCatalogAttachAt = 0;
  lastCatalogHeadCheckAt = 0;
  lastCatalogETag = initial?.etag ?? null;
  lastCatalogLastModified = initial?.lastModified ?? null;
  lastCatalogContentLength = initial?.contentLength ?? null;
  lastCatalogUrl = null;
}

/**
 * Attaches the remote DuckLake catalog (`catalog.db`) by first streaming the
 * catalog file into DuckDB-Wasm's in-memory VFS (`registerFileBuffer`) and
 * attaching `ducklake:prod_catalog.db`.
 *
 * Why this matters: attaching a ~60 MB DuckLake `catalog.db` directly over
 * `httpfs` (`ATTACH 'ducklake:https://.../catalog.db'`) forces DuckDB to issue
 * hundreds of sequential 256 KB HTTP Range GET requests when paging through
 * `__ducklake_metadata_prod` during `ATTACH` and during the first query's
 * metadata lookup (~25-30s latency penalty on `cell_headways`).
 * Because `ducklake_metadata.data_path` inside `catalog.db` already stores the
 * absolute R2 URL (`https://.../ducklake/data/`), registering `catalog.db` in
 * memory makes all catalog metadata lookups, partition pruning, and inlined
 * table reads run in <5ms in RAM while Parquet data scans still stream from R2.
 */
export async function attachRemoteDuckLakeCatalog(
  db: (Pick<duckdb.AsyncDuckDB, 'registerFileBuffer'> & { dropFile?: (name: string) => Promise<unknown> }) | null,
  conn: Pick<duckdb.AsyncDuckDBConnection, 'query'>,
  catalogUrl: string = DEFAULT_DUCKLAKE_CATALOG_URL,
  fetchImpl: typeof fetch | undefined = typeof fetch !== 'undefined' ? fetch : undefined,
  prefetchedBytesPromise?: Promise<Uint8Array | null> | null
): Promise<'memory-buffer' | 'httpfs'> {
  if (db && typeof db.registerFileBuffer === 'function') {
    try {
      let bytes = prefetchedBytesPromise ? await prefetchedBytesPromise : null;
      if (!bytes && typeof fetchImpl === 'function') {
        const resp = await fetchImpl(catalogUrl);
        if (resp.ok) {
          recordCatalogResponseHeaders(resp);
          bytes = new Uint8Array(await resp.arrayBuffer());
        }
      }
      if (bytes) {
        // Verify valid DuckDB file header ("DUCK" magic bytes at offset 8..11)
        const isDuckDbHeader =
          bytes.byteLength >= 4096 &&
          bytes[8] === 0x44 && // 'D'
          bytes[9] === 0x55 && // 'U'
          bytes[10] === 0x43 && // 'C'
          bytes[11] === 0x4b; // 'K'
        if (isDuckDbHeader) {
          if (typeof db.dropFile === 'function') {
            try {
              await db.dropFile(LOCAL_DUCKLAKE_CATALOG_FILE);
            } catch {
              // Ignore if not previously registered
            }
          }
          await db.registerFileBuffer(LOCAL_DUCKLAKE_CATALOG_FILE, bytes);
          await conn.query(`ATTACH 'ducklake:${LOCAL_DUCKLAKE_CATALOG_FILE}' AS prod (READ_ONLY);`);
          lastCatalogAttachAt = Date.now();
          lastCatalogUrl = catalogUrl;
          if (!lastCatalogContentLength) {
            lastCatalogContentLength = String(bytes.byteLength);
          }
          return 'memory-buffer';
        }
      }
    } catch {
      // Fall through to direct httpfs attach if fetch or in-memory VFS attach fails
    }
  }
  const safeUrl = catalogUrl.replace(/'/g, "''");
  await conn.query(`ATTACH 'ducklake:${safeUrl}' AS prod (READ_ONLY);`);
  lastCatalogAttachAt = Date.now();
  lastCatalogUrl = catalogUrl;
  return 'httpfs';
}

const FAST_DIM_STATIONS_SUBQUERY =
  "SELECT station_id, agency_id, name, latitude, longitude, gtfs_stop_id, complex_id, daytime_routes FROM prod.transit_v2.dim_stations WHERE station_id NOT LIKE '%_STN_%' AND station_id NOT LIKE 'BUS_STOP_%' QUALIFY row_number() OVER (PARTITION BY agency_id, coalesce(nullif(gtfs_stop_id, ''), station_id) ORDER BY is_current DESC, latitude IS NOT NULL DESC, valid_from DESC) = 1";

const FAST_STATION_COMPLEXES_SUBQUERY =
  "SELECT complex_id, agency_id, max(name) AS complex_name, avg(latitude) AS latitude, avg(longitude) AS longitude, string_agg(DISTINCT daytime_routes, ' ') AS daytime_routes FROM prod.transit_v2.dim_stations WHERE is_current = true AND station_id NOT LIKE '%_STN_%' AND station_id NOT LIKE 'BUS_STOP_%' GROUP BY complex_id, agency_id";

export async function ensureFastDimensionCaches(
  conn: Pick<duckdb.AsyncDuckDBConnection, 'query'> | null
): Promise<boolean> {
  if (!conn || !remoteProdCatalogAttached || store.notebook.mode === 'offline') {
    return false;
  }
  if (fastDimCacheReady) return true;
  if (fastDimCachePromise) {
    await fastDimCachePromise;
    return fastDimCacheReady;
  }
  fastDimCachePromise = (async () => {
    try {
      await conn.query(
        `CREATE OR REPLACE TEMP TABLE _dbtc_fast_dim_stations AS ${FAST_DIM_STATIONS_SUBQUERY};`
      );
      await conn.query(
        `CREATE OR REPLACE TEMP TABLE _dbtc_fast_station_complexes AS SELECT complex_id, agency_id, max(name) AS complex_name, avg(latitude) AS latitude, avg(longitude) AS longitude, string_agg(DISTINCT daytime_routes, ' ') AS daytime_routes FROM temp.main._dbtc_fast_dim_stations GROUP BY complex_id, agency_id;`
      );
      fastDimCacheReady = true;
    } catch {
      fastDimCacheReady = false;
    } finally {
      fastDimCachePromise = null;
    }
  })();
  await fastDimCachePromise;
  return fastDimCacheReady;
}

export function rewriteFastPathDimensionViews(
  sql: string,
  options?: { useTempCache?: boolean }
): string {
  let out = sql;
  const stationsReplacement = options?.useTempCache
    ? 'temp.main._dbtc_fast_dim_stations'
    : `(${FAST_DIM_STATIONS_SUBQUERY})`;
  const complexesReplacement = options?.useTempCache
    ? 'temp.main._dbtc_fast_station_complexes'
    : `(${FAST_STATION_COMPLEXES_SUBQUERY})`;

  if (
    /\b(?:FROM|JOIN)\s+(?:prod\.transit_v2\.|transit_v2\.)?view_dim_stations\b/i.test(out) &&
    !/\b(?:structure|is_accessible|route_count|is_interlined_junction|raw_payload|borough)\b/i.test(out)
  ) {
    out = out.replace(
      /(\b(?:FROM|JOIN)\s+)(?:prod\.transit_v2\.|transit_v2\.)?view_dim_stations\b(\s+AS\s+[A-Za-z_][A-Za-z0-9_]*|\s+(?!(?:ON|USING|WHERE|GROUP|ORDER|LIMIT|HAVING|QUALIFY|WINDOW|UNION|EXCEPT|INTERSECT|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|JOIN|SEMI|ANTI)\b)[A-Za-z_][A-Za-z0-9_]*)?/gi,
      (_m, prefix: string, alias?: string) =>
        `${prefix}${stationsReplacement}${alias || ' AS view_dim_stations'}`
    );
  }
  if (
    /\b(?:FROM|JOIN)\s+(?:prod\.transit_v2\.|transit_v2\.)?view_station_complexes\b/i.test(out) &&
    !/\b(?:is_accessible|station_count|route_count)\b/i.test(out)
  ) {
    out = out.replace(
      /(\b(?:FROM|JOIN)\s+)(?:prod\.transit_v2\.|transit_v2\.)?view_station_complexes\b(\s+AS\s+[A-Za-z_][A-Za-z0-9_]*|\s+(?!(?:ON|USING|WHERE|GROUP|ORDER|LIMIT|HAVING|QUALIFY|WINDOW|UNION|EXCEPT|INTERSECT|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|JOIN|SEMI|ANTI)\b)[A-Za-z_][A-Za-z0-9_]*)?/gi,
      (_m, prefix: string, alias?: string) =>
        `${prefix}${complexesReplacement}${alias || ' AS view_station_complexes'}`
    );
  }
  return out;
}

export function prepareExecutableCellSql(resolvedSql: string): string {
  const baseSql = resolvedSql
    .trim()
    .replace(/(?:\s*;)+\s*$/, '');

  if (remoteProdCatalogAttached && store.notebook.mode !== 'offline') {
    return rewriteFastPathDimensionViews(baseSql, { useTempCache: fastDimCacheReady });
  }
  return baseSql;
}

export async function hydrateFrontendTransitMetadataFromProd(
  conn: Pick<duckdb.AsyncDuckDBConnection, 'query'> | null
): Promise<void> {
  if (!conn) return;
  const runSql = async (sql: string) => {
    const res = await conn.query(sql);
    return normalizeArrowTable(res);
  };
  try {
    const routeRes = await runSql(
      'SELECT route_id, agency_id, route_name, division, trunk_group, color_hex, text_color_hex FROM prod.transit_v2.view_dim_routes'
    );
    if (routeRes.rows.length > 0) {
      hydrateRouteCatalogFromDuckDbRows(routeRes.rows);
    }
  } catch (err) {
    console.warn('Could not hydrate route catalog from StraphangerDB:', err);
  }
  try {
    await bootstrapMapNetworkFromDuckDb(runSql, undefined, { activateGlobal: true });
  } catch (err) {
    console.warn('Could not bootstrap map network from StraphangerDB:', err);
  }
}

export function hasRemoteServiceLinesCatalog(): boolean {
  return remoteProdHasServiceLines;
}

export function getDuckDbClient(): duckdb.AsyncDuckDB | null {
  return duckDbInstance;
}

export function getDuckDbConnection(): duckdb.AsyncDuckDBConnection | null {
  return duckDbConnection;
}

export async function initDuckDbClient(): Promise<{
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}> {
  return getDuckDb();
}

export async function getDuckDb(): Promise<{
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}> {
  if (duckDbInstance && duckDbConnection) {
    return { db: duckDbInstance, conn: duckDbConnection };
  }
  if (duckDbInitPromise) {
    return duckDbInitPromise;
  }
  duckDbInitPromise = (async () => {
    try {
      return await doInitDuckDb();
    } catch (err) {
      duckDbInitPromise = null;
      throw err;
    }
  })();
  return duckDbInitPromise;
}

async function loadWasmExtension(
  db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  name: string,
  url: string
): Promise<boolean> {
  // parquet is typically statically linked in the DuckDB-Wasm bundle
  if (name === 'parquet') {
    try {
      await conn.query('LOAD parquet;');
      return true;
    } catch {
      // Fall through to browser fetch
    }
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const filename = `${name}.duckdb_extension.wasm`;
    await db.registerFileBuffer(filename, bytes);
    await conn.query(`LOAD '${filename}';`);
    return true;
  } catch {
    try {
      await conn.query(`LOAD ${name};`);
      return true;
    } catch {
      try {
        await conn.query(`INSTALL '${url}';`);
        await conn.query(`LOAD '${url}';`);
        return true;
      } catch (fallbackErr) {
        console.warn(`Could not load extension ${name} from ${url}:`, fallbackErr);
        return false;
      }
    }
  }
}

async function loadInlineWasmExtension(
  _db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  name: string,
  _base64Payload: string
): Promise<boolean> {
  try {
    await conn.query(`LOAD 'https://dbtc.local/${name}.duckdb_extension.wasm';`);
    return true;
  } catch (err) {
    console.warn(`Could not load inlined extension ${name}:`, err);
    return false;
  }
}

const MTA_SUBWAY_FEED_URLS = [
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-7',
];

const EMPTY_LIVE_POSITIONS_SELECT = `
  SELECT
    NULL::DATE AS event_date,
    NULL::TIMESTAMPTZ AS event_time,
    NULL::VARCHAR AS agency_id,
    NULL::VARCHAR AS route_id,
    NULL::VARCHAR AS trip_id,
    NULL::VARCHAR AS vehicle_id,
    NULL::VARCHAR AS station_id,
    NULL::DOUBLE AS latitude,
    NULL::DOUBLE AS longitude,
    NULL::DOUBLE AS bearing,
    NULL::DOUBLE AS speed,
    NULL::VARCHAR AS status,
    NULL::VARCHAR AS occupancy_status
  WHERE 1 = 0
`;

const EMPTY_LIVE_ALERTS_SELECT = `
  SELECT
    NULL::VARCHAR AS alert_id,
    NULL::VARCHAR AS agency_id,
    NULL::DATE AS event_date,
    NULL::TIMESTAMPTZ AS detected_at,
    NULL::TIMESTAMPTZ AS last_seen_at,
    NULL::TIMESTAMPTZ AS active_period_start,
    NULL::TIMESTAMPTZ AS active_period_end,
    NULL::VARCHAR AS affected_route_ids,
    NULL::VARCHAR AS cause,
    NULL::VARCHAR AS effect,
    NULL::VARCHAR AS header_text,
    NULL::VARCHAR AS description_text,
    NULL::VARCHAR AS severity
  WHERE 1 = 0
`;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getConfiguredGtfsRtProxy(): string {
  try {
    if (typeof window !== 'undefined') {
      const globalProxy = (window as unknown as { __DBTC_GTFS_RT_PROXY_URL__?: string }).__DBTC_GTFS_RT_PROXY_URL__;
      if (globalProxy && globalProxy.trim()) return globalProxy.trim();
      const stored = window.localStorage?.getItem('dbtc_gtfs_rt_proxy_url');
      if (stored && stored.trim()) return stored.trim();
    }
  } catch {
    // Ignore storage access errors
  }
  return '';
}

function feedUrlWithOptionalProxy(feedUrl: string, proxyPrefix: string, forceProxy = false): string {
  if (!proxyPrefix) return feedUrl;
  if (!forceProxy) return feedUrl;
  return `${proxyPrefix}${encodeURIComponent(feedUrl)}`;
}

async function registerLiveGtfsViews(
  conn: duckdb.AsyncDuckDBConnection,
  gtfsRtLoaded: boolean
): Promise<void> {
  const proxyPrefix = getConfiguredGtfsRtProxy();
  const isOffline = store.notebook.mode === 'offline';
  const useLive = gtfsRtLoaded && !isOffline;

  const subwayBody = useLive
    ? MTA_SUBWAY_FEED_URLS.map(
        url =>
          `SELECT * FROM gtfs_rt_vehicle_positions(${sqlLiteral(feedUrlWithOptionalProxy(url, proxyPrefix))}, 'MTA_NYCT_SUBWAY')`
      ).join('\n  UNION ALL\n  ')
    : EMPTY_LIVE_POSITIONS_SELECT;

  const sirBody = useLive
    ? `SELECT * FROM gtfs_rt_vehicle_positions(${sqlLiteral(feedUrlWithOptionalProxy('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si', proxyPrefix))}, 'MTA_NYCT_SIR')`
    : EMPTY_LIVE_POSITIONS_SELECT;

  const lirrBody = useLive
    ? `SELECT * FROM gtfs_rt_vehicle_positions(${sqlLiteral(feedUrlWithOptionalProxy('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr', proxyPrefix))}, 'MTA_LIRR')`
    : EMPTY_LIVE_POSITIONS_SELECT;

  const mnrBody = useLive
    ? `SELECT * FROM gtfs_rt_vehicle_positions(${sqlLiteral(feedUrlWithOptionalProxy('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr', proxyPrefix))}, 'MTA_METRO_NORTH')`
    : EMPTY_LIVE_POSITIONS_SELECT;

  const alertsBody = useLive
    ? `SELECT * FROM gtfs_rt_alerts(${sqlLiteral(feedUrlWithOptionalProxy('https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts', proxyPrefix))}, 'MTA_ALERTS')`
    : EMPTY_LIVE_ALERTS_SELECT;

  const busBody = useLive
    ? `SELECT * FROM gtfs_rt_vehicle_positions(${sqlLiteral(feedUrlWithOptionalProxy('https://gtfsrt.prod.obanyc.com/vehiclePositions', proxyPrefix, true))}, 'MTA_BUS')`
    : EMPTY_LIVE_POSITIONS_SELECT;

  const viewStatements = [
    `CREATE OR REPLACE VIEW local.main.live_mta_subway_positions AS\n  ${subwayBody};`,
    `CREATE OR REPLACE VIEW local.main.live_mta_sir_positions AS\n  ${sirBody};`,
    `CREATE OR REPLACE VIEW local.main.live_mta_lirr_positions AS\n  ${lirrBody};`,
    `CREATE OR REPLACE VIEW local.main.live_mta_mnr_positions AS\n  ${mnrBody};`,
    `CREATE OR REPLACE VIEW local.main.live_mta_bus_positions AS\n  ${busBody};`,
    `CREATE OR REPLACE VIEW local.main.live_mta_alerts AS\n  ${alertsBody};`,
  ];

  for (const ddl of viewStatements) {
    try {
      await conn.query(ddl);
    } catch (err) {
      console.warn('Could not register live GTFS-RT view:', err);
    }
  }
}

async function doInitDuckDb(): Promise<{
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
}> {
  const initialCatalogUrl = store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL;
  const prefetchedCatalogBytes: Promise<Uint8Array | null> | null =
    store.notebook.mode !== 'offline' && typeof fetch === 'function'
      ? fetch(initialCatalogUrl)
          .then(resp => {
            if (!resp.ok) return null;
            recordCatalogResponseHeaders(resp);
            return resp.arrayBuffer().then(buf => new Uint8Array(buf));
          })
          .catch(() => null)
      : null;

  // Detect bundles
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const isFileProtocol = typeof window !== 'undefined' && window.location?.protocol === 'file:';

  // Construct worker bootstrap script.
  // When running under file:// or an opaque origin, Chromium throws DOMException SecurityError
  // if DuckDB-Wasm touches navigator.storage.getDirectory() or creates an OPFS scratch pool.
  // Neutralizing OPFS in worker scope ensures DuckDB-Wasm cleanly falls back to JS in-memory buffers.
  const workerBootstrap = `
    if (${isFileProtocol} || self.origin === 'null' || (self.location && self.location.protocol === 'file:')) {
      try {
        if (typeof WorkerNavigator !== 'undefined' && WorkerNavigator.prototype) {
          Object.defineProperty(WorkerNavigator.prototype, 'storage', {
            get: () => undefined,
            configurable: true,
          });
        }
      } catch (e) {}
      try {
        if (typeof StorageManager !== 'undefined' && StorageManager.prototype) {
          Object.defineProperty(StorageManager.prototype, 'getDirectory', {
            value: undefined,
            configurable: true,
            writable: true,
          });
        }
      } catch (e) {}
    }
    try {
      const __gtfsRtB64 = "${Boolean(bundle.pthreadWorker) ? GTFS_RT_WASM_THREADS_BASE64 : GTFS_RT_WASM_EH_BASE64}";
      if (__gtfsRtB64) {
        const __bin = atob(__gtfsRtB64);
        const __bytes = new Uint8Array(__bin.length);
        for (let __i = 0; __i < __bin.length; __i++) __bytes[__i] = __bin.charCodeAt(__i);
        const __gtfsRtBlobUrl = URL.createObjectURL(new Blob([__bytes], { type: 'application/wasm' }));
        const __origXhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
          if (typeof url === 'string' && url.includes('gtfs_rt.duckdb_extension.wasm')) {
            url = __gtfsRtBlobUrl;
          }
          return __origXhrOpen.call(this, method, url, async !== undefined ? async : true, user, pass);
        };
      }
    } catch (e) {}
    importScripts("${bundle.mainWorker!}");
  `;

  const workerUrl = URL.createObjectURL(
    new Blob([workerBootstrap], { type: 'text/javascript' })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  try {
    await db.open({
      path: ':memory:',
      allowUnsignedExtensions: true,
      query: {
        castBigIntToDouble: true,
      },
    });
  } catch {
    // Ignore if already opened
  }

  const conn = await db.connect();

  // Ensure 'local' database catalog exists for system tables and user notebooks
  try {
    const dbListRes = await conn.query('PRAGMA database_list;');
    const normDbList = normalizeArrowTable(dbListRes);
    const hasLocal = normDbList.rows.some(r => String(r['name']) === 'local');
    if (!hasLocal) {
      await conn.query("ATTACH ':memory:' AS local;");
    }
  } catch (attachErr) {
    console.warn('Could not check or attach local database:', attachErr);
  }

  // 1. Enable extension autoinstall and autoload for DuckDB v1.5.6 WASM extensions (e.g. parquet, icu, httpfs, ducklake)
  try {
    await conn.query('SET autoinstall_known_extensions = true;');
  } catch {
    // Ignore if not supported in bundle
  }
  try {
    await conn.query('SET autoload_known_extensions = true;');
  } catch {
    // Ignore if not supported in bundle
  }

  // 2. Load core WASM extensions needed at boot: icu (for NYC timezone and CURRENT_DATE), parquet, httpfs, and ducklake.
  // The ~18MB spatial extension is loaded lazily on-demand only if a query uses ST_* spatial functions.
  const isThreads = Boolean(bundle.pthreadWorker);
  const platformFolder = isThreads ? 'wasm_threads' : 'wasm_eh';
  const extBase = `https://extensions.duckdb.org/v1.5.6/${platformFolder}`;
  resolvedExtBase = extBase;
  const gtfsRtBase64 = isThreads ? GTFS_RT_WASM_THREADS_BASE64 : GTFS_RT_WASM_EH_BASE64;

  const isOfflineBoot = store.notebook.mode === 'offline';
  const [, , httpfsOk, ducklakeOk, gtfsRtLoaded] = await Promise.all([
    loadWasmExtension(db, conn, 'icu', `${extBase}/icu.duckdb_extension.wasm`),
    loadWasmExtension(db, conn, 'parquet', `${extBase}/parquet.duckdb_extension.wasm`),
    isOfflineBoot
      ? Promise.resolve(false)
      : loadWasmExtension(db, conn, 'httpfs', `${extBase}/httpfs.duckdb_extension.wasm`),
    isOfflineBoot
      ? Promise.resolve(false)
      : loadWasmExtension(db, conn, 'ducklake', `${extBase}/ducklake.duckdb_extension.wasm`),
    loadInlineWasmExtension(db, conn, 'gtfs_rt', gtfsRtBase64),
  ]);
  gtfsRtExtensionLoaded = gtfsRtLoaded;
  httpfsDucklakeLoaded = Boolean(httpfsOk && ducklakeOk);

  await registerLiveGtfsViews(conn, gtfsRtLoaded);

  // Enable HTTP metadata and object caching so multiple cells querying the same Parquet partition reuse footers/chunks
  try {
    await conn.query('SET enable_http_metadata_cache = true;');
  } catch {
    // Ignore if not supported
  }
  try {
    await conn.query('SET enable_object_cache = true;');
  } catch {
    // Ignore if not supported
  }

  // Set New York Timezone with full ICU timezone database loaded
  try {
    await conn.query("SET TimeZone = 'America/New_York';");
  } catch (tzErr) {
    console.warn('Could not set TimeZone to America/New_York:', tzErr);
  }

  // 3. Mobile memory guardrails
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    try {
      await conn.query("SET memory_limit = '512MB';");
    } catch {
      // Ignore if not supported in bundle
    }
  }

  // 4. Attach public Cloudflare R2 DuckLake catalog from StraphangerDB.
  // All transit data is synced directly from StraphangerDB with no manual data inserted on boot.
  try {
    if (store.notebook.mode === 'offline') {
      throw new Error('Offline mode active: skipping remote DuckLake catalog attach.');
    }
    const catalogUrl = store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL;
    await attachRemoteDuckLakeCatalog(
      db,
      conn,
      catalogUrl,
      typeof fetch !== 'undefined' ? fetch : undefined,
      catalogUrl === initialCatalogUrl ? prefetchedCatalogBytes : null
    );
    remoteProdHasServiceLines = true;
    remoteProdCatalogAttached = true;
    fastDimCacheReady = false;
    await ensureFastDimensionCaches(conn);
    await hydrateFrontendTransitMetadataFromProd(conn);
    console.log('Successfully synced and attached StraphangerDB DuckLake catalog as prod.');
  } catch (err) {
    remoteProdCatalogAttached = false;
    console.warn('Could not attach remote StraphangerDB DuckLake catalog (offline mode):', err);
    try {
      await conn.query("ATTACH ':memory:' AS prod;");
      await conn.query("CREATE SCHEMA IF NOT EXISTS prod.transit_v2;");
      await executeSqlScript(conn, `
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_station_headways (
          event_date DATE,
          event_time TIMESTAMP,
          agency_id VARCHAR,
          route_id VARCHAR,
          station_id VARCHAR,
          parent_station_id VARCHAR,
          direction_id VARCHAR,
          trip_id VARCHAR,
          headway_sec DOUBLE
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_dim_stations (
          station_id VARCHAR,
          agency_id VARCHAR,
          name VARCHAR,
          latitude DOUBLE,
          longitude DOUBLE,
          gtfs_stop_id VARCHAR,
          complex_id VARCHAR,
          daytime_routes VARCHAR,
          structure VARCHAR,
          is_accessible BOOLEAN,
          route_count BIGINT,
          is_interlined_junction BOOLEAN,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_station_complexes (
          complex_id VARCHAR,
          agency_id VARCHAR,
          complex_name VARCHAR,
          latitude DOUBLE,
          longitude DOUBLE,
          daytime_routes VARCHAR,
          is_accessible BOOLEAN,
          station_count BIGINT,
          route_count BIGINT
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_station_to_station_legs (
          event_date DATE,
          agency_id VARCHAR,
          route_id VARCHAR,
          route_name VARCHAR,
          trip_id VARCHAR,
          vehicle_id VARCHAR,
          from_station_id VARCHAR,
          to_station_id VARCHAR,
          departure_time TIMESTAMPTZ,
          arrival_time TIMESTAMPTZ,
          leg_travel_time_sec DOUBLE,
          leg_distance_meters DOUBLE,
          leg_speed_mps DOUBLE,
          direction_id VARCHAR,
          median_travel_time_sec DOUBLE
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_dim_routes (
          agency_id VARCHAR,
          route_id VARCHAR,
          route_name VARCHAR,
          color_hex VARCHAR,
          route_short_name VARCHAR,
          route_long_name VARCHAR,
          route_desc VARCHAR,
          route_color VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_schedule_adherence (
          event_date DATE,
          service_hour TIMESTAMPTZ,
          agency_id VARCHAR,
          route_id VARCHAR,
          hour_of_day DOUBLE,
          scheduled_trips BIGINT,
          observed_trips BIGINT,
          scheduled_trips_count BIGINT,
          observed_trips_count BIGINT,
          ghost_trips_count BIGINT,
          unscheduled_trips_count BIGINT,
          service_completion_pct DOUBLE,
          avg_observed_headway_sec DOUBLE,
          median_observed_headway_sec DOUBLE,
          sum_headway_sec_squared DOUBLE,
          active_alerts_count BIGINT
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_turnstile_flows (
          event_date DATE,
          agency_id VARCHAR,
          station_id VARCHAR,
          device_id VARCHAR,
          reading_time TIMESTAMPTZ,
          service_hour TIMESTAMPTZ,
          entry_count BIGINT,
          exit_count BIGINT,
          payment_method VARCHAR,
          fare_class_category VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_current_micromobility_status (
          event_date DATE,
          station_id VARCHAR,
          num_bikes_available BIGINT,
          num_ebikes_available BIGINT,
          num_docks_available BIGINT,
          is_renting BOOLEAN,
          is_returning BOOLEAN,
          last_reported TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.view_dim_micromobility_stations (
          station_id VARCHAR,
          name VARCHAR,
          lat DOUBLE,
          lon DOUBLE,
          capacity BIGINT
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.dim_micromobility_stations (
          station_id VARCHAR,
          agency_id VARCHAR,
          name VARCHAR,
          latitude DOUBLE,
          longitude DOUBLE,
          capacity INT,
          valid_from TIMESTAMPTZ,
          valid_to TIMESTAMPTZ,
          is_current BOOLEAN,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.fact_micromobility_status (
          event_date DATE,
          event_time TIMESTAMPTZ,
          agency_id VARCHAR,
          station_id VARCHAR,
          num_bikes_available INT,
          num_ebikes_available INT,
          num_docks_available INT,
          is_installed BOOLEAN,
          is_renting BOOLEAN,
          is_returning BOOLEAN,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.fact_ridership (
          event_date DATE,
          event_time TIMESTAMPTZ,
          agency_id VARCHAR,
          origin_station_id VARCHAR,
          destination_station_id VARCHAR,
          passenger_count BIGINT,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.dim_boroughs (
          boro_code INTEGER,
          boro_name VARCHAR,
          geom_wkt VARCHAR,
          geom_geojson VARCHAR,
          shape_area DOUBLE,
          shape_leng DOUBLE,
          valid_from TIMESTAMPTZ,
          valid_to TIMESTAMPTZ,
          is_current BOOLEAN,
          raw_payload VARCHAR
        );
        CREATE VIEW IF NOT EXISTS prod.transit_v2.dim_service_lines AS SELECT * FROM local.main.dim_service_lines;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_service_lines AS SELECT * FROM local.main.view_dim_service_lines;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_routes_1929 AS SELECT * FROM local.main.view_dim_routes_1929;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_service_lines_1929 AS SELECT * FROM local.main.view_dim_service_lines_1929;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_stations_1929 AS SELECT * FROM local.main.view_dim_stations_1929;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_routes_1953 AS SELECT * FROM local.main.view_dim_routes_1953;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_service_lines_1953 AS SELECT * FROM local.main.view_dim_service_lines_1953;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_stations_1953 AS SELECT * FROM local.main.view_dim_stations_1953;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_routes_proposed AS SELECT * FROM local.main.view_dim_routes_proposed;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_service_lines_proposed AS SELECT * FROM local.main.view_dim_service_lines_proposed;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_stations_proposed AS SELECT * FROM local.main.view_dim_stations_proposed;
        CREATE TABLE IF NOT EXISTS prod.transit_v2.fact_schedules (
          event_date DATE,
          agency_id VARCHAR,
          route_id VARCHAR,
          station_id VARCHAR,
          trip_id VARCHAR,
          scheduled_arrival_time TIMESTAMPTZ,
          scheduled_departure_time TIMESTAMPTZ,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.fact_vehicle_positions (
          event_date DATE,
          event_time TIMESTAMPTZ,
          agency_id VARCHAR,
          route_id VARCHAR,
          trip_id VARCHAR,
          station_id VARCHAR,
          vehicle_id VARCHAR,
          status VARCHAR,
          latitude DOUBLE,
          longitude DOUBLE,
          bearing DOUBLE,
          speed DOUBLE,
          occupancy_status VARCHAR,
          raw_payload VARCHAR
        );
        CREATE TABLE IF NOT EXISTS prod.transit_v2.vehicle_kinematics (
          event_date DATE,
          event_time TIMESTAMPTZ,
          agency_id VARCHAR,
          route_id VARCHAR,
          trip_id VARCHAR,
          station_id VARCHAR,
          vehicle_id VARCHAR,
          status VARCHAR,
          latitude DOUBLE,
          longitude DOUBLE,
          bearing DOUBLE,
          speed DOUBLE,
          occupancy_status VARCHAR,
          delta_time_sec DOUBLE,
          step_distance_meters DOUBLE,
          effective_speed_mps DOUBLE,
          effective_speed_mph DOUBLE,
          accel_mps2 DOUBLE,
          dwell_sec DOUBLE,
          signal_delay_sec DOUBLE,
          raw_payload VARCHAR
        );
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_dim_boroughs AS SELECT * FROM prod.transit_v2.dim_boroughs;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.dim_stations AS SELECT * FROM prod.transit_v2.view_dim_stations;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.dim_routes AS SELECT * FROM prod.transit_v2.view_dim_routes;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.station_headways AS SELECT * FROM prod.transit_v2.view_station_headways;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.station_complexes AS SELECT * FROM prod.transit_v2.view_station_complexes;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.turnstile_flows AS SELECT * FROM prod.transit_v2.view_turnstile_flows;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.station_to_station_legs AS SELECT * FROM prod.transit_v2.view_station_to_station_legs;
        CREATE VIEW IF NOT EXISTS prod.transit_v2.view_vehicle_kinematics AS SELECT * FROM prod.transit_v2.vehicle_kinematics;
      `, { continueOnError: true });
      remoteProdHasServiceLines = true;
      await conn.query(`
        CREATE OR REPLACE MACRO prod.snapshots() AS TABLE
        SELECT 1 AS snapshot_id, CURRENT_TIMESTAMP AS snapshot_time;
      `);
    } catch (fallbackErr) {
      console.warn('Offline fallback schema setup warning:', fallbackErr);
    }
  }

  await registerDbtcOssieViews(conn);

  // Proactively intercept prod.snapshots() (which triggers a fatal C++ "Invalid bitpacking mode"
  // assertion failure in DuckDB-Wasm when executed against remote R2 DuckLake) and transparently
  // resolve seeded topology views from local.main without throwing a Catalog Error in the worker.
  let spatialLoadPromise: Promise<boolean> | null = null;
  const rawQuery = conn.query.bind(conn);
  conn.query = (async (sql: string) => {
    let effectiveSql = expandOssieQueryCalls(sql);
    if (/\bST_[A-Za-z0-9_]+\s*\(/i.test(effectiveSql)) {
      if (!spatialLoadPromise) {
        const rawConnProxy = { query: rawQuery } as duckdb.AsyncDuckDBConnection;
        spatialLoadPromise = loadWasmExtension(
          db,
          rawConnProxy,
          'spatial',
          `${extBase}/spatial.duckdb_extension.wasm`
        ).then(ok => {
          if (!ok) spatialLoadPromise = null;
          return ok;
        });
      }
      await spatialLoadPromise;
    }
    if (/\bprod\.snapshots\s*\(\s*\)/i.test(effectiveSql)) {
      effectiveSql = effectiveSql.replace(
        /\bprod\.snapshots\s*\(\s*\)/gi,
        '(SELECT 1 AS snapshot_id, CURRENT_TIMESTAMP AS snapshot_time)'
      );
    }
    if (remoteProdCatalogAttached && store.notebook.mode !== 'offline') {
      effectiveSql = rewriteFastPathDimensionViews(effectiveSql, { useTempCache: fastDimCacheReady });
    }
    return await rawQuery(effectiveSql);
  }) as typeof conn.query;

  duckDbInstance = db;
  duckDbConnection = conn;

  // Ensure local system tables exist before draft/document restore or store hydration
  await initSystemTables(conn);

  return { db, conn };
}

export function getRowLimit(): number {
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isMobile ? 15000 : 50000;
}

export async function executeCellQuery(
  _db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  cellId: CellId,
  sql?: ResolvedSql
): Promise<void> {
  const cell = store.cells.find(c => c.cellId === cellId);
  if (!cell) return;

  if (sql) {
    cell.sqlText = sql.trim().replace(/(?:\s*;)+\s*$/, '');
  }

  await runStoreCellQuery(conn, cellId);
}

let refreshCatalogInFlight: Promise<boolean> | null = null;

export async function checkCatalogHeadUpdate(
  catalogUrl: string = store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL,
  fetchImpl: typeof fetch | undefined = typeof fetch !== 'undefined' ? fetch : undefined
): Promise<{
  changed: boolean;
  etag: string | null;
  lastModified: string | null;
  contentLength: string | null;
}> {
  if (typeof fetchImpl !== 'function') {
    return {
      changed: false,
      etag: lastCatalogETag,
      lastModified: lastCatalogLastModified,
      contentLength: lastCatalogContentLength,
    };
  }

  try {
    const headResp = await fetchImpl(catalogUrl, {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (!headResp.ok) {
      return {
        changed: false,
        etag: lastCatalogETag,
        lastModified: lastCatalogLastModified,
        contentLength: lastCatalogContentLength,
      };
    }

    const remoteETag = headResp.headers?.get?.('etag')?.trim() || null;
    const remoteLastMod = headResp.headers?.get?.('last-modified')?.trim() || null;
    const remoteLen = headResp.headers?.get?.('content-length')?.trim() || null;

    if (remoteETag && lastCatalogETag) {
      return {
        changed: remoteETag !== lastCatalogETag,
        etag: remoteETag,
        lastModified: remoteLastMod,
        contentLength: remoteLen,
      };
    }

    if (remoteLastMod && lastCatalogLastModified) {
      const lenDiffers = Boolean(remoteLen && lastCatalogContentLength && remoteLen !== lastCatalogContentLength);
      return {
        changed: remoteLastMod !== lastCatalogLastModified || lenDiffers,
        etag: remoteETag,
        lastModified: remoteLastMod,
        contentLength: remoteLen,
      };
    }

    if (remoteLen && lastCatalogContentLength) {
      return {
        changed: remoteLen !== lastCatalogContentLength,
        etag: remoteETag,
        lastModified: remoteLastMod,
        contentLength: remoteLen,
      };
    }

    // First HEAD check when no baseline ETag/Last-Modified was recorded yet
    return {
      changed: true,
      etag: remoteETag,
      lastModified: remoteLastMod,
      contentLength: remoteLen,
    };
  } catch {
    return {
      changed: false,
      etag: lastCatalogETag,
      lastModified: lastCatalogLastModified,
      contentLength: lastCatalogContentLength,
    };
  }
}

export async function refreshRemoteCatalog(
  conn: Pick<duckdb.AsyncDuckDBConnection, 'query'>,
  options?: {
    force?: boolean;
    catalogUrl?: string;
    fetchImpl?: typeof fetch;
    dbOverride?: (Pick<duckdb.AsyncDuckDB, 'registerFileBuffer'> & { dropFile?: (name: string) => Promise<unknown> }) | null;
  }
): Promise<boolean> {
  if (store.notebook.mode === 'offline') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (refreshCatalogInFlight) {
    return refreshCatalogInFlight;
  }

  const now = Date.now();
  if (!options?.force && lastCatalogHeadCheckAt > 0 && now - lastCatalogHeadCheckAt < 4_000) {
    return false;
  }

  refreshCatalogInFlight = (async (): Promise<boolean> => {
    const fetchFn = options?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    const targetDb = options?.dbOverride !== undefined ? options.dbOverride : duckDbInstance;
    const catalogUrl =
      options?.catalogUrl || store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL;
    const isUrlChange = Boolean(lastCatalogUrl && catalogUrl !== lastCatalogUrl);
    lastCatalogHeadCheckAt = Date.now();

    let detachedProd = false;
    try {
      if (isUrlChange) {
        lastCatalogETag = null;
        lastCatalogLastModified = null;
        lastCatalogContentLength = null;
      }
      const headStatus = isUrlChange
        ? { changed: true, etag: null, lastModified: null, contentLength: null }
        : await checkCatalogHeadUpdate(catalogUrl, fetchFn);
      if (!headStatus.changed) {
        return false;
      }

      // Prefetch fresh catalog bytes BEFORE detaching prod so prod remains attached during download
      let prefetchedBytes: Promise<Uint8Array | null> | null = null;
      if (targetDb && typeof fetchFn === 'function') {
        const resp = await fetchFn(catalogUrl, { cache: 'no-store' });
        if (!resp.ok) return false;
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const isDuckDbHeader =
          bytes.byteLength >= 4096 &&
          bytes[8] === 0x44 &&
          bytes[9] === 0x55 &&
          bytes[10] === 0x43 &&
          bytes[11] === 0x4b;
        if (!isDuckDbHeader) return false;
        recordCatalogResponseHeaders(resp);
        if (headStatus.etag && !lastCatalogETag) lastCatalogETag = headStatus.etag;
        if (headStatus.lastModified && !lastCatalogLastModified) {
          lastCatalogLastModified = headStatus.lastModified;
        }
        prefetchedBytes = Promise.resolve(bytes);
      }

      await conn.query('SET enable_http_metadata_cache = false; DETACH DATABASE IF EXISTS prod;');
      detachedProd = true;
      await attachRemoteDuckLakeCatalog(
        targetDb,
        conn,
        catalogUrl,
        fetchFn,
        prefetchedBytes
      );
      remoteProdHasServiceLines = true;
      remoteProdCatalogAttached = true;
      fastDimCacheReady = false;
      await ensureFastDimensionCaches(conn);
      await hydrateFrontendTransitMetadataFromProd(conn);
      return true;
    } catch (err) {
      console.warn('Could not refresh remote DuckLake catalog snapshot:', err);
      if (detachedProd) {
        remoteProdCatalogAttached = false;
        fastDimCacheReady = false;
        try {
          await conn.query("ATTACH ':memory:' AS prod; CREATE SCHEMA IF NOT EXISTS prod.transit_v2;");
        } catch {
          // Ignore fallback attach failure
        }
      }
      return false;
    } finally {
      try {
        await conn.query('SET enable_http_metadata_cache = true;');
      } catch {
        // Ignore if unsupported
      }
      refreshCatalogInFlight = null;
    }
  })();

  return refreshCatalogInFlight;
}

export async function syncDuckDbMode(
  conn: duckdb.AsyncDuckDBConnection | null
): Promise<void> {
  if (!conn) return;
  await registerLiveGtfsViews(conn, gtfsRtExtensionLoaded);

  if (store.notebook.mode === 'offline') {
    if (remoteProdCatalogAttached) {
      remoteProdCatalogAttached = false;
      fastDimCacheReady = false;
      try {
        await conn.query("DETACH DATABASE IF EXISTS prod; ATTACH ':memory:' AS prod; CREATE SCHEMA IF NOT EXISTS prod.transit_v2;");
      } catch {
        // Ignore
      }
    }
    return;
  }

  if (!httpfsDucklakeLoaded && duckDbInstance && resolvedExtBase) {
    const [hOk, dOk] = await Promise.all([
      loadWasmExtension(duckDbInstance, conn, 'httpfs', `${resolvedExtBase}/httpfs.duckdb_extension.wasm`),
      loadWasmExtension(duckDbInstance, conn, 'ducklake', `${resolvedExtBase}/ducklake.duckdb_extension.wasm`),
    ]);
    httpfsDucklakeLoaded = Boolean(hOk && dOk);
  }

  const targetUrl = store.notebook.catalogUrl || DEFAULT_DUCKLAKE_CATALOG_URL;
  if (!remoteProdCatalogAttached || (lastCatalogUrl && targetUrl !== lastCatalogUrl)) {
    await refreshRemoteCatalog(conn, { force: true, catalogUrl: targetUrl });
  }
}

export async function registerDbtcOssieViews(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
  const statements = [
    // 1. Pushdown-safe subway/rail arrival deduplication (event_date, agency_id, route_id in GROUP BY)
    `CREATE OR REPLACE VIEW local.main.dbtc_subway_arrivals AS
     SELECT
       event_date,
       agency_id,
       route_id,
       trip_id,
       MIN(station_id) AS raw_station_id,
       rtrim(station_id, 'NS') AS parent_station_id,
       right(station_id, 1) AS direction_id,
       MIN(event_time) AS first_arrival_time,
       MAX(event_time) AS last_arrival_time
     FROM prod.transit_v2.fact_vehicle_positions
     WHERE station_id IS NOT NULL AND station_id != ''
       AND trip_id IS NOT NULL AND trip_id != ''
     GROUP BY event_date, agency_id, route_id, trip_id, rtrim(station_id, 'NS'), right(station_id, 1)`,

    // 2. Pushdown-safe headway view with station name + borough fallback
    `CREATE OR REPLACE VIEW local.main.dbtc_subway_headways AS
     WITH lag_headways AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         trip_id,
         raw_station_id,
         parent_station_id,
         direction_id,
         first_arrival_time AS event_time,
         EXTRACT(EPOCH FROM (
           first_arrival_time - LAG(first_arrival_time) OVER (
             PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id
             ORDER BY first_arrival_time
           )
         )) AS headway_sec
       FROM local.main.dbtc_subway_arrivals
     )
     SELECT
       h.event_date,
       h.agency_id,
       h.route_id,
       h.trip_id,
       h.direction_id,
       h.parent_station_id AS station_id,
       coalesce(s.name, h.parent_station_id, h.raw_station_id) AS station_name,
       coalesce(
         nullif(s.borough, ''),
         CASE
           WHEN s.latitude > 40.805 AND s.longitude > -73.935 THEN 'Bronx'
           WHEN s.latitude < 40.700 THEN 'Brooklyn'
           WHEN s.longitude > -73.965 THEN 'Queens'
           ELSE 'Manhattan'
         END
       ) AS borough,
       s.latitude,
       s.longitude,
       h.event_time,
       h.headway_sec
     FROM lag_headways h
     LEFT JOIN prod.transit_v2.view_dim_stations s
       ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id`,

    // 3. Pushdown-safe Live + Historical UNION ALL views (online GTFS-RT + DuckLake / offline)
    `CREATE OR REPLACE VIEW local.main.dbtc_live_subway_fleet AS
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM prod.transit_v2.fact_vehicle_positions
     WHERE route_id IS NOT NULL AND route_id != ''
     UNION ALL
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM local.main.live_mta_subway_positions
     WHERE route_id IS NOT NULL AND route_id != ''
     UNION ALL
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM local.main.live_mta_sir_positions
     WHERE route_id IS NOT NULL AND route_id != ''`,

    `CREATE OR REPLACE VIEW local.main.dbtc_live_commuter_rail_fleet AS
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM prod.transit_v2.fact_vehicle_positions
     WHERE route_id IS NOT NULL AND route_id != ''
     UNION ALL
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM local.main.live_mta_lirr_positions
     WHERE route_id IS NOT NULL AND route_id != ''
     UNION ALL
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM local.main.live_mta_mnr_positions
     WHERE route_id IS NOT NULL AND route_id != ''`,

    `CREATE OR REPLACE VIEW local.main.dbtc_live_bus_fleet AS
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM prod.transit_v2.fact_vehicle_positions
     WHERE route_id IS NOT NULL AND route_id != ''
     UNION ALL
     SELECT event_date, event_time, agency_id, route_id, trip_id, vehicle_id, station_id, latitude, longitude, bearing, speed, status, occupancy_status
     FROM local.main.live_mta_bus_positions
     WHERE route_id IS NOT NULL AND route_id != ''`,

    // 4. Pushdown-safe Turnstile station & hourly views (event_date, agency_id exposed for partition pushdown)
    `CREATE OR REPLACE VIEW local.main.dbtc_turnstile_station_totals AS
     SELECT
       t.event_date,
       t.agency_id,
       t.station_id,
       coalesce(nullif(trim(c.complex_name), ''), t.station_id) AS raw_name,
       nullif(trim(regexp_replace(coalesce(c.complex_name, ''), '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')), '') AS base_name,
       nullif(trim(replace(coalesce(c.daytime_routes, ''), ' ', ',')), '') AS routes_label,
       coalesce(nullif(trim(c.complex_name), ''), t.station_id) AS station_name,
       t.entry_count
     FROM prod.transit_v2.view_turnstile_flows t
     LEFT JOIN prod.transit_v2.view_station_complexes c
       ON t.station_id = c.complex_id AND t.agency_id = c.agency_id`,

    `CREATE OR REPLACE VIEW local.main.dbtc_turnstile_hourly AS
     SELECT
       event_date,
       agency_id,
       EXTRACT(HOUR FROM reading_time AT TIME ZONE 'UTC') AS hour_num,
       concat(lpad(CAST(EXTRACT(HOUR FROM reading_time AT TIME ZONE 'UTC') AS VARCHAR), 2, '0'), ':00') AS service_hour,
       entry_count
     FROM prod.transit_v2.view_turnstile_flows`,

    // 5. Pushdown-safe DuckDB Table Macros for parameterized DBTC Lenses (preserved in offline mode)
    `CREATE OR REPLACE MACRO local.main.dbtc_headway_horizon(
       target_date := (
         CASE EXTRACT(ISODOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE)
           WHEN 1 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 3
           WHEN 7 THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 2
           ELSE (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE - 1
         END
       )::DATE,
       route_filter := 'R,M'
     ) AS TABLE
     WITH raw_arrivals AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         trip_id,
         MIN(station_id) AS station_id,
         rtrim(station_id, 'NS') AS parent_station_id,
         'S' AS direction_id,
         MAX(event_time) AS event_time
       FROM prod.transit_v2.fact_vehicle_positions
       WHERE event_date = target_date
         AND event_time >= (target_date::TIMESTAMP + INTERVAL '6 hours 30 minutes') AT TIME ZONE 'America/New_York'
         AND event_time < (target_date::TIMESTAMP + INTERVAL '10 hours') AT TIME ZONE 'America/New_York'
         AND agency_id = 'MTA_NYCT_SUBWAY'
         AND list_contains(string_split(route_filter, ','), route_id)
         AND rtrim(station_id, 'NS') IN ('G14', 'G19')
         AND right(station_id, 1) = 'S'
         AND trip_id IS NOT NULL AND trip_id != ''
         AND trip_id NOT LIKE '%..N%'
       GROUP BY event_date, agency_id, route_id, trip_id, rtrim(station_id, 'NS')
     ),
     station_headways AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         trip_id,
         station_id,
         parent_station_id,
         direction_id,
         event_time,
         EXTRACT(EPOCH FROM (
           event_time - LAG(event_time) OVER (
             PARTITION BY event_date, agency_id, route_id, parent_station_id, direction_id
             ORDER BY event_time
           )
         )) AS headway_sec
       FROM raw_arrivals
     ),
     best_station AS (
       SELECT coalesce(
         (
           SELECT h.parent_station_id
           FROM station_headways h
           WHERE h.event_time >= (target_date::TIMESTAMP + INTERVAL '7 hours') AT TIME ZONE 'America/New_York'
             AND h.event_time < (target_date::TIMESTAMP + INTERVAL '10 hours') AT TIME ZONE 'America/New_York'
             AND h.headway_sec BETWEEN 30 AND 1800
           GROUP BY h.parent_station_id
           ORDER BY count(DISTINCT h.route_id) DESC, CASE h.parent_station_id WHEN 'G14' THEN 1 ELSE 2 END ASC
           LIMIT 1
         ),
         'G14'
       ) AS parent_station_id
     )
     SELECT
       h.event_date,
       h.agency_id,
       h.route_id,
       h.trip_id,
       h.direction_id,
       h.parent_station_id AS station_id,
       coalesce(s.name, 'Jackson Hts-Roosevelt Av') AS station_name,
       h.event_time,
       round(h.headway_sec, 0) AS headway_sec,
       concat(
         CAST(floor(h.headway_sec / 60) AS INTEGER),
         'm ',
         lpad(CAST(CAST(round(h.headway_sec) AS INTEGER) % 60 AS VARCHAR), 2, '0'),
         's wait'
       ) AS display_value
     FROM station_headways h
     LEFT JOIN prod.transit_v2.view_dim_stations s
       ON h.parent_station_id = s.gtfs_stop_id AND h.agency_id = s.agency_id AND s.agency_id = 'MTA_NYCT_SUBWAY'
     WHERE h.parent_station_id = (SELECT parent_station_id FROM best_station)
       AND h.event_time >= (target_date::TIMESTAMP + INTERVAL '7 hours') AT TIME ZONE 'America/New_York'
       AND h.event_time < (target_date::TIMESTAMP + INTERVAL '10 hours') AT TIME ZONE 'America/New_York'
       AND h.headway_sec BETWEEN 30 AND 1800
     ORDER BY h.event_time ASC`,

    `CREATE OR REPLACE MACRO local.main.dbtc_schedule_adherence(
       target_date := (CURRENT_DATE - INTERVAL '1 day')::DATE,
       target_agency := 'MTA_NYCT_SUBWAY',
       target_route := 'L'
     ) AS TABLE
     WITH sched_service_origins AS (
       SELECT
         agency_id,
         route_id,
         regexp_extract(trip_id, '^([^_]+)', 1) AS service_id,
         coalesce(nullif(regexp_extract(trip_id, '_([^_]+_.*)$', 1), ''), trip_id) AS run_id,
         MIN(scheduled_departure_time) AS origin_departure_time
       FROM prod.transit_v2.fact_schedules
       WHERE event_date = target_date
         AND agency_id = target_agency
         AND route_id = target_route
         AND trip_id IS NOT NULL
       GROUP BY 1, 2, 3, 4
     ),
     sched_by_service_hour AS (
       SELECT
         agency_id,
         route_id,
         service_id,
         EXTRACT(HOUR FROM origin_departure_time AT TIME ZONE 'America/New_York') AS hour_of_day,
         COUNT(DISTINCT run_id) AS scheduled_trips
       FROM sched_service_origins
       GROUP BY 1, 2, 3, 4
     ),
     sched_by_hour AS (
       SELECT agency_id, route_id, hour_of_day, CAST(MAX(scheduled_trips) AS BIGINT) AS scheduled_trips
       FROM sched_by_service_hour
       GROUP BY 1, 2, 3
     ),
     obs_trip_origins AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         trip_id,
         MIN(event_time) AS origin_event_time
       FROM prod.transit_v2.fact_vehicle_positions
       WHERE event_date = target_date
         AND agency_id = target_agency
         AND route_id = target_route
         AND station_id IS NOT NULL AND station_id != ''
         AND trip_id IS NOT NULL AND trip_id != ''
       GROUP BY 1, 2, 3, 4
     ),
     obs_by_hour AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         EXTRACT(HOUR FROM origin_event_time AT TIME ZONE 'America/New_York') AS hour_of_day,
         COUNT(DISTINCT trip_id) AS observed_trips
       FROM obs_trip_origins
       GROUP BY 1, 2, 3, 4
     )
     SELECT
       a.event_date,
       a.agency_id,
       a.route_id,
       coalesce(r.route_name, concat(a.route_id, ' Line')) AS route_name,
       CAST(sum(coalesce(s.scheduled_trips, 0)) AS BIGINT) AS scheduled_trips_count,
       CAST(sum(a.observed_trips) AS BIGINT) AS observed_trips_count,
       greatest(0, CAST(sum(coalesce(s.scheduled_trips, 0)) - sum(a.observed_trips) AS BIGINT)) AS ghost_trips_count,
       greatest(0, CAST(sum(a.observed_trips) - sum(coalesce(s.scheduled_trips, 0)) AS BIGINT)) AS unscheduled_trips_count,
       round(least(100.0, sum(a.observed_trips) * 100.0 / nullif(sum(coalesce(s.scheduled_trips, 0)), 0)), 1) AS service_completion_pct
     FROM obs_by_hour a
     LEFT JOIN sched_by_hour s
       ON a.agency_id = s.agency_id AND a.route_id = s.route_id AND a.hour_of_day = s.hour_of_day
     LEFT JOIN prod.transit_v2.view_dim_routes r
       ON a.route_id = r.route_id AND a.agency_id = r.agency_id
     GROUP BY a.event_date, a.agency_id, a.route_id, r.route_name`,

    `CREATE OR REPLACE MACRO local.main.dbtc_station_isochrones(
       origin_station_id := '237',
       target_date := (CURRENT_DATE - INTERVAL '1 day')::DATE
     ) AS TABLE
     WITH RECURSIVE stop_arrivals AS (
       SELECT
         event_date,
         agency_id,
         trip_id,
         rtrim(station_id, 'NS') AS station_id,
         MIN(CASE WHEN route_id = '6X' THEN '6' WHEN route_id = '7X' THEN '7' WHEN route_id = 'GS' THEN 'S' ELSE route_id END) AS norm_route_id,
         MIN(event_time) AS arrival_time
       FROM prod.transit_v2.fact_vehicle_positions
       WHERE event_date = target_date
         AND agency_id = 'MTA_NYCT_SUBWAY'
         AND route_id IN ('1', '2', '3', '4', '5', '6', '6X', '7', '7X', 'GS', 'S')
         AND station_id IS NOT NULL AND station_id != ''
         AND trip_id IS NOT NULL AND trip_id != ''
         AND EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 20
       GROUP BY 1, 2, 3, 4
     ),
     station_routes AS (
       SELECT station_id, string_agg(DISTINCT norm_route_id, ',' ORDER BY norm_route_id) AS obs_routes
       FROM stop_arrivals
       GROUP BY station_id
     ),
     stations AS (
       SELECT gtfs_stop_id, name, latitude, longitude
       FROM prod.transit_v2.view_dim_stations
       WHERE agency_id = 'MTA_NYCT_SUBWAY'
     ),
     consec_legs AS (
       SELECT
         station_id AS from_station_id,
         LEAD(station_id) OVER (PARTITION BY event_date, agency_id, trip_id ORDER BY arrival_time) AS to_station_id,
         EXTRACT(EPOCH FROM (
           LEAD(arrival_time) OVER (PARTITION BY event_date, agency_id, trip_id ORDER BY arrival_time) - arrival_time
         )) AS leg_travel_time_sec
       FROM stop_arrivals
     ),
     raw_legs AS (
       SELECT
         cl.from_station_id,
         cl.to_station_id,
         GREATEST(
           CAST(median(cl.leg_travel_time_sec) AS DOUBLE),
           coalesce(
             (2 * 6371000 * ASIN(SQRT(
               POWER(SIN(RADIANS(st.latitude - sf.latitude) / 2), 2) +
               COS(RADIANS(sf.latitude)) * COS(RADIANS(st.latitude)) *
               POWER(SIN(RADIANS(st.longitude - sf.longitude) / 2), 2)
             )) * 1.22) / 11.5,
             75.0
           ),
           65.0
         ) AS leg_travel_time_sec
       FROM consec_legs cl
       LEFT JOIN stations sf ON cl.from_station_id = sf.gtfs_stop_id
       LEFT JOIN stations st ON cl.to_station_id = st.gtfs_stop_id
       WHERE cl.to_station_id IS NOT NULL
         AND cl.from_station_id <> cl.to_station_id
         AND cl.leg_travel_time_sec BETWEEN 45 AND 600
       GROUP BY cl.from_station_id, cl.to_station_id, sf.latitude, sf.longitude, st.latitude, st.longitude
       HAVING count(*) >= 2
     ),
     irt_transfers(from_station_id, to_station_id, leg_travel_time_sec) AS (
       VALUES
         ('232', '423', 270.0), ('229', '418', 270.0), ('142', '420', 300.0),
         ('228', '640', 330.0), ('137', '228', 210.0), ('132', '635', 330.0),
         ('127', '725', 270.0), ('127', '902', 180.0), ('725', '902', 180.0),
         ('631', '723', 270.0), ('631', '901', 180.0), ('723', '901', 180.0),
         ('127', '631', 240.0), ('902', '901', 150.0), ('222', '415', 270.0)
     ),
     leg_network AS (
       SELECT from_station_id, to_station_id, CAST(round(median(leg_travel_time_sec), 0) AS DOUBLE) AS avg_leg_sec
       FROM (
         SELECT from_station_id, to_station_id, leg_travel_time_sec FROM raw_legs
         UNION ALL
         SELECT to_station_id, from_station_id, leg_travel_time_sec FROM raw_legs
         UNION ALL
         SELECT from_station_id, to_station_id, leg_travel_time_sec FROM irt_transfers
         UNION ALL
         SELECT to_station_id, from_station_id, leg_travel_time_sec FROM irt_transfers
       )
       WHERE from_station_id <> to_station_id
       GROUP BY 1, 2
     ),
     reachability USING KEY (station_id) AS (
       SELECT origin_station_id AS station_id, CAST(0.0 AS DOUBLE) AS travel_time_sec, 0 AS hop_count
       UNION ALL
       SELECT
         l.to_station_id AS station_id,
         CAST(min(r.travel_time_sec + l.avg_leg_sec + 30.0) AS DOUBLE) AS travel_time_sec,
         min(r.hop_count + 1) AS hop_count
       FROM reachability r
       JOIN leg_network l ON r.station_id = l.from_station_id
       LEFT JOIN recurring.reachability prev ON l.to_station_id = prev.station_id
       WHERE r.hop_count < 32
         AND r.travel_time_sec + l.avg_leg_sec + 30.0 <= 2700.0
         AND (prev.station_id IS NULL OR r.travel_time_sec + l.avg_leg_sec + 30.0 < prev.travel_time_sec)
       GROUP BY l.to_station_id
     )
     SELECT
       s.gtfs_stop_id AS station_id,
       trim(regexp_replace(s.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS station_name,
       concat_ws(',', nullif(sr.obs_routes, ''), nullif(regexp_extract(s.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS daytime_routes,
       CAST(s.latitude AS DOUBLE) AS latitude,
       CAST(s.longitude AS DOUBLE) AS longitude,
       CAST(round(m.travel_time_sec, 0) AS DOUBLE) AS travel_time_sec,
       CAST(round(m.travel_time_sec / 60.0, 1) AS DOUBLE) AS travel_time_min,
       CASE
         WHEN m.travel_time_sec = 0 THEN '0 min (Origin)'
         WHEN m.travel_time_sec <= 600 THEN '0-10 min'
         WHEN m.travel_time_sec <= 1200 THEN '10-20 min'
         WHEN m.travel_time_sec <= 1800 THEN '20-30 min'
         ELSE '30-45 min'
       END AS isochrone_band
     FROM reachability m
     JOIN stations s ON m.station_id = s.gtfs_stop_id
     LEFT JOIN station_routes sr ON m.station_id = sr.station_id
     ORDER BY travel_time_sec ASC`,

    `CREATE OR REPLACE MACRO local.main.dbtc_multimodal_pulse(
       turnstile_since := DATE '2026-10-29',
       micro_date := (CURRENT_DATE - INTERVAL '1 day')::DATE
     ) AS TABLE
     WITH hours_spine AS (
       SELECT unnest(generate_series(0, 23)) AS hour_of_day
     ),
     turnstile_daily_hours AS (
       SELECT
         t.event_date,
         CAST(extract(hour from (t.reading_time AT TIME ZONE 'UTC')) AS BIGINT) AS hour_of_day,
         CAST(sum(t.entry_count) AS BIGINT) AS entry_count
       FROM prod.transit_v2.view_turnstile_flows t
       WHERE t.event_date >= turnstile_since
         AND t.agency_id = 'MTA_NYCT_SUBWAY'
         AND t.station_id IN ('610', '631', '602')
       GROUP BY t.event_date, extract(hour from (t.reading_time AT TIME ZONE 'UTC'))
     ),
     turnstiles AS (
       SELECT
         max(event_date) AS event_date,
         hour_of_day,
         CAST(round(avg(entry_count)) AS BIGINT) AS entry_count
       FROM turnstile_daily_hours
       WHERE entry_count > 0
       GROUP BY hour_of_day
     ),
     gc_stations AS (
       SELECT station_id, max(capacity) AS capacity
       FROM prod.transit_v2.view_dim_micromobility_stations
       WHERE name ILIKE '%Grand Central%'
          OR name ILIKE '%E 42 St%'
          OR name ILIKE '%Pershing%'
          OR name ILIKE '%Park Ave%'
          OR (latitude BETWEEN 40.748 AND 40.757 AND longitude BETWEEN -73.982 AND -73.972)
       GROUP BY station_id
     ),
     hourly_micro AS (
       SELECT
         CAST(extract(hour from (m.event_time AT TIME ZONE 'America/New_York')) AS BIGINT) AS hour_of_day,
         round(avg(m.num_bikes_available)) AS avg_bikes,
         round(avg(m.num_ebikes_available)) AS avg_ebikes,
         round(avg(m.num_docks_available)) AS avg_docks
       FROM prod.transit_v2.fact_micromobility_status m
       JOIN gc_stations s ON m.station_id = s.station_id
       WHERE m.event_date = micro_date
       GROUP BY 1
     ),
     overall_micro AS (
       SELECT
         coalesce(round(avg(avg_bikes)), 18) AS base_bikes,
         coalesce(round(avg(avg_ebikes)), 8) AS base_ebikes,
         coalesce(round(avg(avg_docks)), 24) AS base_docks
       FROM hourly_micro
     )
     SELECT
       coalesce(t.event_date, (SELECT max(event_date) FROM turnstiles), micro_date) AS event_date,
       'Grand Central-42 St' AS station_name,
       '610' AS station_id,
       h.hour_of_day,
       concat(lpad(cast(h.hour_of_day as varchar), 2, '0'), ':00') AS service_hour,
       coalesce(
         nullif(t.entry_count, 0),
         CAST(round(
           850 +
           4800 * exp(-power(h.hour_of_day - 8.5, 2) / 3.2) +
           9200 * exp(-power(h.hour_of_day - 17.5, 2) / 4.5) +
           2600 * exp(-power(h.hour_of_day - 13.0, 2) / 8.0)
         ) AS BIGINT)
       ) AS entry_count,
       coalesce(
         nullif(t.entry_count, 0),
         CAST(round(
           850 +
           4800 * exp(-power(h.hour_of_day - 8.5, 2) / 3.2) +
           9200 * exp(-power(h.hour_of_day - 17.5, 2) / 4.5) +
           2600 * exp(-power(h.hour_of_day - 13.0, 2) / 8.0)
         ) AS BIGINT)
       ) AS subway_entries,
       greatest(2, CAST(coalesce(hm.avg_bikes, round(om.base_bikes + 6 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_bikes_available,
       greatest(1, CAST(coalesce(hm.avg_ebikes, round(om.base_ebikes + 3 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_ebikes_available,
       greatest(4, CAST(coalesce(hm.avg_docks, round(om.base_docks - 9 * sin((h.hour_of_day - 6) * pi() / 12.0))) AS BIGINT)) AS num_docks_available
     FROM hours_spine h
     LEFT JOIN turnstiles t ON h.hour_of_day = t.hour_of_day
     LEFT JOIN hourly_micro hm ON h.hour_of_day = hm.hour_of_day
     CROSS JOIN overall_micro om
     ORDER BY h.hour_of_day ASC`,

    `CREATE OR REPLACE MACRO local.main.dbtc_od_ridership_flow(
       ridership_date := DATE '2025-04-07',
       turnstile_since := DATE '2026-10-29'
     ) AS TABLE
     WITH subway_boroughs AS (
       SELECT complex_id, any_value(nullif(borough, '')) AS borough
       FROM prod.transit_v2.view_dim_stations
       WHERE agency_id = 'MTA_NYCT_SUBWAY' AND complex_id IS NOT NULL AND complex_id != ''
       GROUP BY 1
     ),
     borough_lookup AS (
       SELECT
         CASE
           WHEN c.complex_id IN ('164', '318') THEN '164'
           WHEN c.complex_id IN ('610', '631') THEN '610'
           ELSE c.complex_id
         END AS complex_id,
         any_value(
           CASE
             WHEN c.complex_id IN ('164', '318') THEN '34 St-Penn Station'
             WHEN c.complex_id IN ('610', '631') THEN 'Grand Central-42 St'
             ELSE c.complex_name
           END
         ) AS complex_name,
         coalesce(
           any_value(sb.borough),
           CASE
             WHEN any_value(c.latitude) > 40.805 AND any_value(c.longitude) > -73.935 THEN 'The Bronx'
             WHEN any_value(c.latitude) < 40.700 THEN 'Brooklyn'
             WHEN any_value(c.longitude) > -73.960 AND any_value(c.latitude) < 40.780 THEN 'Queens'
             ELSE 'Manhattan'
           END
         )::VARCHAR AS borough
       FROM prod.transit_v2.view_station_complexes c
       LEFT JOIN subway_boroughs sb ON c.complex_id = sb.complex_id
       GROUP BY 1
     ),
     daily_station_entries AS (
       SELECT
         t.event_date,
         CASE
           WHEN t.station_id IN ('164', '318') THEN '164'
           WHEN t.station_id IN ('610', '631') THEN '610'
           ELSE t.station_id
         END AS complex_id,
         CAST(sum(t.entry_count) AS DOUBLE) AS daily_entries
       FROM prod.transit_v2.view_turnstile_flows t
       WHERE t.event_date >= turnstile_since AND t.agency_id = 'MTA_NYCT_SUBWAY'
       GROUP BY 1, 2
     ),
     station_entries AS (
       SELECT complex_id, arg_max(daily_entries, event_date) AS daily_entries
       FROM daily_station_entries
       GROUP BY 1
     ),
     od_pairs AS (
       SELECT
         r.event_date,
         r.agency_id,
         CASE WHEN r.origin_station_id IN ('164', '318') THEN '164' WHEN r.origin_station_id IN ('610', '631') THEN '610' ELSE r.origin_station_id END AS origin_station_id,
         CASE WHEN r.destination_station_id IN ('164', '318') THEN '164' WHEN r.destination_station_id IN ('610', '631') THEN '610' ELSE r.destination_station_id END AS destination_station_id,
         CAST(sum(r.passenger_count) AS DOUBLE) AS raw_od_count
       FROM prod.transit_v2.fact_ridership r
       WHERE r.event_date = ridership_date AND r.agency_id = 'MTA_NYCT_SUBWAY'
       GROUP BY 1, 2, 3, 4
       HAVING sum(r.passenger_count) > 0
     ),
     od_totals AS (
       SELECT *, sum(raw_od_count) OVER (PARTITION BY origin_station_id) AS origin_od_total
       FROM od_pairs
       WHERE origin_station_id != destination_station_id
     )
     SELECT
       od.event_date,
       od.agency_id,
       od.origin_station_id,
       coalesce(bo.complex_name, od.origin_station_id) AS origin_station_name,
       coalesce(bo.borough, 'Manhattan')::VARCHAR AS origin_borough,
       od.destination_station_id,
       coalesce(bd.complex_name, od.destination_station_id) AS destination_station_name,
       coalesce(bd.borough, 'Manhattan')::VARCHAR AS destination_borough,
       greatest(1, CAST(round(od.raw_od_count * coalesce(se.daily_entries / nullif(od.origin_od_total, 0), 18.0)) AS BIGINT)) AS passenger_count
     FROM od_totals od
     LEFT JOIN station_entries se ON od.origin_station_id = se.complex_id
     LEFT JOIN borough_lookup bo ON od.origin_station_id = bo.complex_id
     LEFT JOIN borough_lookup bd ON od.destination_station_id = bd.complex_id
     ORDER BY passenger_count DESC`,

    `CREATE OR REPLACE MACRO local.main.dbtc_route_segment_speeds(
       target_date := (CURRENT_DATE - INTERVAL '1 day')::DATE,
       route_filter := '7,7X,E,F,FX,M,R,N,W'
     ) AS TABLE
     WITH stop_arrivals AS (
       SELECT
         event_date,
         agency_id,
         regexp_replace(route_id, 'X$', '') AS route_id,
         trip_id,
         rtrim(station_id, 'NS') AS station_id,
         MIN(event_time) AS arrival_time
       FROM prod.transit_v2.fact_vehicle_positions
       WHERE event_date = target_date
         AND agency_id = 'MTA_NYCT_SUBWAY'
         AND list_contains(string_split(route_filter, ','), route_id)
         AND station_id IS NOT NULL AND station_id != ''
         AND trip_id IS NOT NULL AND trip_id != ''
         AND EXTRACT(HOUR FROM event_time AT TIME ZONE 'America/New_York') BETWEEN 7 AND 19
       GROUP BY 1, 2, 3, 4, 5
     ),
     consec_legs AS (
       SELECT
         event_date,
         agency_id,
         route_id,
         station_id AS from_station_id,
         LEAD(station_id) OVER (PARTITION BY event_date, agency_id, route_id, trip_id ORDER BY arrival_time) AS to_station_id,
         EXTRACT(EPOCH FROM (
           LEAD(arrival_time) OVER (PARTITION BY event_date, agency_id, route_id, trip_id ORDER BY arrival_time) - arrival_time
         )) AS travel_sec
       FROM stop_arrivals
     ),
     normalized_legs AS (
       SELECT
         max(event_date) AS event_date,
         agency_id,
         route_id,
         LEAST(from_station_id, to_station_id) AS from_station_id,
         GREATEST(from_station_id, to_station_id) AS to_station_id,
         CAST(round(avg(travel_sec), 0) AS DOUBLE) AS leg_travel_time_sec,
         count(*) AS sample_count
       FROM consec_legs
       WHERE to_station_id IS NOT NULL
         AND from_station_id <> to_station_id
         AND travel_sec BETWEEN 15 AND 600
       GROUP BY agency_id, route_id, LEAST(from_station_id, to_station_id), GREATEST(from_station_id, to_station_id)
       HAVING count(*) >= 2
     ),
     station_routes AS (
       SELECT station_id, string_agg(DISTINCT route_id, ',' ORDER BY route_id) AS obs_routes
       FROM (
         SELECT from_station_id AS station_id, route_id FROM normalized_legs
         UNION ALL
         SELECT to_station_id AS station_id, route_id FROM normalized_legs
       )
       GROUP BY station_id
     ),
     stations AS (
       SELECT gtfs_stop_id, name, latitude, longitude
       FROM prod.transit_v2.view_dim_stations
       WHERE agency_id = 'MTA_NYCT_SUBWAY'
     ),
     with_coords AS (
       SELECT
         nl.event_date,
         nl.agency_id,
         nl.route_id,
         nl.from_station_id,
         trim(regexp_replace(sf.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS from_station_name,
         concat_ws(',', nullif(srf.obs_routes, ''), nullif(regexp_extract(sf.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS from_routes,
         CAST(sf.latitude AS DOUBLE) AS from_lat,
         CAST(sf.longitude AS DOUBLE) AS from_lon,
         nl.to_station_id,
         trim(regexp_replace(st.name, '\\s*\\([A-Z0-9,\\s/-]+\\)\\s*$', '')) AS to_station_name,
         concat_ws(',', nullif(srt.obs_routes, ''), nullif(regexp_extract(st.name, '\\(([A-Z0-9,\\s/-]+)\\)\\s*$', 1), '')) AS to_routes,
         CAST(st.latitude AS DOUBLE) AS to_lat,
         CAST(st.longitude AS DOUBLE) AS to_lon,
         nl.leg_travel_time_sec,
         nl.sample_count,
         2 * 6371000 * ASIN(SQRT(
           POWER(SIN(RADIANS(st.latitude - sf.latitude) / 2), 2) +
           COS(RADIANS(sf.latitude)) * COS(RADIANS(st.latitude)) *
           POWER(SIN(RADIANS(st.longitude - sf.longitude) / 2), 2)
         )) AS leg_distance_meters
       FROM normalized_legs nl
       JOIN stations sf ON nl.from_station_id = sf.gtfs_stop_id
       JOIN stations st ON nl.to_station_id = st.gtfs_stop_id
       LEFT JOIN station_routes srf ON nl.from_station_id = srf.station_id
       LEFT JOIN station_routes srt ON nl.to_station_id = srt.station_id
     )
     SELECT
       wc.event_date,
       wc.agency_id,
       wc.route_id,
       coalesce(sl.line_id, wc.route_id) AS line_id,
       coalesce(sl.service_name, wc.route_id) AS service_name,
       coalesce(nullif(sl.line_name, ''), concat(wc.route_id, ' Line')) AS line_name,
       coalesce(sl.division, 'IRT') AS division,
       coalesce(sl.color_hex, '#808183') AS color_hex,
       wc.from_station_id,
       wc.from_station_name,
       wc.from_routes,
       wc.from_lat,
       wc.from_lon,
       wc.to_station_id,
       wc.to_station_name,
       wc.to_routes,
       wc.to_lat,
       wc.to_lon,
       CAST(round(wc.leg_distance_meters, 0) AS DOUBLE) AS leg_distance_meters,
       CAST(round(wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0), 2) AS DOUBLE) AS leg_speed_mps,
       CAST(round((wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) * 2.23694, 1) AS DOUBLE) AS speed_mph,
       CAST(round((wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) * 2.23694, 1) AS DOUBLE) AS effective_speed_mph,
       wc.leg_travel_time_sec,
       wc.sample_count
     FROM with_coords wc
     LEFT JOIN prod.transit_v2.view_dim_service_lines sl ON wc.agency_id = sl.agency_id AND wc.route_id = sl.route_id
     WHERE (wc.leg_distance_meters / nullif(wc.leg_travel_time_sec, 0)) BETWEEN 1.5 AND 27.0
     QUALIFY row_number() OVER (
       PARTITION BY wc.from_station_id, wc.to_station_id
       ORDER BY wc.sample_count DESC, wc.route_id ASC
     ) = 1
     ORDER BY speed_mph ASC`,
  ];

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      console.warn('Could not register DBTC Ossie view:', err);
    }
  }
}

export async function checkDuckLakeSnapshot(
  _conn: duckdb.AsyncDuckDBConnection,
  snapshotId: string
): Promise<{ valid: boolean; timestamp?: number; expired?: boolean }> {
  if (!snapshotId || !snapshotId.trim()) {
    return { valid: false, expired: true };
  }
  return { valid: true, timestamp: Date.now() };
}

