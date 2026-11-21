## Fixed

- **`pnpm ship` 的 `git push` 不再被自家 180s 墙钟预算砍成 `exit -1`**（ISSUE #4753）。
  push 会触发 pre-push 钩子里的合并前复算（分钟级：本机实测 84s ~ 5m35s，光 type-aware
  oxlint 一档就 97~134s），而 ship 的执行器此前给**所有**外部命令统一 180s 预算 ——
  复算一超过它，`spawnSync` 就把 `git push` 连同钩子整棵终止，`status: null` 被读成
  「push 失败（exit -1）」。症状是「后台跑 ship 稳定死在 eslint 档、前台裸 `git push`
  正常」—— 前后台的差异其实是「有没有那条 180s 预算」，与宿主的进程管理无关
  （后台裸跑同一档 lint 实测 97s 完整跑完）。
  - **修法**：push 那一跳的预算**随复算预算走** —— `COMFY_PREMERGE_TIMEOUT_MS`
    （钩子同一条解析器，默认 600s）+ 180s 的 LFS / 网络余量；钩子那侧抬了预算，
    ship 这侧自动跟着抬，不新增第二份口径。
  - **尸检读数**：push 失败且 `error=ETIMEDOUT` 时，念「测量没发生，不是复算红 +
    抬预算出口」那一行，不再落进「看原话定因」的 unknown（预算砍的输出几乎全空，
    原话分型猜不出它）。
