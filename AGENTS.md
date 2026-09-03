# AGENTS.md — AI 协作强制规范

> 本文件会被编码代理（ZCode 等）在会话开始时自动加载。
> **这是硬性前置条件，不是建议**：在修改下列范围之前，必须先完整阅读
> [docs/standards/launch-and-build.md](docs/standards/launch-and-build.md)，
> 并在实施说明中注明遵循了其中哪些条目。

## 强制先读规范文档的改动范围

| 范围 | 路径 | 规范章节 |
|---|---|---|
| 启动链路 | `start-tauri/`、`scripts/start_tauri_launcher.py`、`scripts/dev-launcher.ps1` | §1–§3 |
| Tauri 壳 | `src-tauri/**`（conf.json / src / splash-assets） | §2、§7 |
| ComfyUI 生命周期 | `src/lib/comfyui/**`（lifecycle / executor-* / reaper） | §3、§5 |
| 工坊管线 | `src/components/workshop/**`、`src/lib/workshop/**` | §5 |
| 构建与打包 | `scripts/build-desktop.mjs`、`tools/**` | §7 |

## 硬规则（违反 = 提交被拒或必须回滚）

1. **包管理只用 pnpm**（`pnpm exec …`）。禁止 npx / npm run——npm 11.19 在本机
   解析 typescript 别名链会崩溃（`Class extends value undefined`）。
2. **工具链钉死项不可随意改**（改动前必须读规范 §6 并在提交说明里给出理由）：
   - `pnpm-workspace.yaml`：`minimumReleaseAge: 0`、`allowBuilds`（5 个包）、
     `verifyDepsBeforeRun: false`
   - `next.config.js`：`experimental.useTypeScriptCli: false`
3. **进程清理必须杀整棵树**：`taskkill /PID <pid> /T /F`。禁止 `Process.Kill()`
   单杀（cmd 外壳死了，node/pnpm 子进程会残留并锁住端口与日志文件）。
4. **失败路径必须有日志 + 用户可见出口**；日志按规范 §4 的布局落 `log/`，
   不得引入新的固定名日志文件（残留进程句柄会锁死它，用按次命名 + 轮转）。
5. **改了 `tauri.conf.json` / `src-tauri/src/**` / `splash-assets/**` 必须
   `cd src-tauri && cargo build --release --features custom-protocol` 重编壳**
   （**feature 不能省**：不带它 tauri 的 `cfg(dev)` 开启，启动页会被导航到
   `build.devUrl` 且资源不内嵌——冷启动必现 Edge「无法访问此页面」错误页，
   详见规范 §5）——窗口配置与启动页是编译期内嵌的，只改源码不重编 =
   跑旧二进制（历史黑屏事故来源）。
6. **提交必须通过 `.githooks/pre-commit`**（结构检查 + tsc + eslint，全部走
   `pnpm exec`）。钩子失败先修代码，禁止 `--no-verify` 绕过进历史。
7. **新增含 postinstall 构建脚本的依赖**：同步更新 `pnpm-workspace.yaml`
   的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1。
8. **dev server 运行期间不要执行 `pnpm install`**（better-sqlite3 等原生模块（`.node`）被进程
   锁定会 EPERM 连锁失败）。

## 快速排障

遇到启动/生成问题，先查规范文档 **§5 症状 → 根因对照表**（本项目全部历史
事故都在里面），再按 **§4 日志布局** 的顺序看日志：
`log/start-tauri-launcher.log` → `log/dev-launcher-stderr.log` →
`log/dev-launcher.log` → `log/nextjs-stderr-<ts>.log` →
`log/comfyui-runtime.log`。

## 维护约定

- 修出新的启动/构建故障后：先更新规范文档 §5 对照表与相关章节，再提交修复。
- 规范文档与本文件必须同步演进：改了规范文档的硬规则，同步改这里的摘要。
