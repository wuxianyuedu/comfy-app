# 启动方式与热更新（HMR）详解

本文把「三种启动方式到底加载什么、改了代码能不能热更新、重建 `src-tauri/static` 对哪种方式有实质影响」一次说清楚。
配套构建说明见 [`../README.md`](../README.md) 与 [`tools/README.md`](../tools/README.md)。

> 阅读前提：窗口初始 URL 固定为 `{{shell.splash}}`（`tauri.conf.json` 的 `windows[0].url`），该页在编译时随 `frontendDist` 嵌入二进制；应用主体则按启动方式不同，分别来自 dev server 或内嵌 standalone server。

---

> **占位符约定**：本文中 `{{...}}` 形式的占位符代表文档引用的真实值（如可执行文件名、地址），
> 真实值由 `pnpm doc:check` 运行时从源码/配置动态提取并核对。占位符语义见
> [`docs/reference-facts.md`](reference-facts.md)。改动上游源码后可运行
> `pnpm doc:check` 检查本文是否有值未同步。


## 1. 三种启动方式对照

| 启动方式 | 入口 | 模式 | 实际加载的内容 | 是否需要编译 Rust | 热更新能力 |
|----------|------|------|----------------|------------------|------------|
| **prebuilt（默认）** | 双击 `{{shell.exe.prebuilt}}` | **dev（开发态，固定）** | 秒出窗口并连 dev server（`dev-launcher.ps1` 起 `pnpm dev`）。launcher 通过 `COMFYAPP_LAUNCH_MODE=prebuilt` 显式告知 Rust 壳走 `COMFYAPP_DEV_URL`，**不再依赖 `resource_dir()` 探测**——`{{shell.exe.prebuilt}}` 恒为开发态，与是否跑过 `pnpm tauri build` 无关 | 否（壳已就绪；`{{shell.exe.prebuilt}}` 自动起 dev server） | 前端源码可 HMR；Rust/配置改动需重新 `cargo build --release --features custom-protocol` |
| **tauri dev** | 双击 `{{shell.exe.dev}}` / `{{shell.exe.prebuilt}} --tauri-dev` / `tools/start/start-tauri.ps1` / `pnpm tauri dev` | tauri dev | `cargo` 重新编译 Rust 壳 + 起 dev server，前端/后端同源 | 是（增量编译，首次较慢） | 前端 **和** Rust 均热重载 |
| **standalone 安装包** | `pnpm tauri build` 产出的安装包 | standalone | `beforeBuildCommand` 组装 `src-tauri/static`（standalone `server.js` + `.next/static` + Node sidecar）；打包后 `resource_dir()=resources` 根、`server.js` 在根 ⇒ 壳以 Node sidecar 运行内嵌 server，**不依赖 dev server** | 是（cargo release + 打包） | 全部不可热更新（除非重新构建发布包） |

> **为什么 `{{shell.exe.prebuilt}}` 永远是 dev、不会变成 standalone**：launcher 在启动时就写入 `COMFYAPP_LAUNCH_MODE=prebuilt` 环境变量，Rust 壳据此**跳过** `spawn_sidecar`、直接加载 `COMFYAPP_DEV_URL`（dev server）；只有显式 `COMFYAPP_LAUNCH_MODE=standalone`（即双击 `{{shell.exe.standalone}}`）才要求 `server.js` 就位并跑内嵌 server。因此 dev/standalone 由你双击的 exe **显式决定**，与是否跑过 `pnpm tauri build` 无关——解决了「同一份壳既可能 dev 又可能 standalone」的歧义。

---

## 2. 热更新能力矩阵（按代码/资源区域）

