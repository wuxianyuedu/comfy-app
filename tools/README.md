# tools/ — 构建与运维脚本

本目录存放**不参与应用运行、只用于构建/打包/排障**的脚本与文档。

此前这些文件散落在项目根目录，且打包配置 `start-tauri.spec` 被根 `.gitignore`
的 `start-tauri*.spec` 规则一并忽略，导致**打包流程无法从仓库复现**。现统一收拢
到本目录并纳入版本控制。

> **结构约定**：`*.bat` 仅作 Windows 双击入口（不含业务逻辑、不含中文），按用途归入子目录
> （`build/` 打包类、`registry/` 团队 Registry 等）；真正的逻辑都放在 `scripts/*.ps1`
> （UTF-8 with BOM 保存，避免中文乱码）。`.bat` 内用 `%~dp0..\..` 上溯到项目根、用
> `%~dp0..\scripts\xxx.ps1` 引用逻辑脚本。后续新增入口：放 `tools/<分类>/xxx.bat`。

## 目录内容

| 文件 | 目录 | 类别 | 用途 |
|------|------|------|------|
| `build/build-launcher.bat` | build/ | 启动器（通用） | 打包 `start-tauri/start-tauri.exe`（prebuilt 默认入口，秒出窗口 + dev server） |
| `build/build-launcher-dev.bat` | build/ | 启动器（dev） | 打包 `start-tauri-dev/start-tauri-dev.exe`（双击即走 tauri dev，Rust 热重载） |
| `build/build-launcher-standalone.bat` | build/ | 启动器（standalone） | 打包 `start-tauri-standalone/start-tauri-standalone.exe`（双击即走独立模式） |
| `build/build-tauri-release.bat` | build/ | 壳（dev 用） | 构建 `src-tauri/target/release/app.exe`（release 壳，prebuilt / tauri dev 使用，运行时回退 dev server） |
| `build/build-standalone.bat` | build/ | 壳（standalone 用） | 完整生产构建独立壳：`pnpm tauri build --no-bundle`，产出不连 dev server 的可分发壳 |
| `build/build-all.bat` | build/ | 一键编排 | 构建 release 壳 + 打包 `start-tauri.exe` |
| `build/rebuild-static.bat` | build/ | 资源 | 清理并重建 `src-tauri/static`（standalone / 嵌入资源来源） |
| `registry/start-registry.bat` | registry/ | 团队 Registry | 启动本地 shadcn Registry HTTP 服务（`D:/dev/Comfy-APP-T3/registry`，供 `shadcn add @comfy-app-t3/*`） |
| `start-tauri.spec` | (根) | 打包配置 | PyInstaller（onedir）；入口名由环境变量 `LAUNCHER_NAME` 决定，一份 spec 服务三个入口 |
| `README.md` | (根) | 文档 | 本文件 |
| `scripts/` | scripts/ | 逻辑脚本 | `*.bat` 对应的 PowerShell 实现：环境检查 / 打包 / 日志都在这里 |

## 按用途分类（dev 构建 vs standalone 构建）

三种**启动方式**现在各有一个独立 exe 入口，构建脚本也按职责归类：

### A. 开发 / 快速预览（连 dev server，前端 HMR）

- **入口 exe**：`start-tauri.exe`（prebuilt，默认）或 `start-tauri-dev.exe`（tauri dev）
- **壳来源**：`build/build-tauri-release.bat` 产出的 `target/release/app.exe`
  （该壳运行时 `server.js` 不在资源根，会自动**回退到 dev server**）
- **打包入口 exe**：`build/build-launcher.bat` / `build/build-launcher-dev.bat`
- **适用**：只改前端（`src/` TS/TSX）靠 HMR 即时生效；改 Rust 后用 dev 入口自动重载
- 详见 [`../docs/startup-hotreload.md`](../docs/startup-hotreload.md)

### B. 独立模式（standalone，不连 dev server）

- **入口 exe**：`start-tauri-standalone.exe`（双击即走独立模式）
- **壳来源**：`build/build-standalone.bat`（`pnpm tauri build --no-bundle`）产出的
  `target/release/app.exe` + 同级 `server.js` / `.next/static` / `binaries/node.exe`
  （运行时 `resource_dir` 根有 `server.js`，走内置 Node sidecar，**不依赖 dev server**）
