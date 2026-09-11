# 启动与构建流程规范

> 适用范围：Windows 桌面壳（{{shell.exe.prebuilt}}）启动链路、dev server、桌面壳编译与生产构建。
> 2026-09-02 依据当日五类启动故障的复盘制定。改流程前先读本文；改完流程必须更新本文。
> AI 协作：本仓库根的 `AGENTS.md` 会在编码代理会话开始时自动加载，并把本文列为
> 强制前置阅读；修改硬规则时必须同步 `AGENTS.md` 的摘要。

> **占位符约定**：本文中 `{{...}}` 形式的占位符代表文档引用的真实值（如可执行文件名、地址），
> 真实值由 `pnpm doc:check` 运行时从源码/配置动态提取并核对。占位符语义见
> [`docs/reference-facts.md`](../reference-facts.md)。改动上游源码后可运行
> `pnpm doc:check` 检查本文是否有值未同步。


## 1. 启动链路与分层职责

```
双击 start-tauri\{{shell.exe.prebuilt}}（scripts/start_tauri_launcher.py → PyInstaller）
  │  职责：单实例保护、失败弹窗（人类可见出口）、run/launch-status.json 进度
  ▼
pwsh -File scripts\dev-launcher.ps1 -Prebuilt
  │  职责：预检（依赖/壳时效）、进程编排、日志体系、taskkill /T 进程树回收
  ├─▶ src-tauri\target\release\{{shell.app.exe}}（Tauri 壳，秒出窗口）
  │     职责：splash 窗口展示启动进度（读 run/launch-status.json）
  │           + 「查看日志」面板（读 log/ 下启动器日志尾部，get_launch_log 命令）
  │           + main 窗口隐藏待命；splash 探测就绪后 navigate_to_app 交换窗口
  │           （交换前做 TCP 可达性校验，失败进入重导航循环——WebView2 对导航
  │           失败同样触发 on_page_load Finished，不校验会把 Edge 错误页
  │           当成应用界面显示）
  └─▶ cmd → pnpm dev → node next dev（127.0.0.1:3100）
        就绪后 splash 调 navigate_to_app → main 加载 /workspace → 交换窗口
```

分层边界（不要越层做事）：
- **Python 启动器**不做进程树管理（它退出时 dev-launcher 必须还能活着继续工作）；
- **dev-launcher.ps1** 是唯一的进程编排者：启动、预检、清理都在这一层；
- **Rust 壳**只负责窗口与导航，不启动任何进程（dev 模式）；
- 任何一层失败都必须有人类可见的出口（弹窗/窗口内提示），禁止只写文件。

### 1.1 端口统一配置（COMFYAPP_PORT）

应用端口**不做硬编码**，统一由 `.env` 的 `COMFYAPP_PORT` 控制（默认 `3100`）。
当端口与其他应用冲突时，改 `.env` 一处、重启应用即可，无需改代码。各层读取来源：

| 层 | 读取方式 |
|---|---|
| dev-launcher.ps1 | 启动时解析 `.env` 的 `COMFYAPP_PORT`，用于 `pnpm dev -p`、健康检查、端口清理、`COMFYAPP_DEV_URL` |
| start_tauri_launcher.py | `_read_app_port()` 解析 `.env`，用于 `COMFYAPP_DEV_URL` 与 launch-status 的 `app_url` |
| Rust 壳（lib.rs） | `default_dev_url()` 读 `COMFYAPP_PORT` 环境变量（fallback 时用） |
| tauri.conf.json | `beforeDevCommand: node scripts/dev.mjs`，读 `.env` 端口后启动 next dev |
| 前端 tRPC | `process.env.COMFYAPP_PORT ?? process.env.PORT ?? 3100` |

> 取值合法性：1~65535；非法或缺失时统一回退 3100，并在启动日志中 WARN 提示。
>
> **推荐经 `start-tauri.ps1` / `{{shell.exe.prebuilt}}`（launcher）启动**：launcher 会把
> `COMFYAPP_DEV_URL` / `COMFYAPP_PORT` 注入壳进程，`tauri.conf.json` 的静态 `devUrl`
> 仅作为兜底，不参与主导航。若绕过 launcher 直接 `pnpm tauri dev` 且改了端口，
> 需同步修改 `src-tauri/tauri.conf.json` 的 `build.devUrl` 指向新端口。

### 1.2 comfy-cli 运行环境（python 启动器层，后台兜底）

raw UI-format（liblib 子图）工作流由 `src/lib/comfyui/executor-cli.ts` 交给项目内的
comfy-cli 做 UI→API 转换，解释器固定为 `<项目根>\python-venv\comfy-cli\Scripts\python.exe`。
`start_tauri_launcher.py` 的 `ensure_comfy_cli_venv()` **每次启动都后台触发一次**
`scripts/setup-comfy-cli-venv.ps1`（不阻塞启动，独立进程组），判断逻辑全部在脚本里：

| 环境状态 | 动作 |
|---|---|
| venv 缺失 / `comfy_cli` 不可导入 | 建 venv → 升 pip → 装 comfy-cli |
| 已就绪，版本落后 PyPI | `pip install --upgrade comfy-cli`，状态写 `phase=upgrade` |
| 已就绪且已是最新 | 只记日志，零副作用 |

硬约束（改这条链路前必读）：

1. **启动器侧不要早退**：venv 存在也必须触发脚本，否则 venv 一旦建好就再也不会升级，
   用户会长期停在有缺陷的旧版本上（1.17~1.19 的子图覆盖失效即此类）。
2. **版本检查必须节流**：默认 24h 一次（状态落 `run/comfy-cli-upgrade-check.json`，
   `{ last_check_at, installed, latest }`），手工执行用 `-Force` 跳过节流。启动是高频动作，
   不节流等于每次启动都联网问 PyPI。
3. **查不到最新版 / 升级失败都不得阻断启动**：离线是常态，venv 仍可用旧版本；
   降级路径要有日志（`log/tools/comfy-cli-setup.log`）与状态 message 出口。
4. 日志与状态文件沿用 §4 布局：`log/tools/comfy-cli-setup.log`、
   `run/comfy-cli-setup.json`（`{ phase, message, done, error, updated_at }`）。

## 2. 启动预检（dev-launcher.ps1，新增于 2026-09-02）

预检分两段：**工具链门禁**（`Test-ToolchainGate`）在预编译壳弹出**之前**执行，只做只读致命快检——命中即 throw，让 python 启动器在 Tauri 窗口出现前弹 MessageBox 告知根因（双击 exe 场景下窗口未现即弹窗）；**完整依赖预检**在壳窗口出现之后执行（见 §1：窗口秒出后再由 splash 展示进度）。

### 2.1 工具链门禁（弹壳前，只读快检，任一失败立即终止并弹窗）

1. **pnpm 命令可用性**：corepack shim 存在但切换版本缓存损坏（如 `.tools\pnpm\<ver>\bin` 缺失）时 `pnpm -v` 报 `Failed to switch pnpm to ... ENOENT`，命令完全不可用。此为致命损坏——install/dev 全依赖 pnpm，弹壳也起不来服务，直接报错给修复指引，不弹黑窗口。
2. **node_modules 是否完全未装**：`.modules.yaml` 缺失 = 依赖从未正确安装，引导先跑 `tools\start\run-local.ps1`。

### 2.2 完整依赖预检（壳窗口出现后）

按顺序执行，任一失败立即终止并展示日志尾部：

