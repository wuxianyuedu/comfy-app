# tools/build/ — 构建打包入口（双击用）

Windows 双击入口，逻辑在 [`../scripts/`](../scripts/) 同名文件里（对照表见
[tools/README.md](../README.md) 与 [tools/scripts/README.md](../scripts/README.md)）。

## 三个启动器 exe 分别怎么打

| 产物 | 入口 | 说明 |
|---|---|---|
| `start-tauri/start-tauri.exe` | `build-launcher.ps1` | prebuilt（默认入口，秒出窗口 + dev server） |
| `start-tauri-dev/start-tauri-dev.exe` | `build-launcher-dev.ps1` | 双击即走 `tauri dev`（Rust 热重载） |
| `start-tauri-standalone/start-tauri-standalone.exe` | `build-launcher-standalone.ps1` | 双击即走独立模式（不连 dev server） |

三个 exe 由**同一份** `scripts/start_tauri_launcher.py` 打包而来（PyInstaller 在
打包脚本里用 `LAUNCHER_NAME` 指定文件名）。因此**改完启动器后三个入口都要重新打包**
才全部生效。

## 壳（Rust）怎么编

| 入口 | 产物 | 什么时候用 |
|---|---|---|
| `build-tauri-release.ps1` | `src-tauri/target/release/app.exe` | 改完 Rust / 窗口配置 / 启动页后（**必须带 `--features custom-protocol`**，否则启动页会被导航到 devUrl 且资源不内嵌） |
| `build-standalone.ps1` | 完整生产构建（`pnpm tauri build --no-bundle`） | 要「双击即独立运行、不连 dev server」的分发场景 |
| `rebuild-static.ps1` | 重建 `src-tauri/static` | `static` 被污染导致黑屏时，先跑它再重编壳 |

## 一键发布

`build-all.ps1` = `build-tauri-release.ps1` + `build-launcher.ps1`，结束时报告
整轮与各步耗时（规范 §7.0）。两个子步骤职责独立、前置工具链不同（Rust vs Python），
**不合并为单文件**。

## 非 Windows 平台

上面这些都是 Windows 双击入口，`.ps1` 不是逻辑层，Linux / macOS 上按规范
[launch-and-build.md §9](../../docs/standards/launch-and-build.md) 直接在终端跑
等价的 `pnpm` 命令（`pnpm tauri build --no-bundle` 等）。
