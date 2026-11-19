import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import {
  store,
  persistSourceToDuckDb,
  deleteSourceFromDuckDb,
  dropLocalRelationIfExists,
} from '../state/store.js';
import { getDuckDbClient } from './duckdb-client.js';

export { deleteSourceFromDuckDb };

const sourceRowCounts = new Map<string, number>();

export function getConnectedSourceRowCount(sourceName: string): number | undefined {
  return sourceRowCounts.get(sourceName);
}

export function sanitizeTableName(raw: string): string {
  const base = raw.replace(/\.[^/.]+$/, '');
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'uploaded_data';
}

export async function ingestLocalFile(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  file: File,
  includeInOfflineExport = false
): Promise<{ tableName: string; rowCount: number }> {
  const MAX_BYTES = 100 * 1024 * 1024; // 100 MB limit
  if (file.size > MAX_BYTES) {
    throw new Error(`File size ${(file.size / (1024 * 1024)).toFixed(1)} MB exceeds maximum allowed limit of 100 MB.`);
  }

  const tableName = sanitizeTableName(file.name);
  const virtualPath = `uploads/${file.name}`;

  // Read file as Uint8Array and register buffer
  const arrayBuffer = await file.arrayBuffer();
  await db.registerFileBuffer(virtualPath, new Uint8Array(arrayBuffer));

  const isParquet = file.name.endsWith('.parquet') || file.name.endsWith('.pq');
  const readFn = isParquet ? `read_parquet('${virtualPath}')` : `read_csv_auto('${virtualPath}')`;

  // Create table in local.main
  await dropLocalRelationIfExists(conn, tableName);
  await conn.query(`CREATE OR REPLACE TABLE local.main.${tableName} AS SELECT * FROM ${readFn};`);

  const countResult = await conn.query(`SELECT COUNT(*) as cnt FROM local.main.${tableName};`);
  const rowCount = Number(countResult.getChildAt(0)?.get(0) ?? 0);
  sourceRowCounts.set(tableName, rowCount);

  // Record in store and DB
  const sourceState = {
    sourceName: tableName,
    kind: 'local_upload' as const,
    urlOrFilename: file.name,
    byteSize: file.size,
    includeInOfflineExport,
    createdAt: Date.now(),
  };

  const existingIdx = store.sources.findIndex(s => s.sourceName === tableName);
  if (existingIdx >= 0) {
    store.sources[existingIdx] = sourceState;
  } else {
    store.sources.push(sourceState);
  }

  await persistSourceToDuckDb(conn, sourceState);

  return { tableName, rowCount };
}

export async function registerRemoteUrlView(
  conn: AsyncDuckDBConnection,
  name: string,
  url: string,
  isParquet?: boolean,
  db?: AsyncDuckDB | null,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const detectedParquet = isParquet ?? (url.toLowerCase().includes('.parquet') || url.toLowerCase().includes('.pq'));
  const viewName = sanitizeTableName(name);
  const activeDb = db !== undefined ? db : getDuckDbClient();

  let byteSize = 0;
  let ingestedViaBuffer = false;

  // Socrata dynamic CSV endpoints do not support HTTP HEAD/Range requests required by DuckDB-Wasm's
  // synchronous worker httpfs. Fetching via browser fetch() and registering a VFS buffer in DuckDB
  // makes Socrata and remote CSV connections fast and reliable in browser WASM.
  if (!detectedParquet && activeDb && typeof fetchImpl === 'function') {
    try {
      const fetchUrl =
        /\/resource\/[a-z0-9-]+\.csv/i.test(url) && url.includes('$limit=50000')
          ? url.replace('$limit=50000', '$limit=5000')
          : url;
      const resp = await fetchImpl(fetchUrl);
      if (resp.ok) {
        const arrayBuffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        if (bytes.byteLength > 0) {
          const virtualPath = `remote/${viewName}.csv`;
          await activeDb.registerFileBuffer(virtualPath, bytes);
          await dropLocalRelationIfExists(conn, viewName);
          try {
            await conn.query(
              `CREATE OR REPLACE TABLE local.main.${viewName} AS SELECT * FROM read_csv_auto('${virtualPath}');`
            );
          } catch {
            await conn.query(
              `CREATE OR REPLACE TABLE local.main.${viewName} AS SELECT * FROM read_csv_auto('${virtualPath}', sample_size=-1, ignore_errors=true);`
            );
          }
          const countRes = await conn.query(`SELECT COUNT(*) as cnt FROM local.main.${viewName};`);
          const rowCount = Number(countRes.getChildAt(0)?.get(0) ?? 0);
          sourceRowCounts.set(viewName, rowCount);
          byteSize = bytes.byteLength;
          ingestedViaBuffer = true;
        }
      }
    } catch {
      // Fall back to direct read_csv_auto(url) view creation below
    }
  }

  if (!ingestedViaBuffer) {
    const safeUrl = url.replace(/'/g, "''");
    const readFn = detectedParquet ? `read_parquet('${safeUrl}')` : `read_csv_auto('${safeUrl}')`;
    await dropLocalRelationIfExists(conn, viewName);
    await conn.query(`CREATE OR REPLACE VIEW local.main.${viewName} AS SELECT * FROM ${readFn};`);
  }

  const sourceState = {
    sourceName: viewName,
    kind: (detectedParquet ? 'remote_parquet_url' : 'remote_csv_url') as 'remote_parquet_url' | 'remote_csv_url',
    urlOrFilename: url,
    byteSize,
    includeInOfflineExport: false,
    createdAt: Date.now(),
  };

  const existingIdx = store.sources.findIndex(s => s.sourceName === viewName);
  if (existingIdx >= 0) {
    store.sources[existingIdx] = sourceState;
  } else {
    store.sources.push(sourceState);
  }

  await persistSourceToDuckDb(conn, sourceState);

  return viewName;
}

export async function removeSource(
  conn: AsyncDuckDBConnection,
  sourceName: string
): Promise<void> {
  sourceRowCounts.delete(sourceName);
  store.sources = store.sources.filter(s => s.sourceName !== sourceName);
  await deleteSourceFromDuckDb(conn, sourceName);
}