| 代码 / 资源 | prebuilt（`{{shell.exe.prebuilt}}`） | tauri dev（`{{shell.exe.dev}}`） | standalone（`{{shell.exe.standalone}}`） |
|-------------|------------------------------|--------------------------------------|--------------------|
| **前端源码** `src/`（app / components / server / lib 等） | ✅ HMR（dev server 提供） | ✅ HMR + Rust 热重载 | ❌ 产物快照，不可变 |
| **启动页** `public/{{shell.splash}}` | ❌ 已随 `frontendDist` 嵌入二进制；仅窗口初始屏显示，跳转后才是 dev 应用。改动需重编壳 | ❌ 同上（初始屏仍用嵌入副本） | ❌ 内嵌，需重打包才生效 |
| **`src-tauri/static` 内嵌产物**（`server.js` / `.next/static` / Node sidecar） | 不加载（回退 dev server） | dev server 不依赖这些产物 | ❌ 核心来源，必须重打包 |
| **Rust 代码** `src-tauri/src/*`（lib.rs / main.rs / build.rs） | ❌ 需 `cargo build --release` | ✅ 热重载 | ❌ 需重打包 |
| **Tauri 配置** `tauri.conf.json` / capabilities / permissions | ❌ 需 `cargo build` | ✅（部分变更触发壳重编） | ❌ 需重打包 |
| **Drizzle schema** `src/server/db/schema.ts` | 需 `pnpm db:push`（非 HMR，数据库独立；启动器每次启动也会自动 push） | 同左 | 同左（数据库独立于安装包） |
| **运行时配置** `.env` 等 | 通常需重启 dev server 才生效 | 同左 | 已固化，需重打包 |

**一句话**：`prebuilt` 与 `tauri dev` 是「源码驱动」（dev server + HMR）；`standalone 安装包` 是「产物驱动」（`static` 快照，不可变）。

---

## 3. 构建 `static` 对每种启动方式的影响

`tools\build\rebuild-static.ps1` → `scripts/build-desktop.mjs` 产出 `src-tauri/static`，内含：`server.js`、`server/*`、`node_modules`（裁剪）、`.next/static`、`public`、`{{shell.splash}}`、`index.html`、以及 `binaries/node-<triple>.exe`。

| 启动方式 | 重建 `static` 的影响 |
|----------|----------------------|
| **prebuilt** | **影响有限**。prebuilt 不加载 `static` 里的 standalone 产物（回退 dev server），所以 `server.js` / `.next/static` 改了也没用。但 `{{shell.splash}}` 副本会被 `tools\build\build-tauri-release.ps1` 增量同步、并在 `cargo build` 时嵌入二进制 ⇒ **改 `{{shell.splash}}` 后若要 prebuilt 初始屏生效，必须重新 `cargo build --release`**。`src/` 前端源码改动完全不需要碰 `static`。 |
| **tauri dev** | **几乎无影响**。`tauri dev` 自身会跑 `beforeBuildCommand` 重新组装 `static` 并重编；且 dev server 提供的前端并不依赖 `static/.next/static`，因此 `static` 重建对开发体验无感。 |
| **standalone 安装包** | **决定性影响**。`static` 是 standalone 模式唯一的前端来源。任何前端改动要进安装包，必须重新跑 `build-desktop.mjs`（含 `pnpm build` 生成最新 `.next/static` / `server.js`）并重新 `pnpm tauri build`。 |

> 结论：日常开发用 `prebuilt` / `tauri dev`，前端改动即时生效，无需重建 `static`；只有当要产出「不依赖 dev server 的独立程序」时，`static` 才必须是最新的。若 `static` 缺失/被污染导致黑屏，先 `tools\build\rebuild-static.ps1` 再重新构建。

---

## 4. 改动后操作速查

| 我改了… | 想让 prebuilt 生效 | 想让 tauri dev 生效 | 想让安装包生效 |
|---------|--------------------|----------------------|----------------|
| 前端源码 `src/` | 无需操作（自动 HMR） | 无需操作（自动 HMR） | `pnpm tauri build` |
| `public/{{shell.splash}}` | `tools\build\build-tauri-release.ps1`（重编壳，嵌入新 splash） | `tools\build\build-tauri-release.ps1` | `pnpm tauri build` |
| Rust / `tauri.conf.json` | `tools\build\build-tauri-release.ps1` | 自动热重载 | `pnpm tauri build` |
| `src-tauri/static` 内嵌产物 | （prebuilt 不加载，无需） | （dev 自动重组，无需） | `pnpm tauri build` |
| `static` 被污染 / 黑屏 | `tools\build\rebuild-static.ps1` → `tools\build\build-tauri-release.ps1` | `tools\build\rebuild-static.ps1` → `pnpm tauri dev` | `tools\build\rebuild-static.ps1` → `pnpm tauri build` |

