# Comfy APP (T3)

基于 **T3 Stack + Tauri v2** 的桌面应用：用 Next.js 16（App Router）编写前端与业务逻辑，
再用 Rust 编写的 Tauri v2 壳将其打包为 Windows 原生桌面程序。前端既可在浏览器中开发调试，
也可由桌面壳以「独立进程」方式承载（内置 Node sidecar 运行 Next standalone server，或连接本地 dev server）。

> 仓库前缀 `Comfy-APP-T3` 中的 T3 仅表示初始脚手架来源（create-t3-app），技术栈见下文。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Next.js 16（App Router, React 19, TypeScript） |
| 样式 | Tailwind CSS v4（`@tailwindcss/postcss`） |
| API | tRPC v11 + TanStack React Query |
| 鉴权 | better-auth |
| 数据库 | Drizzle ORM + better-sqlite3（SQLite；schema 见 `src/server/db/schema.ts`） |
| 状态管理 | Zustand |
| 桌面壳 | Tauri v2（Rust）+ WebView2 |
| 测试 | Vitest（单元/组件）、Playwright（e2e） |
| 文档 | TypeDoc（输出至 `docs/`） |

---

## 目录结构

```text
Comfy-APP-T3/
├─ src/                     # Next.js 应用（App Router 前端 + tRPC/server）
│  ├─ app/                  # 路由与页面
│  ├─ components/           # React 组件
│  ├─ server/               # 服务端逻辑（tRPC、auth、db）
│  ├─ lib/                  # 工具与客户端
│  └─ ...
├─ src-tauri/               # Tauri v2 Rust 桌面壳
│  ├─ src/lib.rs            # 窗口/命令/sidecar 进程管理
│  ├─ src/main.rs           # 入口
│  ├─ build.rs              # 编译时把 frontendDist 嵌入二进制
│  ├─ tauri.conf.json       # Tauri 配置（窗口、CSP、beforeBuildCommand）
│  ├─ Cargo.toml            # Rust 依赖
│  ├─ icons/                # 应用图标
│  └─ binaries/             # Node 运行时 sidecar（Windows: node-<triple>.exe；其它: node-<triple>）
├─ scripts/                 # 启动与构建脚本（被壳/工具调用）
│  ├─ dev-launcher.mjs      # 启动编排（全平台同一份：预检 / 端口 / 拉起 / 回收）
│  ├─ dev-launcher.ps1      # Windows 调用入口（只负责转交给上面那份）
│  ├─ launcher-core/        # 编排的平台机制层（进程与端口探测 / 进程组 / 日志）
│  ├─ entry-common.ps1      # 双击入口公共库（定位项目根 / 解析 pwsh / 透传退出码）
│  ├─ build-desktop.mjs     # 组装 src-tauri/static（standalone + splash + sidecar）
│  └─ install-comfyapp-helper.ps1  # 注册 comfyapp:// 协议
├─ tools/                   # 双击入口与构建编排（Windows .ps1，按用途分目录）
│  ├─ start/                # 启动与初始化入口（双击用）
│  │  ├─ start-web.ps1            # 控制台模式启动 Web 开发（可见日志）
│  │  ├─ start-tauri.ps1          # 双击即启动桌面壳（直启 src-tauri\target\release\app.exe）
│  │  ├─ start-tauri-dev.ps1        # 隐藏窗口启动 Tauri 壳（dev / tauri dev，Rust 热重载）
│  │  ├─ start-desktop.ps1        # 桌面版一键自检 + 启动（给拿到桌面包的人）
│  │  ├─ run-local.ps1            # 非开发人员一键初始化（自检/生成 .env/装依赖）
│  │  ├─ verify-quality.ps1       # 一键质量门禁（typecheck / lint / vitest）
│  │  ├─ run-tests.ps1            # 只跑 vitest（可指定文件 / -Full / 透传参数）
│  │  ├─ sync-lint.ps1           # 同步依赖 + pnpm lint（拉取更新/改码后日常自检）
│  │  └─ register-comfyapp-protocol.ps1  # 注册 comfyapp:// 协议（免管理员）
│  ├─ build/                # 构建打包入口
│  │  ├─ build-all.ps1            # 一键发布构建（release 壳 = 唯一入口 app.exe）
│  │  ├─ build-tauri-release.ps1  # 仅构建 release 版 Tauri 壳
│  │  └─ rebuild-static.ps1       # 清理并重建 src-tauri/static
│  ├─ registry/             # 团队 shadcn Registry（start-registry.ps1）
│  ├─ studio/               # 数据库工具（start-studio.ps1）
│  ├─ scripts/              # 上述入口对应的逻辑脚本（与入口同名不同层）
│  └─ README.md             # 入口/逻辑对照与各脚本的详细说明
├─ public/                  # 静态资源（含 splash.html 启动加载页、favicon.ico）
├─ docs/                    # API 文档（TypeDoc 生成，HTML）
├─ e2e/                     # Playwright e2e 测试
├─ tests/                   # Vitest 单元/组件测试
├─ .workbuddy/              # 本地临时目录（不入库）
└─ ... 根目录配置文件（见下）
```

