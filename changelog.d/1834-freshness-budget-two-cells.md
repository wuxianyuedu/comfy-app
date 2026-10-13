## Fixed

- **全量单测 + 覆盖率档：撞墙钟预算被砍，不该被读成「这批用例红了」**。本档经
  `runPnpmSync` 起子进程，而它的 `timeoutMs` **缺省 600_000** —— 那个数是「单条
  `pnpm exec …` 门禁」的合理默认，不是本档的：win32 检出上无争抢实测就要 ~10 分钟
  （`Test Files 3 failed | 695 passed`），只要有任何并发（叠一次运行 / 机器被别人占着）
  子进程就在 600s 处被砍，`res.status` 为 **null**，而调用方写着 `res.status ?? 1`
  —— 于是「**测量没发生**」与「**测量结果是红的**」在退出码上逐字同形，下一个人据此
  去查用例、查到的是空气（同 §13.6.2「拿不到测量 ≠ 测量结果是红的」）。
  修法是两半：**预算显式给**（`FULL_SUITE_TIMEOUT_MS` / `ARTIFACT_TIMEOUT_MS`，30 分钟
  —— 挡真挂死，不是挡机器慢），**两种收场分开报**（`launcher-core/shell.mjs` 的
  `classifyOutcome()` / `abortedAdvice()` 一处实现；被砍时**不记账**、话术明写「要修的不是
  用例」，且不引导人去隔离重跑单份文件）。退出码仍非零 —— 拿不到测量不等于可以放过。
- **本地全量 e2e：43 failed / 35 passed 里有 33 条卡在 60s 自测向预算上，真因是首帧现场编译**。
  `pnpm test:e2e` 本地默认跑 `pnpm dev`（Turbopack，按需编译），8 worker 并发下某条路由
  第一次被导航到时才编译 —— 失败散在互不相干的屏上（`appearance-steps` /
  `critical-flows` / `nav-auto-collapse`），**同形态跨屏**说明红的是服务响应。
  处置**不是**抬 Playwright 的 `timeout`（那会把真挂死的检出时间一起放大，§11.13），
  而是**降负载**：`playwright.config.ts` 的 `resolveE2eWorkers()` 在现场编译档收敛到 4 个
  worker，`PNPM_START=1` / CI（已构建、首屏零编译）不覆盖默认。`e2e-run.mjs` 起 Playwright
  前把这一档打出来，账面的 `how` 也分两档（`PNPM_START=1 pnpm test:e2e`）—— 「这次是怎么
  证的」必须写清，否则下一个人按名义命令复跑、遇到的是另一种负载却看不出差别。
  本地默认**刻意不减配**（`pnpm start` 要求先 `pnpm build`，那会把「按需跑一次」变成
  「先花十分钟构建」）：要那一档就显式给 `PNPM_START=1`。

## Added

- `tests/daily-tracks.test.ts`：墙钟预算那一组（`classifyOutcome` 三态、两个预算常量真被
  传给子进程、两档的红话术**不一样**）。
- `tests/e2e-runtime-budget.test.ts`：并发档那一组（两向钉住 `resolveE2eWorkers`、
  跑法脚本的读数与配置不分叉、以及一条红线 —— `timeout` 一个字节都不许动）。

## 订正

- **ISSUE #1834 的第 ③ 项（`src/lib/markdown/**` 覆盖率不足）已于 `bba52ce2` 关闭**，
  未降门槛、补的是真用例（`render.test.ts` +39 行）；本 PR 与那一格无关。
- 本 PR **不动** `full` 档的新鲜度账（`scripts/.full-suite-freshness.json` 的
  `skippedReason` 里那句归因写着「预算 600_000 被砍」—— 那条归因说的是修复前的形态，
  现在预算与分流都已改；账面上它仍是一条**今天的豁免**，按 `skippedReason` 只替当天作证）。
