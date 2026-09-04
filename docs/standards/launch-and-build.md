# 启动与构建流程规范

> 适用范围：Windows 桌面壳（start-tauri.exe）启动链路、dev server、桌面壳编译与生产构建。
> 2026-09-02 依据当日五类启动故障的复盘制定。改流程前先读本文；改完流程必须更新本文。
> AI 协作：本仓库根的 `AGENTS.md` 会在编码代理会话开始时自动加载，并把本文列为
> 强制前置阅读；修改硬规则时必须同步 `AGENTS.md` 的摘要。

## 1. 启动链路与分层职责

```
双击 start-tauri\start-tauri.exe（scripts/start_tauri_launcher.py → PyInstaller）
  │  职责：单实例保护、失败弹窗（人类可见出口）、run/launch-status.json 进度
  ▼
pwsh -File scripts\dev-launcher.ps1 -Prebuilt
  │  职责：预检（依赖/壳时效）、进程编排、日志体系、taskkill /T 进程树回收
  ├─▶ src-tauri\target\release\app.exe（Tauri 壳，秒出窗口）
  │     职责：splash 窗口展示启动进度（读 run/launch-status.json）
  │           + 「查看日志」面板（读 log/ 下启动器日志尾部，get_launch_log 命令）
  │           + main 窗口隐藏待命；splash 探测就绪后 navigate_to_app 交换窗口
  │           （交换前做 TCP 可达性校验，失败进入重导航循环——WebView2 对导航
  │           失败同样触发 on_page_load Finished，不校验会把 Edge 错误页
  │           当成应用界面显示）
  └─▶ cmd → pnpm dev → node next dev（127.0.0.1:3000）
        就绪后 splash 调 navigate_to_app → main 加载 /workspace → 交换窗口
```

分层边界（不要越层做事）：
- **Python 启动器**不做进程树管理（它退出时 dev-launcher 必须还能活着继续工作）；
- **dev-launcher.ps1** 是唯一的进程编排者：启动、预检、清理都在这一层；
- **Rust 壳**只负责窗口与导航，不启动任何进程（dev 模式）；
- 任何一层失败都必须有人类可见的出口（弹窗/窗口内提示），禁止只写文件。

## 2. 启动预检（dev-launcher.ps1，新增于 2026-09-02）

按顺序执行，任一失败立即终止并展示日志尾部：

1. **残留壳清理**：按命令行匹配终止上次运行遗留的同项目 app.exe（防窗口叠加）。
2. **端口清理**：杀掉 3000/3001/3002 的监听进程（防挤到 3001 连旧代码）。
3. **缓存指纹**：next.config/tsconfig/package.json/lockfile 指纹变化才清 .next。
4. **node_modules 健康检查**：`.modules.yaml` 与 `.bin/next` 缺失即视为残缺
   （pnpm 策略拒装/中断安装的典型残留），显式跑一次 `pnpm install`（CI 模式），
   失败立刻报错带日志尾部。日志：`log/pnpm-install-stdout/stderr.log`。
5. **壳时效提醒**：app.exe 比 tauri.conf.json / src\*.rs / splash-assets 旧时
   WARN 提醒重编（`cd src-tauri; cargo build --release --features custom-protocol`）。
   窗口配置与启动页是编译期内嵌的，只改源码不重编壳 = 跑旧逻辑（黑屏问题的
   直接来源）。
6. **数据库 schema 同步（Drizzle）**：依赖预检后执行 `pnpm exec drizzle-kit push`，
   以 ALTER 方式把 `src/server/db/schema.ts` 的表结构增量同步进 `db.sqlite`
   （保留现有数据）。改用 Drizzle 后不再有「运行时必须重新 prisma generate 一个
   庞大 client + DLL 被锁」的步骤；改了 schema 后双击启动即可自动生效。失败仅
   WARN（不阻断启动），日志：`log/drizzle-push-stdout/stderr.log`。

## 3. 进程树管理规范

