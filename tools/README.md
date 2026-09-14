# tools/ — 构建与运维脚本

本目录存放**不参与应用运行、只用于构建/打包/排障**的脚本与文档。

此前这些文件散落在项目根目录，且打包配置 `start-tauri.spec` 被根 `.gitignore`
的 `start-tauri*.spec` 规则一并忽略，导致**打包流程无法从仓库复现**。现统一收拢
到本目录并纳入版本控制。

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

## 目录内容

| 文件 | 目录 | 类别 | 用途 |
|------|------|------|------|
| `start/start-web.ps1` | start/ | 启动 | 控制台模式启动 Web 开发（调用 `scripts/dev-launcher.ps1`，日志可见） |
| `start/start-tauri.ps1` | start/ | 启动 | 直接启动打包好的 `start-tauri/start-tauri.exe`（prebuilt 秒出窗口） |
| `start/start-tauri-dev.ps1` | start/ | 启动 | 隐藏窗口启动 Tauri 桌面壳（dev / tauri dev 模式，Rust 热重载） |
| `start/start-desktop.ps1` | start/ | 启动 | 桌面版一键自检 + 启动（给拿到「即开即用桌面包」的普通用户） |
| `start/run-local.ps1` | start/ | 初始化 | 非开发人员一键初始化：自检 node/pnpm、生成 `.env`、补齐依赖 |
| `start/verify-quality.ps1` | start/ | 质量门禁 | 双击即跑 typecheck / lint / vitest（见规范 11.12） |
| `start/run-tests.ps1` | start/ | 质量门禁 | 只跑 vitest（可指定文件 / `-Full` 复现基线失败 / 透传 vitest 参数），补 verify-quality「三项串联」之外的日常红绿循环（见规范 11.12） |
| `start/sync-lint.ps1` | start/ | 质量检查 | 同步依赖 + `pnpm lint`（install && lint，拉取更新/改完代码后日常自检用，见规范 §8） |
| `start/register-comfyapp-protocol.ps1` | start/ | 一次性配置 | 注册 `comfyapp://` 协议（HKCU，免管理员） |
| `build/build-launcher.ps1` | build/ | 启动器（通用） | 打包 `start-tauri/start-tauri.exe`（prebuilt 默认入口，秒出窗口 + dev server） |
| `build/build-launcher-dev.ps1` | build/ | 启动器（dev） | 打包 `start-tauri-dev/start-tauri-dev.exe`（双击即走 tauri dev，Rust 热重载） |
| `build/build-launcher-standalone.ps1` | build/ | 启动器（standalone） | 打包 `start-tauri-standalone/start-tauri-standalone.exe`（双击即走独立模式） |
| `build/build-tauri-release.ps1` | build/ | 壳（dev 用） | 构建 `src-tauri/target/release/app.exe`（release 壳，prebuilt / tauri dev 使用，运行时回退 dev server） |
| `build/build-standalone.ps1` | build/ | 壳（standalone 用） | 完整生产构建独立壳：`pnpm tauri build --no-bundle`，产出不连 dev server 的可分发壳 |
| `build/build-all.ps1` | build/ | 一键编排 | 构建 release 壳 + 打包 `start-tauri.exe` |
| `build/rebuild-static.ps1` | build/ | 资源 | 清理并重建 `src-tauri/static`（standalone / 嵌入资源来源） |
| `docs/generate-docs.ps1` | docs/ | 文档 | 一键生成原文文档：`pnpm doc:check` 校验一致性 + `pnpm doc:render` 生成 `docs/generated/`（逻辑在 `scripts/generate-docs.ps1`） |
| `registry/start-registry.ps1` | registry/ | 团队 Registry | 启动本地 shadcn Registry HTTP 服务（`D:/dev/Comfy-APP-T3/registry`，供 `shadcn add @comfy-app-t3/*`） |
| `start-tauri.spec` | (根) | 打包配置 | PyInstaller（onedir）；入口名由环境变量 `LAUNCHER_NAME` 决定，一份 spec 服务三个入口 |
| `README.md` | (根) | 文档 | 本文件 |
| `studio/start-studio.ps1` | studio/ | 数据库 | 启动 Drizzle Studio（逻辑在 `studio/start-studio.logic.ps1`） |
| `scripts/` | scripts/ | 逻辑脚本 | `build/*.ps1` 入口对应的 PowerShell 实现：环境检查 / 打包 / 日志都在这里 |
| `scripts/Log-Common.ps1` | scripts/ | 公共库 | 构建脚本的统一日志输出（`Log` / `Invoke-Logged` / `Open-Log`，落 `log/tools/*.log`） |
| `scripts/Build-Guard.ps1` | scripts/ | 公共库 | 构建前置守卫：编译前检测 `target\{release,debug}\app.exe` 是否仍在运行（被占用的壳会让 cargo 覆盖产物时报 `os error 5`，且要等整轮编译走完才失败）。**陈旧壳**（起它的启动器已退出）与非交互构建（双击 / 由启动器拉起）下的占用一律自动 `taskkill /T /F` 回收后继续；只有「启动器仍在跑 / 用户可能正开着应用」才中止，并额外提示先结束启动器（否则编译途中会被它拉起的新壳顶上，白跑一轮） |
| `../scripts/entry-common.ps1` | (根 scripts) | 公共库 | 入口通用能力：定位项目根 / 解析 pwsh 宿主 / 透传退出码 / 双击场景暂停 |
| `../scripts/enable-ps1-double-click.ps1` | (根 scripts) | 一次性配置 | 关联「双击 .ps1 = 运行」（用户级 HKCU，免管理员） |

