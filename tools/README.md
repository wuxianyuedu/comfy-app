# tools/ — 构建与运维脚本

本目录存放**不参与应用运行、只用于构建/打包/排障**的脚本与文档。

此前这些文件散落在项目根目录（含 PyInstaller 的 `start-tauri.spec`），导致
**打包流程无法从仓库复现**；现统一收拢到本目录并纳入版本控制。
**Python 启动器与它的打包链已随 ISSUE #784 整体删除**：桌面壳 `app.exe` 就是唯一入口，
不再有 `build-launcher*.ps1` / `start-tauri.spec` / `start-tauri*.exe`。

> **结构约定（2026-09-04 修订）**：Windows 双击入口一律 `*.ps1`，按用途归入子目录
> （`start/` 启动与初始化、`build/` 打包类、`docs/` 文档工具、`registry/` 团队 Registry、
> `studio/` 数据库工具等）；业务逻辑放在 `tools/scripts/*.ps1`，与 `build/` 下的入口一一对应（同名的两个
> 文件必然一个是入口、一个是逻辑，见下方「入口 / 逻辑对照」）。入口只做三件事：定位项目根、
> 调用逻辑脚本、透传退出码——这些公共能力收敛在 `scripts/entry-common.ps1`。所有 `.ps1`
> 以 UTF-8 with BOM 保存，避免中文乱码。
>
> **后续新增入口：放 `tools/<分类>/xxx.ps1`，不要放仓库根**。根目录只保留工程配置与文档，
> 该约束由 `scripts/check-file-structure.cjs` 的 R9 规则在 pre-commit 强制（ISSUE #29）。
> 分类目录按用途划分，新增前先看现有目录能否容纳，不要按人名或临时用途建目录。
>
> **不再使用 `.bat`**：历史上入口是 `.bat`，但它走 cmd.exe（系统 ANSI/GBK 代码页），
> 中文提示与子进程 UTF-8 输出必然乱码，被迫把入口做成「不含中文、不含逻辑」的哑壳——
> 本该在入口做的自检与提示只能下沉，维护成本反而更高。详见规范
> `docs/standards/launch-and-build.md` §8。
>
> **一次性前置**：Windows 默认双击 `.ps1` 是「用记事本打开」而非执行。首次使用前需右键
> `scripts/enable-ps1-double-click.ps1` →「使用 PowerShell 运行」完成关联（用户级，免管理员）。
>
> **`.ps1` 不是逻辑层，也不等于「这个仓库只能在 Windows 用」**：本目录下的入口只解决
> 「Windows 上怎么被双击 / 被 exe 拉起」。同一件事在 Linux / macOS / CI 上的入口是等价
> 的 `pnpm` 脚本（例如 `pnpm check:all` = `verify-quality.ps1`、`pnpm test:file` =
> `run-tests.ps1`、`pnpm doc:gen` = `generate-docs.ps1`），逐条对照见
> [launch-and-build.md §9.5](../docs/standards/launch-and-build.md) 的
> **跨平台动作对照表**，由 `scripts/check-ps1-consistency.mjs` 在 pre-commit 与 CI 守着
> —— 新增动作却只写了一侧会在提交时被拦下，而不是等用户在另一个平台上踩空。
>
> **各分类目录另有 README**（该目录「有哪些入口、各自什么时候用」）：
> [start/](start/README.md) · [build/](build/README.md) · [docs/](docs/README.md) ·
> [registry/](registry/README.md) · [studio/](studio/README.md) · [scripts/](scripts/README.md)
> 。本文件保留**全目录视图**与深度说明（打包 / 启动流程 / 排障），不重复各目录的清单。

## 新增入口前先读

1. **放对目录**：`tools/<分类>/xxx.ps1`（分类按用途，不按人名或临时用途新建目录）；
2. **入口只做三件事**：定位项目根 → 调用逻辑脚本 → 收尾，逻辑下沉到 `scripts/`
   或 `tools/scripts/`，公共能力复用 `scripts/entry-common.ps1`；