- 启动器只允许用 `taskkill /PID <pid> /T /F` 回收进程树。`Process.Kill()`
  只杀 cmd.exe 外壳，node/pnpm 子进程会残留（占端口、锁日志文件）。
- Job Object 的 `KILL_ON_JOB_CLOSE` 标志在本机设置失败（Win32 错误 87，
  标准调用亦然，疑似系统构建/安全软件拦截），启动器会 WARN 并依赖自身
  兜底清理。**不要**假设 Job 标志生效。
- pnpm 已关闭 `verifyDepsBeforeRun`（见 §6）：任何 pnpm 命令都不会隐式
  补跑 install。dev server 运行期间不要手动跑 `pnpm install`
  （better-sqlite3 等原生模块被进程锁定，install 会 EPERM）。

## 4. 日志布局（排障从上往下看）

| 文件 | 写者 | 内容 | 轮转 |
|---|---|---|---|
| `log/dev-launcher.log` | dev-launcher.ps1（Transcript） | 本次启动全量：预检/启动步骤/清理 | 每次运行覆盖；归档到 `log/<yyyy-MM>/` |
| `log/dev-launcher-current.txt` | dev-launcher.ps1 | 指向本次真实日志的 sentinel（log 被锁回退改名时靠它定位） | 同上 |
| `log/nextjs-stdout-<ts>.log` `log/nextjs-stderr-<ts>.log` | dev-launcher.ps1 重定向 | Next dev server 原始输出；**启动失败先看 stderr** | 按次命名，保留 5 份 |
| `log/dev-launcher-stderr.log` | python 启动器重定向 | pwsh 的 stderr + app.exe 的 `[ComfyAPP]` 诊断行 | 每次启动覆盖 |
| `log/start-tauri-launcher.log` | python 启动器 | 双击→pwsh→窗口检测的链路日志 | 每次启动覆盖 |
| `run/launch-status.json` | python 启动器 | 结构化启动进度，splash 页展示；launcher 退出 30s 后自删 | — |
| 启动页「查看日志」面板 | splash 前端轮询 `get_launch_log` | dev-launcher.log（经 sentinel 定位）+ dev-launcher-stderr.log 的尾部（去 ANSI、限长），启动页实时看执行到哪一步 | — |
| `.next/dev/logs/next-development.log` | Next dev server | dev server 内部日志（含锁冲突提示） | Next 自管 |
| `log/<yyyy-MM>/dev-launcher-<ts>.log` | dev-launcher.ps1 | 历史归档 | 无限累积，定期清理 |

排障顺序：`start-tauri-launcher.log`（双击层发生了什么）→
`dev-launcher-stderr.log`（pwsh/壳层报错）→ `dev-launcher.log`（编排步骤走到哪）
→ `nextjs-stderr-<ts>.log`（dev server 报错）。失败弹窗已包含后两者的尾部。

## 5. 排障手册（症状 → 已知根因）

