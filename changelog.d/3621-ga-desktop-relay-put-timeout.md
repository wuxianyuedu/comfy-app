## Fixed

- **GA 桌包回传 CNB 的二进制 PUT 60s 超时且无重试（ISSUE #3621）**：收尾步真跑必红在第一份资产 `ComfyAPP-portable.zip` 的 `PUT`：`TimeoutError: The operation was aborted due to timeout`，整格 1m1s `exit 1`，CNB 站内 `nightly` Release 一份成品都拿不到，页面只剩「附件 (2)」两个一样的空占位（本轮只读复核：`get-release-by-tag` 回 `assets: []`、候选下载名全 404）。
  - 根因两处：`putAsset()` 用 `AbortSignal.timeout(60_000)` 发几十 MB 跨网二进制（与 `cnbRequest` 的 JSON 请求同源），且失败**没有任何重试**，一次抖动就整格交账；`asset-upload-url` 已登记、PUT 挂掉、未走到 `asset-upload-confirmation`，于是留下未确认的空资产，滚动 tag 每挂一次叠一个。
  - 单次墙钟放宽到分钟级 `PUT_TIMEOUT_MS`（300000ms），失败按既有 `isRetryableFetchFailure` 判据重试（首跳 + 2 次，退避取公共表前两项），`sleep` / `maxAttempts` 可注入、用例不真等；**HTTP 应答（401/403/5xx）一次交账不重试**，与 `ci-github-verdict-request.mjs` 同一纪律。整轮只读一次盘，重试送同一份 Buffer，Content-Length 与正文不分家。
  - 共享判据 `ci-mirror-failure-report.mjs` 的 `isEgressFailure` 补 `TimeoutError: The operation was aborted due to timeout` 这一形（Node `fetch` 的 `AbortSignal.timeout` 客户端掐断，旧正则一条都不命中，超时被念成「其他」、一次就交账）；认证 / 权限类仍是 HTTP 应答，不受影响。
  - 判据：`tests/ci-github-mirror-push.test.ts` 补超时形状正反；`tests/ci-ga-desktop-relay.test.ts` 补「墙钟分钟级 / 超时重试到绿且不真等 / HTTP 500 不重试 / 用尽尝试仍红 / 纯壳端到端 4 份」共 7 条；`tests/no-platform-ci-config.test.ts` 补 `DESKTOP_SHELL_EXE` 接线断言。规范 §7.7、`.cnb.yml` 桌包段、`package-desktop.yml` 头注/收尾注释同批订正。
  - ⚠️ 边界：已残留的两个空槽由人在 Release 页面手动删一次（本地流水线 token 无 `repo-release:rw`，不为删槽另开写权限通道，也不核实 `overwrite:true` 是否盖掉同名空槽）；「回传失败不碰构建结论」的 `continue-on-error` 口径一字未改。