- **打包入口 exe**：`build/build-launcher-standalone.bat`（仅打包 launcher，壳本身靠 `build/build-standalone.bat`）
- **适用**：需要「双击即独立运行、无需起 dev server」的分发场景
- ⚠️ 必须先跑 `build/build-standalone.bat` 才有独立壳；否则双击 `start-tauri-standalone.exe` 会提示先构建

### C. 资源清理（两类构建共用）

- `build/rebuild-static.bat`：删除并重建 `src-tauri/static`（standalone 资源来源）；
  当 `static` 被污染导致黑屏时，先跑它再重新构建壳

> 三个入口 exe 由**同一份** `scripts/start_tauri_launcher.py` 打包而来：PyInstaller 在
> `build/build-launcher-dev.bat` / `build/build-launcher-standalone.bat` 中通过 `LAUNCHER_NAME`
> 指定 exe 名；launcher 运行时再按 exe 文件名自动选择 prebuilt / tauri / standalone 模式。
> 因此改完 `start_tauri_launcher.py` 后，**三个入口都要重新打包**才生效。

## 重新打包 start-tauri.exe

### 前置条件

```powershell
pip install pyinstaller
```

### 执行

双击 `tools\build\build-launcher.bat`，或在项目根目录执行：

```powershell
pyinstaller --clean --noconfirm --distpath . --workpath build-launcher tools/start-tauri.spec
```

产物：`<项目根>\start-tauri\start-tauri.exe`（连同 `_internal\` 依赖目录）。

> `start-tauri.spec` 内部已按 `SPECPATH` 上溯到项目根计算源码绝对路径，手敲命令时不必
> 强制在项目根执行；但 `build/build-launcher.bat` 仍会自动 `cd /d "%~dp0..\.."` 再打包。

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

该路径缺失时提交任务会直接 `spawn ... ENOENT`，用户无从下手。因此启动器在启动时兜底：

- **已存在** → 只写一行日志，零额外开销；
- **缺失** → 以独立进程后台触发 `scripts/setup-comfy-cli-venv.ps1`：
  1. `python -m venv python-venv\comfy-cli`
  2. `python-venv\comfy-cli\Scripts\python.exe -m pip install --upgrade pip`
  3. `python-venv\comfy-cli\Scripts\python.exe -m pip install comfy-cli`

安装耗时数分钟，**不阻塞启动**；进程独立（`start_new_session=True`），launcher 在
Tauri 窗口出现后退出也不会中断安装。脚本幂等，已装好则直接返回。

排查产物：

| 路径 | 内容 |
|------|------|
| `log/comfy-cli-setup.log` | 安装过程日志 |
| `run/comfy-cli-setup.json` | 安装状态 `{ phase, message, done, error, updated_at }` |

手动触发一次（不必等启动）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-comfy-cli-venv.ps1
```

想跳过自动准备、改用已有环境，设置环境变量 `COMFY_CLI_PYTHON` 指向你的 Python 解释器。

### 两个启动入口对比：start-tauri.exe 与 start-tauri.vbs

两者最终都会拉起「Next.js dev server + Tauri 桌面包壳」，但走的 `dev-launcher.ps1`
分支不同，体验与适用场景也不同：

| 维度 | `start-tauri.exe`（Prebuilt） | `start-tauri.vbs`（Tauri） |
|------|-------------------------------|----------------------------|
| 实际执行 | `dev-launcher.ps1 -Prebuilt` | `dev-launcher.ps1 -Tauri` → `pnpm tauri dev` |
| 启动 Tauri 壳方式 | 直接运行**已编译**的 `target/release/app.exe` | `tauri dev` 现编译 Rust 壳（debug） |
| 窗口出现速度 | **秒出**（壳已编译好） | 慢，要等 Rust 编译（首次数分钟） |
| Rust 改动热重载 | ❌ 无（用预编译壳） | ✅ 改 Rust 自动重编译 |
| 前端 HMR | ✅ 有（next dev） | ✅ 有 |
| 自带启动画面 / 单实例 / comfy-cli 自动准备 | ✅ 由 Python launcher（`scripts/start_tauri_launcher.py`）负责 | ❌ 无（vbs 仅隐藏窗口调 pwsh） |
| 前提 | 需先 `cargo build --release`（否则回退 debug 壳更慢） | 无需预编译，首次自动编译 Rust |