| 症状 | 根因（历史案例） | 对策 |
|---|---|---|
| 双击 exe 完全无窗口、无报错 | ① dev-launcher 静默失败（旧版无弹窗）② 日志文件被残留进程锁死 | 已修复：失败弹窗 + 日志按次命名。若复现，看 `start-tauri-launcher.log` 末行 exit code 与 `dev-launcher-stderr.log` |
| 窗口黑屏，左上角 `asset not found: splash.html` | splash 窗口 URL 用了 macOS/Linux 形式的 `tauri://localhost`，Windows 资源源是 `http(s)://tauri.localhost`；或改了 splash-assets 但没重编壳 | tauri.conf.json 用相对路径 `splash.html`；重编壳 |
| dev server「提前退出 exit=1」且无输出 | cmd 重定向目标文件被残留进程锁定，打开即失败 | 已修复：nextjs 日志按次命名。残留进程见 §3 |
| `pnpm install` 被拒：`minimumReleaseAge` / `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 11 默认拒绝发布不足 24h 的包 | 已在 pnpm-workspace.yaml 关闭；新包确认可信后可按需放开 |
| `pnpm install` exit 1：`ERR_PNPM_IGNORED_BUILDS` | pnpm 11 默认不批准第三方 postinstall | 已在 pnpm-workspace.yaml `allowBuilds` 批准 6 个包；新增含构建脚本的依赖需补充 |
| 任何 pnpm 命令连锁失败：better-sqlite3 `EPERM rename ...node` | dev server 运行中锁着原生模块 + pnpm 隐式依赖检查触发 install | 已关闭 `verifyDepsBeforeRun`；关 dev server 再装依赖 |
| `next dev` 报 `Invalid project directory ... \-p` | pnpm 11 不再剥离 `--`，字面量传给了 next | 已修复：`pnpm dev -p 3000 -H 127.0.0.1` |
| 所有请求挂死、`tsc` 报 typescript 缺失 | Next 16.3.2 默认 `useTypeScriptCli: true`，与 typescript6 别名不兼容 | 已在 next.config.js 关闭；换回标准 typescript 包后可移除该配置 |
| 提交时钩子报 `Class extends value undefined` | npm 11.19 在本机解析 .bin 别名链崩溃 | 钩子已改 `pnpm exec`；勿把钩子改回 npx |
| 打包启动器时报「无法清理 start-tauri」 | 残留的提权进程（如卡死的 pyinstaller/启动器）持有 `_internal` 文件，普通权限无法终止 | 重启后重试；应急：`pyinstaller --distpath dist-new tools/start-tauri.spec` 打到新目录后手动换文件 |
| 启动时先看到 Edge「无法访问此页面 / ERR_CONNECTION_REFUSED」（localhost 拒绝连接），之后才出现启动进度或直接黑等 | **壳编译时没带 `custom-protocol` feature**（裸 `cargo build --release`）：tauri 的 `cfg(dev)` 由该 feature 决定，不带它 = dev 模式行为——①启动页相对 URL 解析到 `build.devUrl`（http://localhost:3000/splash.html），dev server 未就绪时 WebView2 渲染错误页且永不重试（2026-09-02 定位，冷启动必现；官方 `pnpm tauri build` 会自动带该 feature，所以生产包没这问题）②资源根本没内嵌进二进制（启动页由 dev server 提供）。叠加因素：壳二进制过期（改了 src-tauri 后未重编，旧版 splash 的 `window.location.replace` 兜底把错误页顶上来）；WebView2 对导航失败也触发 on_page_load Finished，交换窗口前不校验可达性会把错误页当应用显示 | 重编壳必须带 feature：`cd src-tauri; cargo build --release --features custom-protocol`。现版壳已四重防护：splash 不再自导航、交换前 TCP 可达性校验、main 加载失败重导航循环、启动页看门狗（URL 被带走 1s 内恢复进度页） |
| 工作流库/项目列表整页空数据，tRPC 查询 500（console 报 no such table / Could not locate bindings） | **Drizzle 迁移三重遗漏**（2026-09-03 定位）：① better-sqlite3@11 无 Node 24 预编译包、本机无 MSVC → 原生绑定缺失，所有 DB 查询崩（升级到 v12，prebuild 下载即可）② `resolveDbPath` 用 `new URL("file:./db.sqlite")` 解析 → Windows 落到盘符根 `F:\db.sqlite` 空库（真实数据在 `prisma/db.sqlite`）③ schema.ts 表名 camelCase 与 Prisma 建的 PascalCase 表不一致 | ① better-sqlite3 钉在 v12（v13 移除预编译包，本机无编译链不能升）② 路径解析统一走 `path.resolve(process.cwd(), …)`（与 drizzle-kit 同锚点）③ 表名已重命名对齐 schema.ts；**换 Node 版本或重装依赖后先跑一次 `pnpm db:studio` 确认表与数据都在** |
| `pnpm run build` 卡在 Collecting page data 阶段并报 turbopack 全项目追踪告警（提示围绕 src/server/db.ts / api/health、以及 src/lib/comfyui/lifecycle.ts） | 若干动态文件访问点缺 turbopackIgnore 注解，turbopack 无法静态追踪 → 退化为「整个项目全量追踪」（standalone 会塞进全仓库 >8GB）。命中点：db.ts resolveDbPath 里 path.resolve(process.cwd(), raw)、lifecycle.ts 循环里 fs.existsSync(c.main) | 沿用仓库既有惯例给动态访问加 /*turbopackIgnore: true*/（同 envfile.ts / debug/source/route.ts / localWorkflows.ts），让 turbopack 放弃追踪该动态路径 |
| drizzle-kit push 非交互环境报 "Interactive prompts require a TTY"，或重建表时 "index xxx already exists" | push 遇到表重命名/重建差异需要交互确认；其重建路径在多次部分执行后有索引名冲突的已知缺陷 | 启动器用 `push --force`（非致命，失败仅 WARN）；手动收敛时按「清理 `__new_*` 残留表与同名索引 → 重试 push」循环；索引可安全 DROP 后由 push/schema 重建 |

| 任务报「任务卡在队列超过 Ns（…无人 re-claim）」 | ComfyUI 未运行：WS 连不上 → `processQueue` 不出队 → reaper 30s 判死 | 已加自动启动：配置 `comfyuiPath`（设置 → 创作后端）后任务执行前自动拉起 ComfyUI 并等待就绪；reaper 在启动窗口期跳过回收。也可在设置页手动点「启动 ComfyUI」。启动日志：`log/comfyui-runtime.log` |

## 6. 工具链钉死项（改之前必须理解原因）

| 位置 | 配置 | 原因 |
|---|---|---|
| `pnpm-workspace.yaml` | `minimumReleaseAge: 0` | lockfile 锁定的新包会被 pnpm 默认 24h 年龄门槛拒装 |
| `pnpm-workspace.yaml` | `allowBuilds`（6 个包） | pnpm 11 未批准构建脚本时非交互 install exit 1 |
| `pnpm-workspace.yaml` | `verifyDepsBeforeRun: false` | 隐式 install 在 dev server 运行期必然 EPERM |
| `next.config.js` | `experimental.useTypeScriptCli: false` | typescript6 别名无 bin/tsc，CLI 模式误报缺失并挂死请求 |
| `.githooks/pre-commit` | `pnpm exec`（非 npx） | npm 11.19 在本机损坏 |
| `package.json` | typescript 双别名（TS6 API + TS7 CLI） | Next 检测不认识别名，类型正确性由 `pnpm exec tsc --noEmit` 门禁保证 |

## 7. 构建流程

| 场景 | 命令 | 说明 |
|---|---|---|
| 只改了 Rust 壳 / 窗口配置 / 启动页 | `cd src-tauri; cargo build --release --features custom-protocol` | **必须带 `--features custom-protocol`**（见 §5「启动先看到 Edge 错误页」条目：不带会把启动页导航到 devUrl 且资源不内嵌）；增量编译约 1 分钟；启动器预检会提醒壳过期 |
| 生产构建（standalone + 安装包） | `tools\build\build-standalone.ps1` → `tools\build\build-tauri-release.ps1`（或 `tools\build\build-all.ps1`） | build-desktop.mjs 组装 static（含体积护栏 1.5GB）+ Node sidecar，再 `pnpm tauri build` |
| 重新打包双击启动器 | `tools\build\build-launcher.ps1` | PyInstaller onedir，产物 `start-tauri/`（gitignore） |
| 开发者工具箱 | `tools\build\rebuild-static.ps1` 等 / `dev-tools` | 见 `tools/README.md` |

改动 tauri.conf.json、src-tauri/src/**、splash-assets/** 之后**必须重编壳**
（`cargo build --release --features custom-protocol`，**feature 不能省**），
否则运行的是旧二进制（预检只会提醒，不会阻止——界面异常先想到这一条）。

## 8. Windows 入口规范：一律 .ps1，禁用 .bat / .cmd / .vbs

> 2026-09-04 制定（ISSUE #23）。仓库内**不再保留任何 `.bat` / `.cmd` / `.vbs` 入口**，
> 全部改为 `.ps1`；新写入口若出现这些后缀会被 `scripts/check-file-structure.cjs`
> 的 R7 规则在 pre-commit 阶段直接阻断。

### 8.1 为什么禁用

1. **中文必乱码**：`.bat` 由 cmd.exe 解释，走系统 ANSI 代码页（简体中文环境 GBK）。
   中文字面量与子进程（pnpm / cargo / next）输出的 UTF-8 字节在 cmd 窗口与重定向
   日志里双重失真，只有顶层一行 `chcp 65001` 救不回来（子进程输出仍按 GBK 解码）。
2. **入口被迫变成哑壳**：为绕开乱码，历史写法是「`.bat` 里不写中文、不写逻辑，只
   `powershell -File scripts\xxx.ps1`」。结果是本该在入口做的自检与提示全部下沉，
   入口退化成一层没有价值的间接跳转，新增入口还要手抄一遍 `%~dp0\..\..` 路径魔法。
3. **能力天花板低**：进程树回收、退出码透传、双击场景暂停这些需求在 `.bat` 里只能
   靠 `%errorlevel%` + `pause` + `cmdcmdline` 取巧；`.ps1` 有 `Start-Process -Wait
   -PassThru`、`$LASTEXITCODE`、`Get-CimInstance` 等一等公民手段。
4. **双语言维护成本**：`.bat` 与 `.ps1` 是两套语法，改一处常忘另一处；`.vbs`
   （原 `start-tauri.vbs`）更是第三种语言，只为实现「隐藏窗口启动」。

### 8.2 现在的分层

| 层 | 位置 | 职责 |
|---|---|---|
| 入口（双击用） | `tools/<分类>/*.ps1`（启动类 `tools/start/`、构建类 `tools/build/` 等） | 定位项目根、打印中文提示、调用逻辑脚本、透传退出码、双击场景等待按键 |
| 逻辑 | `scripts/*.ps1`、`tools/scripts/*.ps1` | 环境检查 / 构建 / 编排 / 日志落盘 |
| 公共库 | `scripts/entry-common.ps1` | `Get-ProjectRoot` / `Get-Pwsh` / `Invoke-Entry` / `Complete-Entry` / `Test-IsDoubleClicked` |

> **根目录不再放双击入口**（ISSUE #29，2026-09-04）：6 个启动入口曾平铺在仓库根，与
> `package.json` / `tsconfig.json` 等工程配置混排，既看不出「哪些是入口」，也让根目录
> 随入口增长持续膨胀。现统一归入 `tools/start/`，与 `tools/build/`、`tools/registry/`、
> `tools/studio/` 同构；根目录只保留工程配置与文档。入口的 discoverability 由 README 的
> 入口清单承担，不靠「铺在根目录第一眼看见」。该约束由 `scripts/check-file-structure.cjs`
> 的 R9 规则在 pre-commit 阶段强制（详见 §12.8）。

入口映射（改逻辑时别改错文件）：

| 入口 | 逻辑 |
|---|---|
| `tools/start/start-web.ps1` | `scripts/dev-launcher.ps1` |
| `tools/start/start-tauri.ps1`（隐藏窗口，原 `.vbs`） | `scripts/dev-launcher.ps1 -Tauri` |
| `tools/start/run-local.ps1` | `scripts/prepare-local-run.ps1` |
| `tools/start/verify-quality.ps1` | `scripts/quality-gate.ps1` |
| `tools/start/register-comfyapp-protocol.ps1` | `scripts/install-comfyapp-helper.ps1` |
| `tools/start/start-desktop.ps1`（原 `run-desktop.bat`，自检逻辑内联） | — |
| `tools/build/*.ps1` | `tools/scripts/*.ps1`（同名） |
| `tools/registry/start-registry.ps1` | `tools/scripts/start-registry.ps1` |
| `tools/studio/start-studio.ps1` | `tools/studio/start-studio.logic.ps1` |

### 8.3 一次性前置：让双击真的执行 .ps1

Windows 对 `.ps1` 的默认双击动作是**用记事本打开**（安全默认）。首次使用前需把
文件关联改成「用 PowerShell 运行」，仓库提供一次性脚本（只写 `HKCU`，免管理员）：

```powershell
# 资源管理器里右键本文件 →「使用 PowerShell 运行」，或在终端执行：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-ps1-double-click.ps1
```

它写入 `HKCU\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command`，
撤销：

```bat
reg delete "HKCU\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command" /f
```

> 关联生效后**任意** `.ps1` 双击都会执行（包括下载来的可疑脚本）；不希望如此就撤销。

### 8.4 编写新入口的三条规则

1. **入口不写业务逻辑**，只做定位 → 调用 → 收尾，逻辑下沉到 `scripts/`；
2. 以 UTF-8 **with BOM** 保存（Windows PowerShell 5.1 读无 BOM 的脚本会把中文按
   GBK 解码——与 `.bat` 乱码同源，别在 `.ps1` 上重蹈覆辙，见 §5）；
3. 收尾统一走 `Complete-Entry`，让「双击时暂停、终端调用时直接退出」的行为一致，
   不再需要旧 `.bat` 的 `no-pause` 参数传递约定；
4. **放 `tools/<分类>/`，不放仓库根**（R9，见 §8.2 与 12 章 §12.8）。新增入口前先
   看 `tools/` 下是否已有同分类目录，没有再新建——分类目录按用途划分（start /
   build / registry / studio），不要按人名或临时用途建目录。

### 8.6 tools/ 目录分类（新增入口放哪）

| 目录 | 放什么 | 现有入口 |
|---|---|---|
| `tools/start/` | **启动/初始化类**：起 dev server、起桌面壳、环境自检、质量门禁 | `start-web.ps1`、`start-tauri.ps1`、`start-desktop.ps1`、`run-local.ps1`、`verify-quality.ps1`、`register-comfyapp-protocol.ps1` |
| `tools/build/` | **构建打包类**：编译壳、打启动器 exe、重建 static | `build-all.ps1`、`build-launcher*.ps1`、`build-standalone.ps1`、`build-tauri-release.ps1`、`rebuild-static.ps1` |
| `tools/registry/` | 团队 shadcn Registry | `start-registry.ps1` |
| `tools/studio/` | 数据库工具 | `start-studio.ps1` |
| `tools/scripts/` | 上述入口对应的**逻辑脚本**（与入口同名不同层） | `build-*.ps1`、`start-registry.ps1`、`Log-Common.ps1` |

入口与逻辑同名时靠**目录**区分（`tools/build/build-all.ps1` 是入口、
`tools/scripts/build-all.ps1` 是逻辑）；同目录内无法同名时用后缀区分，如
`tools/studio/start-studio.logic.ps1`。

### 8.5 排障补充：双击 .ps1 只是打开了记事本

| 症状 | 根因 | 对策 |
|---|---|---|
| 双击入口用记事本打开了脚本、没有执行 | 未做文件关联（§8.3 的一次性前置没跑） | 右键 `scripts/enable-ps1-double-click.ps1` →「使用 PowerShell 运行」 |
| 双击闪一下就没了，看不到报错 | 入口已执行并快速退出；`.ps1` 退出后窗口随之关闭 | 入口在双击场景（父进程是 explorer）会自动暂停，见 `Complete-Entry`；若仍闪退说明脚本在收尾前抛异常，改用终端执行 `pwsh -File .\入口.ps1` 看完整输出 |
| 终端执行提示「禁止运行脚本」 | 机器执行策略为 Restricted | `pwsh -ExecutionPolicy Bypass -File .\入口.ps1`（入口内部已自带该参数，直接双击不受影响） |