## 入口 / 逻辑对照

双击入口与逻辑脚本**同名不同层**，改动时别改错文件：

| 入口（双击用，含中文提示与收尾） | 逻辑（做实事，写 `log/tools/*.log`） |
|---|---|
| `build/build-all.ps1` | `scripts/build-all.ps1` |
| `build/build-launcher.ps1` | `scripts/build-launcher.ps1` |
| `build/build-launcher-dev.ps1` | `scripts/build-launcher-dev.ps1` |
| `build/build-launcher-standalone.ps1` | `scripts/build-launcher-standalone.ps1` |
| `build/build-standalone.ps1` | `scripts/build-standalone.ps1` |
| `build/build-tauri-release.ps1` | `scripts/build-tauri-release.ps1` |
| `build/rebuild-static.ps1` | `scripts/rebuild-static.ps1` |
| `registry/start-registry.ps1` | `scripts/start-registry.ps1` |
| `studio/start-studio.ps1` | `studio/start-studio.logic.ps1`（本类无 `scripts/` 分层，后缀区分） |
| `start/start-web.ps1` | `scripts/dev-launcher.ps1` |
| `start/start-tauri.ps1` | 直接启动 `start-tauri\start-tauri.exe`（见 `scripts/start_tauri_launcher.py`） |
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

三种**启动方式**现在各有一个独立 exe 入口，构建脚本也按职责归类：

### A. 开发 / 快速预览（连 dev server，前端 HMR）

- **入口 exe**：`start-tauri.exe`（prebuilt，默认）或 `start-tauri-dev.exe`（tauri dev）
- **壳来源**：`build/build-tauri-release.ps1` 产出的 `target/release/app.exe`
  （该壳运行时 `server.js` 不在资源根，会自动**回退到 dev server**）
- **打包入口 exe**：`build/build-launcher.ps1` / `build/build-launcher-dev.ps1`
- **适用**：只改前端（`src/` TS/TSX）靠 HMR 即时生效；改 Rust 后用 dev 入口自动重载
- 详见 [`../docs/startup-hotreload.md`](../docs/startup-hotreload.md)

### B. 独立模式（standalone，不连 dev server）

- **入口 exe**：`start-tauri-standalone.exe`（双击即走独立模式）
- **壳来源**：`build/build-standalone.ps1`（`pnpm tauri build --no-bundle`）产出的
  `target/release/app.exe` + 同级 `server.js` / `.next/static` / `binaries/node.exe`
  （运行时 `resource_dir` 根有 `server.js`，走内置 Node sidecar，**不依赖 dev server**）