1. **残留壳清理**：按命令行匹配终止上次运行遗留的同项目 {{shell.app.exe}}（防窗口叠加）。
2. **端口清理**：杀掉 3100/3101/3102 的监听进程（防挤到 3101 连旧代码）。
3. **缓存指纹**：next.config/tsconfig/package.json/lockfile 指纹变化才清 .next。
4. **pnpm 版本一致性检查**：比对 `package.json` 的 `packageManager` 声明版本与
   `pnpm -v` 实际版本。一致则跳过；不一致且 corepack 可用时自动
   `corepack prepare pnpm@<期望版本> --activate` 对齐（需联网一次），成功 OK；
   自动对齐失败仅 WARN 并透出到启动页（复用 stale_shell 字段，不阻断启动）。
   手动对齐指引：`corepack enable && corepack prepare pnpm@<期望版本> --activate`。
   > 此步也会兜底识别 pnpm 命令**完全不可用**（探测拿不到版本号，见 §5 新增行），
   > 但若已先经过 §2.1 门禁，此处通常到不了该分支。
5. **node_modules 健康检查**：`.modules.yaml` 与 `.bin/next` 缺失，或关键依赖目录
   （`typescript`、`@typescript/native`、`next`）**存在但为空**（pnpm 策略拒装/中断安装的典型残留——空目录会让 tsc 垫片找不到入口），即视为残缺。显式跑一次 `pnpm install`（CI 模式），失败立刻报错带日志尾部；install 后仍残缺也明确报错而非静默通过。日志：`log/launcher/pnpm-install-stdout/stderr.log`。
   > 判空注意：顶层关键依赖在 pnpm 下是指向 `.pnpm` store 的 **junction/symlink**。
   > 不能直接用 `Get-ChildItem -LiteralPath` 枚举判空——pwsh 对 reparse point 的
   > 枚举跨版本不一致，健康安装也可能被误判为空（假阳性 → 启动中断，见 ISSUE #196）。
   > 正确做法：先用 `Resolve-Path` 解析出链接目标的真实绝对路径，再对真实目录用
   > .NET `[System.IO.Directory]::EnumerateFileSystemEntries` 判非空（Win32 层透明跟随，
   > 稳定）。已由 `Get-BrokenKeyDeps` 落地。
   > 返回语义注意：`Get-BrokenKeyDeps` 必须 `return $broken`，不能写成 `return ,$broken`
   > （unary comma 防展开）。后者在依赖健康、`$broken` 为空数组时会把「一个空数组」
   > 当作单对象输出，调用方 `@(Get-BrokenKeyDeps)` 收集成 `.Count=1` 的空子数组，健康
   > 环境也会被判残缺、反复 `pnpm install` 却 “Already up to date” 无法自愈（见 §5 对应行）。
6. **壳时效提醒**：{{shell.app.exe}} 比 tauri.conf.json / src\*.rs / splash-assets 旧时
   WARN 提醒重编（`cd src-tauri; cargo build --release --features custom-protocol`）。
   窗口配置与启动页是编译期内嵌的，只改源码不重编壳 = 跑旧逻辑（黑屏问题的
   直接来源）。
7. **数据库 schema 同步（Drizzle）**：依赖预检后执行 `pnpm exec drizzle-kit push`，
   以 ALTER 方式把 `src/server/db/schema.ts` 的表结构增量同步进 `db.sqlite`
   （保留现有数据）。改用 Drizzle 后不再有「运行时必须重新 prisma generate 一个
   庞大 client + DLL 被锁」的步骤；改了 schema 后双击启动即可自动生效。失败仅
   WARN（不阻断启动），日志：`log/launcher/drizzle-push-stdout/stderr.log`。

## 3. 进程树管理规范

- 启动器只允许用 `taskkill /PID <pid> /T /F` 回收进程树。`Process.Kill()`
  只杀 cmd.exe 外壳，node/pnpm 子进程会残留（占端口、锁日志文件）。
- Job Object 的 `KILL_ON_JOB_CLOSE` 标志在本机设置失败（Win32 错误 87，
  标准调用亦然，疑似系统构建/安全软件拦截），启动器会 WARN 并依赖自身
  兜底清理。**不要**假设 Job 标志生效。
- 桌面壳（{{shell.app.exe}}）的生命周期必须有人兜底：壳由 dev-launcher.ps1 拉起，正常路径以「壳退出」为锚点回收；**启动器先退出（用户关掉启动器窗口 / python 监控线程结束）时壳会变成无主常驻进程**（窗口没了、进程还在，锁住 `target\release\{{shell.app.exe}}`）。因此：
  - dev-launcher.ps1 启动前按「exe 真实路径落在本仓库 `src-tauri\target\{release,debug}`」回收残留壳（**不要**按 `CommandLine -like` 判断：预编译壳经 `ProcessStartInfo(UseShellExecute=false)` 启动，命令行里不含项目根路径，会漏判）；
  - 壳拉起后把 PID 写入 `log/launcher/tauri-shell.pid`，python 启动器的监控线程在 dev-launcher 退出/异常/超时路径检查该 PID，仍存活就 `taskkill /PID <pid> /T /F` 补刀并删除 PID 文件。
- pnpm 已关闭 `verifyDepsBeforeRun`（见 §6）：任何 pnpm 命令都不会隐式
  补跑 install。dev server 运行期间不要手动跑 `pnpm install`
  （better-sqlite3 等原生模块被进程锁定，install 会 EPERM）。

## 4. 日志布局（排障从上往下看）

`log/` 按子系统分区，禁止新文件平铺在根目录（路径常量的唯一事实来源：
`src/lib/log-paths.ts`，Node 侧一律从该模块取路径）：

```text
log/
├─ launcher/           双击启动链路：python 启动器 + dev-launcher 编排与预检输出
├─ nextjs/             Next dev server 原始输出（按次命名，保留 5 份）
├─ services/           常驻服务运行时日志（comfyui / drizzle-studio / ollama，追加写）
├─ tools/              构建与工具脚本日志（tools/scripts/Log-Common.ps1、setup 脚本）
└─ archive/<yyyy-MM>/  dev-launcher 历史归档
```

