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
 * TWO FAMILIES, DELIBERATELY SPLIT:
 *
 * 1. `journal_mode` / `foreign_keys` describe the *database*: set once, they
 *    live in the file, so a PRAGMA at boot is the right shape and it is shared.
 * 2. The lock-waiting budget is a *connection* property. Since the runtime
 *    driver moved from `@libsql/client` to `node:sqlite` (ISSUE #3171) each
 *    process owns exactly ONE `DatabaseSync` connection, so
 *    `PRAGMA busy_timeout` now covers every statement this process will ever
 *    run -- the old libsql `file:` pool trap (boot PRAGMA lands on one borrowed
 *    connection while later connections never saw it, measured 11 ms throw vs
 *    2221 ms wait) is gone with the pool.
 *
 * The budget is still exported as `SQLITE_BUSY_TIMEOUT_MS` and applied only
 * where it is wanted (`host-runtime.ts`, as `PRAGMA busy_timeout`). It stays
 * out of `SQLITE_PRAGMAS` on purpose: the Next server must keep failing fast,
 * and putting it in the shared list would silently give the UI process a
 * synchronous wait it never asked for.
 *
 * Budget shape (why 250 and why only the host): sqlite runs statements
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
 * The list is applied through `applySqlitePragmas()` rather than a bare
 * `for` loop at each site: the boot loop has to tolerate a *concurrent* WAL
 * switch, and three copies of that tolerance is two places to forget it
 * (ISSUE #1282, see the function's own note).
 *
 * NOTE (keep this file ASCII-only): `src/server/db.ts` pulls it into every
 * route's module graph, and that file is whitelisted ASCII because a multi-byte
 * character inside a rendered code frame panics `next build`
 * (AGENTS.md hard rule 16 / launch-and-build sec.5).
 *
 * @module sqlite-pragmas
 */
import { SQLITE_PRAGMA_BOOT } from "~/lib/retry-policy";
import { runWithSqliteBusyRetry } from "~/lib/sqlite-busy-retry";
import type { RemoteCallback } from "drizzle-orm/sqlite-proxy";

/** Lock-waiting budget for one connection, in ms. Applied at the host site
 *  through `PRAGMA busy_timeout` (one connection per process, see above). */
export const SQLITE_BUSY_TIMEOUT_MS = 250;

/** Database-level PRAGMA list. Order is meaning: WAL first, then integrity. */
export const SQLITE_PRAGMAS: ReadonlyArray<string> = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
];

/** 一次 PRAGMA 执行的最小形态。
 *
 *  只声明用到的那一个方法：调用方传 `~/lib/sqlite-driver` 的句柄（`execute`
 *  走 `DatabaseSync.exec`，同步返回）或本测试里的假对象都成立 —— 这样本模块不必
 *  依赖驱动类型，`scripts/*.mjs` 那侧的可测性也不受影响。 */
export type SqlitePragmaTarget = {
  execute(sql: string): unknown;
};

/**
 * 把那份清单应用到一条连接上，**撞锁按预算重试**。
 *
 * 为什么开机这几条要单独有出口（ISSUE #1282）：
 * 三处站点（Next 主库、工坊库、执行宿主）此前各自写一遍
 * `for (const pragma of SQLITE_PRAGMAS) await client.execute(pragma)` ——
 * 循环体逐字相同（§12.18 该收口），而更麻烦的是**它没有容错**：
 * `PRAGMA journal_mode = WAL` 在一份**还没切到 WAL** 的库上要独占锁，
 * 而 `next build` 会为 collect-page-data 起 7 个 worker 进程，每个都走一遍这个循环。
 * 实测（7 个独立进程同时打一份刚建的空库）：**3/8 抛 `SQLITE_BUSY`**，异常从模块顶层
 * await 浮出 worker、被 Next 聚合进 `Failed to collect page data for /api/trpc/[trpc]`
 * —— 报错行还落在无关路由上。干净检出上表现为「第一次 `pnpm build` 必失败、再跑一次就好」，
 * 而 CI 每次都是干净检出。
 *
 * 重试只认**锁族**错误（复用 `isSqliteBusyError`）：认不出原因就原样抛，
 * 不把「只读挂载 / 磁盘满」一类真故障拖成几次同样的尝试（与 `executor-write-retry` 同纪律）。
 *
 * 站在这里而不是各站点自己包一层：三处站点要的是**同一件事**，各写一遍就必然漏一处
 * （执行宿主那侧有 `PRAGMA busy_timeout` 预算，Next 两处刻意没有 —— 预算的取舍见文件头，
 * 与「开机这几条要不要重试」是两个独立决定，后者三处都要）。
 *
 * @param target 已建好的连接（`~/lib/sqlite-driver` 的 `NodeSqliteHandle`）。
 * @param pragmas 要应用的清单，默认就是本模块那份；只为测试留出注入点。
 * @throws 非锁族错误、或重试穷尽后，抛出原错误（调用方据此失败得看得见）。
 */
export async function applySqlitePragmas(
  target: SqlitePragmaTarget,
  pragmas: ReadonlyArray<string> = SQLITE_PRAGMAS,
): Promise<void> {
  for (const pragma of pragmas) {
    /* The loop body moved into `~/lib/sqlite-busy-retry` (ISSUE #2586) — the same
     * eight lines were written a second time there and a third time at the new
     * transaction site. Rationale unchanged: rethrow as-is when the budget is
     * exhausted or the cause is not a lock, because "could not switch to WAL"
     * may be a read-only mount / full disk, and that must fail visibly.
     * Written in English: the NOTE at the top of this file says keep it ASCII. */
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    await runWithSqliteBusyRetry(() => Promise.resolve(target.execute(pragma)), {
      policy: SQLITE_PRAGMA_BOOT,
    });
  }
}

/**
 * Wrap a node:sqlite handle's drizzle proxy so PRAGMA init is guaranteed to
 * finish before the first query, WITHOUT turning the caller into an async
 * module (ISSUE #3252).
 *
 * Why this shape: `db.ts` / `workshop/db.ts` must stay synchronous modules.
 * A top-level `await applySqlitePragmas(...)` makes Turbopack emit them as
 * async modules; every `class X extends DrizzleRepository` downstream then
 * evaluates its `extends` clause before the base class is exported, which is
 * exactly the "Class extends value undefined" that killed the daily E2E
 * webServer. Drizzle's `RemoteCallback` already returns a Promise, so we gate
 * on the (still fully retried, #1282) init promise inside the callback. The
 * module exports immediately; correctness is preserved at query time.
 *
 * Kept ASCII-only: this file is on the build-time module graph (see NOTE at
 * the top of the file).
 */
export function gateProxyWithPragmas(
  handle: SqlitePragmaTarget & {
    readonly proxy: RemoteCallback;
  },
): RemoteCallback {
  const ready = applySqlitePragmas(handle);
  /* Mark the promise as handled so a boot-time PRAGMA failure (e.g. read-only
   * mount) cannot surface as an unhandledRejection before the first query.
   * The rejection is still rethrown at query time via `await ready` below. */
  ready.catch(() => null);
  return async (query, params, method) => {
    await ready;
    return handle.proxy(query, params, method);
  };
}
