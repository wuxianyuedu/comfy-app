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
│  ├─ build-desktop.mjs     # 组装 src-tauri/static（standalone + splash + sidecar）
│  └─ install-comfyapp-helper.ps1  # 注册 comfyapp:// 协议
├─ tools/                   # 发布构建编排（Windows .bat）
│  ├─ build-all.bat         # 一键发布构建（release 壳 + 打包 start-tauri.exe）
│  ├─ build-tauri-release.bat  # 仅构建 release 版 Tauri 壳
│  ├─ build-launcher.bat    # 仅打包 start-tauri.exe
│  ├─ rebuild-static.bat    # 清理并重建 src-tauri/static
│  └─ README.md             # 各构建脚本的详细对比与说明
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
| `next.config.js` | Next.js 配置，含 `output: 'standalone'`（供桌面壳打包） |
| `tsconfig.json` | TypeScript 配置 |
| `eslint.config.js` `prettier.config.js` | 代码检查与格式化 |
| `postcss.config.js` | Tailwind CSS v4 接入 |
| `vitest.config.ts` `playwright.config.ts` | 测试配置 |
| `typedoc.json` | API 文档生成配置 |
| `public/splash.html` | 桌面壳启动加载页（编译时嵌入，由 Tauri 窗口初始显示） |
| `register-comfyapp-protocol.bat` | 双击注册 `comfyapp://` 自定义 URL 协议（无需管理员） |
| `start-web.bat` | 控制台模式启动 **Web 开发**（调用 `dev-launcher.ps1`，可见日志） |
| `verify-quality.bat` | **一键质量验证**（双击即跑 typecheck/lint/vitest，给非开发人员用，见规范 11.9） |
| `start-tauri.vbs` | 无控制台、隐藏窗口启动 **Tauri 桌面壳（dev 模式）** |
| `CHANGELOG.md` | 变更日志 |

> 发布版的启动入口 `start-tauri.exe` 由 `tools\build-launcher.bat` 生成（位于 `start-tauri\`），不要与 dev 用的 `start-tauri.vbs` 混淆。

---

## 环境要求

- **Node.js** ≥ 22 与 **pnpm** 10（`corepack enable` 或直接安装 pnpm）
- **Rust 工具链**（cargo / rustc）：用于编译桌面壳，见 https://rustup.rs/
- **PowerShell 7（pwsh）**：启动器推荐；Windows PowerShell 5.1 亦可回退
- **WebView2 运行时**：Windows 10/11 通常已内置
- （可选）**Python**：部分辅助脚本可能用到

---

## 快速上手

```bash
# 1. 安装依赖
pnpm install

# 2. 初始化数据库（按 prisma/schema.prisma）
pnpm db:push

# 3. 注册 comfyapp:// 协议（可选，双击根目录 register-comfyapp-protocol.bat）
```

---

## 开发模式（Dev）

开发时**不需要编译 Rust 壳**也能跑前端；若要桌面壳热重载，用 Tauri dev。

| 方式 | 命令 / 入口 | 说明 |
|------|------------|------|
| 纯前端（浏览器） | `pnpm dev` | 启动 Next dev server，访问 http://localhost:3000 |
| 桌面壳（预编译秒出 + 前端热重载） | 双击 `start-tauri.exe` | 默认 prebuilt 模式：用已编译的 release 壳秒出窗口，后台连 dev server，改前端即时刷新（Rust 改动需重新 `cargo build`） |
| 桌面壳（Rust 也热重载） | 双击 `start-tauri-dev.exe` 或 `pnpm tauri dev` | 自动起 dev server + 重新编译 Rust 壳，前端/后端改动即时刷新（首次编译较慢） |
| 桌面壳（独立运行，不连 dev server） | 双击 `start-tauri-standalone.exe`（需先 `tools\build-standalone.bat`） | standalone 模式：内置 Node sidecar 运行 Next standalone server，双击即独立运行，改动需重新构建才生效 |
| 桌面壳（无控制台 vbs） | 双击 `start-tauri.vbs` | 隐藏窗口启动 tauri dev 模式（等价于 `start-tauri-dev.exe`） |
| Web 开发（可见日志） | 双击 `start-web.bat` | 控制台打印 dev-launcher 日志 |

> Dev 模式下窗口初始加载 `splash.html` 启动页，随后自动探测 `http://localhost:3000` 就绪并跳转应用。

---

## 发布构建（Release）

发布构建会编译 **release 版 Rust 壳**（启动更快），并（可选）打包出可直接分发的 `start-tauri.exe`。

> ⚠️ 构建依赖 `src-tauri/static` 目录（`frontendDist`）。该目录在编译时被嵌入二进制，
> 若它**缺失或被污染**（例如被误写入整个项目副本），会导致启动黑屏。
> 正常情况下 `build-all` 流程会自动同步资源；若曾出现异常，先跑 `tools\rebuild-static.bat` 再构建。

### 方式一：一键发布（推荐）

