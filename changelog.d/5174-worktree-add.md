## Added
- `pnpm worktree:add <路径> [--branch <名>|--detach <ref>]`（#5174）：与已有的 `worktree:remove` 成对。硬规则 30 的两条禁戒（不许落在 `.git/` 下、不许让新树的 `node_modules` 指向主检出）此前全靠人记，而「建」正是最容易埋雷的时刻。现在把落点判据做成可注入纯函数（仓库 `.worktrees/` 或系统临时目录才放行），目标已存在且带依赖链接时拒绝建树，建完打印「每树自装依赖」提示；`--branch` 与 `--detach` 互斥。补落点合法 / `.git` 拒绝 / 大小写分隔符归一用例。
