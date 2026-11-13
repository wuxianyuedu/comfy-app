## Fixed

- **每日纯壳获取工具落点修正为规范位置**（ISSUE #3715，`scripts/fetch-daily-shell.mjs`、`tools/start/fetch-daily-shell.ps1`）：`pnpm fetch:daily-shell` 默认将 CNB nightly `ComfyAPP-shell.exe` 保存到 `src-tauri/target/release/app.exe`（与 `start-tauri.ps1` / 构建产物的规范壳位置一致），不再落到 `src-tauri/release/app.exe`，避免用户拿到“最新纯壳”后仍从旧位置启动而表现为未更新。同步修正文档与工具说明中的默认路径。