- **打包入口 exe**：`build/build-launcher-standalone.ps1`（仅打包 launcher，壳本身靠 `build/build-standalone.ps1`）
- **适用**：需要「双击即独立运行、无需起 dev server」的分发场景
- ⚠️ 必须先跑 `build/build-standalone.ps1` 才有独立壳；否则双击 `start-tauri-standalone.exe` 会提示先构建

### C. 资源清理（两类构建共用）

- `build/rebuild-static.ps1`：删除并重建 `src-tauri/static`（standalone 资源来源）；
  当 `static` 被污染导致黑屏时，先跑它再重新构建壳

> 三个入口 exe 由**同一份** `scripts/start_tauri_launcher.py` 打包而来：PyInstaller 在
> `build/build-launcher-dev.ps1` / `build/build-launcher-standalone.ps1` 中通过 `LAUNCHER_NAME`
> 指定 exe 名；launcher 运行时再按 exe 文件名自动选择 prebuilt / tauri / standalone 模式。
> 因此改完 `start_tauri_launcher.py` 后，**三个入口都要重新打包**才生效。

## 重新打包 start-tauri.exe

### 前置条件

```powershell
pip install pyinstaller
```

### 执行

双击 `tools\build\build-launcher.ps1`，或在项目根目录执行：

```powershell
pyinstaller --clean --noconfirm --distpath . --workpath build-launcher tools/start-tauri.spec
```

