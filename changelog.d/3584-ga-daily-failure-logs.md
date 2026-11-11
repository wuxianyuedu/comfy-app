## Added

- **GA 每日档失败立案正文直接贴红色失败日志（ISSUE #3584）**：新增 `scripts/ci-ga-failure-logs.mjs`，复用 `collectFailedJobLogs` / `extractFailureWindow` / `capStageWindow` / `redactSecrets` / `PULL_BODY_LIMIT`（§12.18），把全部 `##[error]` 注解 + 失败 step 窗口脱敏后按字节预算贴进单子；完整日志装得下就整份贴、装不下给窗口 + 逐 job 下载端点 + `gh run view … --log-failed`，取不到日志如实写「取不到 + 出口」，绝不写成「日志里没有失败行」。`ci-ga-daily-failure-issue.mjs` 的 `composeBody()` 接上这一节；日志那一跳失败不阻断立案（与 `ci-ga-logs-relay` 同边界）。回归在 `tests/ci-ga-failure-logs.test.ts`（三态 / 脱敏 / 预算 / 降级 / 接线）。
