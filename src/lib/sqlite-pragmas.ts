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
import { backoffDelayMs, SQLITE_PRAGMA_BOOT } from "~/lib/retry-policy";
import { isSqliteBusyError } from "~/lib/sqlite-error";
import { sleep } from "~/lib/with-timeout";

/** Lock-waiting budget for one connection, in ms. Applied through the libsql
 *  client's `timeout` option, never through a PRAGMA (see the note above). */
export const SQLITE_BUSY_TIMEOUT_MS = 250;

/** Database-level PRAGMA list. Order is meaning: WAL first, then integrity. */
export const SQLITE_PRAGMAS: readonly string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
];

/** 一次 PRAGMA 执行的最小形态。
 *
 *  只声明用到的那一个方法，调用方传 `@libsql/client` 的 `Client`（它有更多方法）
 *  或本测试里的假对象都成立 —— 这样本模块不必依赖驱动类型，`scripts/*.mjs` 那侧
 *  的可测性也不受影响。 */
export interface SqlitePragmaTarget {
  execute(sql: string): Promise<unknown>;
}

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
 * （执行宿主那侧今天有 `timeout` 预算，Next 两处刻意没有 —— 预算的取舍见文件头，
 * 与「开机这几条要不要重试」是两个独立决定，后者三处都要）。
 *
 * @param target 已建好的连接（`@libsql/client` 的 `Client`）。
 * @param pragmas 要应用的清单，默认就是本模块那份；只为测试留出注入点。
 * @throws 非锁族错误、或重试穷尽后，抛出原错误（调用方据此失败得看得见）。
 */
export async function applySqlitePragmas(
  target: SqlitePragmaTarget,
  pragmas: readonly string[] = SQLITE_PRAGMAS,
): Promise<void> {
  const { maxAttempts, ...backoff } = SQLITE_PRAGMA_BOOT;
  for (const pragma of pragmas) {
    for (let attempt = 0; ; attempt++) {
      try {
        await target.execute(pragma);
        break;
      } catch (err) {
        /* 穷尽后如实抛：切 WAL 切不掉也可能是真故障，不许在这里被吞掉。 */
        if (!isSqliteBusyError(err) || attempt + 1 >= maxAttempts) throw err;
        await sleep(backoffDelayMs({ ...backoff, attempt }));
      }
    }
  }
}
