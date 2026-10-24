## Fixed

- 新增 `pnpm ship --rerun-ci`：CI 挂了想重跑时，在当前 PR 分支推一个空提交触发平台重新构建（平台 CI 是 push 触发的，没有「重跑按钮」，此前每个人都得去 cnbcli 翻一遍）。与 `--diagnose` 互斥、支持 `--dry-run` 预览，在 `master` / `HEAD` 上拒绝并提示。详见 #2292。
