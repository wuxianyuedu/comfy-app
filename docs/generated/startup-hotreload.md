<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/startup-hotreload.md`。改动请回源文件，再重新生成。 -->

# 启动方式与热更新（HMR）详解

本文把「三种启动方式到底加载什么、改了代码能不能热更新、重建 `src-tauri/static` 对哪种方式有实质影响」一次说清楚。
配套构建说明见 [`../README.md`](../README.md) 与 [`tools/README.md`](../tools/README.md)。

> 阅读前提：窗口初始 URL 固定为 `splash.html`（`tauri.conf.json` 的 `windows[0].url`），该页在编译时随 `frontendDist` 嵌入二进制；应用主体则按启动方式不同，分别来自 dev server 或内嵌 standalone server。

---

## 1. 三种启动方式对照

| 启动方式 | 入口 | 模式 | 实际加载的内容 | 是否需要编译 Rust | 热更新能力 |
|----------|------|------|----------------|------------------|------------|
| **prebuilt（开发检出）** | 双击 `src-tauri\target\release\app.exe` | prebuilt | 秒出窗口；壳起 `node scripts/dev-launcher.mjs` → dev server（`pnpm dev`），自己按 `COMFYAPP_DEV_URL` 加载 | 否（壳已就绪；编排由壳自己承担） | 前端源码可 HMR；Rust/配置改动需重新 `cargo build --release --features custom-protocol` |
| **tauri dev** | 双击 `tools/start/start-tauri-dev.ps1` / `pnpm tauri dev` | tauri dev | `cargo` 重新编译 Rust 壳 + 起 dev server，前端/后端同源 | 是（增量编译，首次较慢） | 前端 **和** Rust 均热重载 |
| **standalone（分发副本）** | 同一个 `app.exe`（检出里没有编排器时） | standalone | `beforeBuildCommand` 组装 `src-tauri/static`（standalone `server.js` + `.next/static` + Node sidecar）；壳以 Node sidecar 运行内嵌 server，**不依赖 dev server** | 是（cargo release + 组装资源） | 全部不可热更新（除非重新构建发布包） |

> **形态由「检出内容」决定，不由 exe 名字决定**：壳看到
> `scripts/dev-launcher.mjs` 在 → `COMFYAPP_LAUNCH_MODE=prebuilt`（走
> `COMFYAPP_DEV_URL`）；不在 → `standalone`（要求 `server.js` 就位并跑内嵌 server）。
> 用户手里只有一个 `app.exe`，按文件名猜形态会把两种都判错（规范 §1.5）；
> 判据放在内容上，也就没有「同一份壳既可能 dev 又可能 standalone」的歧义。

---

## 2. 热更新能力矩阵（按代码/资源区域）

| 代码 / 资源 | prebuilt（开发检出：编排器在） | tauri dev | standalone（分发副本：编排器不在） |
|-------------|------------------------------|--------------------------------------|--------------------|
| **前端源码** `src/`（app / components / server / lib 等） | ✅ HMR（dev server 提供） | ✅ HMR + Rust 热重载 | ❌ 产物快照，不可变 |
| **启动页** `public/splash.html` | ❌ 已随 `frontendDist` 嵌入二进制；仅窗口初始屏显示，跳转后才是 dev 应用。改动需重编壳 | ❌ 同上（初始屏仍用嵌入副本） | ❌ 内嵌，需重打包才生效 |
| **`src-tauri/static` 内嵌产物**（`server.js` / `.next/static` / Node sidecar） | 不加载（回退 dev server） | dev server 不依赖这些产物 | ❌ 核心来源，必须重打包 |
| **Rust 代码** `src-tauri/src/*`（lib.rs / main.rs / build.rs） | ❌ 需 `cargo build --release` | ✅ 热重载 | ❌ 需重打包 |
| **Tauri 配置** `tauri.conf.json` / capabilities / permissions | ❌ 需 `cargo build` | ✅（部分变更触发壳重编） | ❌ 需重打包 |
| **Drizzle schema** `src/server/db/schema.ts` | 需 `pnpm db:push`（非 HMR，数据库独立；编排器每次启动也会后台同步） | 同左 | 同左（数据库独立于安装包） |
| **运行时配置** `.env` 等 | 通常需重启 dev server 才生效 | 同左 | 已固化，需重打包 |

**一句话**：`prebuilt` 与 `tauri dev` 是「源码驱动」（dev server + HMR）；`standalone 安装包` 是「产物驱动」（`static` 快照，不可变）。

---

## 3. 构建 `static` 对每种启动方式的影响

`tools\build\rebuild-static.ps1` → `scripts/build-desktop.mjs` 产出 `src-tauri/static`，内含：`server.js`、`server/*`、`node_modules`（裁剪）、`.next/static`、`public`、`splash.html`、`index.html`、以及 `binaries/node-<triple>.exe`。

| 启动方式 | 重建 `static` 的影响 |
|----------|----------------------|
| **prebuilt** | **影响有限**。prebuilt 不加载 `static` 里的 standalone 产物（回退 dev server），所以 `server.js` / `.next/static` 改了也没用。但 `splash.html` 副本会被 `tools\build\build-tauri-release.ps1` 增量同步、并在 `cargo build` 时嵌入二进制 ⇒ **改 `splash.html` 后若要 prebuilt 初始屏生效，必须重新 `cargo build --release`**。`src/` 前端源码改动完全不需要碰 `static`。 |
| **tauri dev** | **几乎无影响**。`tauri dev` 自身会跑 `beforeBuildCommand` 重新组装 `static` 并重编；且 dev server 提供的前端并不依赖 `static/.next/static`，因此 `static` 重建对开发体验无感。 |
| **standalone 安装包** | **决定性影响**。`static` 是 standalone 模式唯一的前端来源。任何前端改动要进安装包，必须重新跑 `build-desktop.mjs`（含 `pnpm build` 生成最新 `.next/static` / `server.js`）并重新 `pnpm tauri build`。 |

> 结论：日常开发用 `prebuilt` / `tauri dev`，前端改动即时生效，无需重建 `static`；只有当要产出「不依赖 dev server 的独立程序」时，`static` 才必须是最新的。若 `static` 缺失/被污染导致黑屏，先 `tools\build\rebuild-static.ps1` 再重新构建。

---

## 4. 改动后操作速查

| 我改了… | 想让 prebuilt 生效 | 想让 tauri dev 生效 | 想让安装包生效 |
|---------|--------------------|----------------------|----------------|
| 前端源码 `src/` | 无需操作（自动 HMR） | 无需操作（自动 HMR） | `pnpm tauri build` |
| `public/splash.html` | `tools\build\build-tauri-release.ps1`（重编壳，嵌入新 splash） | `tools\build\build-tauri-release.ps1` | `pnpm tauri build` |
| Rust / `tauri.conf.json` | `tools\build\build-tauri-release.ps1` | 自动热重载 | `pnpm tauri build` |
| `src-tauri/static` 内嵌产物 | （prebuilt 不加载，无需） | （dev 自动重组，无需） | `pnpm tauri build` |
| `static` 被污染 / 黑屏 | `tools\build\rebuild-static.ps1` → `tools\build\build-tauri-release.ps1` | `tools\build\rebuild-static.ps1` → `pnpm tauri dev` | `tools\build\rebuild-static.ps1` → `pnpm tauri build` |

---

## 5. 只有一个 exe：壳 `app.exe`（ISSUE #784 第二轮）

原痛点：`--tauri-dev` 带参数在「双击 / 发给他人」场景不便；dev 入口原本只有 `.vbs`
（2026-09-04 起该入口改为 `tools/start/start-tauri-dev.ps1`，双击关联见
`scripts\enable-ps1-double-click.ps1`）。

**曾经**的形态是「一份 Python launcher 源码打包出三个独立 exe」（prebuilt / dev /
standalone），双击即用、无需记参数。**现在这三个 exe 都已删除** —— 它们带来的是
「任务栏两个图标」「关掉窗口不等于启动器退出」「产物目录被它锁住」这一整类问题，
而收益只是省掉一个参数。取而代之的是**壳自己承担编排**（`src-tauri/src/shell_launch.rs`）：

| 启动方式 | 入口 | 怎么进 | 双击即用 |
|----------|------|--------|----------|
| prebuilt（开发检出） | `src-tauri\target\release\app.exe` | 壳发现检出里有 `scripts/dev-launcher.mjs` → 起编排器 → dev server | ✅ |
| standalone（分发副本） | 同上（同一个文件） | 壳发现检出里**没有**编排器 → 走内嵌 Node sidecar 的 Next standalone server | ✅ |
| tauri dev（改 Rust 时） | `tools\start\start-tauri-dev.ps1` | `pnpm tauri dev`（dev server 由 `beforeDevCommand` 起着） | ✅ |

实现要点：
- 形态判据是**检出内容**（`orchestrator_script` 在不在），不是 exe 文件名 ——
  用户手里只有 `app.exe` 一个文件，拿它去猜形态会把两种形态都判错（规范 §1.5）。
- standalone 资源（`server.js` / Node sidecar）缺失时壳会报错并保持启动页可见，
  不再静默黑屏；组装资源用 `tools\build\build-standalone.ps1`。
- 改完 `src-tauri/src/shell_launch.rs` / `lib.rs` 后**必须重编壳**
  （`cargo build --release --features custom-protocol`）才生效。

`tools\` 目录按用途归类（dev 构建 vs standalone 构建）见 [`../tools/README.md`](../tools/README.md)。

---

## 6. 运行期「本地更新需重启」检测

`app.exe`（prebuilt）开着、且 dev server 在跑时，前端源码 `src/` 的改动由
dev server HMR 自动生效，无需打扰；但上表第 2 列那批「**改完当前窗口不生效、得重启**」
的文件不会热更。为让用户第一时间知道「本地更新了但当前界面是旧的」，前端在运行期
轮询 `/api/update-check`：

| 检测分组 | 覆盖文件 | 需用户动作 |
|---|---|---|
| 重编壳（`recompile`） | `src-tauri/**`、`tauri.conf.json`、`public/splash.html` | `tools\build\build-tauri-release.ps1` 重编壳后重启 |
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

### 6.1 与「界面比代码旧」的分工（别混成一条）

上面的检测只覆盖**改完当前窗口不生效、需要重启**的那批文件。`src/` 下的前端源码
不在其中——它由 HMR 处理。但 HMR 有一条边界：**已经打开的界面不会因为代码变了就
重建自己**，于是「应用长开 + 期间拉到新代码」时，页面里仍可能是旧代码造出来的
对象，用到新加的能力就会报 `xxx is not a function`（严重时整块画布白屏）。

这件事由另一条链路观测与提示（构建标识轮询 + 应用内通知），**不要**并入本节的检测：
把 `src/` 加进来会让它开始对每次前端改动都报「需重启」，而绝大多数改动根本不需要。
机制与判据见
[`standards/launch-and-build.md` §4.3](standards/launch-and-build.md#43-陈旧实例运行图落后于源码时的可观测性issue-389)，
用户侧处置见 [`guide-stale-code.md`](guide-stale-code.md)。
