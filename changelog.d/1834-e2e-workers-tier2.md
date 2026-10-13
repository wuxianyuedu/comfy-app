## Fixed

- **现场编译档的并发 4 → 2：4 档在 win32 真读数下不够（ISSUE #1834 剩下的两格之一）**。
  立案时 8 worker 是 43 failed（33 条卡 60s）；降到 4 后复测仍有 **3 条 `page.goto` 卡
  `Test timeout of 60000ms exceeded`**（`/settings` ×2、`/workspace` ×1，都是重路由），
  而**单 worker 独跑同一条 spec 时 `/settings` 冷编译只要 14.8s** —— 路由本身不慢，
  红的是 4 个 worker 并发时首帧编译仍被同伴撕超。降到 2 后复测，60s 超时形态
  **33 → 3 → 1**（剩下那条在 runtime-budget 的 `/workspace`，该 spec 本机单跑也是
  **真红**：性能预算 loadEventEnd 715.5ms > 640ms，与负载无关，另行立案）。
  处置口径不变：**降并发、不抬预算**（`timeout: 60_000` 一个字节没动，§13.5.3.2）。
  档位三处同批：`playwright.config.ts` / `scripts/e2e-run.mjs` /
  `tests/e2e-runtime-budget.test.ts` 的钉值。
- **win32 全量 e2e 的另一格真读数（顺带记账，不另开 PR）**：4 worker 一遍
  14 failed / 64 passed（7.1m），2 worker 一遍 11 failed / 67 passed（11.2m）——
  失败集高度重合的部分（`main-journey` 出图 ×2、`queue-monitor` ×4、
  `critical-flows` 页签 ×1、`theme-token-consumers` ×1 等）在本机是**与负载无关的
  稳定红**，且 dev server stderr 有服务端异常（`task` 表查询失败，经
  `queue-status.server.ts` 抛出）——归因见 ISSUE #1834 的评论，不在本 PR 修。