3. **UTF-8 with BOM** 保存（含中文的 `.ps1` 无 BOM 会被 PowerShell 5.1 按 GBK 解码）；
4. **同时想清楚跨平台那侧**：这个动作在 Linux / macOS 上怎么跑？有 `.mjs` 逻辑就
   在 `package.json` 里挂一条脚本，并登记进规范 §9.5 的对照表（门禁会核对）。

## 目录内容

| 文件 | 目录 | 类别 | 用途 |
|------|------|------|------|
| `start/start-web.ps1` | start/ | 启动 | 控制台模式启动 Web 开发（调用 `scripts/dev-launcher.ps1`，日志可见） |
| `start/start-tauri.ps1` | start/ | 启动 | 双击即启动桌面壳 `src-tauri/target/release/app.exe`（**唯一入口**，编排由壳自己承担） |
| `start/start-tauri-dev.ps1` | start/ | 启动 | 隐藏窗口启动 Tauri 桌面壳（dev / tauri dev 模式，Rust 热重载） |
| `start/start-desktop.ps1` | start/ | 启动 | 桌面版一键自检 + 启动（给拿到「即开即用桌面包」的普通用户） |
| `start/run-local.ps1` | start/ | 初始化 | 非开发人员一键初始化：自检 node/pnpm、生成 `.env`、补齐依赖 |
| `start/verify-quality.ps1` | start/ | 质量门禁 | 双击即跑 typecheck / lint / vitest（跨平台等价：`pnpm check:all`，见规范 11.12） |
| `start/run-tests.ps1` | start/ | 质量门禁 | 只跑 vitest（可指定文件 / `-Full` 复现基线失败 / 透传 vitest 参数），补 verify-quality「三项串联」之外的日常红绿循环（跨平台等价：`pnpm test:file` / `pnpm test:full`，见规范 11.12） |
| `start/sync-lint.ps1` | start/ | 质量检查 | 同步依赖 + `pnpm lint`（install && lint，拉取更新/改完代码后日常自检用，见规范 §8） |
| `start/register-comfyapp-protocol.ps1` | start/ | 一次性配置 | 注册 `comfyapp://` 协议（HKCU，免管理员） |
| `build/build-tauri-release.ps1` | build/ | 壳 | 构建 `src-tauri/target/release/app.exe`（唯一入口；prebuilt / tauri dev 都用它） |
| `build/build-standalone.ps1` | build/ | 壳（standalone 用） | 完整生产构建独立壳：`pnpm tauri build --no-bundle`，产出不连 dev server 的可分发壳 |
| `build/build-all.ps1` | build/ | 一键编排 | 构建 release 壳（= 唯一入口 `app.exe`） |
| `build/rebuild-static.ps1` | build/ | 资源 | 清理并重建 `src-tauri/static`（standalone / 嵌入资源来源） |
| `docs/generate-docs.ps1` | docs/ | 文档 | 一键生成原文文档：`pnpm doc:check` 校验一致性 + `pnpm doc:render` 生成 `docs/generated/`（跨平台等价：`pnpm doc:gen`；逻辑在 `scripts/generate-docs.ps1` / `scripts/generate-docs.mjs`） |
| `registry/start-registry.ps1` | registry/ | 团队 Registry | 启动本地 shadcn Registry HTTP 服务（`D:/dev/Comfy-APP-T3/registry`，供 `shadcn add @comfy-app-t3/*`） |
| `README.md` | (根) | 文档 | 本文件 |
| `studio/start-studio.ps1` | studio/ | 数据库 | 启动 Drizzle Studio（逻辑在 `studio/start-studio.logic.ps1`） |
| `scripts/` | scripts/ | 逻辑脚本 | `build/*.ps1` 入口对应的 PowerShell 实现：环境检查 / 打包 / 日志都在这里 |
| `scripts/Log-Common.ps1` | scripts/ | 公共库 | 构建脚本的统一日志输出（`Log` / `Invoke-Logged` / `Open-Log`，落 `log/tools/*.log`） |
| `scripts/Build-Guard.ps1` | scripts/ | 公共库 | 构建前置守卫：编译前检测 `target\{release,debug}\app.exe` 是否仍在运行（被占用的壳会让 cargo 覆盖产物时报 `os error 5`，且要等整轮编译走完才失败）。**陈旧壳**（exe 路径指不到本仓库）与双击构建下的占用一律自动 `taskkill /T /F` 回收后继续；只有「用户可能正开着应用」才中止。另含「目录删不掉时到底是谁占着」的通用出口（`Get-ProductDirHolder` / `Write-ProductDirLockHint`） |
| `../scripts/entry-common.ps1` | (根 scripts) | 公共库 | 入口通用能力：定位项目根 / 解析 pwsh 宿主 / 透传退出码 / 双击场景暂停 |
| `../scripts/enable-ps1-double-click.ps1` | (根 scripts) | 一次性配置 | 关联「双击 .ps1 = 运行」（用户级 HKCU，免管理员） |

