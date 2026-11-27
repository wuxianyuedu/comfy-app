## Added
- `pnpm ship:cleanup [--dry-run] [--yes]`（#5183）：合并后分支 / worktree 收尾的三态计划，落地判定只认 PR 的 `is_merged`；默认一条不删，`--yes` 才逐条复用既有 `branch-clean` / `worktree-remove`，取不到判定一律退 2。
