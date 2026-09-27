/**
 * `db.ts` -- Drizzle instance over the async `@libsql/client` driver.
 * ===========================================================================
 *
 * Connects to `db.sqlite` via `@libsql/client` (`DATABASE_URL` looks like
 * `file:./db.sqlite`). In development the singleton is parked on globalThis so
 * Next dev hot reloads do not reopen the connection on every re-evaluation.
 *
 * Why libsql (was better-sqlite3): better-sqlite3 is a *synchronous* driver --
 * any slow SQL, big Zod safeParse, or index scan pinned the whole Next server
 * event loop and amplified every backend slowdown (see MEMORY notes). libsql
 * speaks the same SQLite file format and ships a native async client, so we
 * keep the schema, the file layout and Drizzle's `libsql` adapter and stop
 * blocking the loop. Same WAL / foreign_keys pragmas as before.
 *
 * NOTE (keep this file ASCII-only): it sits on the build-time module graph and
 * Next's error code frame renderer computes highlight spans by byte offset,
 * panicking (`end byte index N is not a char boundary`) when a span lands
 * inside a multi-byte character -- which takes the whole `next build` down with
 * a Rust panic that points nowhere near the real cause. See
 * `docs/standards/launch-and-build.md` sec.5.
 *
 * @module server/db
 */
import "server-only";
import path from "node:path";
import { env } from "~/env";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./db/schema";

/** Fallback DB file when `DATABASE_URL` carries no path (relative to CWD).
 *  Same anchor as drizzle-kit, see `resolveDbPath`. */
const DEFAULT_DB_FILE = "./db.sqlite";

function resolveDbPath(url: string): string {
  // MUST use the same anchor as drizzle-kit push: relative paths resolve
  // against the process CWD (the launcher and drizzle-kit both run with the
  // project root as CWD).
  //
  // This used to parse with `new URL(url)`, which turned "file:./db.sqlite"
  // into file:///db.sqlite -- on Windows that lands in the drive root
  // (F:\db.sqlite), a brand new empty database. The real data was never read,
  // which is what made the whole workflow library render empty (root cause of
  // the Drizzle migration gap).
  //
  // `url || DEFAULT_DB_FILE` guards the case where the value is present but
  // empty: `SKIP_ENV_VALIDATION=1` lets `env` build without `DATABASE_URL`, so
  // `env.DATABASE_URL` is `undefined` at build time and `url.startsWith` below
  // would throw `Cannot read properties of undefined` -- killing `next build`
  // during collect-page-data with a trace pointing at an unrelated route.
  // The default is the same "tables may not exist yet" state the
  // `db-schema-ready` probe reports, so the failure surfaces as a readable
  // 503 (see `src/app/api/health/route.ts`) instead of a build crash.
  const value = url || DEFAULT_DB_FILE;
  const raw = value.startsWith("file:") ? value.slice("file:".length) : value;
  return path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    raw || DEFAULT_DB_FILE,
  );
}

// libsql's file: URL wants the resolved absolute path so hot reloads and
// drizzle-kit keep pointing at the same file regardless of process CWD shifts.
const client = createClient({
  url: `file:${resolveDbPath(env.DATABASE_URL ?? DEFAULT_DB_FILE)}`,
});

// Pragma init: awaited at module top-level so the exported `db` never runs a
// query before WAL / foreign_keys are on. The Drizzle async adapter queues
// commands, so a slow startup pragma would otherwise race with the first
// route-handler hit. Next 15 / Node 20 support top-level await in ESM server
// modules; this file is `server-only` so it never lands in the client graph.
await client.execute("PRAGMA journal_mode = WAL");
await client.execute("PRAGMA foreign_keys = ON");

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export const db = globalForDb.db ?? drizzle(client, { schema });

if (env.NODE_ENV !== "production") globalForDb.db = db;

/**
 * Close the underlying libsql client (tests only today).
 *
 * Nothing in the app ever closes it: the Next server process ends with the
 * connection still open. Tests that point `DATABASE_URL` at a temp file need
 * the handle released before they can delete that file on Windows (an open
 * sqlite file cannot be unlinked -- `rmSync` fails with EPERM).
 */
export function closeDb(): void {
  client.close();
}
