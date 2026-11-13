## Fixed

- 按需 GA 日志档（`workflow_dispatch` 形态）在 GA 侧拿不到 PR 号，relay 0s 静默
  退出、结论回调恒 failure（#3710，#3667 链路的断点）：
  - `pr-gate.yml` 的**结论回调**补上 `inputs.pr_number` 兜底（此前只读
    `client_payload.pr_number`，按需档恒空 ⇒ 回调 0s failure）；
  - `ci-ga-logs-relay.mjs` 的 `GA_LOG_RUN_ID` 回落改用 `||`：YAML 侧给缺席 input
    写的是**空串**，`??` 不拦空串，把本 run 的 `GITHUB_RUN_ID` 遮成「runId 缺席」
    —— relay 就在前提校验上 0s 退出；
  - relay step 摘掉 step 级 `continue-on-error`：前提不成立的失败不再被盖成绿色 ✓
    （run 的结论仍由 job 级 continue-on-error 保护，不随日志搬运成败变化）。
