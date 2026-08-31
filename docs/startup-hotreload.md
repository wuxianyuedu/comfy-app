# 启动方式与热更新（HMR）详解

本文把「三种启动方式到底加载什么、改了代码能不能热更新、重建 `src-tauri/static` 对哪种方式有实质影响」一次说清楚。
配套构建说明见 [`../README.md`](../README.md) 与 [`tools/README.md`](../tools/README.md)。

> 阅读前提：窗口初始 URL 固定为 `splash.html`（`tauri.conf.json` 的 `windows[0].url`），该页在编译时随 `frontendDist` 嵌入二进制；应用主体则按启动方式不同，分别来自 dev server 或内嵌 standalone server。

---

## 1. 三种启动方式对照

| 启动方式 | 入口 | 模式 | 实际加载的内容 | 是否需要编译 Rust | 热更新能力 |
|----------|------|------|----------------|------------------|------------|
| **prebuilt（默认）** | 双击 `start-tauri.exe` | prebuilt | 已编译的 `target/release/app.exe` 秒出窗口；壳检测不到 standalone `server.js`（直接运行时 `resource_dir()=src-tauri`，`server.js` 在 `static` 子目录）⇒ 回退加载 `COMFYAPP_DEV_URL`（dev server，默认 `http://localhost:3000/workspace`） | 否（壳已就绪；`start-tauri.exe` 会自动起 dev server） | 前端源码可 HMR；Rust/配置改动需重新 `cargo build --release` |
| **tauri dev** | 双击 `start-tauri-dev.exe` / `start-tauri.exe --tauri-dev` / `start-tauri.vbs` / `pnpm tauri dev` | tauri dev | `cargo` 重新编译 Rust 壳 + 起 dev server，前端/后端同源 | 是（增量编译，首次较慢） | 前端 **和** Rust 均热重载 |
| **standalone 安装包** | `pnpm tauri build` 产出的安装包 | standalone | `beforeBuildCommand` 组装 `src-tauri/static`（standalone `server.js` + `.next/static` + Node sidecar）；打包后 `resource_dir()=resources` 根、`server.js` 在根 ⇒ 壳以 Node sidecar 运行内嵌 server，**不依赖 dev server** | 是（cargo release + 打包） | 全部不可热更新（除非重新构建发布包） |

> **为什么 prebuilt 默认连 dev server 而不是独立运行**：直接运行 `target/release/app.exe` 时 `resource_dir()` 指向 `src-tauri`，而 `server.js` 在 `src-tauri/static` 子目录，壳检测不到根目录的 `server.js`，便回退到 dev URL。只有 `pnpm tauri build` 打包安装后 `resource_dir()` 指向 resources 根、`server.js` 在根，才会走真正独立的 standalone 模式（`src-tauri/src/lib.rs` 的 `spawn_sidecar` 逻辑）。

---

## 2. 热更新能力矩阵（按代码/资源区域）

| 代码 / 资源 | prebuilt（`start-tauri.exe`） | tauri dev（`start-tauri-dev.exe`） | standalone（`start-tauri-standalone.exe`） |
|-------------|------------------------------|--------------------------------------|--------------------|
| **前端源码** `src/`（app / components / server / lib 等） | ✅ HMR（dev server 提供） | ✅ HMR + Rust 热重载 | ❌ 产物快照，不可变 |
| **启动页** `public/splash.html` | ❌ 已随 `frontendDist` 嵌入二进制；仅窗口初始屏显示，跳转后才是 dev 应用。改动需重编壳 | ❌ 同上（初始屏仍用嵌入副本） | ❌ 内嵌，需重打包才生效 |
| **`src-tauri/static` 内嵌产物**（`server.js` / `.next/static` / Node sidecar） | 不加载（回退 dev server） | dev server 不依赖这些产物 | ❌ 核心来源，必须重打包 |
| **Rust 代码** `src-tauri/src/*`（lib.rs / main.rs / build.rs） | ❌ 需 `cargo build --release` | ✅ 热重载 | ❌ 需重打包 |
| **Tauri 配置** `tauri.conf.json` / capabilities / permissions | ❌ 需 `cargo build` | ✅（部分变更触发壳重编） | ❌ 需重打包 |
| **Prisma schema** `prisma/schema.prisma` | 需 `pnpm db:push`（非 HMR，数据库独立） | 同左 | 同左（数据库独立于安装包） |
| **运行时配置** `.env` 等 | 通常需重启 dev server 才生效 | 同左 | 已固化，需重打包 |

**一句话**：`prebuilt` 与 `tauri dev` 是「源码驱动」（dev server + HMR）；`standalone 安装包` 是「产物驱动」（`static` 快照，不可变）。

---

## 3. 构建 `static` 对每种启动方式的影响

