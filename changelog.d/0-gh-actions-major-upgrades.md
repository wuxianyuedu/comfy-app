## Changed

**`.github/workflows/` 的 action 主版本升级**（2026-11-02 按 `git ls-remote --tags` 逐仓
核过真实 tag，不是凭记忆）：`actions/checkout` v5→v7、`actions/setup-node` v5→v7、
`actions/upload-artifact` v4→v7、`pnpm/action-setup` v5→v6（它没有 v7，v6 即最新主版本）；
`swatinem/rust-cache` 停在 v2（它只有一个主版本，且已是 node24 运行时）。
逐条的破坏性核对：checkout v7 拒检 `pull_request_target`/`workflow_run` 的 fork PR
（本仓只用 `repository_dispatch`/`workflow_dispatch`/`schedule`，不沾）；setup-node v6
的「自动缓存只对 npm 默认开」不影响显式的 `cache: pnpm`；upload-artifact v7 新增的
`archive` 输入缺省 true，本仓 `name`/`path`/`retention-days` 用法不变。
三个 workflow 的版本注释口径同步更新；daily/package-desktop 头注里「master 镜像
推送目前不存在」的过时前提一并订正（#3064 已合）。
