# AGENTS.md — AI 协作强制规范

> 本文件会被编码代理（ZCode 等）在会话开始时自动加载。
> **这是硬性前置条件，不是建议**：在修改下列范围之前，必须先完整阅读
> [docs/standards/launch-and-build.md](docs/standards/launch-and-build.md)，
> 并在实施说明中注明遵循了其中哪些条目。

## 强制先读规范文档的改动范围

| 范围 | 路径 | 规范章节 |
|---|---|---|
| 启动链路 | `start-tauri/`、`scripts/start_tauri_launcher.py`、`scripts/dev-launcher.ps1` | §1–§3 |
| Windows 双击入口 | `tools/<分类>/*.ps1`（启动类 `tools/start/`）、`scripts/entry-common.ps1` | §8 |
| Tauri 壳 | `src-tauri/**`（conf.json / src / splash-assets） | §2、§7 |
| ComfyUI 生命周期 | `src/lib/comfyui/**`（lifecycle / executor-* / reaper） | §3、§5 |
| 工坊管线 | `src/components/workshop/**`、`src/lib/workshop/**` | §5 |
| UI/逻辑分离 | 视图层新增 `fetch`/`vanillaApi`/tRPC hook 时 | §17（[17-UI与逻辑分离.md](docs/standards/17-UI与逻辑分离.md)） |
| 构建与打包 | `scripts/build-desktop.mjs`、`tools/**` | §7、§8 |

## 硬规则（违反 = 提交被拒或必须回滚）

1. **包管理只用 pnpm**（`pnpm exec …`）。禁止 npx / npm run——npm 11.19 在本机
   解析 typescript 别名链会崩溃（`Class extends value undefined`）。
2. **工具链钉死项不可随意改**（改动前必须读规范 §6 并在提交说明里给出理由）：
   - `pnpm-workspace.yaml`：`minimumReleaseAge: 0`、`allowBuilds`（6 个包）、
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
9. **视图层不得新增 IO**：`src/components/**`、`src/app/**`（除 `api/`）里不允许新写
   `fetch(`、`vanillaApi.*`、`api.x.y.useQuery/useMutation`——逻辑要进
   `<feature>/hooks/` 或 `src/lib/<domain>-client.ts`。守卫脚本
   `scripts/check-ui-logic-separation.cjs`（棘轮只许降不许升，已接入 pre-commit 与 CI）。
   治理后必须 `node scripts/check-ui-logic-separation.cjs --update` 收紧基线。
10. **禁用 `.bat` / `.cmd` / `.vbs` 入口，Windows 入口一律 `.ps1`**（ISSUE #23 / 规范 §8）。
    **入口放 `tools/<分类>/`，不放仓库根**（ISSUE #29 / 规范 §8.6）：启动类归
    `tools/start/`，与 `tools/build/`、`tools/registry/`、`tools/studio/` 按用途并列；
    根目录只留工程配置与文档。R9 在 pre-commit 强制拦截，回归测试见
    `tests/check-file-structure.test.ts`。
   理由：cmd.exe 走系统 ANSI（GBK）代码页，中文提示与子进程 UTF-8 输出必然乱码，
   历史上被迫把入口做成「不含中文、不含逻辑」的哑壳。新增入口规则：
   - 入口只做「定位项目根 → 调用逻辑脚本 → 收尾」，逻辑下沉到 `scripts/` 或
     `tools/scripts/`，公共能力复用 `scripts/entry-common.ps1`；
   - 含中文的 `.ps1` 必须 **UTF-8 with BOM** 保存（无 BOM 会被 PowerShell 5.1
     按 GBK 解码，与 `.bat` 乱码同源）；
   - R7/R8 由 `scripts/check-file-structure.cjs` 在 pre-commit 强制拦截，
     回归测试见 `tests/check-file-structure.test.ts`。
11. **注释里禁止「历史流水」**（ISSUE #46 / 规范 §12.4.2 / 反模式表 G4）：
    日期（`2026-08-17`）、改动编号（`R-ardot114` / `R83` / `R-Next`）、
    任务批次号（`T12-3`）—— 这些归 `git log`，写进注释会随代码搬迁过期失真。
    由 `scripts/check-file-structure.cjs` 的 **R10** 在 pre-commit 强制拦截，
    回归测试见 `tests/check-file-structure.test.ts`。

## 快速排障

遇到启动/生成问题，先查规范文档 **§5 症状 → 根因对照表**（本项目全部历史
事故都在里面），再按 **§4 日志布局** 的顺序看日志：
`log/start-tauri-launcher.log` → `log/dev-launcher-stderr.log` →
`log/dev-launcher.log` → `log/nextjs-stderr-<ts>.log` →
`log/comfyui-runtime.log`。

## 维护约定

- 修出新的启动/构建故障后：先更新规范文档 §5 对照表与相关章节，再提交修复。
- 规范文档与本文件必须同步演进：改了规范文档的硬规则，同步改这里的摘要。
