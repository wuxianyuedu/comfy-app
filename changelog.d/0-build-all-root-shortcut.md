## Fixed

- **一键发布构建重新在仓库根生成 `Comfy APP.lnk` 双击入口**：`tools/scripts/build-all.ps1` 在 ISSUE #2503 重写为直接跑 `pnpm tauri build` + 发布常驻目录时，不再调用 `tools/start/Create-AppShortcut.ps1`，根目录那份双击入口从此在「一键发布构建」这条路径上静默消失（`build-tauri-release.ps1` 单步构建仍会生成，所以只在发布构建里表现为回归）。现在构建成功后补回这一步，并在收尾汇总里单独列出「启动入口」；生成失败不阻断后续发布。仓库根从未拷贝过 exe 副本——历史上那段根级 `start-tauri.exe` 是已随 ISSUE #784 删除的 PyInstaller 启动器，现入口是快捷方式指向 `src-tauri\target\release\app.exe`。