---

## 根目录文件用途

| 文件 | 用途 |
|------|------|
| `package.json` | 前端依赖与脚本（`dev` / `build` / `tauri` / `test` 等） |
| `next.config.js` | Next.js 配置，含 `output: 'standalone'`（供桌面壳打包）与产物排除清单 |
| `scripts/standalone-private-inputs.mjs` | 从产物里剥掉开发机私有输入（`.env` / `db.sqlite*`），由 `pnpm build` 与 `build-desktop.mjs` 共用 |
| `tsconfig.json` | TypeScript 配置 |
| `eslint.config.js` `prettier.config.js` | 代码检查与格式化 |
| `postcss.config.js` | Tailwind CSS v4 接入 |
| `vitest.config.ts` `playwright.config.ts` | 测试配置 |
| `typedoc.json` | API 文档生成配置 |
| `public/splash.html` | 桌面壳启动加载页（编译时嵌入，由 Tauri 窗口初始显示） |
| `CHANGELOG.md` | 变更日志（**不要直接改**：条目先进 `changelog.d/` 碎片，见 [规范 §13.10.5](docs/standards/13-提交与-code-review.md#13105-碎片化落地改-changelogd不改-changelogmd)） |
| `changelog.d/` | 变更日志碎片：一件变更一个文件，避免并行分支在 `CHANGELOG.md` 上冲突 |

> **双击入口都在 `tools/` 下**（启动类 `tools/start/`、构建类 `tools/build/`），
> 根目录只保留工程配置与文档，见下方「双击入口速查」与 `tools/README.md`。

> **打包前务必确认仓库根没有要随包走的私有输入**：`next build` 会把 `.env` 与
> `db.sqlite` 复制进 `.next/standalone`，进而被内嵌进桌面包（密钥明文分发 +
> 开发者本机数据库变成出厂库）。现在 `pnpm build` 会自动剥离这两类文件
> （`scripts/standalone-private-inputs.mjs`），并有产物层护栏
> `node scripts/check-standalone-contents.cjs` 兜底；**不要**为了省事把 `.env`
> 写进 `outputFileTracingExcludes` 就以为解决了——实测对 `.env` 无效，见
> [规范 §7.3](docs/standards/launch-and-build.md)。

> `tools/start/start-tauri.ps1` 直接启动 `src-tauri\target\release\app.exe` —— **它就是唯一入口**：
> 编排（起 dev server / 端口 / 缓存 / 回收）由壳自己承担（规范 §1.5）。
> dev/tauri dev 模式（Rust 热重载）的入口是 `tools/start/start-tauri-dev.ps1`。

---

## 环境要求

仅开发前端（Windows / Linux / macOS 均可）：

- **Node.js** ≥ 22 与 **pnpm** 10（`corepack enable` 或直接安装 pnpm）
- 其他都不用装：`pnpm dev` 是一条纯 Node 链路，**不依赖 PowerShell / Rust /
  WebView2**。Linux / macOS 上按下方「快速上手」跑起来即可（详见
  [规范 §9 跨平台模式](docs/standards/launch-and-build.md)）。

要打包/运行**桌面壳**时另需（三平台通用）：

- **Rust 工具链**（cargo / rustc）：用于编译桌面壳，见 https://rustup.rs/
- **WebView2 运行时**：Windows 10/11 通常已内置；Linux 用系统 WebKitGTK
  （Debian/Ubuntu：`libwebkit2gtk-4.1-dev` / `libgtk-3-dev` / `pkg-config`，
  Fedora：`webkit2gtk4.1-devel`），macOS 用系统 WKWebView
- （可选）**Python**：仅 comfy-cli venv（`scripts/setup-comfy-cli-venv.ps1`）用到
  （Windows Job Object 已由壳内联 Rust 实现，不再依赖 Python）

启动编排**只有一份实现**：`scripts/dev-launcher.mjs`（Windows 也走它）。
双击入口就是壳本身（`src-tauri\target\release\app.exe`），平台差异如下
（规范 §3.2 / §3.3）：

| 平台 | 入口 | 平台机制（回收 / 探测） |
|---|---|---|
| Windows | `app.exe`（双击）、`tools/start/*.ps1` | `taskkill /PID <pid> /T /F`（收在 `src/lib/process/kill-process-tree.ts`） |
| Linux / macOS | `pnpm dev`、`node scripts/dev-launcher.mjs` | POSIX 进程组（`detached` 建组 + 整组信号） |

平台判据只有两处出处（`scripts/launcher-core/**` 与 `kill-process-tree`）：入口与
编排都不再自己摸 `process.platform`，因此没有「改一侧忘了另一侧」这件事。

灰度能力：**ComfyUI 执行器可切独立宿主**（`COMFY_EXECUTOR=host`，**当前仅 dev 可用**、
必须走 launcher 入口；`pnpm dev` 裸链路不拉起 host）。宿主的运行时图已随构建进产物
（[规范 §7.5](docs/standards/launch-and-build.md)），但桌包的 standalone 形态还没有进程
拉起它——ISSUE #1216 落地前，**桌包里不要设这个开关**（不写 = inline）。开关方法、日志
位置与恢复语义见 [执行器宿主指南](docs/guide-executor-host.md)。

---

## 双击入口速查（Windows）

所有双击入口都在 `tools/` 下按用途分目录，根目录只放工程配置。首次双击 `.ps1` 前需
右键 `scripts/enable-ps1-double-click.ps1` →「使用 PowerShell 运行」完成一次性关联
（Windows 默认双击 `.ps1` 是用记事本打开），详见 `docs/standards/launch-and-build.md` §8.3。

| 我想… | 双击 |
|---|---|
| 在浏览器里开发（看得到日志） | `tools/start/start-web.ps1` |
| 启动桌面壳（双击即用） | `tools/start/start-tauri.ps1`（等价于双击 `src-tauri\target\release\app.exe`） |
| 启动桌面壳（dev，Rust 热重载） | `tools/start/start-tauri-dev.ps1` |
| 运行已构建好的桌面包 | `tools/start/start-desktop.ps1` |
| 第一次在本机跑起来（自检 + 装依赖 + 生成 `.env`） | `tools/start/run-local.ps1` |
| 跑一遍质量门禁（typecheck / lint / vitest） | `tools/start/verify-quality.ps1` |
| 只跑测试（可指定单个文件 / 复现基线失败） | `tools/start/run-tests.ps1` |
| 拉取更新后同步依赖并跑 lint | `tools/start/sync-lint.ps1` |
| 注册 `comfyapp://` 协议（任务历史「打开文件夹」） | `tools/start/register-comfyapp-protocol.ps1` |
| 构建发行包（release 壳） | `tools/build/*.ps1`（见 `tools/README.md`） |

### 同一件事在 Linux / macOS / CI 上怎么写

`.ps1` 只解决「Windows 上怎么被双击」；**逻辑是跨平台的，入口不是**。常用动作逐条对照
（完整表与它对应的门禁见 [launch-and-build.md §9.5](docs/standards/launch-and-build.md)）：

| 我想… | Linux / macOS / CI | 对应 Windows 双击 |
|---|---|---|
| 启动开发环境 | `pnpm dev` | `tools/start/start-web.ps1` |
| 跑质量门禁（typecheck / lint / vitest） | `pnpm check:all` | `tools/start/verify-quality.ps1` |
| 只跑测试 | `pnpm test:file [文件]` | `tools/start/run-tests.ps1` |
| 连已知基线失败一起跑 | `pnpm test:full` | `tools/start/run-tests.ps1 -Full` |
| 同步依赖 + lint | `pnpm install && pnpm lint` | `tools/start/sync-lint.ps1` |
| 生成 `.env` | `pnpm env:init` | `tools/start/run-local.ps1` |
| 建库 | `pnpm db:push` | （双击启动链路会自动做） |
| 生成原文文档 | `pnpm doc:gen` | `tools/docs/generate-docs.ps1` |

> 这张表不是「文档承诺」：`scripts/check-ps1-consistency.mjs` 在 pre-commit 与 CI 核对
> 每个动作两侧的脚本都真实存在 —— **新增动作却只写了一侧会提交失败**。

---

## 非开发人员快速运行

不熟悉开发环境？请先阅读 **[`docs/guide-non-developer.md`](./docs/guide-non-developer.md)**，
并按里面的图文步骤操作：

- **想要独立桌面窗口**（最接近成品）→ 向开发人员要一份**即开即用桌面包**，解压后双击
  **`tools/start/start-desktop.ps1`** 即可，无需装 Node/Rust；
- **只有源码、想先在浏览器跑起来** → 双击 **`tools/start/run-local.ps1`** 自动完成初始化后，
  双击 **`tools/start/start-web.ps1`** 启动，再用浏览器打开**控制台打印的**
  `http://localhost:<COMFYAPP_PORT>`（**不是固定的 3100**：缺省时端口由检出路径推导到
  3200~3999，`3100` 只是异常兜底；照抄 3100 会 `ERR_CONNECTION_REFUSED`。端口契约见
  [规范 §1.1](docs/standards/launch-and-build.md#11-端口统一配置comfyapp_port)）

两条路都无需安装 Rust、无需手工编译。

> 拉取团队更新后本地怎么同步依赖环境（pnpm 配置有变更时），见 [`docs/guides/sync-after-pull.md`](./docs/guides/sync-after-pull.md)。
>
> 应用**一直开着**、期间拉到新代码后出现白屏 / 功能点了没反应（「界面比代码旧」），
> 见 [`docs/guide-stale-code.md`](./docs/guide-stale-code.md)；应用内也会主动提示该怎么重载。

开发人员请继续阅读下方「快速上手」与「开发模式」。

## 快速上手

> **开发/本地跑起来前必须先有 `.env`**：`src/env.js` 在启动时会校验
> `DATABASE_URL` / `BETTER_AUTH_*`，缺 `.env`（或值留空）会直接报
> `Invalid environment variables`，看不出是「缺文件」。CI / Playwright 因设了
> `SKIP_ENV_VALIDATION` 绕开校验，所以「CI 全绿、本地起不来」的差异不会自动暴露。
> `.env` 已被 gitignore（凭据零写入，见规范 §8），从未入库，需本地自行生成 ——
> 跑 `pnpm env:init` 即可（跨平台；只 `cp .env.example .env` 会因三项留空而仍然起不来）。

```bash
# 1. 安装依赖
pnpm install

# 2. 生成本地配置 .env（跨平台，三平台走同一条命令）
#    读取 .env.example，自动生成 BETTER_AUTH_SECRET（64 位随机 hex）并把
#    GitHub OAuth 两项填成本地占位值；已存在则跳过，不会覆盖你的配置。
#    —— Windows 用户也可直接双击 tools/start/run-local.ps1，它顺带做自检+装依赖
pnpm env:init
#    ⚠️ 只 `cp .env.example .env` 是**不够**的：.env.example 里那三项就是空串，
#    而校验把空串当「没给」，会直接报 Invalid environment variables。

# 3. 初始化数据库（Drizzle，按 drizzle.config.ts）
#    经 scripts/db-push.mjs：以 --force 非交互运行，并**复核库里真的建出表**——
#    drizzle-kit push 在无 TTY 环境（CI / 脚本 / 容器）会「报错 + exit 0 + 留 0 字节库」，
#    此时首页与 /api/health 都 200，只有真实业务页面 500（见规范 §9.1）
pnpm db:push

# 4. 启动开发服务器（Linux / macOS / CI 无需任何 .ps1）
#    端口不是固定 3100：经 scripts/dev.mjs 解析（.env 的 COMFYAPP_PORT →
#    检出路径推导 3200~3999 → 兜底 3100），启动时打印 `[dev.mjs] COMFYAPP_PORT=<n>`，
#    在浏览器打开 http://localhost:<n> 即可（见规范 §1.1）
pnpm dev

# 5. 注册 comfyapp:// 协议（可选，仅 Windows：双击 tools/start/register-comfyapp-protocol.ps1）
```

**桌面壳（三平台）**：

```bash
# 开发期：起壳 + dev server（跨平台编排器，Linux/macOS 上零 .ps1 依赖）
pnpm tauri dev

# 完整编排（预检 / 缓存指纹 / 就绪等待 / 整组回收 / 启动进度快照）
node scripts/dev-launcher.mjs

# 出安装包（先组装 standalone 资源 + 平台判据的 sidecar，再打包）
pnpm tauri build
```

> Linux 上编译壳需要系统 WebKitGTK 开发库（上表），
> 且**必须**经 `pnpm tauri build`（`beforeBuildCommand` 会组装
> `src-tauri/static` 与 sidecar）——裸 `cargo build` 缺资源时会在 `build.rs`
> 直接 panic，报的是「resource path binaries/node-<triple> doesn't exist」。

---

## 开发模式（Dev）

开发时**不需要编译 Rust 壳**也能跑前端；若要桌面壳热重载，用 Tauri dev。

| 方式 | 命令 / 入口 | 说明 |
|------|------------|------|
| 纯前端（浏览器） | `pnpm dev` | 启动 Next dev server，访问控制台打印的 `http://localhost:<COMFYAPP_PORT>`（缺省按检出路径推导到 3200~3999，不是固定 3100；端口契约见 [规范 §1.1](docs/standards/launch-and-build.md#11-端口统一配置comfyapp_port)） |
| 桌面壳（双击即用） | 双击 `src-tauri\target\release\app.exe` | 壳自己起编排器与 dev server：窗口秒出、改前端即时刷新（Rust 改动需重新 `cargo build`） |
| 桌面壳（Rust 也热重载） | 双击 `tools/start/start-tauri-dev.ps1` 或 `pnpm tauri dev` | 自动起 dev server + 重新编译 Rust 壳，前端/后端改动即时刷新（首次编译较慢） |
| 桌面壳（独立运行，不连 dev server） | 先跑 `tools\build\build-standalone.ps1`，再双击 `src-tauri\target\release\app.exe` | standalone 模式：内置 Node sidecar 运行 Next standalone server（检出里没有编排器时壳自动走这条路），改动需重新构建才生效 |
| 桌面壳（无控制台入口） | 双击 `tools/start/start-tauri.ps1` | 直接启动 `src-tauri\target\release\app.exe`（等价于双击壳本身） |
| 桌面壳（dev，Rust 热重载） | 双击 `tools/start/start-tauri-dev.ps1` | 隐藏窗口启动 tauri dev 模式（等价于 `pnpm tauri dev`） |
| Web 开发（可见日志） | 双击 `tools/start/start-web.ps1` | 控制台打印 dev-launcher 日志 |

> 窗口初始加载 `splash.html` 启动页，随后自动探测 dev server 就绪并跳转应用；
> 探测地址由壳按 §1.1 的端口契约注入（`COMFYAPP_DEV_URL`），`tauri.conf.json` 的静态
> `devUrl`（`localhost:3100`）只是编译期兜底、不参与主导航。

---

## 发布构建（Release）

发布构建会编译 **release 版 Rust 壳** —— 它**就是**唯一的启动入口
（`src-tauri\target\release\app.exe`），不再打包第二层启动器 exe。

> ⚠️ 构建依赖 `src-tauri/static` 目录（`frontendDist`）。该目录在编译时被嵌入二进制，
> 若它**缺失或被污染**（例如被误写入整个项目副本），会导致启动黑屏。
> 正常情况下构建流程会自动同步资源；若曾出现异常，先跑 `tools\build\rebuild-static.ps1` 再构建。

### 方式一：一键构建（推荐）

```text
双击 tools\build\build-all.ps1
```

它执行 `tools\build\build-tauri-release.ps1` → 编译出
`src-tauri/target/release/app.exe`。编译前会：
- 同步 `splash.html` 进 `src-tauri/splash-assets/`（启动页是编译期嵌入的）；
- 补齐 Node sidecar（`src-tauri/binaries/node-<triple>.exe`，`externalBin` 在编译期被校验）。

完成后**双击 `src-tauri\target\release\app.exe`** 即可启动
（或用入口 `tools\start\start-tauri.ps1`）。

### 方式二：仅构建 release 壳

```text
双击 tools\build\build-tauri-release.ps1
```

产物同上一节。适合只想替换壳的场合。

### 方式三：完整安装包与 standalone 资源

```bash
pnpm tauri build              # 系统安装包（msi / nsis）
tools\build\build-standalone.ps1   # 组装 standalone 资源（server.js + .next + sidecar）
```

两者都经 `beforeBuildCommand`（`node scripts/build-desktop.mjs`）组装资源，
安装包产出在 `src-tauri/target/release/bundle/`。

### 运行形态：壳自己按「检出里有没有编排器」决定

**一个 exe，两种形态**（判据见规范 §1.5，`shell_launch::ensure_launch_mode`）：

| 形态 | 触发条件 | 说明 | 改动热更新 |
|------|----------|------|-----------|
| prebuilt（开发检出） | 检出里有 `scripts/dev-launcher.mjs` | 壳起编排器 → dev server，前端 HMR | 前端 HMR；Rust 需重编 |
| standalone（分发副本） | 检出里**没有**编排器 | 壳经 Node sidecar 起 `scripts/standalone-runtime.mjs`：由它装配运行期 env（产物不含 `.env`，见规范 §7.6）并首启建表，再带起内嵌 server | 不可（需重构建） |

> 为什么不是「按 exe 名字区分」：用户手里只有 `app.exe` 一个文件，拿它去猜形态
> 会把两种形态都判错。判据放在**内容**（编排器在不在）上，这是唯一可判且不会漂的。

> standalone 的载荷从哪来：`scripts/build-desktop.mjs` 组装 `src-tauri/static`，
> `tauri.conf.json` 的 `bundle.resources: ["static/"]` 再把它装进资源目录（实测落点
> `resource_dir()/static/`）。这两段**都要在**——此前 `resources` 段是空的，所以
> 「壳起内嵌 server」这条路从来没有通过（五层断点与实测见规范 §7.6，ISSUE #1216）。
> 直接运行 `target/release/app.exe` 时走的是哪条路，仍由「检出里有没有编排器」决定：
> 开发检出里有，于是走 prebuilt 连 dev server。

### 资源异常时清理重建

```text
双击 tools\build\rebuild-static.ps1
```

删除旧的 `src-tauri/static` 并重新运行 `build-desktop.mjs`（含 `pnpm build` 生成 standalone），
随后再跑上面的任一构建以重新嵌入干净的前端资源。

---

## 构建流程速查

| 目标 | 命令 |
|------|------|
| 浏览器开发 | `pnpm dev` |
| 桌面壳开发（热重载） | `pnpm tauri dev` 或双击 `tools\start\start-tauri-dev.ps1` |
| 一键构建（release 壳 = 唯一入口） | `tools\build\build-all.ps1` |
| 仅 release 壳 | `tools\build\build-tauri-release.ps1` |
| 独立模式资源（standalone） | `tools\build\build-standalone.ps1` |
| 完整安装包 | `pnpm tauri build` |
| 清理重建前端资源 | `tools\build\rebuild-static.ps1` |

更详细的脚本职责、启动入口对比（`start-tauri.ps1` / `start-tauri-dev.ps1` / 壳自身）、CSP 与 standalone 模式说明，
见 [`tools/README.md`](./tools/README.md)。
启动方式的热更新（HMR）能力矩阵、以及重建 `src-tauri/static` 对每种方式的影响，
见 [`docs/startup-hotreload.md`](./docs/startup-hotreload.md)。

---

## 常用脚本

```bash
pnpm dev          # 前端开发服务器
pnpm build        # Next.js 生产构建（standalone）
pnpm check        # eslint + tsc --noEmit
pnpm test         # Vitest 单元测试
pnpm test:e2e     # Playwright e2e
pnpm docs         # 生成 API 文档到 docs/
pnpm db:push      # 同步 Drizzle schema 到 db.sqlite（非交互、复核建表结果）
pnpm env:init     # 生成/补齐本地 .env（随机密钥 + 本地 OAuth 占位值）
```

非开发人员无需记上面命令，双击根目录 `tools/start/verify-quality.ps1` 即可一键跑质量门禁
（typecheck / eslint 零警告 / vitest），用法与"新增校验怎么补"见 `docs/standards/11` 的 11.12。

---

## 常见问题

- **启动黑屏**：通常是 `src-tauri/static` 缺失/被污染或前端资源未嵌入。先 `tools\build\rebuild-static.ps1`，
  再重新跑发布构建（`build-all` 或 `build-tauri-release`）。
- **修改 `public/splash.html` 不生效**：release 构建时 `splash.html` 已被嵌入二进制旧版本，
  需重新 `cargo build --release`（走 `tools\build\build-tauri-release.ps1` 会自动增量同步）。
- **`comfyapp://` 链接打不开**：双击根目录 `tools/start/register-comfyapp-protocol.ps1` 注册协议。