| 文件 | 写者 | 内容 | 轮转 |
|---|---|---|---|
| `log/launcher/dev-launcher.log` | dev-launcher.ps1（Transcript） | 本次启动全量：预检/启动步骤/清理 | 每次运行覆盖；归档到 `log/archive/<yyyy-MM>/` |
| `log/launcher/dev-launcher-current.txt` | dev-launcher.ps1 | 指向本次真实日志的 sentinel（log 被锁回退改名时靠它定位） | 同上 |
| `log/nextjs/nextjs-stdout-<ts>.log` `log/nextjs/nextjs-stderr-<ts>.log` | dev-launcher.ps1 重定向 | Next dev server 原始输出；**启动失败先看 stderr** | 按次命名，保留 5 份 |
| `log/launcher/dev-launcher-stderr.log` | python 启动器重定向 | pwsh 的 stderr + {{shell.app.exe}} 的 `[ComfyAPP]` 诊断行（dev 下壳诊断经 log:: → Stderr target 仍落这里） | 每次启动覆盖 |
| `log/shell/shell.log` | Tauri 壳（tauri-plugin-log，release 构建） | 壳自持日志：导航/看门狗/侧车/窗口交换等 `[ComfyAPP]` 诊断（standalone 双击无 launcher 重定向时的兜底落盘）；get_launch_log 启动面板尾部追加展示 | KeepOne 轮转 |
| `log/launcher/start-tauri-launcher.log` | python 启动器 | 双击→pwsh→窗口检测的链路日志 | 超过 512KB 轮转，保留 5 份 |
| `log/launcher/pnpm-install-stdout/stderr.log` | dev-launcher.ps1（依赖预检） | 自动补装依赖的原始输出 | 每次触发覆盖 |
| `log/launcher/drizzle-push-stdout/stderr.log` | dev-launcher.ps1（schema 同步） | drizzle-kit push / heal-db 的原始输出 | 每次启动覆盖 |
| `log/launcher/tauri-shell.pid` | dev-launcher.ps1 写 / python 启动器读+删 | 本次拉起的桌面壳 PID；启动器先退出时靠它对仍存活的壳做 `taskkill /T /F` 兜底回收（见 §3） | 每次启动覆盖，兜底回收后删除 |
| `run/launch-status.json` | python 启动器 | 结构化启动进度，splash 页展示；launcher 退出 30s 后自删 | — |
| 启动页「查看日志」面板 | splash 前端轮询 `get_launch_log` | dev-launcher.log（经 sentinel 定位）+ dev-launcher-stderr.log + log/shell/shell.log（release）的尾部（去 ANSI、限长），启动页实时看执行到哪一步 | — |
| `.next/dev/logs/next-development.log` | Next dev server | dev server 内部日志（含锁冲突提示） | Next 自管 |
| `log/services/comfyui-runtime.log` | Next server（src/lib/comfyui/lifecycle.ts） | ComfyUI 拉起/spawn 参数/等待与就绪结论 + 子进程 stdout/stderr（`[out]`/`[err]` 前缀），时间戳为本地时间；每次启动/停止前会写一条 **ANSI 亮色会话横幅**（`▶`/`■` box 分隔线），使多次启动累积的日志能一眼分清会话边界；设置页「创作后端 → 启动日志」面板经 `GET /api/logs/current?source=comfyui-runtime` 实时跟随。手动启动不设硬超时（冷加载慢不误报，可手动关闭中止）；任务自动启动保留 420s 上限（防止 reaper 启动窗口被无限拉长） | 追加不轮转；接口首次打开只回尾部 128KB |
| `log/services/comfyui-keepalive-<ts>.out/.err.log` | dev-launcher 保活中介（Start-Process 重定向） | 保活模式下 ComfyUI 的完整原始输出，等待循环增量跟随进 runtime.log | 按次命名，不自动清理 |
| `log/services/drizzle-studio-runtime.log` `log/services/ollama-runtime.log` | Next server（对应 lifecycle / api 路由） | Drizzle Studio / Ollama 拉起与子进程输出，设置页日志面板跟随（同 comfyui-runtime 模式） | 追加不轮转 |
| `log/services/app-runtime.log` | Next server（src/lib/app-runtime-log.ts） | **应用运行期业务操作日志**：tRPC 中间件每次调用（path+duration+type）+ 生成任务入队/完成/失败等里程碑，`[日期时间] [LEVEL] [ns] msg` 本地时区行格式；仅记事件/耗时/类型，不外泄 prompt/PII；应用内「应用日志」面板经 `GET /api/logs/current?source=app-runtime` 实时轮询（规范 07 §7.11）。**面板只显示本次运行**：本文件追加不轮转，服务端在轮询响应里带回「会话起点」（dev-launcher.log 的 mtime），面板据此丢弃早于起点的历史行（`src/lib/log-session-scope.ts`，见 §4.1） | 追加不轮转 |
| `log/tools/*.log` | tools/scripts（Log-Common.ps1）与 setup 脚本 | 构建/打包/工具运行日志（build-tauri-release、build-standalone、build-launcher、rebuild-static、comfy-cli-setup 等） | 每次运行覆盖 |
| `log/archive/<yyyy-MM>/dev-launcher-<ts>.log` | dev-launcher.ps1 | 历史归档 | 无限累积，定期清理 |

### 4.1 面板「只显示本次运行」的会话边界

`log/services/` 下的 runtime 日志（comfyui / drizzle-studio / ollama）与
`app-runtime.log` 都是**追加不轮转**的：上一次、上上一次运行的内容全留在文件里。
「应用日志」面板若照单全收，用户打开面板看到的一屏里混着历史运行的行，分不清
哪条属于本次启动。会话边界由三处配合划定：

| 环节 | 位置 | 职责 |
|---|---|---|
| 粒度起点 | `dev-launcher.log` 的 mtime | 双击链路每次运行都覆盖重建该文件，mtime 即本次启动时刻；读不到（非双击链路）时面板退化为不做截断，多显示几条历史也好过凭空丢掉本次日志 |
| 起点下发 | `GET /api/logs/current` 的 `sessionStart` 字段 | 追加写来源的分支在每次响应里带回起点，客户端无需额外请求 |
| 行级截断 | `src/lib/log-session-scope.ts` + `log-store.ts` 的 `dropStaleEntries` | 行时刻早于起点即判为历史并丢弃；`setSessionStart` 幂等，页面重载不会把起点往后推 |

时间戳只能回答「文件有没有在本次运行期间被写过」，回答不了「本次内容从第几个
字节开始」，因此**不做字节级跳过**——线格式自带毫秒时间戳，按行比较即可精确切分。
面板每行右侧标注来源（`dev` / `launcher` / `app-runtime`），便于对照文件排查。

> 服务页「创作后端 → 启动日志」「数据库工具 → 启动日志」跟随的是
> comfyui-runtime / drizzle-studio-runtime，**不在**该机制覆盖范围内：它们是
> 单个服务的会话视图，靠会话横幅（`▶`/`■`）区分边界，由用户主动点「刷新」。

排障顺序：`log/launcher/start-tauri-launcher.log`（双击层发生了什么）→
`log/launcher/dev-launcher-stderr.log`（pwsh/壳层报错）→
`log/launcher/dev-launcher.log`（编排步骤走到哪）
→ `log/nextjs/nextjs-stderr-<ts>.log`（dev server 报错）。失败弹窗已包含后两者的尾部。

## 5. 排障手册（症状 → 已知根因）

