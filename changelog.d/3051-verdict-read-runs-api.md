## Changed

- `ci-github-verdict-read.mjs` 判决回读主路径改走 runs API（`GET /repos/{owner}/{repo}/actions/runs?head_sha=<sha>`，需 `actions: read`），按 workflow run 的 `conclusion` 判定（success/neutral/skipped 绿；failure/timed_out/cancelled/action_required/startup_failure 红；未 completed 继续等），「check-run 挂在分支 HEAD」的错位坑由 head_sha 过滤规避。Checks API 留作兜底：主路径 401/403（缺 `actions: read`）或零匹配 run 时同轮回落，日志点名走哪条路径与回落原因；权限提示同时点名 `actions: read`（优先）与 `checks: read`（兜底）。30s 超时、仅网络类重试（5s/10s、至多 3 次）、401/403 不重试、45m 轮询预算与 `--readout` 语义不变。
