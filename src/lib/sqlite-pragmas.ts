/**
 * `sqlite-pragmas.ts` -- the settings every new database connection needs
 * (single definition; ISSUE #1250).
 * ===========================================================================
 *
 * Why it is collected here: the same two pragmas used to be written out at four
 * sites (`server/db.ts`, `server/workshop/db.ts`, `comfyui/host-runtime.ts` and
 * the launcher-side `scripts/launcher-core/standalone-runtime-env.mjs`), and
 * "adding one more to each place" means "forgetting one". In the packaged
 * topology the embedded Next server and the executor host write the *same* WAL
 * file, so a momentary write lock comes back as `SQLITE_BUSY` -- and before
 * #1250 a failed terminal write was never retried, which is how a finished task
 * stayed "generating" forever.
 *
 * TWO FAMILIES, DELIBERATELY SPLIT (measured, two processes, real driver):
 *
 * 1. `journal_mode` / `foreign_keys` describe the *database*: set once, they
 *    live in the file, so a PRAGMA at boot is the right shape and it is shared.
 * 2. The lock-waiting budget is a *connection* property, and a PRAGMA is the
 *    wrong place for it on this driver: `createClient({url: "file:"})` is a
 *    connection **pool**, and its size is `Math.max(1, config.concurrency)` --
 *    with `concurrency` unset that is `NaN`, i.e. "never at the limit", so the
 *    pool happily opens a second connection that never saw the boot PRAGMA.
 *    Measured: boot PRAGMA + one pooled connection busy -> contended write threw
 *    `SQLITE_BUSY` after 11 ms (no wait at all), while
 *    `createClient({ timeout })` -- which the driver applies when it *opens*
 *    every connection -- waited 2221 ms. That is also exactly what the
 *    packaged host did before this split: 4 retries burned 0.6 s because no
 *    connection actually had a budget.
 *
 * So the budget is exported as `SQLITE_BUSY_TIMEOUT_MS` and passed as the
 * `timeout` **client option** where it is wanted, and it is deliberately NOT
 * put back into `SQLITE_PRAGMAS`: a PRAGMA there looks like coverage while
 * quietly being coverage for one connection only, which is the same silent
 * failure this issue is about.
 *
 * Budget shape (why 250 and why only the host): libsql runs statements
 * synchronously, so waiting for a lock stalls *this process's* event loop by
 * that many milliseconds -- measured: during a 2.2 s wait a 10 ms heartbeat
 * fired zero times (it should have fired ~220). The host is the process whose
 * terminal write must land and it exists only to run tasks, so it takes the
 * 250 ms. The Next server answers UI requests and keeps failing fast instead;
 * what protects a contended write there is the bounded retry in
 * `comfyui/executor-write-retry.ts`, not a wait.
 *
 * The launcher side is a non-TypeScript host and cannot import this module;
 * `tests/sqlite-pragma-sites.test.ts` checks that it runs exactly this list and
 * that only `host-runtime.ts` carries the budget, so the judgement lives in a
 * test rather than in someone's memory.
 *
 * NOTE (keep this file ASCII-only): `src/server/db.ts` pulls it into every
 * route's module graph, and that file is whitelisted ASCII because a multi-byte
 * character inside a rendered code frame panics `next build`
 * (AGENTS.md hard rule 16 / launch-and-build sec.5).
 *
 * @module sqlite-pragmas
 */

/** Lock-waiting budget for one connection, in ms. Applied through the libsql
 *  client's `timeout` option, never through a PRAGMA (see the note above). */
export const SQLITE_BUSY_TIMEOUT_MS = 250;

/** Database-level PRAGMA list. Order is meaning: WAL first, then integrity. */
export const SQLITE_PRAGMAS: readonly string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
];