## 入口 / 逻辑对照

双击入口与逻辑脚本**同名不同层**，改动时别改错文件：

| 入口（双击用，含中文提示与收尾） | 逻辑（做实事，写 `log/tools/*.log`） |
|---|---|
| `build/build-all.ps1` | `scripts/build-all.ps1` |
| `build/build-standalone.ps1` | `scripts/build-standalone.ps1` |
| `build/build-tauri-release.ps1` | `scripts/build-tauri-release.ps1` |
| `build/rebuild-static.ps1` | `scripts/rebuild-static.ps1` |
| `registry/start-registry.ps1` | `scripts/start-registry.ps1` |
| `studio/start-studio.ps1` | `studio/start-studio.logic.ps1`（本类无 `scripts/` 分层，后缀区分） |
| `start/start-web.ps1` | `scripts/dev-launcher.ps1` |
| `start/start-tauri.ps1` | 直接启动 `src-tauri\target\release\app.exe`（编排由壳自己承担，见 `src-tauri/src/shell_launch.rs`） |
| `start/start-tauri-dev.ps1` | `scripts/dev-launcher.ps1 -Tauri` |
| `start/run-local.ps1` | `scripts/prepare-local-run.ps1` |
| `start/verify-quality.ps1` | `scripts/quality-gate.ps1` |
| `start/run-tests.ps1` | `scripts/run-tests.ps1` |
| `start/sync-lint.ps1` | `scripts/sync-lint.ps1` |
| `docs/generate-docs.ps1` | `scripts/generate-docs.ps1` |
| `start/register-comfyapp-protocol.ps1` | `scripts/install-comfyapp-helper.ps1` |
| `start/start-desktop.ps1` | —（自检逻辑内联在入口里，不另起逻辑脚本） |

> **启动类入口原先平铺在仓库根**（`start-web.ps1` / `run-local.ps1` …），2026-09-04
> 归入 `start/`（ISSUE #29）：根目录只留工程配置，入口按用途与 `build/` / `registry/` /
> `studio/` 并列。入口只做定位与收尾，逻辑一律在 `scripts/` 或 `tools/scripts/`。

## 按用途分类（dev 构建 vs standalone 构建）

**一个 exe，两种运行形态**（判据：检出里有没有 `scripts/dev-launcher.mjs`）：

### A. 开发 / 快速预览（连 dev server，前端 HMR）

- **入口**：`src-tauri/target/release/app.exe`（双击即可；也可以用 `tools/start/start-tauri.ps1`）
- **壳来源**：`build/build-tauri-release.ps1`
- **适用**：只改前端（`src/` TS/TSX）靠 HMR 即时生效；改 Rust 后用 `tools\start\start-tauri-dev.ps1`（等价 `pnpm tauri dev`）自动重载
- 详见 [`../docs/startup-hotreload.md`](../docs/startup-hotreload.md)

