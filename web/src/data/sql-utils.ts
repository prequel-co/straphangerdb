import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';

export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let inLineComment = false;
  let blockCommentDepth = 0;
  let dollarTag: string | null = null;

  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    const next = i + 1 < script.length ? script[i + 1] : '';

    if (inLineComment) {
      current += c;
      if (c === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      current += c;
      if (c === '/' && next === '*') {
        blockCommentDepth++;
        current += next;
        i++;
      } else if (c === '*' && next === '/') {
        blockCommentDepth--;
        current += next;
        i++;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (c === '$' && script.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += c;
      }
      continue;
    }

    if (inQuote) {
      current += c;
      if (c === quoteChar) {
        if (next === quoteChar) {
          current += next;
          i++;
        } else {
          inQuote = false;
        }
      }
      continue;
    }

    if (c === '-' && next === '-') {
      inLineComment = true;
      current += '--';
      i++;
    } else if (c === '/' && next === '*') {
      blockCommentDepth = 1;
      current += '/*';
      i++;
    } else if (c === '$') {
      const rest = script.slice(i);
      const tagMatch = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0];
        current += dollarTag;
        i += dollarTag.length - 1;
      } else {
        current += c;
      }
    } else if (c === "'" || c === '"') {
      inQuote = true;
      quoteChar = c;
      current += c;
    } else if (c === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += c;
    }
  }

  const lastTrimmed = current.trim();
  if (lastTrimmed) {
    statements.push(lastTrimmed);
  }

  return statements;
}

export async function executeSqlScript(
  conn: AsyncDuckDBConnection,
  script: string,
  options?: { continueOnError?: boolean }
): Promise<void> {
  const statements = splitSqlStatements(script);
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
    } catch (err) {
      console.warn('SQL script statement warning/error:', stmt.slice(0, 120), err);
      if (!options?.continueOnError) {
        throw err;
      }
    }
  }
}