| 症状 | 根因（历史案例） | 对策 |
|---|---|---|
| 双击 exe：启动即报「pnpm 工具链不可用 / 无法获取 pnpm 版本」并弹窗 | corepack 管理的 pnpm 在切换版本时本地缓存损坏：`.tools\pnpm\<ver>\bin` 缺失 → `pnpm -v` 报 `Failed to switch pnpm to pnpm@<ver> ... ENOENT`，命令完全不可用（install/dev 全依赖 pnpm） | 已由 `Test-ToolchainGate`（弹壳前）拦截并弹 MessageBox 给修复步骤：`corepack enable && corepack prepare pnpm@<版本> --activate`（重建缓存，需联网一次），仍不行则删除损坏缓存后重装 Node/pnpm |
| 启动后 splash 停在依赖预检报「关键依赖目录 typescript / @typescript/native / next 为空或缺失」 | pnpm 中断安装/拒装留下「目录在但内容空」的残缺（如 typescript 与 @typescript/native 空目录 → tsc 垫片找不到入口），旧版只查 `.modules.yaml` / `.bin/next` 查不出 | 已由 `Test-DevDependencies` 覆盖关键目录非空检测，残缺时自动 `pnpm install` 自愈；install 后仍残缺则明确报错并指向 `log/launcher/pnpm-install-stderr.log` |
| `pnpm install` 已成功（exit 0）但仍报「node_modules/…为空或缺失」启动失败；同机跑 `sync-lint.ps1`/`run-local.ps1` 却正常 | 假阳性：`Get-BrokenKeyDeps` 用 `Get-ChildItem -LiteralPath` 枚举顶层 junction/symlink 判空，pwsh（7.6.5 实测）对这类 reparse point 的枚举可能返回 0 项 → 健康安装被误判残缺，触发 install 后因 `.modules.yaml`/lockfile 已一致而“Already up to date”无法自愈，二次复查仍误报 | 已修：先 `Resolve-Path` 解析到链接目标真实绝对路径，再用 .NET `Directory.EnumerateFileSystemEntries` 对真实目录判非空（见 §2.2 step 5）。同步/自检脚本（sync-lint/run-local）本就只查 `.modules.yaml`+`.bin`+lockfile，故不受影响 |
| junction 枚举已修（见上）后仍报「node_modules/ 仍为空或缺失」且 `pnpm install` 显示 “Already up to date”；报错串中目录名后为空 | 第二处假阳性：`Get-BrokenKeyDeps` 结尾 `return ,$broken`（unary comma 防外层展开）。当依赖健康、`$broken` 为空数组 `@()` 时，`,@()` 向外输出「一个空数组」单对象，调用方 `@(Get-BrokenKeyDeps)` 收集成 `@(@())`——`.Count` 恒为 1 而非 0 → 健康环境永远被判有坏依赖，install 因依赖本就完好返回 exit 0 无法自愈，二次复查 `foreach ($d in …)` 取出空数组元素（`"$d"` 为空）再误报抛错 | 已修：函数改 `return $broken`——空数组不产生输出，`@(...)` 得 0 项；非空正常展开，`foreach`/`.Count` 语义正确（见 §2.2 step 5）。勿再加 unary comma |
| 双击 exe 完全无窗口、无报错 | ① dev-launcher 静默失败（旧版无弹窗）② 日志文件被残留进程锁死 | 已修复：失败弹窗 + 日志按次命名。若复现，看 `start-tauri-launcher.log` 末行 exit code 与 `dev-launcher-stderr.log` |
| 窗口黑屏，左上角 `asset not found: {{shell.splash}}` | splash 窗口 URL 用了 macOS/Linux 形式的 `tauri://localhost`，Windows 资源源是 `http(s)://tauri.localhost`；或改了 splash-assets 但没重编壳 | tauri.conf.json 用相对路径 `{{shell.splash}}`；重编壳 |
| dev server「提前退出 exit=1」且无输出 | cmd 重定向目标文件被残留进程锁定，打开即失败 | 已修复：nextjs 日志按次命名。残留进程见 §3 |
| `pnpm install` 被拒：`minimumReleaseAge` / `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 11 默认拒绝发布不足 24h 的包 | 已在 pnpm-workspace.yaml 关闭；新包确认可信后可按需放开 |
| `pnpm install` exit 1：`ERR_PNPM_IGNORED_BUILDS` | pnpm 11 默认不批准第三方 postinstall | 已在 pnpm-workspace.yaml `allowBuilds` 批准 6 个包；新增含构建脚本的依赖需补充 |
| 任何 pnpm 命令连锁失败：better-sqlite3 `EPERM rename ...node` | dev server 运行中锁着原生模块 + pnpm 隐式依赖检查触发 install | 已关闭 `verifyDepsBeforeRun`；关 dev server 再装依赖 |
| `next dev` 报 `Invalid project directory ... \-p` | pnpm 11 不再剥离 `--`，字面量传给了 next | 已修复：`pnpm dev -p 3100 -H 127.0.0.1` |
| 所有请求挂死、`tsc` 报 typescript 缺失 | Next 16.3.2 默认 `useTypeScriptCli: true`，与 typescript6 别名不兼容 | 已在 next.config.js 关闭；换回标准 typescript 包后可移除该配置 |
| 提交时钩子报 `Class extends value undefined` | npm 11.19 在本机解析 .bin 别名链崩溃 | 钩子已改 `pnpm exec`；勿把钩子改回 npx |
| 构建 release 壳在编译收尾报 `error: failed to remove file ...\target\release\{{shell.app.exe}}` / `Caused by: 拒绝访问。 (os error 5)` | 上一次启动的桌面壳（{{shell.app.exe}}）还开着：cargo 覆盖产物前会先删除旧 exe，Windows 不允许替换运行中进程的可执行文件。等待整个 Rust 编译（可能十几分钟）走完才失败，报错本身也看不出「壳还在跑」（2026-09-06 定位） | 不要用任务管理器单杀壳（其 Next dev server 子进程会残留占端口，见 §3）：正常关闭桌面窗口即可（壳退出时会自行 `taskkill /T` 回收 sidecar 进程树），无响应时用 `taskkill /IM {{shell.app.exe}} /T /F`。已由 `tools/scripts/Build-Guard.ps1` 把这类占用提到编译**之前**拦截，并在失败时追加提示（见 §7） |
| 桌面窗口已经关了，`{{shell.app.exe}}` 进程还在（只能手工 `taskkill /IM {{shell.app.exe}} /T /F`） | **启动器先于壳退出，壳成了无主进程**：壳由 dev-launcher.ps1 拉起，正常路径以「壳退出」为锚点回收；但用户关掉启动器窗口 / python 监控线程结束时 dev-launcher 的 `WaitForExit` 与 taskkill 兜底都没机会跑。旧实现的「残留壳清理」还按 `CommandLine -like "*<项目根>*"` 筛选，而预编译壳经 `ProcessStartInfo(UseShellExecute=false)` 启动、命令行里不含项目根路径 → 既漏判残留，也让残留壳锁住 `target\release\{{shell.app.exe}}`（连带 §5「os error 5」那条） | 已三层治理（2026-09-06 定位）：①启动前按 **exe 真实路径**回收残留壳；②壳拉起后 PID 落 `log/launcher/tauri-shell.pid`，python 启动器在监控退出/异常/超时时对仍存活的 PID 执行 `taskkill /PID <pid> /T /F` 后删除该文件；③正常关窗仍走 dev-launcher 的进程树回收。见 §3 |
| 打包启动器时报「无法清理 start-tauri」 | 残留的提权进程（如卡死的 pyinstaller/启动器）持有 `_internal` 文件，普通权限无法终止 | 重启后重试；应急：`pyinstaller --distpath dist-new tools/start-tauri.spec` 打到新目录后手动换文件 |
| 启动时先看到 Edge「无法访问此页面 / ERR_CONNECTION_REFUSED」（localhost 拒绝连接），之后才出现启动进度或直接黑等 | **壳编译时没带 `custom-protocol` feature**（裸 `cargo build --release`）：tauri 的 `cfg(dev)` 由该 feature 决定，不带它 = dev 模式行为——①启动页相对 URL 解析到 `build.devUrl`（http://localhost:3100/{{shell.splash}}），dev server 未就绪时 WebView2 渲染错误页且永不重试（2026-09-02 定位，冷启动必现；官方 `pnpm tauri build` 会自动带该 feature，所以生产包没这问题）②资源根本没内嵌进二进制（启动页由 dev server 提供）。叠加因素：壳二进制过期（改了 src-tauri 后未重编，旧版 splash 的 `window.location.replace` 兜底把错误页顶上来）；WebView2 对导航失败也触发 on_page_load Finished，交换窗口前不校验可达性会把错误页当应用显示 | 重编壳必须带 feature：`cd src-tauri; cargo build --release --features custom-protocol`。现版壳已四重防护：splash 不再自导航、交换前 TCP 可达性校验、main 加载失败重导航循环、启动页看门狗（URL 被带走 1s 内恢复进度页） |
| 打开设置失败，页面只剩一句「配置数据未就绪」（没有原因、没有重试、日志面板里也找不到对应失败） | **判据取错**（ISSUE #304）：设置页有两个查询（`setting.get` / `llm.configGet`），降级视图此前只在「两份数据都没拿到」时才触发。当一份成功、一份失败（如 `llm` 相关表缺失 → `no such table: llmConfig`）时，草稿两份都不齐却又不满足该条件，容器一路落到兜底文案。叠加两个观测缺陷：①补记日志的 `query` 字段写死成 `setting.get`，与实际失败的查询对不上；②只记翻译后的可读文案（`signal is aborted without reason` 被译成「请求被中断，请稍候重试」），服务端原文丢失，用户按提示反复等重启永远修不好 | 已修：`hasError = 任一查询失败 且 草稿未就绪`（一份成功一份失败也落错误视图）；日志按实际失败查询记全名称，并把原始报错（tRPC `code` / 服务端 `message` / `cause` / 堆栈首行）写入 `raw` 字段；`errorMessage` 优先取 `shape.message` 的服务端原文，不让传输层包装文案盖掉根因。见 07 §7.12.1 |
| 工作流库/项目列表整页空数据，tRPC 查询 500（console 报 no such table / Could not locate bindings） | **Drizzle 迁移三重遗漏**（2026-09-03 定位）：① better-sqlite3@11 无 Node 24 预编译包、本机无 MSVC → 原生绑定缺失，所有 DB 查询崩（升级到 v12，prebuild 下载即可）② `resolveDbPath` 用 `new URL("file:./db.sqlite")` 解析 → Windows 落到盘符根 `F:\db.sqlite` 空库（真实数据在 `prisma/db.sqlite`）③ schema.ts 表名 camelCase 与 Prisma 建的 PascalCase 表不一致 | ① better-sqlite3 钉在 v12（v13 移除预编译包，本机无编译链不能升）② 路径解析统一走 `path.resolve(process.cwd(), …)`（与 drizzle-kit 同锚点）③ 表名已重命名对齐 schema.ts；**换 Node 版本或重装依赖后先跑一次 `pnpm db:studio` 确认表与数据都在** |
| `pnpm run build` 卡在 Collecting page data 阶段并报 turbopack 全项目追踪告警（提示围绕 src/server/db.ts / api/health、以及 src/lib/comfyui/lifecycle.ts） | 若干动态文件访问点缺 turbopackIgnore 注解，turbopack 无法静态追踪 → 退化为「整个项目全量追踪」（standalone 会塞进全仓库 >8GB）。命中点：db.ts resolveDbPath 里 path.resolve(process.cwd(), raw)、lifecycle.ts 循环里 fs.existsSync(c.main) | 沿用仓库既有惯例给动态访问加 /*turbopackIgnore: true*/（同 envfile.ts / debug/source/route.ts / localWorkflows.ts），让 turbopack 放弃追踪该动态路径 |
| drizzle-kit push 非交互环境报 "Interactive prompts require a TTY"，或重建表时 "index xxx already exists" | push 遇到表重命名/重建差异需要交互确认；其重建路径在多次部分执行后有索引名冲突的已知缺陷 | 启动器用 `push --force`（非致命，失败仅 WARN）；手动收敛时按「清理 `__new_*` 残留表与同名索引 → 重试 push」循环；索引可安全 DROP 后由 push/schema 重建 |
| 设置/工坊/模型等 `(main)` 路由组页面整组 404（应用内「页面走丢了」），应用日志面板恒为空（全部 0 条）；同会话根级路由 `/workspace`、`/login` 正常且该坏状态持续整场 | Turbopack dev 会话级路由组失效（上游 vercel/next.js#97897 同类，偶发于某次 `next dev` 启动，2026-09-06 定位，Next 16.3.2）：坏会话内 `(main)` 组路由不进编译直接 404；日志面板轮询的 `/api/logs/current` 在同会话同样拿不到数据 → 面板全空。与代码无关（源码与 `.next` 编译产物均完好） | 关闭桌面窗口重启应用即恢复（dev server 重建路由表）；重启无效再删 `.next` 重启。持续跟进上游修复，修复后可移除本条 |

| `nextjs-stderr-<ts>.log` 被同一条 **Edge 编译噪声刷屏**（同一段文本重复数万行、可到数十 MB，去重后仅几十行唯一内容），真实的运行报错（Failed to fetch / ECONNREFUSED / JSON 解析错等）全被淹没看不见 | **Edge instrumentation 包被静态拉进 Node-only 模块**：`src/sentry.edge.config.ts` 顶层 `import { env } from "~/env"` 把整个 `src/env.js` 并进 Edge 包。env.js 虽已用 `NEXT_RUNTIME !== "edge"` 做了**运行期**守卫，但 Turbopack 编译 Edge 包时是静态把整个模块图并进去，`node:fs` / `node:path` / `node:url` 仍被静态分析识别为「Edge 不支持的内置模块」→ 每次编译都报 `⚠ ./src/env.js … not supported in the Edge Runtime` + `Ecmascript file had an error`，import trace `src/env.js → src/sentry.edge.config.ts → src/instrumentation.ts`，Edge instrumentation 编译卡进无限重试/重编循环把 stderr 刷满（2026-09-08 定位）。只加运行守卫挡不住静态打包追踪 | 已修：`src/sentry.edge.config.ts` 不再 import `~/env`，Edge 只需要 `SENTRY_DSN` 与 `NODE_ENV`，直接读 `process.env.SENTRY_DSN` / `process.env.NODE_ENV`（沿用该文件「未配置即 no-op」风格），env.js 彻底不进 Edge 包，噪声消失。server 端 config（sentry.server.config.ts）仍可用 `~/env` |
| **`/login` 与 `/workspace` 打开即 500、应用完全打不开**（`pnpm build` 也失败），`next dev` 终端输出 `FATAL: An unexpected Turbopack error occurred: Failed to write app endpoint /login/page`，`Caused by: the chunking context does not support external modules (request: node:fs)` | **纯逻辑模块混进了 Node-only IO**（2026-09-10 定位，ISSUE #317）：`src/lib/log-session-scope.ts` 顶层 `import fs from "node:fs"`，而客户端组件 `LogProvider.tsx`（`"use client"`）只需要它的纯函数 `clampLogTime`。Turbopack 编译**浏览器** chunk 时把该模块整图形入，`node:fs` 被视为「浏览器不支持的 external module」→ 该 endpoint 编译失败、页面 500。与下方 #282 那条**同源**（Node-only 模块被静态打包进浏览器图），区别是这次走的是「本该纯逻辑的模块里放了 IO」，更隐蔽：模块名和注释都写着「逻辑层」，只有第一行是 IO | 已修：按「纯逻辑 / IO」分层——`log-session-scope.ts` 只留纯函数（`resolveSessionStart` / `clampLogTime`，客户端与服务端共用），读文件 mtime 的 `fileMtimeMs` 移入 `.server.ts`（Node-only），仅服务端路由 `GET /api/logs/current` 引用。**新增静态门禁** `tests/client-bundle-node-builtins.test.ts`：从所有 `"use client"` 入口遍历 import 图（`import type` 编译期擦除，不计），命中「客户端可达且顶层 import Node 内建」即失败并打印完整引用链。同类排查手法：`rg "^import .*from \"node:(fs|path|child_process)\"" src/lib` 后反查谁在客户端 import 它 |
| 设置页 / 工作区等页面打开即报 **“An unexpected Turbopack error occurred”**（浏览器 overlay），`next dev` 终端输出 `FATAL: An unexpected Turbopack error occurred: Failed to write app endpoint /(main)/settings/page`，`Caused by: the chunking context … does not support external modules (request: node:fs)`，且非编译型报错而是整页 500 | **客户端组件链顶层 import 了 Node-only 模块**：`app-runtime-log.ts` 顶层 `import fs from "node:fs"` / `node:path`（Node 专用），却被客户端 hook `use-settings-page.ts`（`"use client"`）顶层 `import { createAppRuntimeLogger }` 引用。Turbopack 编译**浏览器** chunk 时把该模块整图形入，`node:fs` 被识别为「浏览器不支持的 external module」→ 编译该 endpoint 失败，页面 500（2026-09-09 定位，ISSUE #282 回归，由提交 29d8b1d 引入——客户端为补记 `app-runtime` 日志直接 import 了 Node 日志模块）。与 §5 上一条 Edge 噪声同源：都是「Node-only 模块被错误打包进非 Node 运行时图形」。`/*turbopackIgnore*/` 只能豁免动态访问点，**挡不住顶层 `import` 的静态打包** | 已修：客户端逻辑层不得直接 import `app-runtime-log`（Node-only）。改为经服务端写入通道——新增 `POST /api/logs/app-runtime`（route.ts 用 `createAppRuntimeLogger` 落 `log/services/app-runtime.log`，白名单 ns 与 level、截断超长消息），客户端网络层 `src/lib/log-file-client.ts` 新增 `postAppRuntimeLog()`，`use-settings-page.ts` 在 `hasError` 分支 `void postAppRuntimeLog("settings","error",msg,fields)` 取代直接 logger 调用。规范 07 §7.12 新增「客户端补记 app-runtime 必须走服务端通道」的约定 |
| 任务报「任务卡在队列超过 Ns（…无人 re-claim）」 | ComfyUI 未运行：WS 连不上 → `processQueue` 不出队 → reaper 30s 判死 | 已加自动启动：配置 `comfyuiPath`（设置 → 创作后端）后任务执行前自动拉起 ComfyUI 并等待就绪；reaper 在启动窗口期跳过回收。也可在设置页手动点「启动 ComfyUI」。启动日志：`log/services/comfyui-runtime.log` |
| 子图（liblib）工作流每次生成的都是同一张图，且与提示词无关；日志里「真实执行 seed」恒等于工作流里存的那个默认值 | **覆盖只写到了子图 wrapper，没写进内层节点**：raw 子图 wrapper 的 `widgets_values` 只是**宿主值**；comfy-cli 把子图展开成 `wrapperId:innerId` 后，UI→API 转换读的是**内层节点**的 `widgets_values`。而「把宿主值回写进内层」（promoted-widget overlay）是 comfy-cli **1.20** 才有的逻辑，1.17~1.19 会用内层默认值整段盖掉 → 提示词/种子/步数全部失效。日志特征：`输入参数（workflowInputs，N 项）` 里值正确，但 `真实执行 seed = <工作流默认值>` 恒定不变；把临时工作流文件直接拖进 ComfyUI 跑也是同一张图 | 已修：`applyRawOverrides` 对子图 wrapper 的覆盖项按 ComfyUI 前端的映射规则（`sub.inputs[i].linkIds` → 起点为 `-10` 的边界连线 → 内层 `target_id` / `target_slot`）同步写进内层节点，seed 的 `control_after_generate` 哨兵槽与「随机值」兜底生成的随机种子同样同步。回归测试见 `src/lib/comfyui/executor-cli.test.ts`（`applyRawOverrides — 子图 wrapper 覆盖同步到内层节点`）。另注：comfy-cli 版本可用 `python-venv/comfy-cli/Scripts/python.exe -m comfy_cli --version` 确认，1.20 起两条路径都生效；版本比对与升级已由启动时后台的 `scripts/setup-comfy-cli-venv.ps1` 自动完成（见 §1.2），仍停在旧版时查 `log/tools/comfy-cli-setup.log`（离线 / PyPI 不可达会跳过升级，需手工 `-Force` 重试） |

| 任务报「任务卡在队列超过 Ns（…无人 re-claim）」——但这次 ComfyUI 明明在运行、comfy-cli 进程已启动 | **raw UI-format（liblib 子图）路径的误判**：任务经 `executeViaComfyCli` 提交，但直到 comfy-cli 子进程回传 `prompt_id` 前，DB 行保持 `QUEUED / promptId=null`。comfy-cli 的 Python 启动 + 工作流转换 + POST /prompt 可能超过 reaper 的 30s 阈值（STALE_MS），于是 `reapStaleQueuedTasks` 把这个健康在飞的任务误判为孤儿并标记 FAILED。日志特征：`✓ comfy-cli 进程已启动` 之后立刻出现 `任务卡在队列超过 Ns` | 已修：`reapStaleQueuedTasks` 增加 in-memory 认领保护 `isTaskClaimedInProcess`——任务若仍被当前进程认领（还在 `s.queue` / 有 comfy-cli 子进程 `cliProcs` / `executedWorkflow` 已记录），则不回收，交给正常执行路径收口；只有 cold restart 后无任何 in-memory 足迹的才判孤儿。回归测试见 `src/lib/comfyui/reaper.test.ts` |

| ComfyUI 启动失败（如「保活进程已退出」）后仍被一直自动重试，执行日志与 `comfyui-runtime.log` 里同一条失败被反复刷、进程被无谓地重复拉起 | **自动启动没有「失败即停」的出口**（ISSUE #335）：`ensureComfyUiReady` 只把失败返回给这一次调用方，WS 重连循环（退避到 15s）仍每轮重新讨要启动；路径没配好 / 环境缺依赖 / 保活进程拉起来就退这类失败重试并不能自愈 | 已修：一次自动启动以**明确失败**收尾即落 `autoStartFailed` 闩锁，非手动来源（WS 重连 / 状态轮询）后续直接回报上次失败详情并跳过重试，不再 spawn、不再刷日志；被闩锁抑制时 WS 层也不再安排重连（否则只是每 15s 空转一轮）。清闩锁的出口：手动点「启动 ComfyUI」（`manual:true`）、重新开启自动启动（`clearComfyManualStop`）、或修改「安装路径 / 启动参数」（`setting.save`） |
| 设置页 ComfyUI 状态更新不及时 / 误报：外部（Comfy 桌面版、自己的终端）已经启动了 ComfyUI，设置页仍显示「未运行」；或打开设置页要等几秒才跳到「运行中」；点「打开查看」报未运行 | 三处判据缺陷叠加（2026-09-10 定位，ISSUE #339）：① **只看 HTTP 探测**——`comfyStatus` 直接调 `probeComfyUi()`，而它底层 `resolveComfyBase()` 在配置路径下会先要求「命令行含 `main.py` 的进程」存在；Comfy Desktop 的 standalone-env 由 `uv` 启动，命令行里没有 `main.py`，于是外部实例明明在跑也**直接抛错**判未运行。② **无缓存**——每次查询都重新付一遍 PowerShell 进程表查询（冷启动高负载下可到 10s 超时）+ 6 次端口扫描，状态行先渲染「未运行」再跳。③ **前端 15s 轮询**——外部刚起来的实例最多要等一个轮询周期才被认出来。另外 `client.ts` 的 `_resolvedBase` 一记住就永不复查 | 已修：新增 `src/lib/comfyui/status.ts` 运行态快照——进程级判据（bound 子进程 → 配置路径 `main.py` → `comfy-cli` setup 登记的启动器 / `pythonw`/`python` 候选 → 任意解释器起的 ComfyUI），命中即「在跑」不等 HTTP；带 1.5s TTL 缓存 + 在途去重（并发查询只走一次 IO）；探测失败（进程表超时）标 `unverified`，**绝不当成「没在跑」**。`getComfyUiStatus()` 合并快照与 HTTP 探测给出四态：运行中（含端口偏移推导出的 base）→ 进程在但接口未就绪 =「启动中」→ 事实不可信 =「检测中…」→ 未运行。`comfyStatus` 改走该函数并透出 `probing`/`port`/`via`；设置页轮询 15s → 5s 且不在后台轮询，「打开查看」先取一份新鲜状态再打开，按钮只在「明确未运行」时禁用。回归测试见 `src/lib/comfyui/status.test.ts` |
| 设置页 ComfyUI 状态**一直停在「正在启动…」**：ComfyUI 早就起来了（`127.0.0.1:8188` 在浏览器里能正常打开），设置页状态行却永远显示「ComfyUI 正在启动…」，启动日志里明确有「ComfyUI 已就绪（保活）：http://127.0.0.1:8188」 | **状态判定被「查不到进程」与「粘性缓存」两头堵死**（2026-09-11 定位，ISSUE #344）：① `resolveComfyBase()` 在**配置了 `comfyuiPath`** 且进程表里查不到该路径 `main.py` 时会**直接抛错**（`Configured ComfyUI instance is not running`），而 Comfy Desktop 的实例由 `standalone-env` 启动、命令行里没有 `main.py`，于是进程在跑也查不到 —— `probeComfyUi()` 被 catch 成「不可达」，**一次 HTTP 都没发出去**；② 同函数里「进程在、端口未绑定」的分支会把**配置地址写进 `_resolvedBase` 会话缓存**，ComfyUI 随后就绪（或落在偏移端口）时本进程仍沿用这个连不上的地址；③ 快照层把「进程在、端口未绑定」当成普通结论缓存 1.5s，叠加设置页 5s 轮询，两次采样很容易都命中同一份陈旧快照 | 已修：①`client.ts` 进程表未命中**不再抛错**，只记日志退回端口探测（「实例在不在」归 `status.ts` 的快照负责，`resolveComfyBase` 只回答「连得上哪个地址」）；②新增 `probeComfyBase()` **按次探测**（探测后还原会话缓存），`probeComfyUi()` 改走它，状态判定不再被粘性结论污染；③新增 `COMFY_UNBOUND_PORT_TTL_MS = 0`，「进程在、端口未绑定」的快照不缓存，端口一出现立刻翻页；④`getComfyUiStatus()` 拿到「启动中」结论时当场 `force` 复核一次快照再判；⑤判据链补第 5 级**环境反查**——Comfy Desktop 的 `standalone-env` 解释器常由 `uv` 托管（`%LOCALAPPDATA%\uv\python\cpython-*`），不在实例根下，「按实例根解释器路径查进程表」必然落空，现在顺 `<实例根>\standalone-env\pyvenv.cfg` 的 `home`/`executable` 反查真正在跑的解释器，并补一遍 `uv` 托管目录（认 `UV_PYTHON_INSTALL_DIR` 与平台默认位置，兼容 `<env>\python.exe`、`<env>\install\python.exe`），命中即判「在跑」；同时「配置路径 `main.py` 查询失败」不再提前终止判据链（只记 `unverified` 继续放宽），避免高负载下进程表超时把 Desktop 实例误报成「未运行」。回归测试见 `src/lib/comfyui/client.test.ts`、`src/lib/comfyui/status.test.ts`、`src/lib/comfyui/env-python.test.ts`、`src/lib/comfyui/lifecycle.test.ts` |
| 保活（keepAlive）模式下 ComfyUI 启动日志面板空白（只有 spawn 行）；或启动中报「保活进程已退出」但 ComfyUI 后来其实起来了 | 四个因素叠加（2026-09-06 定位）：① Start-Process 拉起的进程没有 stdio 管道，日志无处可去；② 进程存在性查询（Get-CimInstance 全量枚举 ~3.4s，贴近 4s 超时）在冷启动高负载下超时被当「进程不在」；③ 查询里内嵌双引号（-Filter "Name LIKE…"）经 execFile argv → PS -Command 的引号转义链路变形，恒空匹配（进程活着也查不到）；④ 字面反斜杠 Replace 在同一链路里被吞，路径分隔符归一失效 | 已修：Start-Process 把 stdout/stderr 重定向到按次命名的 `log/services/comfyui-keepalive-<时间>.out/.err.log`，等待循环增量跟随进 runtime.log；进程查询改纯单引号 + `[char]92` 运行时构造反斜杠 + Where 内 Name 过滤 + 10s 超时；判死需**连续 2 次**查询都找不到进程 | 重启应用生效；完整启动输出在重定向文件里可整段查看 |

| 启动时 `dev-launcher.ps1` 报 `ParserError: Unexpected token '-Level'`（定位到 corepack prepare 分支的 Write-Log 行），启动中断 | Write-Log 调用里把命名参数 `-Level WARN` 误写进了字符串括号内：`Write-Log ("…" -Level WARN)`，PowerShell 把它解析成对字符串的无效操作符而报语法错（2026-09-07 定位，仅当 pnpm 版本不一致且 corepack prepare 失败触发） | 已修：右括号移到字符串后：`Write-Log ("…") -Level WARN`，让 `-Level` 成为命名参数。排查同类错误：`grep -nE '\("[^"]*" -Level' *.ps1` |
| 壳内打开 ComfyUI 报「Command open_comfyui_window not allowed by ACL」（壳已重编、命令已注册、`remote.json` 已加 `core:default` 仍如此） | 根因在 Tauri 2.11 起的安全变更（tauri fix#15266，随 2.11.0 合入）：远程源调用**应用自建命令**一律强制走 ACL，**必须先在 build.rs 用 `AppManifest::commands` 声明命令**（生成 `allow-<command>` 权限条目），否则即便 `remote.json` 的 permissions 有 `core:default` 也无法命中应用命令 → 无授权被拒。`core:default` 只放行 core 插件命令，不含应用自建命令。附带影响：一旦启用 AppManifest，本地 splash 的自建命令（get_launch_status/get_app_url/get_launch_log/navigate_to_app）也随之受 ACL 管控，需补 splash 的本地授权能力 | 三处配合：①`build.rs` 改 `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[...全部5条命令])))`；②`capabilities/remote.json` permissions 追加应用命令授权 `allow-open-comfyui-window`（main 远程窗）；③新增 `capabilities/splash.json` 给 splash 窗授 `allow-get-launch-status`/`allow-get-app-url`/`allow-get-launch-log`/`allow-navigate-to-app`（本地命令，防 AppManifest 打开后 splash 也被拦）。改壳层配置/构建脚本，须重编：`cd src-tauri; cargo build --release --features custom-protocol` |
| 设置页「打开查看 ComfyUI」弹出独立第 2 窗口且空白、无法关闭 | 旧方案用 Rust `open_comfyui_window` 在壳内另开一个 `comfyui` WebviewWindow；用户反馈这违背「像文件管理器多页签」的预期，且独立窗口可能空白/难关闭 | 已改为**同一主窗口内的应用级页签**（后续 ISSUE #310/#200 又把页签搬到窗口标题行，见下表末行）：`shell-tabs-store` 管理页签，`ShellTabs` 在窗口顶部渲染页签栏，ComfyUI 以 iframe 内嵌为主应用页签并行内容（CSS 显隐切换，主应用组件树保持挂载不丢态）。配套：①`tauri.conf.json` CSP 增加 `frame-src 'self' http://127.0.0.1:* http://localhost:*` 放行本地 ComfyUI 被 iframe 内嵌；②设置页 `openComfy` 桌面壳分支改为 `useShellTabs.openTab` 打开 ComfyUI 页签，不再调用 `open_comfyui_window`；③浏览器/dev 模式仍走系统浏览器兜底。注：若 ComfyUI 自身设置 `X-Frame-Options`/CSP `frame-ancestors` 拒绝嵌套，页签会空白——此时可回退到独立窗口（Rust `open_comfyui_window` 保留）或让 ComfyUI 放行 frame |
| 页签栏占用了应用内的一块区域，而不是显示在窗口标题行（用户期望「像文件资源管理器那样」） | 应用内页签方案（上一条）只解决了「不另弹独立窗口」，页签栏仍渲染在**原生标题栏下方**，等于在应用内又占掉一条 40px 区域（ISSUE #310 / #200） | 已改为**自定义标题栏**：主窗口 `decorations: false` 关掉原生装饰，页签栏与标题行合并为同一条横条——页签 + 拖拽空白区 + 最小化/最大化/关闭。配套：①`TitleBarTabs` 渲染标题行，拖拽区用 `data-no-drag` 标记排除页签/按钮（点击不被拖拽吞掉），双击空白处最大化/还原；②窗口动作（`startDragging`/`minimize`/`toggleMaximize`/`isMaximized`/`close`）统一封在 `src/lib/window-controls-client.ts`（浏览器降级为空操作），最大化状态用 `onResized` 订阅同步；③`capabilities/{default,remote}.json` 各补 5 条 `core:window:allow-*` 权限；④浏览器 / dev 无原生标题栏可让位，`shouldUseTitleBarTabs` 判据退回应用内页签栏。**改的是 `src-tauri/src/**` 与窗口配置，必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`。回归测试见 `src/lib/title-bar-derive.test.ts` |
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
| 前端/standalone 体积分析 | `pnpm analyze` （`node scripts/analyze-bundle.mjs` → `ANALYZE=true next build --webpack`） |
  `@next/bundle-analyzer` 量化各 bundle 体积。**仅 webpack 支持**（Turbopack 不支持），默认
  `next build` 走 Turbopack 不受影响；因此分析时强制 `--webpack`。产物
  `.next/analyze/client.html` / `nodejs.html` / `edge.html`，并监听
  `http://127.0.0.1:8888` 可视化报告。`output: standalone` 以 webpack 构建时同样生效，
  可量化独立 server 侧 bundle。用 Node 包装以兼容 Windows（内联 `VAR=cmd` POSIX 专属）。 |
