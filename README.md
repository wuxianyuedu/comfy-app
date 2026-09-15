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
│  └─ binaries/             # Node 运行时 sidecar（node-<triple>.exe）
├─ scripts/                 # 启动与构建脚本（被壳/工具调用）
│  ├─ dev-launcher.ps1      # 启动器：起 dev server / Tauri 壳 / 探测端口
│  ├─ entry-common.ps1      # 双击入口公共库（定位项目根 / 解析 pwsh / 透传退出码）
│  ├─ build-desktop.mjs     # 组装 src-tauri/static（standalone + splash + sidecar）
│  └─ install-comfyapp-helper.ps1  # 注册 comfyapp:// 协议
├─ tools/                   # 双击入口与构建编排（Windows .ps1，按用途分目录）
│  ├─ start/                # 启动与初始化入口（双击用）
│  │  ├─ start-web.ps1            # 控制台模式启动 Web 开发（可见日志）
│  │  ├─ start-tauri.ps1          # 直接启动 start-tauri\start-tauri.exe（prebuilt 秒出）
│  │  ├─ start-tauri-dev.ps1        # 隐藏窗口启动 Tauri 壳（dev / tauri dev，Rust 热重载）
│  │  ├─ start-desktop.ps1        # 桌面版一键自检 + 启动（给拿到桌面包的人）
│  │  ├─ run-local.ps1            # 非开发人员一键初始化（自检/生成 .env/装依赖）
│  │  ├─ verify-quality.ps1       # 一键质量门禁（typecheck / lint / vitest）
│  │  ├─ run-tests.ps1            # 只跑 vitest（可指定文件 / -Full / 透传参数）
│  │  ├─ sync-lint.ps1           # 同步依赖 + pnpm lint（拉取更新/改码后日常自检）
│  │  └─ register-comfyapp-protocol.ps1  # 注册 comfyapp:// 协议（免管理员）
│  ├─ build/                # 构建打包入口
│  │  ├─ build-all.ps1            # 一键发布构建（release 壳 + 打包 start-tauri.exe）
│  │  ├─ build-tauri-release.ps1  # 仅构建 release 版 Tauri 壳
│  │  ├─ build-launcher.ps1       # 仅打包 start-tauri.exe
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

> `tools/start/start-tauri.ps1` 直接启动打包好的 `start-tauri\start-tauri.exe`（prebuilt，秒出窗口）；
> dev/tauri dev 模式的入口是 `tools/start/start-tauri-dev.ps1`。

---

## 环境要求

仅开发前端（Windows / Linux / macOS 均可）：

