/**
 * `db.ts` -- Drizzle instance (replaces the former PrismaClient singleton).
 * ===========================================================================
 *
 * Connects to `db.sqlite` through the synchronous better-sqlite3 driver
 * (`DATABASE_URL` looks like `file:./db.sqlite`). In development the singleton
 * is parked on globalThis so Next dev hot reloads do not reopen the
 * connection on every re-evaluation.
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
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
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

const sqlite = new Database(resolveDbPath(env.DATABASE_URL ?? DEFAULT_DB_FILE));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export const db = globalForDb.db ?? drizzle(sqlite, { schema });

if (env.NODE_ENV !== "production") globalForDb.db = db;