| 重新打包双击启动器 | `tools\build\build-launcher.ps1` | PyInstaller onedir，产物 `start-tauri/`（gitignore） |
| 开发者工具箱 | `tools\build\rebuild-static.ps1` 等 / `dev-tools` | 见 `tools/README.md` |

### 7.1 构建前置检查：目标壳不得在运行（`tools/scripts/Build-Guard.ps1`）

`build-tauri-release.ps1` / `build-standalone.ps1` 在动手前 dot-source
`tools/scripts/Build-Guard.ps1`，调用 `Assert-ShellNotRunning` 检查
`src-tauri\target\{release,debug}\{{shell.app.exe}}` 是否正被运行中的桌面壳占用：

- **命中即中止**（exit 1，日志给处置提示），不让整轮编译走到链接收尾才报
  `os error 5`（见 §5 对应行）；
- **判据是进程可执行文件的真实路径**，而不是进程名或命令行。预编译壳由
  `dev-launcher.ps1` 用 `ProcessStartInfo` 启动，`UseShellExecute=false` 时命令行里
  不含项目根路径——`dev-launcher.ps1` 清理残留壳用的 `CommandLine -like "*$root*"`
  因此并不可靠，这里不能照抄。`ExecutablePath` 取不到时退回命令行匹配（宁可多提示
  一次，也不要漏判后白跑构建）；
