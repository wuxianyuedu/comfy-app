## Added
- `pnpm status:checkout [--fetch]`（#5168）：开工 / 收尾反复手敲 `git status --short`、`git stash list`、`git rev-parse`、`git worktree list`，而「上次 ship 走到哪」只落在本机快照里没人念。现在一张屏给出 HEAD / 分支 / 上游 ahead-behind（缺省零网络、不声称已最新，`--fetch` 只刷新引用不改树）、porcelain 三档、stash、worktree、上次 ship 结论与本检出实例；解析复用 `parsePorcelain` / `readShipResult` / `runningAppInstances`，不另写第二套。补三档解析与 worktree 清单用例。
