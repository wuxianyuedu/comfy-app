## Fixed

- `base-check` 新增 `--merge-state`（ISSUE #3043）：平台 PR 建的是**合并态**（分支 ⊕ 目标分支），「本地绿 + 平台红」那一形下 `current-green` 的「无需复算」不构成证据。该输入在场时把合并态真建出来量（临时 worktree + `git merge --no-commit --no-ff`，与平台合并预览同内容），结论多一档 `merge-red`（红来自组合：不是基线的红、也不是本检出的红，修在自己的分支上）；冲突 / 判据没跑起来 ⇒ `inconclusive` 并点名。不给输入时行为逐字不变；只接单命令档。
