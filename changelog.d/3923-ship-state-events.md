## Added

- ship：每轮的「走到哪了 / 结论」升级为**状态快照 + 事件时间线**双通道（#3923）——`.git/ship-result.json` 在 write-ahead 快照里新增带时间戳的 `events`（`start` / `stage` 含结构化 `facts` / `conclusion` / `finished` / `interrupted`），落盘改为**原子替换**（临时文件 + rename），后台跑时另一只轮询的眼睛读不到半截 JSON；新增只读查询口 `pnpm ship --result`（`--result=json` 出原始 JSON），`pnpm ship --status` 的「本地上一次跑」补「走到哪」一行。轮询 ship 进度不再需要 `sleep + grep` 运行日志。只读单件动作（`--result` / `--status` / `--whoami` / `--branches` / `--claims` / `--diagnose` / `--stage-log` / `--gh-logs` / `--gh-prs`）自己不再落盘 —— 查询不会覆盖后台那一跑的活读数。