- **Node.js** ≥ 22 与 **pnpm** 10（`corepack enable` 或直接安装 pnpm）
- 其他都不用装：`pnpm dev` 是一条纯 Node 链路，**不依赖 PowerShell / Rust /
  WebView2**。Linux / macOS 上按下方「快速上手」跑起来即可（详见
  [规范 §9 Web-only Linux 模式](docs/standards/launch-and-build.md#9-web-only-linux-模式pnpm-dev-零-ps1-依赖)）。

要打包/运行**桌面壳**时另需（仅 Windows）：

- **Rust 工具链**（cargo / rustc）：用于编译桌面壳，见 https://rustup.rs/
- **PowerShell 7（pwsh）**：启动器推荐；Windows PowerShell 5.1 亦可回退
- **WebView2 运行时**：Windows 10/11 通常已内置
- （可选）**Python**：部分辅助脚本可能用到

---

## 双击入口速查（Windows）

所有双击入口都在 `tools/` 下按用途分目录，根目录只放工程配置。首次双击 `.ps1` 前需
右键 `scripts/enable-ps1-double-click.ps1` →「使用 PowerShell 运行」完成一次性关联
（Windows 默认双击 `.ps1` 是用记事本打开），详见 `docs/standards/launch-and-build.md` §8.3。

| 我想… | 双击 |
|---|---|
| 在浏览器里开发（看得到日志） | `tools/start/start-web.ps1` |
| 启动桌面壳（prebuilt，秒出窗口） | `tools/start/start-tauri.ps1`（等价于双击 `start-tauri.exe`） |
| 启动桌面壳（dev，Rust 热重载） | `tools/start/start-tauri-dev.ps1` |
| 运行已构建好的桌面包 | `tools/start/start-desktop.ps1` |
| 第一次在本机跑起来（自检 + 装依赖 + 生成 `.env`） | `tools/start/run-local.ps1` |
| 跑一遍质量门禁（typecheck / lint / vitest） | `tools/start/verify-quality.ps1` |
| 只跑测试（可指定单个文件 / 复现基线失败） | `tools/start/run-tests.ps1` |
| 拉取更新后同步依赖并跑 lint | `tools/start/sync-lint.ps1` |
| 注册 `comfyapp://` 协议（任务历史「打开文件夹」） | `tools/start/register-comfyapp-protocol.ps1` |
| 构建发行包 / 重新打包启动器 | `tools/build/*.ps1`（见 `tools/README.md`） |

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

---

## 开发模式（Dev）

开发时**不需要编译 Rust 壳**也能跑前端；若要桌面壳热重载，用 Tauri dev。

| 方式 | 命令 / 入口 | 说明 |
|------|------------|------|
| 纯前端（浏览器） | `pnpm dev` | 启动 Next dev server，访问控制台打印的 `http://localhost:<COMFYAPP_PORT>`（缺省按检出路径推导到 3200~3999，不是固定 3100；端口契约见 [规范 §1.1](docs/standards/launch-and-build.md#11-端口统一配置comfyapp_port)） |
| 桌面壳（预编译秒出 + 前端热重载） | 双击 `start-tauri.exe` | 默认 prebuilt 模式：用已编译的 release 壳秒出窗口，后台连 dev server，改前端即时刷新（Rust 改动需重新 `cargo build`） |
| 桌面壳（Rust 也热重载） | 双击 `start-tauri-dev.exe` 或 `pnpm tauri dev` | 自动起 dev server + 重新编译 Rust 壳，前端/后端改动即时刷新（首次编译较慢） |
| 桌面壳（独立运行，不连 dev server） | 双击 `start-tauri-standalone.exe`（需先 `tools\build\build-standalone.ps1`） | standalone 模式：内置 Node sidecar 运行 Next standalone server，双击即独立运行，改动需重新构建才生效 |
| 桌面壳（prebuilt，无控制台入口） | 双击 `tools/start/start-tauri.ps1` | 直接启动 `start-tauri\start-tauri.exe`（等价于 prebuilt，秒出窗口） |
| 桌面壳（dev，Rust 热重载） | 双击 `tools/start/start-tauri-dev.ps1` | 隐藏窗口启动 tauri dev 模式（等价于 `start-tauri-dev.exe`） |
| Web 开发（可见日志） | 双击 `tools/start/start-web.ps1` | 控制台打印 dev-launcher 日志 |

> Dev 模式下窗口初始加载 `splash.html` 启动页，随后自动探测 dev server 就绪并跳转应用；
> 探测地址由启动器按 §1.1 的端口契约注入（`COMFYAPP_DEV_URL`），`tauri.conf.json` 的静态
> `devUrl`（`localhost:3100`）只是编译期兜底、不参与主导航。

---

## 发布构建（Release）

发布构建会编译 **release 版 Rust 壳**（启动更快），并（可选）打包出可直接分发的 `start-tauri.exe`。

> ⚠️ 构建依赖 `src-tauri/static` 目录（`frontendDist`）。该目录在编译时被嵌入二进制，
> 若它**缺失或被污染**（例如被误写入整个项目副本），会导致启动黑屏。
> 正常情况下 `build-all` 流程会自动同步资源；若曾出现异常，先跑 `tools\build\rebuild-static.ps1` 再构建。

### 方式一：一键发布（推荐）

> 说明：`tools\build\build-all.ps1` 产出的 `start-tauri.exe` 本身就是一个「开发/预编译」启动入口——
> 双击它会用预编译壳秒出窗口并后台连接 dev server（前端热重载），**日常开发直接双击即可**，
> 无需先构建。它并非只能用于发布：当你需要**不依赖 dev server 的独立程序**时，才用下面的
> 「方式三：完整安装包」（内嵌 standalone server，双击即独立运行）。

```text
双击 tools\build\build-all.ps1
```

它依次执行：
1. `tools\build\build-tauri-release.ps1` → 编译 `src-tauri/target/release/app.exe`
   - 若 `src-tauri/static` 不存在，会自动跑 `node scripts/build-desktop.mjs` 完整组装；
   - 已存在则仅增量同步 `splash.html` / `dev-launcher.ps1` / `index.html`。
2. `tools\build\build-launcher.ps1` → 打包 `start-tauri\start-tauri.exe`

最终双击 `start-tauri\start-tauri.exe` 即可启动（自动优先使用 release 壳）。

### 方式二：仅构建 release 壳

```text
双击 tools\build\build-tauri-release.ps1
```

产物：`src-tauri/target/release/app.exe`。适合只想替换壳、再用现有 `start-tauri.exe` 启动。

### 方式三：完整安装包（msi / nsis）

```bash
pnpm tauri build
```

由 Tauri CLI 走 `beforeBuildCommand`（`node scripts/build-desktop.mjs`）组装资源，
再产出系统安装包（位于 `src-tauri/target/release/bundle/`）。

### 启动入口一览（三种独立 exe）

`scripts/start_tauri_launcher.py` 是**一份源码**，由 `tools\build\build-launcher*.ps1` 通过
`LAUNCHER_NAME` 环境变量打包出三个入口 exe；运行时再按 **exe 文件名**自动选择模式
（也可显式用参数覆盖：`--tauri-dev` / `--standalone`）：

| 入口 exe | 模式 | 说明 | 改动热更新 |
|----------|------|------|-----------|
| 双击 `start-tauri.exe` | prebuilt（默认） | 预编译壳秒出窗口 + 后台 dev server | 前端 HMR；Rust 需重编 |
| 双击 `start-tauri-dev.exe` | tauri dev | 重新编译 Rust 壳 + dev server | 前端 + Rust 均热重载 |
| 双击 `start-tauri-standalone.exe` | standalone | 内置 Node sidecar 独立运行（需先 `tools\build\build-standalone.ps1`） | 不可（需重构建） |
| `pnpm tauri build` 安装包 | standalone | 以安装包形式分发的独立程序 | 不可 |

> 三种方式的「哪些能热更 / 哪些不能 / 构建 `static` 对谁有影响」，见
> [docs/startup-hotreload.md](./docs/startup-hotreload.md)。

> 为何 prebuilt 默认连 dev server 而非独立运行：直接运行 `target/release/app.exe` 时，
> Tauri 的 `resource_dir()` 指向 `src-tauri`，而 standalone 的 `server.js` 在 `src-tauri/static`
> 子目录，壳检测不到 `server.js` 便回退到 `COMFYAPP_DEV_URL`（dev server）；只有打包安装后
> `resource_dir()` 指向 resources 且 `server.js` 在根，才会走真正独立的 standalone 模式。

### 资源异常时清理重建

```text
双击 tools\build\rebuild-static.ps1
```

删除旧的 `src-tauri/static` 并重新运行 `build-desktop.mjs`（含 `pnpm build` 生成 standalone），
随后再跑上面的任一发布构建以重新嵌入干净的前端资源。

---

## 构建流程速查

| 目标 | 命令 |
|------|------|
| 浏览器开发 | `pnpm dev` |
| 桌面壳开发（热重载） | `pnpm tauri dev` 或双击 `start-tauri-dev.exe` |
| 一键发布（壳 + launcher） | `tools\build\build-all.ps1` |
| 仅 release 壳 | `tools\build\build-tauri-release.ps1` |
| 独立模式壳（standalone） | `tools\build\build-standalone.ps1` |
| 独立模式启动入口 | `tools\build\build-launcher-standalone.ps1`（打包 `start-tauri-standalone.exe`） |
| 完整安装包 | `pnpm tauri build` |
| 清理重建前端资源 | `tools\build\rebuild-static.ps1` |

更详细的脚本职责、启动入口对比（start-tauri.ps1 / start-tauri-dev.ps1 / start-tauri.exe）、CSP 与 standalone 模式说明，
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
