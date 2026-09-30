## Fixed

- **干净检出上第一次 `pnpm build` 必失败**（ISSUE #1282）。`Collecting page data` 阶段报 `Failed to collect page data for /api/trpc/[trpc]`（或任意一条 API 路由），`cause` 是 `SQLITE_BUSY: database is locked`，行号落在 `src/server/db.ts` 的开机 PRAGMA 循环上 —— 而**同一条命令再跑一次就好**，所以 CI 上呈现成「每次都是第一次、永远红」。
  - 根因是 **7 个 build worker 抢同一份新库的 WAL 切换**：Next 的「Collecting page data using 7 workers」起 7 个独立进程，每个都 import `src/server/db.ts`、于是每个都跑一遍 `PRAGMA journal_mode = WAL`。在一份**还没切到 WAL** 的库上这条 PRAGMA 要独占锁，而那一刻别人不是「正在写」、只是「正在开」。同进程内的多条连接会被驱动自己串行化（实测 7 条连接跑同一循环全绿），**只有独立进程才复现**：实测 7 个进程同时打一份刚建的空库，**3/8 抛 `SQLITE_BUSY`**。
  - 异常从**模块顶层 await** 浮出 worker，被 Next 聚合进 collect-page-data 阶段错误，报错行还指向无关路由。与 §5 手册里既有那两条「读库」事故同族但不同档：那两条是「表还没建 / 连库路径都没有」，这条是**库刚建出来、一张表都没有也会中** —— 只跑 `pnpm install` 的干净检出 100% 命中。

## Changed

- **PRAGMA 的应用收成一个出口**：`src/lib/sqlite-pragmas.ts::applySqlitePragmas()`，三处站点（Next 主库 `src/server/db.ts`、工坊库 `src/server/workshop/db.ts`、执行宿主 `src/lib/comfyui/host-runtime.ts`）都改走它 —— 此前三处各写一遍 `for (const pragma of SQLITE_PRAGMAS) await client.execute(pragma)`，循环体逐字相同（规范 §12.18），且**没有一处有容错**。
- 撞锁按 `SQLITE_PRAGMA_BOOT`（5 次、指数退避基数 25ms、封顶 200ms，定义进 `src/lib/retry-policy.ts` 与其他具名策略并列）**有界重试**；只认锁族错误（复用 `src/lib/sqlite-error.ts` 的 `isSqliteBusyError`），「切 WAL 切不掉」这类真故障（只读挂载 / 磁盘满）仍如实抛出，不吞。
- 等锁预算的形状**没动**：那几条库级 PRAGMA 的清单、以及「预算只走客户端 `timeout` 选项、只给宿主」的既有取舍一律照旧（`tests/sqlite-pragma-sites.test.ts` 原有的 6 条断言仍逐条钉着）。

## Tests

- `tests/sqlite-pragma-sites.test.ts` 新增「开机 PRAGMA 撞锁有界重试，当场量出来」一组，**两条缺一不可**：
  - 一条量修复本身 —— 7 个独立进程齐步后同时打一份新库，全绿；
  - 一条量**量具没坏** —— 同一形状下裸循环确实会抛，否则第一条在「未来某版 SQLite 不再抢锁」时也会绿，而那时它已经什么都不判了。
  - 量的是**真模块**（子进程用仓库自带的 `tsx` 加载 `src/lib/sqlite-pragmas.ts`，模块路径以绝对 `file:` URL 传入），不是复制一份逻辑；跨进程是这条判据的前提，同进程量不出这一档。齐步（等同一个「发令」文件）也是必须的 —— 少了它量到的是 `tsx` 启动抖动，实测会「一次都不抛」。
- 站点同源那条断言同步收紧：三处 TS 站点现在必须 import `applySqlitePragmas`，且**不许再自己遍历清单**（只判「有没有 import 清单」的话，把循环抄回去也照样绿）。
- 全量：`pnpm test` 493 文件 / 6207 用例绿；`tsc --noEmit`、eslint（零警告）、D 组 25 条静态判据全绿。

## Docs

- `docs/standards/launch-and-build.md` §5 排障手册补一行（症状 → 根因 → 已修），与既有那两条 build-期读库事故并列；`docs/generated/` 同步重渲染。