### B. 独立模式（standalone，不连 dev server）

- **入口**：还是那个 `app.exe` —— 壳发现检出里**没有**编排器时自动走内嵌 server
- **壳来源**：`build/build-standalone.ps1`（`pnpm tauri build --no-bundle`）产出的
  `target/release/app.exe` + 同级 `server.js` / `.next/static` / `binaries/node.exe`
- **适用**：需要「双击即独立运行、无需起 dev server / 无需 Node 环境」的分发场景
- 先跑 `build/build-standalone.ps1` 才有完整资源；否则壳按 prebuilt 走，而分发副本里没有编排器 → 起不来（启动页会说原因）

### C. 资源清理（两类构建共用）

- `build/rebuild-static.ps1`：删除并重建 `src-tauri/static`（standalone 资源来源）；
  当 `static` 被污染导致黑屏时，先跑它再重新构建壳

## 打包产物不入库

`.gitignore` 已忽略 `/dist/` 与 `/src-tauri/target/`（含壳与 standalone 资源）。

## 启动流程与 comfy-cli 环境

双击 `src-tauri/target/release/app.exe` 的启动流程（职责全在壳侧，见
`src-tauri/src/shell_launch.rs` 与规范 §1.5）：

1. 壳秒出窗口、显示内嵌启动页；
2. 壳按「检出里有没有编排器」决定形态，有则起 `node scripts/dev-launcher.mjs --mode prebuilt`；
3. 编排器起 Next.js dev server，就绪后启动页把主窗导航过去；
4. 壳退出时回收编排器整棵树（另挂 Job Object 兜住硬杀）。

### comfy-cli 虚拟环境准备

raw UI-format（liblib 子图）工作流由 `src/lib/comfyui/executor-cli.ts` 交给项目内的
comfy-cli 做 UI→API 转换，它固定使用：

```
<项目根>\python-venv\comfy-cli\Scripts\python.exe
```

该路径缺失时提交任务会直接 `spawn ... ENOENT`，用户无从下手；版本过旧时子图
wrapper 的覆盖不生效（提示词/种子整段失效，1.20 才修）。按需执行
`scripts/setup-comfy-cli-venv.ps1`（原先由 Python 启动器每次启动后台触发，
启动器已移除），由脚本统一决定做什么：

- **venv 缺失 / `comfy_cli` 不可导入** → 安装：
  1. `python -m venv python-venv\comfy-cli`
  2. `python-venv\comfy-cli\Scripts\python.exe -m pip install --upgrade pip`
  3. `python-venv\comfy-cli\Scripts\python.exe -m pip install comfy-cli`
- **已就绪** → 版本检查：比对已装版本与 PyPI 最新版，落后才
  `pip install --upgrade comfy-cli`；已是最新则只记一行日志。

版本检查**默认 24 小时才联网一次**（状态见 `run/comfy-cli-upgrade-check.json`），
避免每次启动都打扰 PyPI；离线 / PyPI 不可达或升级失败只记日志并保持已安装版本——
venv 仍可用，不阻断启动。

安装耗时数分钟，**不阻塞启动**；进程独立（`start_new_session=True`），launcher 在
Tauri 窗口出现后退出也不会中断安装。

排查产物：

| 路径 | 内容 |
|------|------|
| `log/tools/comfy-cli-setup.log` | 安装/升级过程日志 |
| `run/comfy-cli-setup.json` | 安装状态 `{ phase, message, done, error, updated_at }` |
| `run/comfy-cli-upgrade-check.json` | 升级检查节流 `{ last_check_at, installed, latest }` |