- 需要无人值守时用 `-AutoCloseShell` 自动 `taskkill /PID <pid> /T /F` 回收（**禁止**
  单杀，见 §3），回收失败仍返回 1。

回归测试：`tests/check-file-structure.test.ts` 的「Build-Guard.ps1（构建前置守卫）」
用例用 PowerShell 打桩 `Get-CimInstance` 喂造数据，锁住「本仓库 target 下的 exe 命中 /
别处同名进程不命中 / 路径大小写差异命中」三条规则（非 Windows 平台自动跳过）。

#### 应用自更新（tauri-plugin-updater / tauri-plugin-process）

> 2026 接入（ISSUE #232）：设置页「应用更新」区可检测新版本、下载安装并重启。
> `tauri-plugin-updater` 的检测/下载/安装命令与 `tauri-plugin-process` 的重启命令
> 已在 `src-tauri/Cargo.toml` 注册、`src-tauri/src/lib.rs` 挂载，并在
> `src-tauri/capabilities/remote.json` 授予远程源 `updater:default`、`process:default`。

接入业务更新源需三步（否则「检测更新」只会提示未配置更新源）：

1. 生成签名密钥对：`pnpm tauri signer generate -w ~/.tauri/comfyapp.key`
   （私钥留作 CI 签名，公钥输出内容随 `-w` 到终端）。
