# tools/scripts/ — tools/ 入口对应的逻辑脚本

本目录放 `tools/<分类>/*.ps1` **双击入口**背后的逻辑实现，两层的分工是硬规则
（规范 [launch-and-build.md §8.2](../../docs/standards/launch-and-build.md)）：

- **入口只做三件事**：定位项目根 → 调用逻辑脚本 → 收尾（透传退出码、双击场景暂停）；
- **逻辑做实事**：环境检查 / 打包 / 编排 / 日志落盘。

## 入口 / 逻辑对照

入口与逻辑**同名不同目录**，改动时别改错文件：

| 入口（`tools/<分类>/`） | 逻辑（本目录） |
|---|---|
| `build/build-all.ps1` | `build-all.ps1` |
| `build/build-launcher.ps1` | `build-launcher.ps1` |
| `build/build-launcher-dev.ps1` | `build-launcher-dev.ps1` |
| `build/build-launcher-standalone.ps1` | `build-launcher-standalone.ps1` |
| `build/build-standalone.ps1` | `build-standalone.ps1` |
| `build/build-tauri-release.ps1` | `build-tauri-release.ps1` |
| `build/rebuild-static.ps1` | `rebuild-static.ps1` |
| `registry/start-registry.ps1` | `start-registry.ps1` |

## 公共库

| 文件 | 职责 |
|---|---|
| `Log-Common.ps1` | 统一日志与耗时：`Log` / `Invoke-Logged` / `Open-Log`，以及 `Start-LogStopwatch` / `Format-Elapsed` / `Log-Elapsed`（构建耗时报告，规范 §7.0）。**新增构建脚本复用这三个耗时函数，不要各写一套 `Stopwatch`** —— 格式漂成几种就没法横向对比。 |
| `Build-Guard.ps1` | 编译前置守卫 `Assert-ShellNotRunning`：`target/{release,debug}/app.exe` 被占用时会在链接收尾报 `os error 5`，且要等整轮编译走完才失败。陈旧壳与非交互构建自动 `taskkill /T /F` 回收后继续；只有「启动器仍在跑 / 用户可能正开着应用」才中止（规范 §7.1）。 |
| `Build-Guard.ps1`（同文件另一半） | 打包前置守卫 `Assert-LauncherNotRunning`：`build-launcher*.ps1` 的产物是**整个目录**（`start-tauri\` 等），运行中的启动器把 `_internal\*.dll` 锁住就删不掉，而「关掉桌面窗口」并不会让启动器自己退出。命中即中止并点名 PID + 给 `taskkill /PID <pid> /T /F`（**不自动回收**：启动器没有「无主孤儿」这条判据，见规范 §7.1.1）。 |

`scripts/entry-common.ps1`（仓库根的 `scripts/`，不在本目录）提供入口通用能力：
`Get-ProjectRoot` / `Get-Pwsh` / `Invoke-Entry` / `Complete-Entry` / `Test-IsDoubleClicked`。