产物：`<项目根>\start-tauri\start-tauri.exe`（连同 `_internal\` 依赖目录）。

> `start-tauri.spec` 内部已按 `SPECPATH` 上溯到项目根计算源码绝对路径，手敲命令时不必
> 强制在项目根执行；`build/build-launcher.ps1` 也会先定位项目根再调用 PyInstaller。

### 打包产物不入库

`.gitignore` 已忽略：

- `/start-tauri/` —— onedir 产物目录
- `/build-launcher/` —— PyInstaller 中间产物
- `/dist/`

## 启动流程与 comfy-cli 环境

`start-tauri.exe` 由 `scripts/start_tauri_launcher.py` 打包而来，启动流程：

1. 弹出 Win32 自绘启动画面（预编译壳模式下由 Tauri 内嵌页展示进度）；
2. 后台调用 `scripts/dev-launcher.ps1` 启动 Next.js dev server 与 Tauri 壳；
3. **检测 comfy-cli 虚拟环境**（见下）；
4. tail `log/dev-launcher.log`，把进度写入 `run/launch-status.json`，供启动页读取。

### comfy-cli 虚拟环境自动准备

raw UI-format（liblib 子图）工作流由 `src/lib/comfyui/executor-cli.ts` 交给项目内的
comfy-cli 做 UI→API 转换，它固定使用：

```
<项目根>\python-venv\comfy-cli\Scripts\python.exe
```

该路径缺失时提交任务会直接 `spawn ... ENOENT`，用户无从下手；版本过旧时子图
wrapper 的覆盖不生效（提示词/种子整段失效，1.20 才修）。因此启动器**每次启动**
都后台触发一次 `scripts/setup-comfy-cli-venv.ps1`，由脚本统一决定做什么：

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

### 三个启动入口对比：start-tauri.ps1 / start-tauri-dev.ps1 / start-tauri.exe

`start-tauri.ps1` 现在**直接启动打包好的 `start-tauri\start-tauri.exe`**，不再复刻 dev-launcher
逻辑；`start-tauri-dev.ps1` 保持原「dev / tauri dev」入口。三者最终都会拉起「Next.js
dev server + Tauri 桌面包壳」，但走的模式不同：

| 维度 | `tools/start/start-tauri.ps1`（直启 exe） | `tools/start/start-tauri-dev.ps1`（Tauri） | `start-tauri\start-tauri.exe`（Prebuilt） |
|------|-----------------------------------|----------------------------|--------------------------------|
| 实际执行 | 直接 `Start-Process start-tauri\start-tauri.exe` | `dev-launcher.ps1 -Tauri` → `pnpm tauri dev` | `dev-launcher.ps1 -Prebuilt` |
| 启动 Tauri 壳方式 | 由 exe 决定：直接运行**已编译**的 `target/release/app.exe` | `tauri dev` 现编译 Rust 壳（debug） | 直接运行**已编译**的 `target/release/app.exe` |
| 窗口出现速度 | **秒出**（壳已编译好） | 慢，要等 Rust 编译（首次数分钟） | **秒出**（壳已编译好） |
| Rust 改动热重载 | ❌ 无（用预编译壳） | ✅ 改 Rust 自动重编译 | ❌ 无（用预编译壳） |
| 前端 HMR | ✅ 有（next dev） | ✅ 有 | ✅ 有 |
| 自带启动画面 / 单实例 / comfy-cli 自动准备 | ✅ 由 exe 内 Python launcher（`scripts/start_tauri_launcher.py`）负责 | ❌ 无（本入口仅隐藏窗口调 pwsh） | ✅ 由 Python launcher 负责 |
| 前提 | 需先打包 `start-tauri.exe`（`tools\build\build-launcher.ps1`）并 `cargo build --release` | 无需预编译，首次自动编译 Rust | 需先 `cargo build --release`（否则回退 debug 壳更慢） |

- **`tools/start/start-tauri.ps1`（直启 exe）= 日常使用 / 快速预览**：等价于双击
  `start-tauri\start-tauri.exe`，窗口立刻弹出（显示 Tauri 内嵌 splash 加载页），后台并行
  起 dev server，就绪后自动跳转应用。适合只改前端（src/ 下的 TS/TSX，靠 HMR 生效）；
  改 Rust 壳后必须重新 `cargo build --release` 才生效。
- **`tools/start/start-tauri-dev.ps1` = 开发桌面壳时用**：走 `pnpm tauri dev`，Rust 侧改完
  自动重载，适合调壳本身逻辑（如 `lib.rs`、窗口配置）。启动慢在编译 Rust，且绕过
  了 Python launcher 的额外逻辑（单实例 / comfy-cli 自动准备不在）。

> 窗口初始页（`splash.html`）通过 `tauri://localhost/splash.html` 加载，不依赖 dev
> server；它会主动轮询 `COMFYAPP_DEV_URL` 直到后端就绪再跳转，因此 dev server 未起
> 时显示「加载中」而非 Edge 错误页。

## 修改启动器后的注意事项

`start-tauri.exe` 是**打包产物**，改完 `scripts/start_tauri_launcher.py` 后必须重新执行
`tools\build\build-launcher.ps1`，否则双击仍跑旧逻辑。

## 构建 release 版 Tauri 壳

`scripts/dev-launcher.ps1` 的 `-Prebuilt` 模式会**优先**使用
`src-tauri/target/release/app.exe`（启动更快），仅在它缺失时才回退到
`src-tauri/target/debug/app.exe`（debug 启动较慢）。因此发布前建议先构建 release 壳：

### 前置条件

- 已安装 Rust 工具链（`cargo` / `rustc`，推荐通过 https://rustup.rs/ 安装）；
- Windows 上需 Visual Studio Build Tools（含「使用 C++ 的桌面开发」工作负载），
  否则 `cargo build` 会因缺少 MSVC 链接器失败。
