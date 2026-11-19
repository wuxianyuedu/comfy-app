## Fixed

**镜像格 LFS 核对 `fetch` 的网络重试（ISSUE #3400）**：`verifyLfsObjects` 的 batch API 那一跳
不再单次即弃，按与 `verifyPushedRef` 同口径的墙钟预算重试瞬时失败（网络层异常 / 远端 5xx）。

- 症状：PR #3395 的「GitHub 镜像同步」连续 4 跑 error，`--rerun-ci` 救不回。最近一跑
  `cnb-5r6-1k6talc59` 里 wire 推送与 LFS 推送**都通了**（`回读一致` / `LFS 推送：通`），
  最后一步核对却挂在一次 `TypeError: fetch failed` 上：`结论：exit 2 —— LFS 核对请求没跑起来（网络层）`、
  `重试=1 次｜耗时=5.6s`，把整格判挂、后面「判决回读 / 判决判定」整片 skipped。
- 根因：`runMirror` 对 refs 推送 / refs 回读 / LFS 推送三跳都注入了 `runGitWithRetry`（#3346 称
  「三跳各只试一次」），但**第四跳** `verifyLfsObjects` 里的裸 `fetch` 没有重试、也不区分瞬时网络错
  与认证/权限错。自托管节点到 `github.com:443` 是间歇抖动（#3397 已记同类现场），单次请求撞上就退 2。
- 改法：`ci-mirror-push-verify.mjs` 把 batch 请求收成 `requestLfsBatch`，`verifyLfsObjects` 按
  `VERIFY_MAX_ATTEMPTS` / `VERIFY_RETRY_BUDGET_MS` / 退避表驱动重试；只重试网络层异常与 5xx，
  4xx、回话格式不符、对象确实缺失仍是读到的事实、一次交账。返回值补 `attempts`（向后兼容），
  小结的 `重试=` 计入两跳合计。PR 档按 `once ? 1 : VERIFY_MAX_ATTEMPTS` 注入、master 档用默认上限；
  不给 `maxAttempts` 的直接调用缺省单次，逐字保持原行为。
- 校验：`ci-github-mirror-push.test.ts` 补 9 条定向用例（135 条全绿），含「网络抖动第一次挂、
  第二次通 ⇒ 0」「耗尽仍 2」「5xx 重试 / 4xx 不重试」「回话事实不消耗重试」「`--once` 恰好一发」
  与两处调用点的逐实例接线断言。