手动触发一次（不必等启动，加 `-Force` 跳过 24h 节流立即检查）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-comfy-cli-venv.ps1 -Force
```

想跳过自动准备、改用已有环境，设置环境变量 `COMFY_CLI_PYTHON` 指向你的 Python 解释器。

### 两个启动入口对比：start-tauri.ps1 / start-tauri-dev.ps1

两者最终都会拉起「Next.js dev server + 桌面壳」，但走的模式不同
（**没有第三个入口**：Python 启动器 exe 已删除，双击壳本身就是完整形态）：

| 维度 | `tools/start/start-tauri.ps1`（直启壳） | `tools/start/start-tauri-dev.ps1`（Tauri dev） |
|------|-----------------------------------------|------------------------------------------------|
| 实际执行 | `Start-Process src-tauri\target\release\app.exe` | `dev-launcher.ps1 -Tauri` → `pnpm tauri dev` |
| 启动壳方式 | 运行**已编译**的 `target/release/app.exe` | `tauri dev` 现编译 Rust 壳（debug） |
| 窗口出现速度 | **秒出**（壳已编译好） | 慢，要等 Rust 编译（首次数分钟） |
| Rust 改动热重载 | ❌ 无（用预编译壳） | ✅ 改 Rust 自动重编译 |
| 前端 HMR | ✅ 有（next dev） | ✅ 有 |
| 启动页 / 单实例 / dev server 编排 | ✅ 由壳自己负责（`shell_launch.rs`） | ❌ 无（dev server 由 `beforeDevCommand` 起着） |
| 前提 | 需先 `cargo build --release --features custom-protocol` | 无需预编译，首次自动编译 Rust |

- **`tools/start/start-tauri.ps1`（直启壳）= 日常使用 / 快速预览**：等价于双击
  `src-tauri\target\release\app.exe`，窗口立刻弹出（显示内嵌 splash 加载页），壳自己
  起编排器与 dev server，就绪后自动跳转应用。适合只改前端（`src/` 下的 TS/TSX，靠 HMR 生效）；
  改 Rust 壳后必须重新 `cargo build --release --features custom-protocol` 才生效。
- **`tools/start/start-tauri-dev.ps1` = 开发桌面壳时用**：走 `pnpm tauri dev`，Rust 侧改完
  自动重载，适合调壳本身逻辑（如 `lib.rs`、窗口配置）。

> 窗口初始页（`splash.html`）通过 `tauri://localhost/splash.html` 加载，不依赖 dev
> server；它会主动轮询 `run/launch-status.json` 直到后端就绪再跳转，因此 dev server 未起
> 时显示「加载中」而非 Edge 错误页。

## 改动壳侧启动逻辑后的注意事项

「启动编排」全部在 `src-tauri/src/shell_launch.rs` 与 `src-tauri/src/lib.rs` 里，
改完**必须重编壳**才生效：

```powershell
cd src-tauri
cargo build --release --features custom-protocol   # feature 不能省，见规范 §5
```

唯一例外是内嵌启动页资源（`public/splash.html` → `src-tauri/splash-assets/`，由
`cargo build` 的 build script 同步），但它同样要重编壳才会嵌进二进制。

## 构建 release 版 Tauri 壳

双击 `app.exe` 时壳优先用 `src-tauri/target/release/app.exe`（release 壳，启动更快）；
debug 壳只在开发（`pnpm tauri dev`）时用。发布前建议先构建 release 壳：

### 前置条件

- 已安装 Rust 工具链（`cargo` / `rustc`，推荐通过 https://rustup.rs/ 安装）；
- Windows 上需 Visual Studio Build Tools（含「使用 C++ 的桌面开发」工作负载），
  否则 `cargo build` 会因缺少 MSVC 链接器失败。
- **桌面壳要处于关闭状态**：`app.exe` 还在运行时 Windows 不允许替换它，
  cargo 会在编译收尾报 `failed to remove file ... app.exe / 拒绝访问 (os error 5)`，
  白白浪费整轮编译。构建脚本已用 `tools/scripts/Build-Guard.ps1` 在编译前拦下：
  - **陈旧壳**（exe 路径指不到本仓库的老式残留）直接 `taskkill /PID <pid> /T /F`
    回收后继续构建，不用你手动关；
  - 双击构建**没人能按任意键确认**，这类非交互场景一律自动回收后继续，不留死胡同；
  - 判据是进程可执行文件的**真实路径**，别处的同名进程不算。
  手动处理时别用任务管理器单杀壳（Next dev server 子进程会残留占端口），
  用 `taskkill /IM app.exe /T /F`。

