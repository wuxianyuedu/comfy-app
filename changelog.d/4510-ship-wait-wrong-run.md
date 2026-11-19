## Fixed

- `pnpm ship:wait` 在已有 ship 在跑时启动，会拿「最近一次已有结论的旧跑」当终态返回（如流程长跑期间一笔 `--comment` 快动作收口覆盖了单文件快照），等错对象；现在见到 `status=running` 的落盘读数就认准那一跑（输出念出 `startedAt` / 阶段），期间别的跑的结论不冒充终态；没有在跑的才回落「最近结论」。（#4510）
- 同根源同批修：ship 的单件动作（`--comment` / `--claim` / `--release` / `--new-issue` / `--rerun-ci` 等写侧快动作与既有只读口）不再写 `.git/ship-result.json`——这份文件只当「流程那一跑」的账，快动作的结论不再覆盖在跑流程的活读数。（#4510）