- **别让桌面壳变成无主进程**：启动器先于壳退出（关掉启动器窗口 / python 监控线程结束）时，已经弹出的 `app.exe` 会继续运行。启动链路已三层治理：①启动前按 exe 真实路径回收上一轮残留的壳；②壳 PID 落 `log/launcher/tauri-shell.pid`，python 启动器在监控退出/异常/超时路径对仍存活的壳执行 `taskkill /PID <pid> /T /F` 补刀；③正常关窗仍由 `dev-launcher.ps1` 的进程树回收负责。排查时看 `log/launcher/` 下这一条「发现上次残留的桌面壳（PID …）」与 `[ComfyAPP]` 诊断行。
- **桌面壳要处于关闭状态**：`app.exe` 还在运行时 Windows 不允许替换它，
  cargo 会在编译收尾报 `failed to remove file ... app.exe / 拒绝访问 (os error 5)`，
  白白浪费整轮编译。构建脚本已用 `tools/scripts/Build-Guard.ps1` 在编译前拦下：
  - **陈旧壳**（起它的启动器已退出 = 无主孤儿壳）直接 `taskkill /PID <pid> /T /F`
    回收后继续构建，不用你手动关；
  - 双击构建、或由启动器拉起的构建**没人能按任意键确认**，这类非交互场景一律自动
    回收后继续，不留死胡同；
  - 只有「应用启动器（`start-tauri*.exe`）还在跑 / 用户可能正开着应用」才中止，
    并在日志里点名要求先结束启动器——启动器会把壳重新拉起来顶上 `app.exe`，
    否则构建会在编译途中被占用而白跑一轮。
  手动处理时别用任务管理器单杀壳（Next dev server 子进程会残留占端口），
  用 `taskkill /IM app.exe /T /F` 或直接关掉启动器窗口。

### 执行

双击 `tools\build\build-tauri-release.ps1`，或在项目根目录执行：

```powershell
cd src-tauri
cargo build --release
```

产物：`<项目根>\src-tauri\target\release\app.exe`。

> 首次构建会拉取并编译全部 Rust 依赖，耗时通常 5–15 分钟；之后的增量构建较快。

### 两种运行模式（重要）

> **流程已统一（推荐）**：直接双击 `tools\build\build-tauri-release.ps1` 或 `tools\build\build-all.ps1`
> 即可，脚本会在 `cargo build --release` **之前自动同步前端资源**——`src-tauri/static`
> 缺失时跑完整 `build-desktop.mjs`（含 `pnpm build` + Node sidecar），已存在时仅增量
> 同步 `splash.html` / `dev-launcher.ps1` / `index.html`。**无需再手动 `cp`**。

裸 `cargo build --release`（手动在 `src-tauri` 目录敲命令）只编译 Rust 壳，**不会**
运行 `tauri.conf.json` 的 `beforeBuildCommand`（`node scripts/build-desktop.mjs`），
因此 `target/release/` 下没有 standalone 资源（`server.js` + Node sidecar）。运行时的处理：

- **缺 `server.js` 时**：release 壳会自动**回退到 dev URL 模式**——`dev-launcher.ps1`
  的 `-Prebuilt` 分支已经起了 Next dev server，壳只需加载 `COMFYAPP_DEV_URL`
  （`http://127.0.0.1:3100/workspace`）即可，不会因资源缺失而 panic 退窗。
  这是开发 / 快速预览的推荐路径：双击 `start-tauri.exe` 即秒弹窗口，前端由 dev server 提供。
- **要做真正「独立分发」**（壳自带 Next standalone server、连 dev server 都不需要、
  启动最快）：必须执行完整生产构建，让 `beforeBuildCommand` 组装好资源：

  ```powershell
  pnpm tauri build --no-bundle   # 只产出裸壳 + 资源，不打安装包
  # 或 pnpm tauri build          # 同时打 msi/nsis 安装包
  ```

  该路径会先 `pnpm build`（Next standalone 全量编译，较慢），再拷贝 `server.js` /
  Node sidecar 到资源目录；此时 release 壳走真正的 standalone 模式。

## 一键发布构建

需要「最快启动」的完整发布包时，直接双击 `tools\build\build-all.ps1`：

1. 自动调用 `build/build-tauri-release.ps1` 构建 release Tauri 壳（脚本内部已自动组装前端资源，无需手动 build-desktop）；
2. 完成后自动调用 `build/build-launcher.ps1` 打包 `start-tauri.exe`；
3. 全部完成后由入口统一收尾（双击场景等待按键，终端调用直接返回退出码）。

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
