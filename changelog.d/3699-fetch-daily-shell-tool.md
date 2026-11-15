## Added

- **本地工具：从 CNB 站内每日成品快速获取纯壳并补齐快捷方式**（ISSUE #3699，`scripts/fetch-daily-shell.mjs`、`tools/start/fetch-daily-shell.ps1`、`pnpm fetch:daily-shell`）。

  新增 `tools/start/fetch-daily-shell.ps1`（跨平台等价 `pnpm fetch:daily-shell`）：从 CNB 滚动 `nightly` Release 下载每日成品 `ComfyAPP-shell.exe`，保存为 `src-tauri/release/app.exe`（正确位置与名称，自动创建父目录）；若项目根缺少 `Comfy APP.lnk`，在 Windows 上自动补齐指向该壳的快捷方式。下载支持可选鉴权（`--token` 或 `CNB_RELEASE_TOKEN` / `CNB_TOKEN` / `CNB_ISSUE_TOKEN`）。
