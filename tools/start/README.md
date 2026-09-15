# tools/start/ — 启动与初始化入口（双击用）

Windows 双击入口，逻辑在 [`../../scripts/`](../../scripts/) 同名或对应文件里
（对照表见 [tools/README.md](../README.md)）。

## 入口清单

| 入口 | 什么时候用 | 逻辑 |
|---|---|---|
| `start-web.ps1` | 跑 Web 开发模式（控制台显示日志） | `scripts/dev-launcher.ps1` → `scripts/dev-launcher.mjs` |
| `start-tauri.ps1` | 直接启动打包好的 `start-tauri/start-tauri.exe`（秒出窗口） | 由 exe 内的 `scripts/start_tauri_launcher.py` 负责 |
| `start-tauri-dev.ps1` | 开发 Rust 壳本身（Rust 热重载，编译慢） | `scripts/dev-launcher.ps1 -Tauri` |
| `start-desktop.ps1` | 拿到「即开即用桌面包」的普通用户：自检 + 启动 | 自检逻辑内联在入口里 |
| `run-local.ps1` | 非开发人员一次性初始化（自检 node/pnpm、生成 `.env`、补依赖） | `scripts/prepare-local-run.ps1` |
| `verify-quality.ps1` | 一键质量门禁：typecheck / eslint（零警告）/ vitest | `scripts/quality-gate.ps1` |
| `run-tests.ps1` | **只**跑测试，可指定文件、可 `-Full` | `scripts/run-tests.ps1` |
| `sync-lint.ps1` | 日常：同步依赖 + `pnpm lint` | `scripts/sync-lint.ps1` |
| `register-comfyapp-protocol.ps1` | 一次性：注册 `comfyapp://` 协议（HKCU，免管理员） | `scripts/install-comfyapp-helper.ps1` |

## 非 Windows 平台（同一件事的跨平台入口）

`.ps1` **不是逻辑层**——启动编排的唯一实现是 `scripts/dev-launcher.mjs`，
`.ps1` 只负责「Windows 侧怎么被双击 / 被 exe 拉起」。Linux / macOS 上用同一批
`pnpm` 脚本，对照表见
[launch-and-build.md §9.5](../../docs/standards/launch-and-build.md)：

| 目的 | Windows 双击 | Linux / macOS |
|---|---|---|
| 启动开发环境 | `start-web.ps1` | `pnpm dev` |
| 质量门禁（三项） | `verify-quality.ps1` | `pnpm check:all` |
| 只跑测试 | `run-tests.ps1` | `pnpm test:file` / `pnpm test:full` |
| 生成原文文档 | `../docs/generate-docs.ps1` | `pnpm doc:gen` |
| 初始化 `.env` | `run-local.ps1` | `pnpm env:init` |
