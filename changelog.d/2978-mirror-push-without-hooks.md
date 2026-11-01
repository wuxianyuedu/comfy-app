## Fixed

- 镜像格那次推送不再经过本仓的 `pre-push`（#2978 / #3025 的第二现场）：平台侧检出的每一步
  都在同一棵工作区里，`.githooks/pre-push` 会跟着每一次 `git push` 跑，而它判的是「这条分支
  要不要合进本仓 `master`」—— 对镜像仓库这一推没有对象。#3025 给钩子补的「按目的地放行」
  需要 `git remote get-url` 读得到本仓 remote，平台检出连 remote 都没有 ⇒ 照旧复算 ⇒ 又被
  拦死。现在推送带 `-c core.hooksPath=`，并把 `GIT_DIR` / `GIT_WORK_TREE` 从子进程环境里
  清掉（只认 `cwd`）。本仓 `master` 上的 `pre-push` 语义一字未改。
