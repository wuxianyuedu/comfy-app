## Added

**ship 本地 CLI 直接回读 GA 失败日志**：新增 `pnpm ship --gh-logs <run-id|pr号>`（`run:` /
`pr:` 可消歧，也认 Actions URL），不必等判红就能单取；ship 轮询读到 build 红时自动按 PR 号
回读一次。台面直接念出 run id / URL、失败 job 与 step、该 step 的全部 `##[error]` 注解、
失败窗口（head 20 + tail 120，带标记并写明省略行数）与一行归因（环境侧 / 内容判据 / 混合 /
未判定）。全量日志落系统临时目录并打印可直接打开的绝对路径与清理提示，不进仓库。

取数复用 `ci-github-verdict-logs.mjs`（重试 / 超时 / 脱敏不写第二份）；脱敏补上日志里的
`KEY=value` 与 `{"key":"value"}` env/secret 形状。令牌只从 `GITHUB_MIRROR_TOKEN`（优先）/
`GITHUB_TOKEN` 取，没有令牌只念一行跳过，不发网络、不改三态、不改退码；401/403、404、
网络不通同样只多一行缺因。回归在 `tests/ship-gh-logs.test.ts`（判红 / 无令牌 / 超长 /
取数失败四档 + 脱敏与参数形态）。
