## Added

- **P3 §5 第 2 期 · Phase 4-A4：`COMFY_EXECUTOR` 判据收成「同层一份 + 跨层一致性门禁」（ADR §14 D5）**。新增 `scripts/launcher-core/executor-mode.mjs`：`normalizeExecutorMode` / `readExecutorEnvRaw` / `resolveExecutorMode`，进程 env 优先、其次回读仓库根 `.env`（复用既有 `parseEnvFile`，不另写一份解析）、未知值不猜意图（按 inline 起，但把原值回给调用方去提示）。launcher 与 `executor-host.mjs` 是同一层的两个纯 Node 宿主，共用这一份；Next 侧那份留在 TS（跨层合成一份要么给 launcher 引入 tsx、要么让 `src/lib` import `scripts/`，两条都撞既有约束）。两份之间由 **`tests/executor-mode-consistency.test.ts`** 逐值比对：一份共享向量 `tests/fixtures/executor-mode-vectors.json`（17 条，覆盖大小写 / 首尾空白 / 制表 / 换行 / 空值 / 未知值 / 中文值）两侧真跑，另断言两个纯 Node 宿主源码里不再长出第二份归一化、`.env` 回读只此一处。形态沿用 `tests/app-port-cross-language.test.ts`。新脚本登记进产物白名单两处（`RUNTIME_SCRIPTS` 与 `ALLOWED_SCRIPTS`）——缺它的桌面包里 host 会静默跑成骨架。

## Fixed

- **host 侧漏 `trim()` 与 `.env` 回读造成的静默错配**：`COMFY_EXECUTOR=" host "` 时 Next 把行写成 `claimedBy='host'`、host 却按骨架起；只在 `.env` 里写开关再手工起 host 也是同样结果。两种表现都是「任务永远停在队列里等回收器判失败」，而界面和日志给不出原因（launcher 显式回写归一值时恰好掩盖了第一种，手工起 host 才暴露）。现在两侧同源，且优先级钉死为「进程 env 给了值（哪怕空串）就不再看 `.env`」，与 @next/env 的覆盖规则同形。
- **host 契约测的骨架组由本地 `.env` 决定结论**：那组用例原先用「不设 `COMFY_EXECUTOR`」表达骨架，而开发机 `.env` 写着 `host` 时它其实测的是运行时形态（本机实测正是如此）。改为显式 `COMFY_EXECUTOR=inline`，并在文件头写明为什么必须显式。