2. 把公钥填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`；
   按更新宿主（GitHub Releases / 业务后端）填 `plugins.updater.endpoints`。
3. 发布更新时用私钥对产物签名；`bundle.createUpdaterArtifacts` 置 `true`
   才会让 `pnpm tauri build` 产出 `.sig` 签名与更新元数据（当前未开启，
   因尚未配置公钥——避免无公钥时打包报错）。

> 更新产物与签名、更新服务端部署不在本仓库范围内，属发布运维配置。

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
| `tools/start/start-tauri.ps1` | 直接启动 `start-tauri\{{shell.exe.prebuilt}}`（prebuilt，见 `scripts/start_tauri_launcher.py`） |
| `tools/start/start-tauri-dev.ps1`（隐藏窗口，原 `.vbs`） | `scripts/dev-launcher.ps1 -Tauri` |
| `tools/start/run-local.ps1` | `scripts/prepare-local-run.ps1` |
| `tools/start/verify-quality.ps1` | `scripts/quality-gate.ps1` |
| `tools/start/sync-lint.ps1` | `scripts/sync-lint.ps1` |
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
| `tools/start/` | **启动/初始化类**：起 dev server、起桌面壳、环境自检、质量门禁 | `start-web.ps1`、`start-tauri.ps1`、`start-tauri-dev.ps1`、`start-desktop.ps1`、`run-local.ps1`、`verify-quality.ps1`、`sync-lint.ps1`、`register-comfyapp-protocol.ps1` |
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
