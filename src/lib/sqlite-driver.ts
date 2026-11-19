/**
 * `sqlite-driver.ts` -- one `node:sqlite` connection wrapped into the callback
 * shape drizzle's async `sqlite-proxy` session expects (ISSUE #3171).
 *
 * Why the proxy: drizzle-orm 0.45 has no `node:sqlite` dialect, while the
 * runtime driver moved off `@libsql/client` -- that addon loads an 8.5 MB
 * native `.node` file into every server/host process. `node:sqlite` ships with
 * Node >= 26.12.1 (the `engines` floor), so the only thing needed is an async
 * adapter over its synchronous `DatabaseSync` API. The callback shape is the
 * same one `tests/helpers/test-db.ts` already uses (better-sqlite3 host), so
 * production and tests speak one dialect.
 *
 * Rows MUST be positional arrays. `mapResultRow` indexes the row by
 * `columnIndex`; handing it an object silently reads every column as
 * `undefined` (the failure then looks like corrupt data, not a wrong host).
 * `setReturnArrays(true)` is the node:sqlite equivalent of better-sqlite3's
 * `raw()`.
 *
 * The driver throws synchronously; this adapter returns a resolved promise and
 * lets the throw escape from inside the (async) drizzle call, so callers still
 * see a rejection. A lock error therefore reaches drizzle as `DrizzleQueryError`
 * with the driver error on `cause` -- `~/lib/sqlite-error` reads `errcode` /
 * `errstr` from there (the driver's own `code` is always `ERR_SQLITE_ERROR`).
 *
 * Keep this file ASCII-only: `src/server/db.ts` pulls it into every route's
 * module graph and that file is whitelisted ASCII because a multi-byte
 * character inside a rendered code frame panics `next build`
 * (AGENTS.md hard rule 16 / launch-and-build sec.5).
 *
 * @module lib/sqlite-driver
 */
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementSync,
} from "node:sqlite";

import type { RemoteCallback } from "drizzle-orm/sqlite-proxy";

/** What the three connection sites hand to drizzle and to the PRAGMA list. */
export type NodeSqliteHandle = {
  close(): void;
  /** `SqlitePragmaTarget` adapter: `DatabaseSync.exec` takes the string as-is. */
  execute(sql: string): void;
  /** Async callback consumed by `drizzle(proxy, { schema })`. */
  readonly proxy: RemoteCallback;
  /** Raw handle; only `close()` is used outside this module. */
  readonly sqlite: DatabaseSync;
};

/** The subset of `StatementSync` used here. `close()` exists at runtime since
 *  Node 24 but the bundled `@types/node` 24.19 omits it, so it is declared
 *  optional rather than asserted -- a missing method is simply not called. */
type RuntimeStatement = Pick<StatementSync, "all" | "get" | "run" | "setReturnArrays"> & {
  readonly close?: () => void;
};

type NodeSqliteProxy = (
  sql: string,
  params: Array<SQLInputValue>,
  method: "run" | "all" | "values" | "get",
) => Promise<{ changes?: number; lastInsertRowid?: number; rows: unknown[] }>;

/** With `setReturnArrays(true)` a row IS an array of values; narrow it here so
 *  the `get` branch returns the row itself (which is what `mapGetResult` reads)
 *  instead of an object it would index wrongly. */
function isRowArray(value: unknown): value is SQLOutputValue[] {
  return Array.isArray(value);
}

/** Statements are prepared per call: libsql also parsed every execute, and a
 *  per-connection statement cache would need lifetime management for no
 *  measurable win at this call volume. */
function statementResult(
  stmt: RuntimeStatement,
  params: Array<SQLInputValue>,
  method: "run" | "all" | "values" | "get",
): { changes?: number; lastInsertRowid?: number; rows: unknown[] } {
  if (method === "run") {
    const result = stmt.run(...params);
    return {
      rows: [],
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }
  if (method === "get") {
    const row: unknown = stmt.get(...params);
    return { rows: isRowArray(row) ? row : [] };
  }
  return { rows: stmt.all(...params) };
}

/**
 * Open `file` (absolute path) and return the drizzle-facing handle.
 *
 * The caller owns the PRAGMA list and the lock-wait budget: `node:sqlite` has
 * exactly one connection per process, so a `PRAGMA busy_timeout` applies to
 * every statement -- the "boot PRAGMA only covers the pooled connection it
 * borrowed" trap of the libsql `file:` client (standards sec.7.6) is gone.
 */
export function openNodeSqlite(file: string): NodeSqliteHandle {
  const sqlite = new DatabaseSync(file);
  let closed = false;

  const proxyImpl: NodeSqliteProxy = (sql, params, method) => {
    const stmt: RuntimeStatement = sqlite.prepare(sql);
    stmt.setReturnArrays(true);
    try {
      return Promise.resolve(statementResult(stmt, params, method));
    } finally {
      stmt.close?.();
    }
  };
  /* `RemoteCallback` declares `params: any[]` and `rows: any[]`; the impl above
   * is structurally narrower, so assigning it needs no cast. */
  const proxy: RemoteCallback = proxyImpl;

  return {
    sqlite,
    execute(sql: string): void {
      sqlite.exec(sql);
    },
    proxy,
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      sqlite.close();
    },
  };
}
