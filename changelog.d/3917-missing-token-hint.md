## Fixed

- **缺令牌时日志把「下一步那条命令」念出来（ISSUE #3917）**：`pnpm fetch:daily-shell --config --token
  <你的CNB_RELEASE_TOKEN>` 此前只写在 `--help` 与 401 出口里，且 401 出口念的是
  `node scripts/devtools/fetch-daily-shell.mjs --config --token <token>` 这一形态——人读到的是「建令牌文件：
  <长命令>（目标 <路径>）」，得自己再翻译一遍成 `pnpm` 入口。现在三条出口统一念同一个常量
  （`MISSING_TOKEN_HINT`）：无令牌的前置读数、`--dry-run`、401/403 失败。
  - `--dry-run` 缺令牌从「静默退 0」改成**退 2 并在 stderr 说明**：预演那一刻正是补齐令牌的最后
    时机，只念计划不念缺件，人容易以为一切就绪、真跑起来才吃 401。退码与正文一致，不许说完就算过。
  - `tools/start/fetch-daily-shell.ps1` 失败提示同步改成同一条命令（原来只说「可设置环境变量或将
    token 写入 %APPDATA%\…」）。
  - 判据补 3 条：缺令牌时日志逐字含那条命令且退 2、有令牌时 dry-run 照常退 0 且不出现该提示、
    401 且无令牌时失败出口同样给出它。
