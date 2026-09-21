# tools/build/ — 构建打包入口（双击用）

Windows 双击入口，逻辑在 [`../scripts/`](../scripts/) 同名文件里（对照表见
[tools/README.md](../README.md) 与 [tools/scripts/README.md](../scripts/README.md)）。

## 只有一个 exe：壳 `app.exe`

**不再打包「启动器 exe」**：Python 启动器（`start-tauri*.exe`）与它的打包链
（`build-launcher*.ps1` / `tools/start-tauri.spec`）已随 ISSUE #784 整体删除。
双击 `src-tauri/target/release/app.exe` 就是完整的启动形态 —— 编排（起 dev server /
端口 / 缓存 / 回收）由壳自己承担（见 `src-tauri/src/shell_launch.rs` 与规范 §1.5）。

## 壳（Rust）怎么编

| 入口 | 产物 | 什么时候用 |
|---|---|---|
| `build-tauri-release.ps1` | `src-tauri/target/release/app.exe`（**唯一入口**） | 改完 Rust / 窗口配置 / 启动页后（**必须带 `--features custom-protocol`**，否则启动页会被导航到 devUrl 且资源不内嵌） |
| `build-standalone.ps1` | 完整生产构建（`pnpm tauri build --no-bundle`） | 要「双击即独立运行、不连 dev server」的分发场景 |
| `rebuild-static.ps1` | 重建 `src-tauri/static` | `static` 被污染导致黑屏时，先跑它再重编壳 |

## 一键发布

`build-all.ps1` = `build-tauri-release.ps1`（单步），结束时报告整轮耗时（规范 §7.0）。
原先还有「打包启动器 exe」那一步，已随 ISSUE #784 删除；产物就是壳本身。

## 非 Windows 平台

上面这些都是 Windows 双击入口，`.ps1` 不是逻辑层，Linux / macOS 上按规范
[launch-and-build.md §9](../../docs/standards/launch-and-build.md) 直接在终端跑
等价的 `pnpm` 命令（`pnpm tauri build --no-bundle` 等）。
