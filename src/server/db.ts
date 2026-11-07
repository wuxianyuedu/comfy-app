/**
 * `db.ts` -- Drizzle over one `node:sqlite` connection (`file:./db.sqlite`);
 * dev singleton on globalThis (hot reloads). The runtime driver moved from
 * `@libsql/client` to the SQLite bundled with Node (ISSUE #3171): same schema,
 * same PRAGMAs, one less 8.5 MB native addon in every process. NOTE
 * (ASCII-only): code-frame spans are byte offsets and panic on multibyte chars,
 * killing `next build` (standards sec.5).
 */
import "server-only";
import path from "node:path";

import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import { env } from "~/env";
import { openNodeSqlite, type NodeSqliteHandle } from "~/lib/sqlite-driver";
import { gateProxyWithPragmas } from "~/lib/sqlite-pragmas";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { sql } from "drizzle-orm";
import * as schema from "./db/schema";

/** Fallback DB file when `DATABASE_URL` carries no path (relative to CWD).
 *  Same anchor as drizzle-kit, see `resolveDbPath`. */
const DEFAULT_DB_FILE = "./db.sqlite";

function resolveDbPath(url: string): string {
  // MUST use the same anchor as drizzle-kit push: relative paths resolve against the process CWD (both run at root).
  // `new URL(url)` turned "file:./db.sqlite" into file:///db.sqlite -- on Windows the drive root (F:\db.sqlite), a new
  // empty database; that made the workflow library render empty (Drizzle migration gap root cause).
  // `url || DEFAULT_DB_FILE` guards empty/undefined at build time (`SKIP_ENV_VALIDATION=1`), where `url.startsWith`
  // would throw and kill `next build`; the default yields a readable 503 (health route), not a build crash.
  const value = url || DEFAULT_DB_FILE;
  const raw = value.startsWith("file:") ? value.slice("file:".length) : value;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw || DEFAULT_DB_FILE);
}

// Absolutize here so hot reloads, the executor host and drizzle-kit keep
// pointing at the same file regardless of process CWD shifts.
const nodeSqlite = openNodeSqlite(resolveDbPath(env.DATABASE_URL ?? DEFAULT_DB_FILE));

// PRAGMA init must NOT be a top-level await (ISSUE #3252): TLA makes Turbopack
// emit this module as an async module, and `db` is imported by
// `repository-base` -- the base class of every `class X extends
// DrizzleRepository`. Under an async module those `extends` clauses evaluate
// before the base class is exported ("Class extends value undefined") when the
// instrumentation hook loads the film/repository graph. Gate the drizzle proxy
// on the init promise instead: the module stays synchronous, while every query
// still waits for WAL/foreign_keys (with the #1282 busy retry) before it runs.
const gatedProxy = gateProxyWithPragmas(nodeSqlite);

/* SAFETY: reviewed */
const globalForDb = globalThis as unknown as {
  db: SqliteRemoteDatabase<typeof schema> | undefined;
};

export const db = globalForDb.db ?? drizzle(gatedProxy, { schema });

/** The retired libsql driver exposed the client as `$client`; tests use that
 *  property (and `closeDb`) to release the handle before unlinking a temp
 *  database on Windows. Keep the shape without pretending the proxy has more
 *  API than the handle. */
/* SAFETY: reviewed */
(db as SqliteRemoteDatabase<typeof schema> & { $client?: NodeSqliteHandle }).$client = nodeSqlite;

if (env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

/**
 * Close the underlying `node:sqlite` handle (tests only today); nothing in the
 * app closes it. Tests pointing `DATABASE_URL` at a temp file must release the
 * handle first: Windows cannot unlink an open sqlite file (`rmSync` fails with
 * EPERM).
 */
export function closeDb(): void {
  nodeSqlite.close();
}

/** Liveness probe for the health route (keeps the route off `db` / `orm`, standards 1 sec.1.10); same `SELECT 1`.
 *
 *  It **returns the promise** and callers must await it: the async facade would otherwise report "db: up" for
 *  a broken database (route answers 200 while the rejection floats unserved). Kept ASCII: code-frame byte slicing
 *  panics on multibyte chars (AGENTS hard rule 16 / standards 12 sec.12.4.6). */
export function pingDatabase(): Promise<unknown> {
  return db.run(sql`select 1`);
}