### 执行

双击 `tools\build\build-tauri-release.ps1`，或在项目根目录执行：

```powershell
cd src-tauri
cargo build --release --features custom-protocol
```

产物：`<项目根>\src-tauri\target\release\app.exe`（**唯一入口**）。

> 首次构建会拉取并编译全部 Rust 依赖，耗时通常 5–15 分钟；之后的增量构建较快。

### 两种运行模式（重要）

> **流程已统一（推荐）**：直接双击 `tools\build\build-tauri-release.ps1` 或
> `tools\build\build-all.ps1` 即可，脚本会在 `cargo build --release` **之前自动同步前端资源**
> ——`src-tauri/static` 缺失时跑完整 `build-desktop.mjs`（含 `pnpm build` + Node sidecar），
> 已存在时仅增量同步 `splash.html` / `index.html`。**无需再手动 `cp`**。

跑出来的 `app.exe` 是同一个文件，形态由**壳自己**按「检出里有没有编排器」决定：

- **有编排器（开发检出）→ prebuilt**：壳起 `node scripts/dev-launcher.mjs`，由它起 Next dev server，
  壳加载 `COMFYAPP_DEV_URL`。这是开发 / 快速预览的推荐路径：双击 `app.exe` 即秒弹窗口，
  前端由 dev server 提供（改前端 HMR 即时生效）。
- **没有编排器（分发副本）→ standalone**：壳走内嵌 Node sidecar 运行 Next standalone server，
  连 dev server 都不需要。要走到这一步必须执行完整生产构建，让 `beforeBuildCommand`
  组装好资源：

  ```powershell
  tools\build\build-standalone.ps1   # = pnpm tauri build --no-bundle（只产出裸壳 + 资源）
  pnpm tauri build                     # 同时打 msi/nsis 安装包
  ```

  该路径会先 `pnpm build`（Next standalone 全量编译，较慢），再拷贝 `server.js` /
  Node sidecar 到资源目录。

## 一键发布构建

需要「最快启动」的完整发布包时，直接双击 `tools\build\build-all.ps1`：

1. 自动调用 `build/build-tauri-release.ps1` 构建 release Tauri 壳（脚本内部已自动同步前端资源，无需手动 build-desktop）；
2. 产物就是唯一入口 `src-tauri\target\release\app.exe` —— **没有第二步打包**（原先那一步做的
   「再包一层启动器 exe」已随 ISSUE #784 移除）；
3. 全部完成后由入口统一收尾（双击场景等待按键，终端调用直接返回退出码）。

结束时报告耗时：入口打印整轮总耗时（双击场景里它是关窗口前最后一行），
编排层汇总里给出「总耗时」（失败中止时也报已用时间），两个子步骤各报本步耗时；
耗时同时落 `log\tools\*.log`。格式按量级自适应：`45.6 秒` / `3 分 12.4 秒` / `1 时 02 分 03 秒`。

```powershell
# 在项目根目录执行
tools\build\build-all.ps1
```

两个脚本职责独立、前置工具链不同（Rust vs Python），**不合并为单文件**，
仅由 `build/build-all.ps1` 做编排，便于单独重编其中一环。

> 单独双击任一入口时，收尾会等待按键（双击场景窗口是一闪而过，必须暂停才能读到提示）；
> 从终端调用（非资源管理器拉起）则不暂停，直接返回退出码，因此 `build/build-all.ps1`
> 编排子脚本时天然无人值守——这正是旧 `.bat` 方案里要靠 `no-pause` 参数传递才能
> 做到的行为，现在由 `scripts/entry-common.ps1` 的 `Test-IsDoubleClicked` 统一判定。