- **`start-tauri.exe`（Prebuilt）= 日常使用 / 快速预览**：双击即用，窗口立刻弹出
  （显示 Tauri 内嵌 splash 加载页），后台并行起 dev server，就绪后自动跳转应用。
  适合只改前端（src/ 下的 TS/TSX，靠 HMR 生效）；改 Rust 壳后必须重新
  `cargo build --release` 才生效。
- **`start-tauri.vbs`（Tauri）= 开发桌面壳时用**：走 `pnpm tauri dev`，Rust 侧改完
  自动重载，适合调壳本身逻辑（如 `lib.rs`、窗口配置）。启动慢在编译 Rust，且绕过
  了 Python launcher 的额外逻辑（单实例 / comfy-cli 自动准备不在）。

> 窗口初始页（`splash.html`）通过 `tauri://localhost/splash.html` 加载，不依赖 dev
> server；它会主动轮询 `COMFYAPP_DEV_URL` 直到后端就绪再跳转，因此 dev server 未起
> 时显示「加载中」而非 Edge 错误页。

## 修改启动器后的注意事项

`start-tauri.exe` 是**打包产物**，改完 `scripts/start_tauri_launcher.py` 后必须重新执行
`tools\build\build-launcher.bat`，否则双击仍跑旧逻辑。

## 构建 release 版 Tauri 壳

`scripts/dev-launcher.ps1` 的 `-Prebuilt` 模式会**优先**使用
`src-tauri/target/release/app.exe`（启动更快），仅在它缺失时才回退到
`src-tauri/target/debug/app.exe`（debug 启动较慢）。因此发布前建议先构建 release 壳：

### 前置条件

- 已安装 Rust 工具链（`cargo` / `rustc`，推荐通过 https://rustup.rs/ 安装）；
- Windows 上需 Visual Studio Build Tools（含「使用 C++ 的桌面开发」工作负载），
  否则 `cargo build` 会因缺少 MSVC 链接器失败。

### 执行

双击 `tools\build\build-tauri-release.bat`，或在项目根目录执行：

```powershell
cd src-tauri
cargo build --release
```

产物：`<项目根>\src-tauri\target\release\app.exe`。

> 首次构建会拉取并编译全部 Rust 依赖，耗时通常 5–15 分钟；之后的增量构建较快。

### 两种运行模式（重要）

> **流程已统一（推荐）**：直接双击 `tools\build\build-tauri-release.bat` 或 `tools\build\build-all.bat`
> 即可，脚本会在 `cargo build --release` **之前自动同步前端资源**——`src-tauri/static`
> 缺失时跑完整 `build-desktop.mjs`（含 `pnpm build` + Node sidecar），已存在时仅增量
> 同步 `splash.html` / `dev-launcher.ps1` / `index.html`。**无需再手动 `cp`**。

裸 `cargo build --release`（手动在 `src-tauri` 目录敲命令）只编译 Rust 壳，**不会**
运行 `tauri.conf.json` 的 `beforeBuildCommand`（`node scripts/build-desktop.mjs`），
因此 `target/release/` 下没有 standalone 资源（`server.js` + Node sidecar）。运行时的处理：

- **缺 `server.js` 时**：release 壳会自动**回退到 dev URL 模式**——`dev-launcher.ps1`
  的 `-Prebuilt` 分支已经起了 Next dev server，壳只需加载 `COMFYAPP_DEV_URL`
  （`http://127.0.0.1:3000/workspace`）即可，不会因资源缺失而 panic 退窗。
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

需要「最快启动」的完整发布包时，直接双击 `tools\build\build-all.bat`：

1. 自动调用 `build/build-tauri-release.bat` 构建 release Tauri 壳（脚本内部已自动组装前端资源，无需手动 build-desktop）；
2. 完成后自动调用 `build/build-launcher.bat` 打包 `start-tauri.exe`；
3. 全部完成后在 `build/build-all.bat` 末尾暂停一次，方便确认结果。

```powershell
# 在项目根目录执行
tools\build\build-all.bat
```

两个脚本职责独立、前置工具链不同（Rust vs Python），**不合并为单文件**，
仅由 `build/build-all.bat` 做编排，便于单独重编其中一环。

> 单独双击 `build/build-tauri-release.bat` 或 `build/build-launcher.bat` 时，每个脚本仍会在
> 自身完成后暂停，方便查看日志；只有被 `build/build-all.bat` 调用时才会自动跳过子脚本
> 的 `pause`，实现真正一键无人值守。