> 说明：`tools\build-all.bat` 产出的 `start-tauri.exe` 本身就是一个「开发/预编译」启动入口——
> 双击它会用预编译壳秒出窗口并后台连接 dev server（前端热重载），**日常开发直接双击即可**，
> 无需先构建。它并非只能用于发布：当你需要**不依赖 dev server 的独立程序**时，才用下面的
> 「方式三：完整安装包」（内嵌 standalone server，双击即独立运行）。

```text
双击 tools\build-all.bat
```

它依次执行：
1. `build-tauri-release.bat` → 编译 `src-tauri/target/release/app.exe`
   - 若 `src-tauri/static` 不存在，会自动跑 `node scripts/build-desktop.mjs` 完整组装；
   - 已存在则仅增量同步 `splash.html` / `dev-launcher.ps1` / `index.html`。
2. `build-launcher.bat` → 打包 `start-tauri\start-tauri.exe`

最终双击 `start-tauri\start-tauri.exe` 即可启动（自动优先使用 release 壳）。

### 方式二：仅构建 release 壳

```text
双击 tools\build-tauri-release.bat
```

产物：`src-tauri/target/release/app.exe`。适合只想替换壳、再用现有 `start-tauri.exe` 启动。

### 方式三：完整安装包（msi / nsis）

```bash
pnpm tauri build
```

由 Tauri CLI 走 `beforeBuildCommand`（`node scripts/build-desktop.mjs`）组装资源，
再产出系统安装包（位于 `src-tauri/target/release/bundle/`）。

### 启动入口一览（三种独立 exe）

`scripts/start_tauri_launcher.py` 是**一份源码**，由 `tools\build-launcher*.bat` 通过
`LAUNCHER_NAME` 环境变量打包出三个入口 exe；运行时再按 **exe 文件名**自动选择模式
（也可显式用参数覆盖：`--tauri-dev` / `--standalone`）：

| 入口 exe | 模式 | 说明 | 改动热更新 |
|----------|------|------|-----------|
| 双击 `start-tauri.exe` | prebuilt（默认） | 预编译壳秒出窗口 + 后台 dev server | 前端 HMR；Rust 需重编 |
| 双击 `start-tauri-dev.exe` | tauri dev | 重新编译 Rust 壳 + dev server | 前端 + Rust 均热重载 |
| 双击 `start-tauri-standalone.exe` | standalone | 内置 Node sidecar 独立运行（需先 `tools\build-standalone.bat`） | 不可（需重构建） |
| `pnpm tauri build` 安装包 | standalone | 以安装包形式分发的独立程序 | 不可 |

> 三种方式的「哪些能热更 / 哪些不能 / 构建 `static` 对谁有影响」，见
> [docs/startup-hotreload.md](./docs/startup-hotreload.md)。

> 为何 prebuilt 默认连 dev server 而非独立运行：直接运行 `target/release/app.exe` 时，
> Tauri 的 `resource_dir()` 指向 `src-tauri`，而 standalone 的 `server.js` 在 `src-tauri/static`
> 子目录，壳检测不到 `server.js` 便回退到 `COMFYAPP_DEV_URL`（dev server）；只有打包安装后
> `resource_dir()` 指向 resources 且 `server.js` 在根，才会走真正独立的 standalone 模式。

### 资源异常时清理重建

```text
双击 tools\rebuild-static.bat
```

删除旧的 `src-tauri/static` 并重新运行 `build-desktop.mjs`（含 `pnpm build` 生成 standalone），
随后再跑上面的任一发布构建以重新嵌入干净的前端资源。

---

## 构建流程速查

| 目标 | 命令 |
|------|------|
| 浏览器开发 | `pnpm dev` |
| 桌面壳开发（热重载） | `pnpm tauri dev` 或双击 `start-tauri-dev.exe` |
| 一键发布（壳 + launcher） | `tools\build-all.bat` |
| 仅 release 壳 | `tools\build-tauri-release.bat` |
| 独立模式壳（standalone） | `tools\build-standalone.bat` |
| 独立模式启动入口 | `tools\build-launcher-standalone.bat`（打包 `start-tauri-standalone.exe`） |
| 完整安装包 | `pnpm tauri build` |
| 清理重建前端资源 | `tools\rebuild-static.bat` |

更详细的脚本职责、启动入口对比（start-tauri.exe vs start-tauri.vbs）、CSP 与 standalone 模式说明，
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
pnpm db:push      # 推送 Prisma schema 到数据库
```

非开发人员无需记上面命令，双击根目录 `verify-quality.bat` 即可一键跑质量门禁
（typecheck / eslint 零警告 / vitest），用法与"新增校验怎么补"见 `docs/standards/11` 的 11.9。

---

## 常见问题

- **启动黑屏**：通常是 `src-tauri/static` 缺失/被污染或前端资源未嵌入。先 `tools\rebuild-static.bat`，
  再重新跑发布构建（`build-all` 或 `build-tauri-release`）。
- **修改 `public/splash.html` 不生效**：release 构建时 `splash.html` 已被嵌入二进制旧版本，
  需重新 `cargo build --release`（走 `build-tauri-release.bat` 会自动增量同步）。
- **`comfyapp://` 链接打不开**：双击根目录 `register-comfyapp-protocol.bat` 注册协议。
