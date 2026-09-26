/**
 * `db-schema-ready.ts` -- runtime probe for "are the DB tables ready yet?"
 * ===========================================================================
 *
 * Why this exists
 * ---------------
 * A few modules run **module-level side effects that read the database as soon
 * as they are loaded** -- the clearest example is the ComfyUI orphan-task reaper
 * (`src/lib/comfyui/reaper.ts`): `enqueue.ts` pulls it onto the boot path with a
 * bare `import "./reaper"`, so a freshly started server immediately reclaims
 * tasks abandoned by the previous lifetime.
 *
 * Those side effects have no notion of "is the DB usable yet":
 *   - `next build` loads the module graph in worker processes for every route
 *     during the collect-page-data / prerender phase, so the reaper also runs
 *     at build time;
 *   - on a clean checkout (CI, fresh clone) `db.sqlite` does not exist yet
 *     because `pnpm db:push` has not been run.
 *
 * The collision does not merely skip one reap -- it **breaks the build**:
 * `no such table: task` / `no such table: user` escapes the worker as an
 * unhandled rejection, Next aggregates it into a collect-page-data stage error,
 * and the reported line points at an unrelated route file. That keeps the CI
 * `pnpm build` gate red for reasons that have nothing to do with the route in
 * the trace.
 *
 * Design
 * ------
 * - The probe is **read-only** and **runs at most once** (cached): it queries
 *   `sqlite_master` for a sentinel table, which is negligible and has no write
 *   side effect (`drizzle-kit push` is the only thing that creates tables);
 * - The result is three-state (`ready` / `missing` / `unknown`) so callers own
 *   the semantics instead of this module swallowing everything: "DB is broken"
 *   and "tables do not exist yet" are different problems and only the latter
 *   should be skipped silently;
 * - No new log file is introduced (spec sec.4); callers log a warn if they wish.
 *
 * NOTE (keep this file ASCII-only): Next's error code frame renderer
 * (`next-code-frame`) computes highlight spans by byte offset and panics
 * (`end byte index N is not a char boundary`) when a span lands inside a
 * multi-byte character. Because this module sits on the build-time module graph
 * it gets rendered into such a frame, taking the whole `next build` down with a
 * Rust panic. Other docs in this repo are free to use Chinese; this particular
 * file must not.
 *
 * @module lib/db-schema-ready
 */
// Section 18.4 form 3 (P3 lib-foundation batch, last-mile for reaper): this
// module intentionally drops `import "server-only"` and is registered in
// `tests/lib-node-only-declarations.test.ts` under `PURE_NODE_HOSTS`. It uses
// `node:sqlite` DatabaseSync (native in Node 22+), `node:path`, and pure
// `~/lib/shell/tracing-ignore` -- no server-only chain. The ComfyUI reaper
// imports `isSchemaReady()` statically; without this change, a pure Node
// executor host (P3 phase 2 `scripts/executor-host.mjs`) loading `reaper`
// would crash here at the `import "server-only"` throw before ever reaching
// the probe. Keeping the ASCII-only invariant (see NOTE above and hard rule
// 16) is unrelated to the declaration form and still holds.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";

/** Table readiness state. */
export type SchemaReadiness = "ready" | "missing" | "unknown";

/** Probe result cache: at most one probe per process. A schema cannot appear
 *  from nothing twice within a single process lifetime in a way we care about,
 *  and repeating the query on every sweep would be pure overhead. */
let cached: SchemaReadiness | null = null;

/** Sentinel table. `task` is the first table the reaper touches and the one
 *  that historically reported `no such table` first; probing it covers both
 *  "DB file missing" and "schema only half created". */
const SENTINEL_TABLE = "task";

/**
 * Resolve the SQLite file path from a `DATABASE_URL`.
 *
 * Uses the exact same anchor as `src/server/db.ts::resolveDbPath` (process CWD,
 * with the `file:` prefix stripped) so the probe and the real connection can
 * never disagree about which file they are looking at.
 */
export function resolveSqlitePath(databaseUrl?: string): string {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:./db.sqlite";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(...tracingIgnoreArgs(), process.cwd(), raw);
}

/**
 * Check whether the sentinel table exists.
 *
 * Any probe-time failure maps to `unknown`: the probe must never become a new
 * failure source of its own.
 */
export function probeSchemaSync(databaseUrl?: string): SchemaReadiness {
  try {
    const db = new DatabaseSync(resolveSqlitePath(databaseUrl), {
      // Read-only: when the DB file is absent SQLite errors out instead of
      // silently creating an empty database, which would let dev/start keep
      // running behind the illusion of a usable DB.
      readOnly: true,
      open: true,
    });
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(SENTINEL_TABLE);
      return row ? "ready" : "missing";
    } finally {
      db.close();
    }
  } catch {
    /* Missing file / not a SQLite database / permission denied: all of these
     * mean "tables are not ready" for our purposes. */
    return "unknown";
  }
}

/**
 * Cached readiness check, meant for module-level side effects.
 *
 * @returns `true` when the tables exist and it is safe to read the DB.
 *   Otherwise the caller must **skip** this round; the next interval tick (or
 *   the next run after `pnpm install` / creating the tables) will pick it up.
 */
export function isSchemaReady(databaseUrl?: string): boolean {
  cached ??= probeSchemaSync(databaseUrl);
  return cached === "ready";
}

/** Clear the cache. Test-only helper so one vitest process can build both a
 *  "ready" and a "not ready" database. */
export function resetSchemaReadinessCache(): void {
  cached = null;
}