---

## 5. 三种启动方式各有一个独立 exe（已实现）

原痛点：`--tauri-dev` 带参数在「双击 / 发给他人」场景不便；dev 入口原本只有 `.vbs`
（2026-09-04 起该入口改为 `tools/start/start-tauri.ps1`，双击关联见 `scripts\enable-ps1-double-click.ps1`）。
现已实现**一份 launcher 源码打包出三个独立 exe**，双击即用、无需记参数：

| 启动方式 | 独立 exe 入口 | 打包脚本 | 双击即用 |
|----------|--------------|----------|----------|
| prebuilt | `{{shell.exe.prebuilt}}` | `tools\build\build-launcher.ps1` | ✅ |
| tauri dev | `{{shell.exe.dev}}` | `tools\build\build-launcher-dev.ps1` | ✅ |
| standalone | `{{shell.exe.standalone}}` | `tools\build\build-launcher-standalone.ps1`（壳本身需先 `tools\build\build-standalone.ps1`） | ✅ |

实现要点：
- `scripts/start_tauri_launcher.py` 在运行时按 **exe 文件名**自动选模式
  （`{{shell.exe.dev}}` → tauri dev，`{{shell.exe.standalone}}` → standalone，否则 prebuilt）；
  也可用参数 `--tauri-dev` / `--standalone` 显式覆盖。
- `tools\start-tauri.spec` 的入口名由环境变量 `LAUNCHER_NAME` 决定，
  三个 `build-launcher*.ps1` 各自注入不同 `LAUNCHER_NAME`，复用同一份 spec。
- standalone 入口不依赖 `dev-launcher.ps1`，直接 spawn 已构建的
  `src-tauri/target/release/{{shell.app.exe}}`；若 standalone 资源（server.js / node sidecar）缺失会
  明确报错提示先跑 `tools\build\build-standalone.ps1`，避免黑屏。

> ⚠️ 改完 `scripts/start_tauri_launcher.py` 后，三个入口都要重新打包（dev / standalone / 默认）
> 才生效——它们共享同一份源码。

`tools\` 目录按用途归类（dev 构建 vs standalone 构建）见 [`../tools/README.md`](../tools/README.md)。

---

## 6. 运行期「本地更新需重启」检测

`{{shell.exe.prebuilt}}`（prebuilt）开着、且 dev server 在跑时，前端源码 `src/` 的改动由
dev server HMR 自动生效，无需打扰；但上表第 2 列那批「**改完当前窗口不生效、得重启**」
的文件不会热更。为让用户第一时间知道「本地更新了但当前界面是旧的」，前端在运行期
轮询 `/api/update-check`：

| 检测分组 | 覆盖文件 | 需用户动作 |
|---|---|---|
| 重编壳（`recompile`） | `src-tauri/**`、`tauri.conf.json`、`public/{{shell.splash}}` | `tools\build\build-tauri-release.ps1` 重编壳后重启 |
| 重启应用（`restart`） | `.env`、`pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml` | 重启应用 / dev server |

机制与范围：
- **基线**：`/api/update-check` 首次被请求时把上述文件扫描成模块级基线（近似 dev
  server 启动时刻），之后每次 GET 与当前状态比对，回报「哪一组、具体哪些文件」在
  运行期被改过。dev server 重启后基线自然重置，重启后不再误报。
- **触发**：运行时轮询（默认开启，可关）+ 快捷键 `Ctrl+Shift+U` 手动检测一次。
- **形态**：应用内 toast（走项目 `ToastProvider`），安静、不抢焦点，不做系统级弹窗。
- **开关**：设置页「外观主题 → 本地更新检测」卡片，纯前端偏好，存 `localStorage`。
- **实现**：后端路由 `src/app/api/update-check/route.ts`；前端网络收口
  `src/lib/update-check-client.ts`；控制器
  `src/components/update-check/hooks/use-update-check.ts`；挂载
  `src/components/update-check/UpdateCheckProvider.tsx`（根布局挂一次）。
- 递归扫描 `src-tauri` 时跳过 `target` / `node_modules` / `.next`，重编壳产生的产物
  不会误触发。