`tools\rebuild-static.bat` → `scripts/build-desktop.mjs` 产出 `src-tauri/static`，内含：`server.js`、`server/*`、`node_modules`（裁剪）、`.next/static`、`public`、`splash.html`、`index.html`、以及 `binaries/node-<triple>.exe`。

| 启动方式 | 重建 `static` 的影响 |
|----------|----------------------|
| **prebuilt** | **影响有限**。prebuilt 不加载 `static` 里的 standalone 产物（回退 dev server），所以 `server.js` / `.next/static` 改了也没用。但 `splash.html` 副本会被 `build-tauri-release.bat` 增量同步、并在 `cargo build` 时嵌入二进制 ⇒ **改 `splash.html` 后若要 prebuilt 初始屏生效，必须重新 `cargo build --release`**。`src/` 前端源码改动完全不需要碰 `static`。 |
| **tauri dev** | **几乎无影响**。`tauri dev` 自身会跑 `beforeBuildCommand` 重新组装 `static` 并重编；且 dev server 提供的前端并不依赖 `static/.next/static`，因此 `static` 重建对开发体验无感。 |
| **standalone 安装包** | **决定性影响**。`static` 是 standalone 模式唯一的前端来源。任何前端改动要进安装包，必须重新跑 `build-desktop.mjs`（含 `pnpm build` 生成最新 `.next/static` / `server.js`）并重新 `pnpm tauri build`。 |

> 结论：日常开发用 `prebuilt` / `tauri dev`，前端改动即时生效，无需重建 `static`；只有当要产出「不依赖 dev server 的独立程序」时，`static` 才必须是最新的。若 `static` 缺失/被污染导致黑屏，先 `tools\rebuild-static.bat` 再重新构建。

---

## 4. 改动后操作速查

| 我改了… | 想让 prebuilt 生效 | 想让 tauri dev 生效 | 想让安装包生效 |
|---------|--------------------|----------------------|----------------|
| 前端源码 `src/` | 无需操作（自动 HMR） | 无需操作（自动 HMR） | `pnpm tauri build` |
| `public/splash.html` | `tools\build-tauri-release.bat`（重编壳，嵌入新 splash） | `tools\build-tauri-release.bat` | `pnpm tauri build` |
| Rust / `tauri.conf.json` | `tools\build-tauri-release.bat` | 自动热重载 | `pnpm tauri build` |
| `src-tauri/static` 内嵌产物 | （prebuilt 不加载，无需） | （dev 自动重组，无需） | `pnpm tauri build` |
| `static` 被污染 / 黑屏 | `tools\rebuild-static.bat` → `tools\build-tauri-release.bat` | `tools\rebuild-static.bat` → `pnpm tauri dev` | `tools\rebuild-static.bat` → `pnpm tauri build` |

---

## 5. 三种启动方式各有一个独立 exe（已实现）

原痛点：`--tauri-dev` 带参数在「双击 / 发给他人」场景不便；dev 入口原本只有 `.vbs`。
现已实现**一份 launcher 源码打包出三个独立 exe**，双击即用、无需记参数：

| 启动方式 | 独立 exe 入口 | 打包脚本 | 双击即用 |
|----------|--------------|----------|----------|
| prebuilt | `start-tauri.exe` | `tools\build-launcher.bat` | ✅ |
| tauri dev | `start-tauri-dev.exe` | `tools\build-launcher-dev.bat` | ✅ |
| standalone | `start-tauri-standalone.exe` | `tools\build-launcher-standalone.bat`（壳本身需先 `tools\build-standalone.bat`） | ✅ |

实现要点：
- `scripts/start_tauri_launcher.py` 在运行时按 **exe 文件名**自动选模式
  （`start-tauri-dev.exe` → tauri dev，`start-tauri-standalone.exe` → standalone，否则 prebuilt）；
  也可用参数 `--tauri-dev` / `--standalone` 显式覆盖。
- `tools\start-tauri.spec` 的入口名由环境变量 `LAUNCHER_NAME` 决定，
  三个 `build-launcher*.bat` 各自注入不同 `LAUNCHER_NAME`，复用同一份 spec。
- standalone 入口不依赖 `dev-launcher.ps1`，直接 spawn 已构建的
  `src-tauri/target/release/app.exe`；若 standalone 资源（server.js / node sidecar）缺失会
  明确报错提示先跑 `tools\build-standalone.bat`，避免黑屏。

> ⚠️ 改完 `scripts/start_tauri_launcher.py` 后，三个入口都要重新打包（dev / standalone / 默认）
> 才生效——它们共享同一份源码。

`tools\` 目录按用途归类（dev 构建 vs standalone 构建）见 [`../tools/README.md`](../tools/README.md)。
