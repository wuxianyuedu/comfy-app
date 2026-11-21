## Added

- **dev 壳启动前自动检测并取更新壳（#4722）**：`tools/start/start-tauri.ps1` 启动 `app.exe` 前先调用新的 `scripts/launcher-core/dev-shell-update.mjs` —— 沿用 `shellStaleWarning` 判定本地壳过期，再从 nightly 构建信息附件比 commit / built_at / run_id；远端更新（或本地还没有构建标记，即老用户首次建立基线）就复用 `fetch-daily-shell.mjs` 覆盖 `app.exe`，随后照常用新壳启动（更新发生在启动前，不需要杀正在跑的壳）。缺令牌 / 网络失败 / 构建信息读不到 / 壳被占用时只提示、照常启动，绝不阻塞。`fetch-daily-shell.mjs` 成功取壳后把构建信息落在壳旁边作下次比较基线。`tests/dev-shell-update.test.ts` 钉住比较规则、基线建立与三条「照常启动」安全边界（13 条）。选择启动器侧检查而非应用内 updater：后者端点 / 公钥为空，要工作还需 CI 产出签名清单，且更新的是运行中的 exe、不是 dev `app.exe`。
