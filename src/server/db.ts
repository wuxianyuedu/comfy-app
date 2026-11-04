/**
 * `db.ts` -- Drizzle over async `@libsql/client` (`file:./db.sqlite`); dev singleton on globalThis (hot reloads).
 * libsql replaced better-sqlite3 (sync driver pinned the event loop); same schema/pragmas. NOTE (ASCII-only):
 * code-frame spans are byte offsets and panic on multibyte chars, killing `next build` (standards sec.5).
 */
import "server-only";
import path from "node:path";
import { env } from "~/env";
import { applySqlitePragmas } from "~/lib/sqlite-pragmas";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
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

// libsql's file: URL wants the resolved absolute path so hot reloads and
// drizzle-kit keep pointing at the same file regardless of process CWD shifts.
const client = createClient({
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- env may lack DATABASE_URL under SKIP_ENV_VALIDATION (see the comment above); zod declares it required, so this ?? is the only build-time guard
  url: `file:${resolveDbPath(env.DATABASE_URL ?? DEFAULT_DB_FILE)}`,
});

// Pragma init is awaited at top level so the exported `db` never runs a query before WAL/foreign_keys are on;
// the list lives in `~/lib/sqlite-pragmas`, which deliberately holds only the two database-level pragmas and
// leaves the lock-wait budget unset -- a contended write fails fast rather than stalling the event loop (#1250).
// `applySqlitePragmas` survives a concurrent WAL switch: `next build` collects page data with 7 workers, a new
// db file grants the lock to only one (measured 3/8 SQLITE_BUSY); the unhandled rejection kills the build (#1282).
await applySqlitePragmas(client);

/* SAFETY: reviewed */
const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export const db = globalForDb.db ?? drizzle(client, { schema });

if (env.NODE_ENV !== "production") {
  globalForDb.db = db;
}

/**
 * Close the underlying libsql client (tests only today); nothing in the app closes it. Tests pointing
 * `DATABASE_URL` at a temp file must release the handle first: Windows cannot unlink an open sqlite file
 * (`rmSync` fails with EPERM).
 */
export function closeDb(): void {
  client.close();
}

/** Liveness probe for the health route (keeps the route off `db` / `orm`, standards 1 sec.1.10); same `SELECT 1`.
 *
 *  It **returns the promise** and callers must await it: the async driver would otherwise report "db: up" for
 *  a broken database (route answers 200 while the rejection floats unserved). Kept ASCII: code-frame byte slicing
 *  panics on multibyte chars (AGENTS hard rule 16 / standards 12 sec.12.4.6). */
export function pingDatabase(): Promise<unknown> {
  return db.run(sql`select 1`);
}
