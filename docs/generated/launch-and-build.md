<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/standards/launch-and-build.md`。改动请回源文件，再重新生成。 -->

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
node scripts/dev-launcher.mjs --mode prebuilt        （Windows 侧入口是 scripts/dev-launcher.ps1）
  │  职责：预检（依赖/壳时效）、进程编排、日志体系、进程树回收 —— **全平台唯一实现**
  ├─▶ src-tauri\target\release\app.exe（Tauri 壳，秒出窗口）
  │     职责：splash 窗口展示启动进度（读 run/launch-status.json）
  │           + 「查看日志」面板（读 log/ 下启动器日志尾部，get_launch_log 命令）
  │           + 无原生标题栏（decorations: false）：窗口右上角自绘
  │             最小化 / 关闭（三条互补路径：监听 / 内联 onclick / 应用命令
  │             win_minimize·win_close——只挂一条就是「点了没反应」，规范 07 §7.18.7）；
  │             开窗就是「内容多大窗口多大」的紧凑档，
  │             展开日志时由 set_splash_compact 把窗口调到展开档（§7.18.7）
  │           + main 窗口隐藏待命；splash 探测就绪后 navigate_to_app 交换窗口
  │           （交换前做 TCP 可达性校验，失败进入重导航循环——WebView2 对导航
  │           失败同样触发 on_page_load Finished，不校验会把 Edge 错误页
  │           当成应用界面显示）
  │           + 交换窗口默认**不抢前台**（窗口进任务栏 + 任务栏闪烁提醒），
  │           是否给前台由启动器经 COMFYAPP_FOREGROUND 决定；窗口交接那一刻
  │           再由启动器的复核进程复裁一次（见 §1.3）
  │           + 用户关闭启动页（右上角 ✕）而主窗尚未显示 = **放弃本次启动，
  │           整个壳进程直接退出**：主窗是隐藏待命创建的，只关 splash 会留下
  │           看不见窗口的壳进程（任务栏残留、dev server 继续被拉起、稍后还会
  │           自己把主窗弹出来）；壳退出后 dev server 由 dev-launcher 以壳退出
  │           为锚点回收（正常交接时主窗已显示，壳自己关启动页不触发退出）
  └─▶ pnpm dev → node next dev（127.0.0.1:<解析端口>，见 §1.1；
        本检出缺省 = 路径推导值，静态兜底才是 3100）
        就绪后 splash 调 navigate_to_app → main 加载 /workspace → 交换窗口
```

分层边界（不要越层做事）：

- **Python 启动器**不做进程树管理（它退出时 dev-launcher 必须还能活着继续工作）；
- **`scripts/dev-launcher.mjs`** 是唯一的进程编排者：启动、预检、清理都在这一层
  （**全平台同一份**，见 §3）。`scripts/dev-launcher.ps1` 只是它在 Windows 侧的
  **调用入口**（定位项目根 → 转交 → 透传退出码），不含任何编排逻辑；
- **Rust 壳**只负责窗口与导航，不启动任何进程（dev 模式）；
- 任何一层失败都必须有人类可见的出口（弹窗/窗口内提示），禁止只写文件。

### 1.1 端口统一配置（COMFYAPP_PORT）

应用端口**不做硬编码**，取值优先级（解析的唯一事实源：Node 侧
`scripts/app-port.mjs` / PowerShell 侧 `scripts/app-port.ps1`）：

1. `.env` 显式 `COMFYAPP_PORT`（每个检出各自的 `.env`；要固定端口、例如与
   其他应用冲突时配置，改一处、重启应用即可）；
2. **按检出路径稳定推导**——对检出绝对路径（反斜杠转正斜杠、转小写、去尾
   斜杠）的 UTF-8 字节取 FNV-1a 32 位哈希，映射到 3200~3999 区间内的固定
   端口；同一检出恒定同端口，多份检出并行开发互不冲突（见 §1.4）。
   **规范化只对相对路径做 resolve**（绝对路径原样处理）：Node 的
   `path.resolve` / Python 的 `os.path.abspath` 语义都是「相对当前工作目录
   解析」，无条件调用会把 `F:\AI\...` 在 Linux 上拼成 `/workspace/f:/...`
   —— 同一检出在不同 cwd / 平台推出不同端口，「恒定同端口」直接失效。
   四侧实现见下方「推导算法是跨语言约定」；
3. 兜底 `3100`：仅在路径推导不可用的异常情况，也是 `tauri.conf.json` 静态
   `devUrl` 的编译期兜底值。

各层读取来源：

| 层                        | 读取方式                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev-launcher.mjs          | `scripts/app-port.mjs` 的 `resolveAppPort`，用于 `pnpm dev -p`、健康检查、端口占用回收、`COMFYAPP_DEV_URL`（`.ps1` 只是入口，出口径同一处）                                                                                                                                                                                                                                      |
| start_tauri_launcher.py   | `_read_app_port()`（.env 优先，缺省按检出路径推导），用于 `COMFYAPP_DEV_URL` 与 launch-status 的 `app_url`                                                                                                                                                                                                                                                                       |
| Rust 壳（lib.rs）         | `default_dev_url()` 读 `COMFYAPP_PORT` 环境变量；未注入时按 `single_instance::derive_app_port()` 推导                                                                                                                                                                                                                                                                            |
| tauri.conf.json           | `beforeDevCommand: node scripts/dev.mjs`，经 `scripts/app-port.mjs` 解析端口后启动 next dev                                                                                                                                                                                                                                                                                      |
| `pnpm dev` / `pnpm start` | 统一经 `scripts/dev.mjs` / `scripts/start.mjs` → `scripts/app-port.mjs` 解析端口，再显式传 `-p` 给 next。**`dev` 与 `start` 都必须经脚本**：裸 `next dev` 会落 Next 默认的 3000，与 .env / 路径推导 / Playwright / 启动器找的端口对不上（2026-09-14 修 `dev` 一侧，`start` 此前已修）。`dev.mjs` 的 `-p` / `-H` 供 Windows 启动器显式覆盖，Linux / CI 直接 `pnpm dev` 即走解析值 |
| Playwright                | `playwright.config.ts` 经 `scripts/app-port.mjs` 解析，与 webServer/baseURL 同源                                                                                                                                                                                                                                                                                                 |
| 前端 tRPC                 | `process.env.COMFYAPP_PORT ?? process.env.PORT ?? 3100`（服务端运行时 env 由启动链路注入）                                                                                                                                                                                                                                                                                       |

> **推导算法是跨语言约定**：Node / PowerShell / Python / Rust 四侧实现必须逐字节
> 一致（FNV-1a-32），任一侧改动必须四处同步；`tests/app-port.test.ts` 与
> `src-tauri/src/single_instance.rs` 的单测锁有相同校验向量。

> **为什么 `pnpm start` 也要经脚本**：`next start` **不认 `COMFYAPP_PORT`**（只认 `PORT`）。
> 默认端口由 3000 改成 3100 那次只改了 config 与文档，`pnpm start` 仍会回落到 Next 的
> 默认 3000 —— 而 Playwright 的 `webServer.url` 与 `baseURL` 都按 3100 找服务，CI 的
> E2E 因此长期起不来（`Timed out waiting 180000ms from config.webServer`，2026-09-12
> 定位）。`scripts/start.mjs` 与 `dev.mjs` 对称：同一端口解析 + `next start -p`，
> 保证「一处配置、dev 与 prod-start 两条链路一致」。

> **端口有两条链路，数值经常不相等，别混用**（ISSUE #489）：解析链是
> `pnpm dev` / `pnpm start` / `tauri.conf.json` 的 `beforeDevCommand` / Playwright ——
> 它们都经 `scripts/dev.mjs` / `scripts/app-port.mjs`，缺省拿到的是**路径推导值**
> （3200~3999）；静态链是 `tauri.conf.json` 的 `build.devUrl`（缺省写 3100）——
> 它是**编译期内嵌的兜底值**，正常启动时被启动器注入的 `COMFYAPP_DEV_URL` 覆盖。
> 结论：**文档描述 `pnpm dev` 时写 3100 = 写错**（实测某检出推导为 3311，
> 照 3100 打开即 `ERR_CONNECTION_REFUSED`），必须写控制台打印的
> `[dev.mjs] COMFYAPP_PORT=<n>`；反之描述启动器 / 壳的兜底行为时，3100 才是对的。
> 两条事实在登记表里是分开的（`dev.port` / `dev.port.derived`，见
> [reference-facts.md](../reference-facts.md) §1.1），`pnpm doc:check` 会按文档各自
> 所属语境核对，防「用静态值给解析链文档背书」这类漏网。

> **推荐经 `start-tauri.ps1` / `start-tauri.exe`（launcher）启动**：launcher 会把
> `COMFYAPP_DEV_URL` / `COMFYAPP_PORT` 注入壳进程，`tauri.conf.json` 的静态 `devUrl`
> 仅作为兜底，不参与主导航。若绕过 launcher 直接 `pnpm tauri dev` 且改了端口，
> 需同步修改 `src-tauri/tauri.conf.json` 的 `build.devUrl` 指向新端口。

### 1.2 comfy-cli 运行环境（python 启动器层，后台兜底）

raw UI-format（liblib 子图）工作流由 `src/lib/comfyui/executor-cli.ts` 交给项目内的
comfy-cli 做 UI→API 转换，解释器固定为 `<项目根>\python-venv\comfy-cli\Scripts\python.exe`。
`start_tauri_launcher.py` 的 `ensure_comfy_cli_venv()` **每次启动都后台触发一次**
`scripts/setup-comfy-cli-venv.ps1`（不阻塞启动，独立进程组），判断逻辑全部在脚本里：

| 环境状态                         | 动作                                                      |
| -------------------------------- | --------------------------------------------------------- |
| venv 缺失 / `comfy_cli` 不可导入 | 建 venv → 升 pip → 装 comfy-cli                           |
| 已就绪，版本落后 PyPI            | `pip install --upgrade comfy-cli`，状态写 `phase=upgrade` |
| 已就绪且已是最新                 | 只记日志，零副作用                                        |

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

### 1.3 启动完成后的前台归属（不打断用户正在看的内容）

启动要几十秒，用户往往在这段时间切去别的窗口干活。**加载完成不得抢前台**——
把窗口顶到最前面会把用户正在看的内容当场打断（用户可见的诉求：应用启动好
只需在任务栏显示状态即可）。

判据分两段，都不写死在壳里：

| 段                     | 位置                                                         | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 判决（启动期，一次性） | `scripts/start_tauri_launcher.py` 的 `decide_foreground()`   | 决定本次启动是否允许给前台；结果写环境变量 `COMFYAPP_FOREGROUND`（`1`/`0`），由 dev-launcher.mjs 透传给壳                                                                                                                                                                                                                                                                                                                                                                                  |
| 执行（窗口交换时）     | `src-tauri/src/lib.rs` 的 `show_main_window_without_focus()` | 主窗以 `focused(false)` 创建：首次 `show()` 由 tao 走 `SW_SHOWNOACTIVATE`——窗口进任务栏但不向前台要焦点（不带它的话 `show()` 自带的激活语义会让 Windows 把前台放行给主窗）；只有判决/调用方明确要求给前台时才调 `set_focus()`，未获前台则 `request_user_attention` 请求任务栏闪烁提醒；**窗口处于最小化时先 `unminimize()`**——`show()` 走 `SW_SHOW`，对最小化窗口不还原，只把它记为前台，用户看到的是「点托盘 / 二次启动没反应」（再点一次任务栏才出来，因为那次走的是系统自己的还原路径） |

`decide_foreground()` 的判决表（命中任一即允许给前台，**默认拒绝**）：

| 情形                                                                     | 结果     | 为什么不算「打断」                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前台本来就是本应用（`foreground_window_process() == app.exe`） | 允许     | 用户就是从应用里重启 / 更新后重启，前台本来就是它                                                                                                                                                                                                                                                                                                 |
| 显式冷启动（`-ColdStart` / `--cold-start`，脚本或终端拉起）              | 允许     | 命令行路径，用户在终端里等结果                                                                                                                                                                                                                                                                                                                    |
| 已有实例在跑，这次只是唤起（`--focus`，默认开）                          | 允许     | 用户点了启动就该看到界面                                                                                                                                                                                                                                                                                                                          |
| 其余（含**双击启动**：前台是 explorer / 启动器自身）                     | **拒绝** | 双击之后切去干别的正是常态——启动期此刻前台还是双击入口，几十秒后正式窗口冒出来时用户早就在别处工作了，抢前台就是把用户当场打断（曾按「用户刚点的启动」放行，叠加交接复核的 `give` 把用户**打断两次**：第一次正式窗口弹出，用户点回别处后复核进程又把它强拉回前台）。现在双击启动一律不给前台：窗口进任务栏 + 闪烁提醒，用户处理完手上的事自己点开 |

### 交接时刻的复核（`scripts/win32-window-focus.py`）

只判一次不够——用户双击后去干别的可以持续几分钟，等应用真正冒出来时「双击入口还在
前台」这条判据早已失真；更关键的是**窗口交接那一刻 Windows 会把前台自动放行给新显示
的主窗**：启动页窗口一直是 `WS_EX_TOOLWINDOW`（不产生任务栏按钮），主窗 `show()` 时
任务栏按钮首次创建，Windows 把它当成「新窗口」按「用户刚启动 → 允许置前」放行。
于是壳里任何 `set_focus()` 都「成功」——「不打断用户」的策略在交接这一瞬间被架空，
这正是 ISSUE #359 修复后用户仍反馈「启动仍然抢前台」的原因。

因此壳侧**不再无条件调 `set_focus()` 试探**（只在 `request_focus` / `configured`
为真时才争取前台），并新增一个交接复核进程收尾：

| 段                       | 位置                                                                                              | 职责                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 执行（窗口显示）         | `src-tauri/src/lib.rs` 的 `show_main_window_without_focus()`                                      | 首次显示不激活（`focused(false)` → `SW_SHOWNOACTIVATE`，窗口必须出现在任务栏）；只有显式要求给前台时调 `set_focus()`，未获前台则补任务栏闪烁 |
| 复核（交接后，独立进程） | `scripts/start_tauri_launcher.py` 的 `spawn_foreground_watch()` → `scripts/win32-window-focus.py` | 主窗口可见后复裁一次：`give` 把前台拿到手（含键盘焦点）／`restore` 把系统自放的前台还回去／`leave` 什么都不做                                |

复核判决表（`decide_handoff()`，**默认什么都不做**）：

| 情形                                             | 动作      | 为什么                                                                     |
| ------------------------------------------------ | --------- | -------------------------------------------------------------------------- |
| 启动期判决允许（`COMFYAPP_FOREGROUND=1`）        | `give`    | 用户就在等这个应用，前台必须真的到手（含键盘焦点，否则输入会落到别的窗口） |
| 不该给，但窗口自己已是前台（系统交接时自动放行） | `restore` | 这个前台不是用户要的，留着就是「还是会抢前台」                             |
| 不该给，且前台是别的应用                         | `leave`   | 用户切去干别的了，窗口只留在任务栏 + 任务栏闪烁提醒                        |
| 窗口还没显示                                     | `leave`   | 没有前台归属要处理                                                         |

「还回去」用 `SendInput` 发一个**无副作用的 Alt 按键**（不产生输入内容、不切换窗口），
把输入权交回用户当前线程，再靠 `SetForegroundWindow` 把前台还回去——单独调
`SetForegroundWindow` 会被前台锁定挡下（实测就是「`already=focused` / 任务栏闪烁反复
触发」那条路径）。复核只在交接那一刻执行一次，之后不再动前台：用户后来自己点了别处，
就不该再被拉回去。

复核跑在**独立进程**而非线程：前台输入相关的动作（`AttachThreadInput` / `SendInput` /
`SetForegroundWindow`）都绑定调用线程的输入状态，混进 GUI 线程会干扰窗口消息；
独立进程还带 60s 超时熔断，不留常驻进程。日志：`log/launcher/foreground-watch.log`
（交接发生在启动完成之后，那时启动器主日志已经收尾，独立落盘才排得到）。

纯判定函数 `decide_handoff()` 不依赖 Win32，可在 CI 上直接测；回归测试见
`tests/check-file-structure.test.ts` 的「窗口交接时刻的前台归属复核」用例组。

启动器另有两个显式覆盖开关：`--foreground` / `--background`（调试与特殊入口用）。
壳侧的三个调用点（main 页面加载完成交换窗口、splash 缺失时的兜底导航、150s
安全网强制显示）统一走 `show_main_window_without_focus(handle, false)`；**只有
用户主动唤起**（托盘「打开主界面」、二次启动的单实例回调）传 `request_focus =
true`——这类场景的策略反过来，必须给前台。

「用户再次启动已运行的实例」要闭环：二次启动的新进程会被
`tauri-plugin-single-instance` 杀掉，运行中的实例得自己顶上来。做法是启动器在
判定「已有实例」时立刻把 `COMFYAPP_FOREGROUND=1` 写入自身环境（连同
`COMFYAPP_PROJECT_ROOT` 等一起被新实例继承），新实例起来后前端首次挂载调壳命令
`should_activate_on_launch` 读到该标记，再调 `activate_main_window` 把自己带到
前台（链路：`use-startup-foreground` → `~/lib/desktop-shell-client`）。标记放在
壳进程里判、不放在前端读 env：非 `NEXT_PUBLIC_` 前缀的变量在客户端读不到，
放前端会一律降级成「不给前台」。

**托盘**：`build_tray()` 常驻一个系统托盘图标（左键单击 = 打开主界面，右键菜单 =
打开主界面 / 退出），给「窗口只在任务栏、用户又切走了」提供一个稳定入口。
关主窗仍然直接退出应用（不做「最小化到托盘」）——那需要另配重启 / 退出语义，
不在本策略范围内。启用托盘需要 `tauri` 的 `tray-icon` feature（见 `Cargo.toml`）。

### 1.4 启动等待期的画面只有一个出口（ISSUE #730）

启动期有两个窗口、三段画面，**任何一段都不能是「空白」或「错误页」**：

| 阶段                    | 画面来源                                                                          | 谁能保证                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 拉起 → 应用服务就绪     | 启动页（`src-tauri/splash-assets/splash.html`：进度 / 日志 / 最小化 / 关闭） | 启动器 + 壳（`spawn_splash_watchdog` 把被带走的 URL 拨回来）                   |
| 应用服务就绪 → 应用首帧 | **壳注入的加载占位**（`MAIN_LOADING_STUB_JS`）                                    | 壳的 `watch_main_first_paint`（注入）+ 应用的 `clearLaunchLoadingStub`（收尾） |
| 应用首帧之后            | 应用自己（`src/app/layout.tsx` 起）                                               | 前端                                                                           |

第二段是历史缺口：启动页探测到应用端口**可响应**就调 `navigate_to_app`，但
navigate 一发起，主窗画面就离开启动页；而「TCP 可连」到「首帧画出来」之间
要等 dev server 首次编译（冷启动十几秒）。这段时间里 WebView2 先给空白、连接
被拒时给内嵌的 Edge「无法访问此页面 / ERR_CONNECTION_REFUSED」；更迷惑的是
主窗 `decorations: false`（标题行由前端接管），**页面没画出来时右上角的关闭按钮
也不存在**——用户看到的就是「窗口没有关闭按钮」。

两条已收口的判据（改启动链路前先看这两条）：

1. **TCP 可达性校验不足以防住这段**：`url_reachable()` 只证明端口能连，
   连接被接受而首编译没完成时 `on_page_load(Finished)` 照样触发，交换窗口就把
   空白 / 错误页顶给用户。
2. **占位必须由壳注入、由应用收尾**：导航一发起 WebView2 就已切走画面，应用
   那一端此刻连首帧都没有，能抢在它前面的只有壳侧 `eval`；而占位为了不被
   「错误页换掉整个 DOM」冲走，自带一个自我重贴的定时器，**必须由应用在挂载时
   收掉**（`clearLaunchLoadingStub()` 清定时器 + 摘节点），否则它会在真界面画好
   之后又盖回来。注入与收尾是同一件事的两半，标记（`__comfyapp_loading_stub`
   / `__comfyappStubTimer`）写在两处就必须同源。

`standalone` 模式**不注入占位**：内嵌 server 随壳一起就绪，主窗很快有画面，
提前贴反而白闪一下（判据 `expect_slow_first_paint = launch_mode != "standalone"`，
启动模式只在 `run()` 里读一次）。回归测试见 `tests/check-file-structure.test.ts`
的「主窗首帧之前由壳注入加载占位」用例。

### 1.4 多检出并行（同一项目检出多份同时开发）

同一项目检出多份是开发期的常态，**各检出必须能同时运行、互不干扰**。为此
启动链路做了三层按检出隔离：

| 机制             | 位置                                               | 行为                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端口按检出推导   | §1.1（`.env` 显式值优先）                          | 各检出各自稳定的端口；两份检出不再争抢同一端口                                                                                                                                                                                           |
| 单实例按检出隔离 | python 启动器互斥量 / Rust 壳 `single_instance.rs` | 互斥量与焦点事件名带**检出路径哈希**：同检出二次启动 → 唤起已有窗口；不同检出 → 各自独立运行                                                                                                                                             |
| 端口清理只动自己 | `dev-launcher.mjs` 的 `reconcilePort()`            | 回收占用端口的进程前先核对其工作目录是否落在本检出根内（`launcher-core/procs.mjs`）；外部进程（别份检出 / 其它程序）**绝不清理**，只给「改 `.env` 的 COMFYAPP_PORT」这类可行动提示。判据不清时一律不杀 —— 「猜着杀」比「说清楚」危险得多 |

历史行为（已废弃）：启动器互斥量与壳单实例用全局固定名，端口清理按端口号
无差别击杀——表现为「启动第二份检出时，把第一份检出的 dev server / 壳杀掉，
或自己被第一份检出吞掉」。

> **窗口识别也按检出**：python 启动器查找/聚焦应用窗口时核对窗口进程的 exe
> 路径落在本检出内（`_SHELL_OWN_PREFIX`），否则另一份检出的同名壳
> （进程都叫 app.exe、标题相同）会被误认成自己的实例。
>
> **注意**：两份检出共用外部服务（如 ComfyUI 默认端口）的行为不变——后启动
> 的一方会探测到已运行的实例并复用；需要隔离时在各自设置里配不同端口。
> WebView2 用户数据目录按应用标识共享（同一台机器上的两份检出同一身份），
> localStorage 等按源隔离（端口不同即不同源），不互相污染。

## 2. 启动预检（dev-launcher.mjs，新增于 2026-09-02）

预检分两段：**工具链门禁**（`Test-ToolchainGate`）在预编译壳弹出**之前**执行，只做只读致命快检——命中即 throw，让 python 启动器在 Tauri 窗口出现前弹 MessageBox 告知根因（双击 exe 场景下窗口未现即弹窗）；**完整依赖预检**在壳窗口出现之后执行（见 §1：窗口秒出后再由 splash 展示进度）。

### 2.1 工具链门禁（弹壳前，只读快检，任一失败立即终止并弹窗）

1. **pnpm 命令可用性**：install / dev 全依赖 pnpm，命令不可用即致命损坏 ——
   直接给修复指引，不弹黑窗口。判据与文案收在
   `scripts/launcher-core/corepack.mjs`（`orchestratePnpm()`），编排器只接线
   （`runToolchainGate()`）。三条口径见下。
2. **node_modules 是否完全未装**：`.modules.yaml` 缺失 = 依赖从未正确安装，引导先跑
   `tools\start\run-local.ps1`（Windows 双击）/ `pnpm install`（三平台通用）。

#### 2.1.1 「pnpm 可用」的判据：**选中的可执行形态真的起得来**（ISSUE #576）

`whichCommand()` 只保证「PATH × PATHEXT 上存在同名文件」，**不等于能跑**：

- Node 的 `spawnSync` 在 Windows 上**不解析 shebang**（libuv 直接 `CreateProcess`
  传文件路径），所以 corepack 那只无扩展名 shim（`#!/usr/bin/env node`）被 spawn 时
  一律 `EACCES` / `ENOEXEC`；
- 而 PATHEXT 的常见顺序把 `.CMD` 排在最前，`.CMD` **只有 cmd.exe 会解释** ——
  同一目录里「能跑的 `pnpm.ps1` / 能跑的 `pnpm`」会被**跳过**，选中的偏偏是跑不起来的那个；
- **`.CMD` 被选中时 Node 一定会失败**（实测 `EINVAL`，不是 `EACCES`）：它既不是
  能做 `CreateProcess` 的 PE 镜像，也没有 Node 认的 shebang。所以「批处理」必须是
  一个**独立形态**，不能被塞进通用的「文本脚本」里当成可执行 —— 那会让它一路通过
  候选确认，直到真跑起来才炸。

表现是 `pnpm -v` 探测失败、**stdout / stderr 全空**，用户只看到
`pnpm 工具链不可用（exit=?）：未知错误`（选中的若正是 `.CMD`，则是
`EINVAL（未发现可回退形态）`）—— 看起来完全像 corepack 缓存损坏，
而真正的修法是「别选中那个文件，改用它旁边的 `.ps1`」。因此判据分两层：

| 层           | 位置               | 做什么                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 候选**顺序** | `executableExts()` | 无扩展名 / `.EXE`（CreateProcess 能直接起）→ `.PS1`（经 PowerShell 宿主）→ `.CMD` / `.BAT`（Node 起不了，只能垫底）→ PATHEXT 其余项                                                                                                                                                                        |
| 候选**形态** | `executableKind()` | `shebang`（`#!` 起头）/ **`batch`**（`@echo` / `@setlocal` 起头，即 `.cmd` / `.bat`）/ `script` / `binary` / `unknown`。**批处理单列一类**，不与 `.ps1` 混                                                                                                                                                 |
| 候选**确认** | `usableCommand()`  | `fs.accessSync(X_OK)`；**Windows 上的 `batch` 直接走回退、不真起**（真起必 `EINVAL`）；其余形态**真起一次**（`stdio: "ignore"`）。起不来 / 属 `batch` 时在**同目录**取 `<去掉自身扩展名>.ps1`（`powershell -NoProfile -ExecutionPolicy Bypass -File`）。**选第一个真的能跑的**，全都不能跑才返回「没找到」 |

> 为什么是「真起一次」而不是「看扩展名」：扩展名只说明「谁解释它」，不说明
> 「这台机器上现在能不能跑」。探针的退出码无关紧要（`--version` 报错也算起得来），
> 只有 `probe.error.code`（EACCES / ENOENT / ENOEXEC）才算不可用。
> shebang **不按形态一刀切**：libuv 在 Windows 上确实不解析它，但机器上真配好了
> 文件关联时它仍可用，所以留给「真起一次」去发现；起不来自然落到回退。
> POSIX 上只有一种形态（无扩展名），且内核自己解析 shebang，整条判据退化为原来的行为
> ——「批处理专属」的短路**只在 Windows 生效**。

> **回退同胞名按「去掉自身扩展名再拼 `.ps1`」求**：无扩展名 shim 是 `pnpm` → `pnpm.ps1`，
> 批处理是 `pnpm.CMD` → `pnpm.ps1`（**不是** `pnpm.CMD.ps1`）。只做字符串拼接会让
> `.CMD` 一侧的回退永远找不到，等于没修 —— 这正是第二轮现场里提示说
> 「未发现可回退形态」而 `pnpm.ps1` 明明就在旁边的原因。

**同一个形态必须一路走到起服务**：`spawnDevServer()` 经 `commandInvocation()`
拿 `{ command, prefixArgs }`，不再自己拼可执行名 —— 否则会出现「门禁探测通过了，
起 dev server 时换一种方式又失败一次」。

#### 2.1.2 探测结果要区分成因，并且**不把猜测写成结论**

`probePnpm()` 返回结构化结论（`ok` / `reason` / `reasonText` / `detail` / `exitCode`）：

| reason         | 现场                                        | 提示口径                                                               |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `not-found`    | PATH 上没有任何可用形态                     | 给 `corepack enable`，并点明「检查 PATH 上是否同时存在多个 pnpm 形态」 |
| `spawn-error`  | 命令**起不来**（EACCES / ENOENT / ENOEXEC） | 附 `error.code` 与回退结果；**自动 corepack 重建 + 复核**（见 §2.1.3） |
| `exit-nonzero` | 命令能起，自己报错退出                      | 原样带出 stderr 头几行（不再塌成「未知错误」）                         |
| `no-version`   | 能起、退出 0，但没打印版本号                | 同上，带出实际输出                                                     |

文案里「你看到的是现象」与「可能的成因」分两句写：此前把
`疑似 corepack 切换版本时本地缓存损坏` 直接当结论（`疑似` 又写成陈述句），
用户会照着错的方向删缓存 / 重装 Node，而真正该做的是**先看命令起没起来**。

修复提示里的版本号**取自 `package.json` 的 `packageManager`**
（`packageManagerVersion()`），不再出现 `corepack prepare pnpm@<项目版本>`
这种没人会去填的占位符。提示是多行文本，经 launch-status 的 `stale_shell`
横幅落到启动页（启动页的横幅用 `white-space: pre-wrap` 渲染，
修复动作不会被压成一行挤没）。

#### 2.1.3 能自愈的先自愈，**修完必须复核**

`spawn-error` / `not-found` 一类看起来就是「缓存或可执行形态坏了」，正是 corepack
的修法能治的；`no-version` / `exit-nonzero` 则往往是 pnpm 自己在报业务错误
（工作区配置、磁盘权限），重建既治不好又白等几分钟下载 —— 所以自动重建只对前者触发
（`shouldRepair()`）。重建后**必须用同一条探测再验一次**（`repairPnpm()`）：
`corepack prepare` 的退出码只说明「下载/激活动作完成」，而「shim 仍不可执行」
这类现场里正好是 prepare 成功、`pnpm -v` 依旧起不来 —— 只报 prepare 成功
等于把「修好了」当结论，用户下一次启动会原封不动再撞一次。

#### 2.1.4 独立自查入口：**与启动器同一条口径**（ISSUE #576）

`pnpm check:toolchain` → `scripts/check-pnpm-available.mjs`，登记在 §9.5 对照表。
启动被门禁拦下之后，用户需要的是「只跑一次自查、看清结论与动作」，而不是反复双击
入口撞同一堵墙。它是**薄壳**，判据全部复用上面这些函数；且与 `dev-launcher.mjs`
一样**不需要任何 `.ps1` 副本**（Windows 双击侧由 `prepare-local-run.ps1` 的第 2/3 步
覆盖同一件事）。

「薄壳」也包括**动作**，不只是判据 —— 自检看到的每条结论，都必须是启动链路里
真正会发生的事，否则用户会照着自检去手工修一个「真启动时它自己就会好」的问题：

| 情况                           | 启动链路会怎么做                                                                                | 自检必须怎么做                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| pnpm 不可用                    | 门禁终止 + 给修复提示                                                                           | 同样非零退出 + 同一份 `buildTip()` 文案                                                                             |
| 版本与 `packageManager` 不一致 | `reconcilePnpmVersion()`：`preparePnpm()` 对齐后用**同一条探测复核**，仍不一致才 WARN（不阻断） | **先试同一条对齐**：复核通过 → `[OK] 已对齐（10.34.5 → 12.4.1）`；复核仍不一致才 `[WARN] 自动对齐未生效` + 手动命令 |
| `node_modules` 未装            | 完整依赖预检（§2.2 第 5 步）终止                                                                | 点出这一道门禁与 `pnpm install`，不让「`[OK] pnpm 可用`」被读成「可以启动了」                                       |
| 探到的是「哪个 pnpm」          | 日志里记选中的可执行文件（`commandInvocation()`）                                               | 另打印「选中的 pnpm：<文件>」与「经宿主执行：<宿主> → <文件>」两行（§2.1.5）                                        |

> 反例（已修）：自检此前只对版本不一致打一句 `[WARN]`、什么也不做，还以 0 退出；
> 而启动器在同一情形下会自己 corepack 对齐。用户看到的是「排查完了、没办法」，
> 只能手动跑 corepack —— **自检与真启动两套说法**，正是 §9.5「一份逻辑两端复用」
> 要消灭的形态。判据（`probePnpm` / `preparePnpm`）与动作（对齐 + 复核）现在都在
> `corepack.mjs`，自检与 `reconcilePnpmVersion()` 各调用一次，不各写一份。

#### 2.1.5 「版本对不上终端」先看探测身份：选中的是哪个文件（ISSUE #576 第四轮）

用户现场（Windows，`F:\AI\Other\Comfy-APP-T3`）：同一个窗口里
`pnpm --version` → `12.4.1`，而 `pnpm check:toolchain` →
`[OK] pnpm 可用：10.34.5（C:\Program Files\PowerShell\7\pwsh.EXE）`。

两句都不假，因为它们说的**不是同一个文件**：终端敲的 `pnpm` 由 shell 的 PATHEXT 解析
（会走 `.cmd` 交 cmd.exe）；Node 侧由 `whichCommand()` 解析，只看节点**真的能起**的形态
（`.cmd` / `.bat` 被跳过，见 §2.1.1），选中 `.ps1` 时命令名就变成宿主 `pwsh.EXE`。
再叠上「PATH 上并存多个 pnpm」（独立安装 / 另一份 corepack 副本 / 另一个检出）时，
被选中的那个完全可能是另一个版本 —— 旧文案只给「版本号 + 命令名」，现场于是无解。

因此自检必须打印**探测身份**（`scripts/check-pnpm-available.mjs`）：

- `[INFO] 选中的 pnpm：<文件>` —— PATH 上真正命中并被 spawn 的那个；
- `[INFO] 经宿主执行：<宿主> <参数> → <文件>` —— 仅当形态需要宿主时打印；
- 版本漂移的提示把方向指向「选中的 pnpm」，而不是项目里的 `package.json`。

判据仍在 `shell.mjs` 的 `commandInvocation()`（形态 + 宿主前缀只有一处定义），
自检只是把它返回的 `{ command, prefixArgs }` 印出来，不自己拼可执行名。

> **排障口径**：看到 `（…\pwsh.EXE）` 不是异常，含义是「本次探测经 PowerShell 宿主
> 跑的是同目录的 `pnpm.ps1`」；要改「用哪个 pnpm」，改的是 **PATH 顺序**
> （把想用的形态目录排到前面），而不是改仓库里的任何文件。

#### 2.1.6 内层 spawn pnpm 也必须走同一个形态判据（ISSUE #576 第五轮）

第五轮现场（用户第二次双击 `start-tauri.exe`）：启动页报
`应用启动失败：启动进程 dev-launcher.mjs 提前退出（exit=1）`，而 `dev-launcher.log`
里 `dev server 已启动（PID …）` 之后**两秒**就出现 `dev server 自身退出（exit=0）`，
`最近 stdout` 只有一行 `[dev.mjs] COMFYAPP_PORT=3734 host=127.0.0.1`，stderr 全空。
用户的反馈是「还是看不出那有问题，日志需要详细」。

根因在**编排器之下**：`scripts/dev.mjs`（`pnpm dev` 的入口，由启动器 spawn）当时写死
`spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", …)`。Windows 上批处理
只有 cmd.exe 会解释，**Node 起它会失败**（实测 `EINVAL`，正是 §2.1.1 已记录的那条判据），
于是 `result.status === null`，而旧代码 `process.exit(result.status ?? 0)` 把它读成
**成功退出 0** —— dev server 静默消失，Next 一行输出都没有。

| 缺陷                     | 形态                                                                                | 修法                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内层起服务自己拼可执行名 | `dev.mjs` / `start.mjs` / `analyze-bundle.mjs` 各自写 `win32 ? "pnpm.cmd" : "pnpm"` | 一律经 `shell.mjs` 的 **`pnpmInvocation()`**（它内部就是 `whichCommand()` + `commandInvocation()`，见 §2.1.1），拿 `{ command, args }` 直接 spawn |
| 「命令没起来」被读成成功 | `process.exit(result.status ?? 0)`                                                  | 先判 `result.error`（带 `error.code` + 实际命令），再判 `status === null`，两者都以非零退出并打印**真实命令**                                     |
| PATH 上没有任何可用 pnpm | 静默 —（`status` 也是 null）                                                        | `pnpmInvocation()` 返回 `null`，调用方打印可行动作（`pnpm check:toolchain`）并非零退出                                                            |

> `pnpmInvocation()` 是**唯一出口**：任何「Node 去 spawn pnpm」的地方都从这里拿命令，
> 不许自己拼可执行名、更不许按平台写后缀 —— 那正是本条缺陷的形态本身。
> 回归护栏：`tests/dev-launcher-toolchain-gate.test.ts` 的
> 「内层 spawn pnpm 复用同一形态判据」一组（含「不得再出现 `?? 0`」的源码级断言）。

**失败出口的日志必须落在「本次运行」的文件上**：同一次现场里，
`concludeDownstreamExit()` 还按文件名重找「最近一份」nextjs 日志
（`lastNextLog()` → `readdirSync().sort().reverse()` 的**字典序**）。目录里同时存在
历史命名（`…<date>_<time>.log`）与现命名（`…<date>T<time>.log`）时，
`_`（0x5F）排在 `T`（0x54）之后，「最新」恒定指向**上一次运行**那份 ——
用户照着弹窗给的路径去翻，看到的是别的失败现场。现在把本次起的
`nextOut` / `nextErr` **直接传进**收尾函数，不再按名字猜（`lastNextLog` 已删除）。

失败弹窗（`_build_failure_message`）同时补齐最关键的现场：除了启动器两侧，
还贴出 **dev server 自己的输出尾部**（`log/nextjs/nextjs-stderr-*.log`，取
**mtime 最新**的一份 —— 不按文件名字典序，理由同上）与「下一步」（`pnpm check:toolchain`），
让用户不必再去翻别处。

#### 2.1.7 门禁与工具脚本同样走同一个形态判据（ISSUE #638）

第五轮修的是「起**服务**」那一层（`dev.mjs` / `start.mjs` / `analyze-bundle.mjs`），
而**门禁与工具脚本**仍在自己拼可执行名 —— 于是同一个坑换了地方复发。现场是 Windows 上
跑格式门禁：

```
[format] 无法执行 prettier:spawnSync pnpm.cmd EINVAL
```

`scripts/check-format.cjs` 里写着 `process.platform === "win32" ? "pnpm.cmd" : "pnpm"`，
而那**正是** §2.1.1 早已判定「Node 起不来」的批处理形态（只有 cmd.exe 解释它，实测
`EINVAL`）。它是提交门槛的格式棘轮入口、也是 `pnpm check:all` 的一环，于是 Windows 上
`pnpm format:ratchet` 直接以 exit 2 崩掉；更糟的是同族脚本的失败形态是**静默**的
（`check-reformat-only.cjs` 每个文件都退回「无法判定」，门禁一声不吭地失效）。

| 位置                                                                                             | 旧写法                                                                         | 现在的写法                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `check-format.cjs`                                                                               | `win32 ? "pnpm.cmd" : "pnpm"` 后 `spawnSync`                                   | `runPnpmSync()`（唯一出口），失败时打印 `error.code` + **实际命令** + `pnpm check:toolchain` |
| `check-reformat-only.cjs`                                                                        | 同上（prettier 兜底档），判据模块与格式棘轮**各写一份**平台分叉                | 同上；`entry` 档起的是当前 Node 运行时（无平台分叉），只有兜底档走 `runPnpmSync()`           |
| `check-app-port-vectors.cjs` / `repair-imports.cjs` / `heal-db.cjs`                              | `execSync("pnpm exec tsc …")` / `spawnSync("cmd", ["/c", "pnpm", …])`          | 同上（`cmd /c` 那版在 POSIX 上等于**什么都不做**：`cmd` 根本不存在）                         |
| `db-push.mjs` / `quality-gate.mjs` / `run-tests.mjs` / `generate-docs.mjs` / `build-desktop.mjs` | 各自 `whichCommand("pnpm")` 后裸 `spawn`（拿到的是**文件**，不是**命令形态**） | 同上：`runPnpmSync()` / `pnpmInvocation()`（后者连宿主前缀一起给，`.ps1` 形态才起得来）      |

**唯一出口是 `shell.mjs` 的 `pnpmInvocation()` + `runPnpmSync()`**：前者解决「服务怎么起」
（返回 `{ command, args }` 供 `spawn`），后者解决「同步跑一条 `pnpm …`」（返回带
`error` 的结构化结果，`status === null` 只表示「没起来」而不是「成功 0」）。
调用方只给 pnpm 后面的参数，**不拼可执行名、不按平台分叉**。

> 为什么不是「逐个文件修」：这条坑在本仓库已经复发到第四次（`.cmd` 形态被选中、
> `dev.mjs` 写死 `pnpm.cmd`、`dev-launcher.mjs` 的探测、门禁脚本）。每次都是
> 「同一个判据在另一个文件里被重写一遍」。所以回归护栏改为**按形态全仓扫描**
> （`tests/dev-launcher-toolchain-gate.test.ts`）：
> `scripts/**` 里出现 `pnpm.cmd` 字面量、按平台三元拼可执行名、或**裸起一个 pnpm**
> 而没有复用 `pnpmInvocation` / `runPnpmSync`，即失败。它不靠一张会漂移的文件清单
> ——新增脚本自动落在判据内（这正是 `repair-imports.cjs` / `heal-db.cjs` 被它当场
> 抓出来的原因）。

> **`.cjs` 门禁怎么复用 ESM 判据**：判据模块是 ESM，`.cjs` 里 `require()` 拿不到它，
> 用 `await import()` —— 那件事让整个脚本变异步，因此 `check-format.cjs` /
> `check-reformat-only.cjs` / `heal-db.cjs` 的主逻辑收进 `async function main()`，
> `repair-imports.cjs` 同理。薄壳式的 `loadShell()` 只加载一次，加载失败时以非零码
> 退出并指出缺的是哪个模块（门禁的「加载失败」不许表现为「判定通过」）。

### 2.2 完整依赖预检（壳窗口出现后）

按顺序执行，任一失败立即终止并展示日志尾部：

1. **残留壳清理**：按命令行匹配终止上次运行遗留的同项目 app.exe（防窗口叠加）。
2. **端口清理**：杀掉**本检出端口族**的监听进程——族 = `Get-AppPort` 的解析端口
   `[COMFYAPP_PORT, +1, +2]`（端口缺省时为路径推导值，静态兜底 3100 只是该族的一个
   特例，**不要写成写死的 3100/3101/3102**：那会在推导端口上留下残留实例，新实例
   被挤到 +1 后浏览器连着旧代码）。
3. **缓存指纹**：next.config/tsconfig/package.json/lockfile 指纹变化才清 .next。
4. **pnpm 版本一致性检查**：比对 `package.json` 的 `packageManager` 声明版本与
   `probePnpm()` 报告的实际版本。一致则跳过；不一致时按同一版本号
   `corepack prepare pnpm@<期望版本> --activate` 对齐（需联网一次），**并用同一条
   探测复核**（不看 prepare 的退出码，见 §2.1.3），成功 OK；不一致仍持续时只 WARN
   并透出到启动页（复用 stale_shell 字段，不阻断启动），提示里的版本号取自
   `package.json`（不再有 `<期望版本>` 占位符）。
   > 本步与 §2.1 门禁共用 `corepack.mjs` 的探测与重建（规范 §9.5「一份逻辑两端复用」）：
   > 探测失败**不在这里二次解释** —— 门禁已给过「不可用 + 怎么修」，这里不再叠一句。
   > 若已先经过 §2.1 门禁，此处通常到不了该分支。
5. **node_modules 健康检查 + 补装（编排器侧）**：`.modules.yaml` 与 `.bin/next` 缺失，
   或关键依赖目录（`typescript`、`@typescript/native`、`next`）**存在但为空**
   （pnpm 策略拒装/中断安装的典型残留——空目录会让 tsc 垫片找不到入口），即视为残缺。
   直接 `pnpm dev` / 双击入口的判据与动作收在 `scripts/dev-launcher.mjs` 的
   `runToolchainGate()` + `syncDependencies()`（配合 `launcher-core/worktree.mjs`）：
   - 门禁只回答「装没装」；**补装与否由 lockfile 漂移决定**
     （`lockfileDrift()` 比对 `node_modules/.pnpm/lock.yaml` 与仓库 `pnpm-lock.yaml`）。
     「装了」与「装的是不是当前 lockfile」是两件事：只看前者会让「拉了更新没重装」
     被当成「已就绪」跳过，而报错落在业务模块解析失败上（看不出是依赖问题）。
   - **漂移判据是「实质差异」，不是字节相等**：两份 lockfile 必然不同形（少 YAML
     文档头 `---`、`settings:` 段位置不同；实测干净安装后 12300 / 12142 行、首行就不同），
     哈希比对会让每次启动都判成漂移并重装一遍。判据用
     `scripts/lockfile/lock-diff.mjs` 的 `diffLockfiles()/isEmptyDiff()`（与质量门禁、
     `diff-cli.mjs` 同源），注释 / 空行 / 条目顺序不算差异。
   - 补装走 `pnpmInvocation(["install"])`（形态判据的唯一出口，§2.1.6），
     **复核走 `verifyInstall()`**（`.modules.yaml` + 关键依赖目录 + 安装时 lockfile 与
     仓库 lockfile 实质一致）—— 不看退出码（§9.2 第 4 条：`drizzle-kit push` 的
     「报错 + exit 0 + 留空库」是同一族的坑）。复核不通过即非零退出 + 可行动提示。
   - lockfile 一致时**不再无条件跑 install**（正常路径上那是一次纯等待）。
   > 差异明细复用 `scripts/lockfile/diff-cli.mjs` 同一条判据，逐项打印（ISSUE #550）。
   > 日志：`log/launcher/pnpm-install-stdout/stderr.log`（.ps1 侧）。
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
6. **依赖漂移差异定位（ISSUE #550）**：判定「依赖与 lockfile 不一致」只回答了一半问题——
   用户接着要问的是「哪儿不一致」。启动链路与质量门禁统一调用
   `scripts/lockfile/diff-cli.mjs`（内核 `scripts/lockfile/lock-diff.mjs`），把两份 lockfile
   分段比对后**逐项打印**：顶层配置（`settings` / `overrides`）、各 importer 的直接依赖
   （新增 / 删除 / `specifier` 或解析版本变更）、以及 `packages` / `snapshots` 的条目增删。
   只依赖 Node 内置能力，不引第三方 YAML 解析器（standalone 产物里也不带）。
   > 判据仍是 `node_modules\.pnpm\lock.yaml` 与仓库根 `pnpm-lock.yaml` 的内容差异，
   > 差异定位只是把「为什么不一致」讲清楚，不改变谁触发重装。
   > 两份 lockfile 的正文段必须用 `splitTopSections` 统一处理：仓库 lockfile 头部含一段
   > pnpm 自举（bundled CLI）内容与正文同形，整体拿去比对会被误判成「重复段落」。
7. **壳时效提醒**：app.exe 比 tauri.conf.json / src\*.rs / splash-assets 旧时
   WARN 提醒重编（`cd src-tauri; cargo build --release --features custom-protocol`）。
   窗口配置与启动页是编译期内嵌的，只改源码不重编壳 = 跑旧逻辑（黑屏问题的
   直接来源）。
8. **数据库 schema 同步（Drizzle）**：依赖预检后执行 `pnpm exec drizzle-kit push`，
   以 ALTER 方式把 `src/server/db/schema.ts` 的表结构增量同步进 `db.sqlite`
   （保留现有数据）。改用 Drizzle 后不再有「运行时必须重新 prisma generate 一个
   庞大 client + DLL 被锁」的步骤；改了 schema 后双击启动即可自动生效。失败仅
   WARN（不阻断启动），日志：`log/launcher/drizzle-push-stdout/stderr.log`。

## 3. 进程树管理规范

### 3.1 跨平台入口：`src/lib/process/kill-process-tree.ts`（Node 侧唯一收口）

Node 侧**只允许经 `killProcessTree()` / `killProcessTreeSync()` 回收进程树**，
不要在各服务生命周期里自己写 `taskkill` / `process.kill`——历史实现正是各写一遍，
且 POSIX 分支只剩 `child.kill("SIGTERM")` 单杀 leader，实测给一个含 3 个子进程的
shell 发 SIGTERM 后 3 个子进程全部残留（PPID=1，占端口、锁日志文件），
正是硬规则 3 明令禁止的形态。平台判据收在该模块一处：

| 平台    | 机制                                                | 说明                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `taskkill /PID <pid> /T /F`                         | 硬规则 3 的原始要求；`/F` 走 TerminateProcess，被杀进程没有清理机会（这也是 bound / keepAlive 只能在「拉起时」决定的原因）                                                                                                                                                                                                                                                                    |
| POSIX   | 读目标 PGID 后 `process.kill(-pgid, SIG)`（进程组） | **组长归属由 OS 回答**（`ps -o pgid= -p <pid>`），不由调用方按 `detached` 布尔值猜——经 `sh -c` / `pnpm exec` 中转后 leader 往往不是组长，`kill(-pid)` 会 ESRCH 静默落回单杀（实测 `pnpm dev` 留下 5 个孤儿）。另设**防自杀判据**：目标 PGID 等于调用者自身 PGID 时（bound 模式子进程与调用者同组）禁止走组路径，只单杀 leader，否则信号会打向应用自己的进程组。拿不到 PGID 时也退化为单杀兜底 |

只用 Node 内建能力：`lsof`、`pstree` 在很多发行版默认不装，依赖它们等于把
「回收失败」变成静默失败（探测链路另有 `proc-detect.ts` 的同类约束）。
回收结果由调用方**探测确认**收口（各服务生命周期自己那份），本模块不抛错。

**「派发」与「等到结束」是两件事（`wait` 选项）**：Windows 上 taskkill 是独立进程，
默认只派发（服务生命周期随后自行探测确认）；但**派发完就退出的调用方必须传
`wait: true`** —— 父进程紧接着 `process.exit()` 会把还没跑起来的 taskkill 一起带走，
现象是**打印了命令、退出码 0、目标进程却还在**（实测：不等时目标存活，等 3 秒后消失）。
命令行入口 `scripts/reap-process.mjs` 正是这种形态，因此它显式等待，并把回收命令的
退出码写进 `via`（宿主日志据此能看出这一刀落没落）。`spawn` 会同步抛错的情形
（命令不是可执行映像 / 取不到命令名）一并收成 `ok: false`，不让「回收失败不抛错」
这条承诺在实现里破口。

回归测试：`src/lib/process/kill-process-tree.test.ts` —— **真起多进程树、杀完数残留**，
而不是断言 `via` 字符串（只查命令构造正是让「按 detached 猜组长」漏过去的原因）。
覆盖：detached 进程组整树 0 残留、与调用者同组时禁走组路径（防自杀）、
`detached` 标记与实际组不一致、单杀兜底、目标已退出的返回语义；
Windows 分支只在 win32 上断言命令构造。
命令行入口另有**端到端**用例（`tests/cross-platform-launcher.test.ts`，Windows 上真起
一个长命进程 → 真跑 `node scripts/reap-process.mjs <pid> --force` → 核实目标**真的没了**）：
「打印了命令」不等于「杀掉了」，而这条兜底恰恰曾经停在前者。
POSIX 端口探测回归：`src/lib/comfyui/proc-detect.test.ts`（`/proc/net/tcp` 解析、
真起监听 socket 的 fd 交集、失败路径返回 null）。

### 3.2 编排器入口（`dev-launcher.ps1` / 启动器 exe / Build-Guard.ps1）

> 编排的**唯一实现**是 `scripts/dev-launcher.mjs`（§3.3）。Windows 侧只保留
> 「怎么被拉起」这一层入口，`taskkill` 之类的平台命令一律不在入口里。

- `scripts/dev-launcher.ps1` 是**薄入口**：定位项目根 → `node scripts/dev-launcher.mjs`
  → 透传退出码。它不再自己拼任何平台命令（长度判据有回归测试守着，见
  `tests/cross-platform-launcher.test.ts`）。
- `scripts/entry-common.ps1` 的 `Get-ProjectRoot` 判据是 `scripts/dev-launcher.mjs`
  （编排器的唯一实现），**不是** `.ps1` —— 判据绑在入口形态上，换入口时就会
  静默失效一次（本仓库已经栽过一回，见 §9.3 的 `looks_like_project_root`）。
- **桌面壳进程树由编排器回收**，入口侧只保留两条兜底（都是历史事故换来的）：
  - 编排器启动前按「exe 真实路径落在本仓库 `src-tauri/target/{release,debug}`」
    回收残留壳（**不要**按 `CommandLine -like` 判断：预编译壳经
    `ProcessStartInfo(UseShellExecute=false)` 启动，命令行里不含项目根路径）；
  - 壳拉起后把 PID 写入 `log/launcher/tauri-shell.pid`，Python 启动器的监控线程在
    编排器退出/异常/超时路径检查该 PID，仍存活就调
    `node scripts/reap-process.mjs <pid> --force` 补刀并删除 PID 文件；
  - **拉起编排器之前必须先删这个 PID 文件**：它是上一轮 run 的残留，而编排器是被
    启动器另起的进程——在它写新 PID 之前，文件里还是旧 PID。系统会复用 PID，旧号
    很可能已归某个无关进程，兜底路径读到就会去杀不相干的东西。先删 = 窗口期内读不到，
    语义安全。
- **Job Object 已退场**：`KILL_ON_JOB_CLOSE` 在本机设置失败（Win32 错误 87），
  历史上只是「WARN 后靠自身兜底」。现在兜底就是唯一路径 —— 进程组（POSIX）与
  `taskkill /T /F`（Windows）由 `kill-process-tree` 统一执行，不再有「看起来生效
  其实没生效」的第二套机制。
- pnpm 已关闭 `verifyDepsBeforeRun`（见 §6）：任何 pnpm 命令都不会隐式
  补跑 install。dev server 运行期间不要手动跑 `pnpm install`
  （better-sqlite3 等原生模块被进程锁定，install 会 EPERM）。

### 3.3 跨平台启动编排器（`scripts/dev-launcher.mjs`）

`dev-launcher.mjs` 是**全平台唯一实现**（Windows 也走它）。历史形态是「Windows
一份 `.ps1`、POSIX 一份 `.mjs`」，两套各自演进 → 平台间行为不一致，且只能靠
「记得同步另一侧」维持，而漏同步是静默的（`dev` 一侧长期没走端口契约就是这么
来的；上一版 `.ps1` 有 1324 行 / 19 处 Windows 专属调用：`taskkill` /
`Get-CimInstance` / Job Object / `cmd.exe`，保留在 `dev-launcher.legacy.ps1`
只作对照）。

编排的 90% 本就与平台无关，现在按职责分成三层，**每层只有一个出处**：

| 层         | 文件                                                                              | 内容                                                                                  |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 编排       | `scripts/dev-launcher.mjs`                                                        | 预检 / 端口 / 缓存 / 拉起 / 就绪 / 进度快照 / 收尾定性（**不摸 `process.platform`**） |
| 平台机制   | `scripts/launcher-core/{procs,shell,job-object}.mjs`                              | 进程与端口探测、进程组拉起、可执行文件解析                                            |
| 进程树回收 | `src/lib/process/kill-process-tree.ts`（`scripts/reap-process.mjs` 为命令行入口） | Windows `taskkill /T /F`；POSIX 读 PGID 后发组信号                                    |

各环节的取值来源仍是**同一事实源**，只是不再有「第二份实现」：

| 环节       | 出处                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 端口       | `scripts/app-port.mjs` 的 `resolveAppPort`（绝不在这里重算）           |
| 缓存指纹   | `launcher-core/worktree.mjs` 的 `configFingerprint()`（sha256 逐文件） |
| dev server | `spawnInGroup(pnpm, ["dev","-p",N,"-H",…])` —— POSIX 自建进程组        |
| 回收       | `killProcessTree`（Windows `taskkill /PID /T /F`；POSIX 杀进程组）     |
| 孤儿线索   | `run/launcher-session.json` + `run/launcher-heartbeat.txt`             |
| 进度快照   | `run/launch-status.json`（字段口径见 §9.3）                            |

**增量决策：不在 Rust/Python 里重写平台判据。** 壳的 sidecar 回收（`kill_sidecar`）
与 Python 启动器的兜底补刀都转交 `scripts/reap-process.mjs`：Rust 里再写一套
`taskkill` 分支，就是「各写各的、POSIX 上退化成单杀」那条老路的翻版。

**进程组是本方案的地基，不是优化项**。POSIX 上没有 Job Object，而
`spawn` 默认让子进程与编排器**同组**：此时 §3.1 的防自杀判据会禁用组路径，
回收退化成单杀 leader，其下的 `pnpm` / `next` / `turbopack worker` 全部残留。
实测（本机）对照：

```
编排器起来后的真实进程树（与 §3.1 记录的历史形态一致）：
  PID 23201  PGID 23199  node scripts/dev-launcher.mjs
  PID 23246  PGID 23210  pnpm exec next dev --turbo -p 3311
  PID 23273  PGID 23210  node .../next/dist/bin/next dev
  PID 23290  PGID 23210  next-server

旧做法（单杀 leader）：残留 2 个进程（PPID=1），继续占着端口
spawnInGroup（自建进程组）+ 整组回收：残留 0，端口立即释放
```

**会话锚点为什么是「心跳 + PID」两条**（`run/launcher-session.json`、
`run/launcher-heartbeat.txt`）：编排器被 SIGKILL 时没有任何清理机会，
下次启动必须能认出「上一次留下的孤儿」。只看 PID 会被**系统复用**骗过
（旧号可能已归某个无关进程，照着杀就是误伤）；只看心跳会把「卡死但活着」
的实例当成死的。两条都满足才算「上一位还活着」：

| 心跳          | PID  | 判定              | 动作                                                         |
| ------------- | ---- | ----------------- | ------------------------------------------------------------ |
| 新鲜          | 存活 | 上一位在跑        | 不回收，提示端口占用（**不擅自杀**，可能属另一份检出，§1.4） |
| 陈旧（> 30s） | 任意 | 上一位卡死 / 被杀 | 按 `child_pids` 回收整组                                     |
| 新鲜          | 已死 | 写完心跳即被收走  | 同上（回收）                                                 |
| 不存在        | —    | 没有会话          | 无事发生                                                     |

**端口占用只回收自己的**：判据分两层，收在 `launcher-core/procs.mjs`
（`pidBelongsToRoot`）与 `launcher-core/orchestrator.mjs`（`usesExplicitPort` /
`portOwnershipVerdict`）里，本机平台机制由前者按平台实现（POSIX 读
`/proc/<pid>/cwd`；Windows 经 `Win32_Process` 的命令行）：

| 层                            | 判据                   | 说明                                                                                                                                                 |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 工作目录 / 命令行命中检出根 | `pidBelongsToRoot`     | 「该 PID 的命令行里有没有出现过本检出根路径」                                                                                                        |
| ② **应用服务自证**            | `portOwnershipVerdict` | 命令行跑的是本仓库的启动脚本（`scripts/{{dev.script}}` / `scripts/start.mjs`）或 `next dev` / `next start` CLI。**只在端口由编排器显式指定时才成立** |

**为什么需要第 ② 层**（ISSUE #621）：第 ① 层回答不了「这个进程是不是本仓库的
应用服务」——`node_modules`、缓存路径、用户传进来的相对路径参数**都会**把检出根
带进命令行，于是「别的程序恰好从本检出目录启动」与「本检出上次留下的 dev server」
在旧判据下无法区分，而这两种情形的正确动作完全相反。第 ② 层加的是**形状判据**，
不依赖任何状态文件（`run/`、`log/` 里的锚点会就地重建或提前清掉，见上文会话锚点）。

**为什么第 ② 层只在「显式端口」上成立**：编排器一律用 `pnpm dev -p <port>` 拉起
dev server（Next 不认 `COMFYAPP_PORT`，必须显式传），所以**端口上服务只可能是编排器
起的、或用户/别的检出手工起的**；而缺省解析链上这两者**无法区分**——
另一份检出的 `.env` 恰好解析到同一个号码时，双方都会判定「端口是我该用的」。
因此 `usesExplicitPort()` 是第 ② 层的开关：缺省端口（`null` / 非正整数）一律退回
第 ① 层结论，**宁可放过一次残留，也不猜着杀别人的进程**。

两种情形必须分清：

- 属本检出的残留（上一次启动留下的实例，或显式端口上自证为本仓库应用服务的进程）
  → 回收整棵进程树后继续启动，用户无感；
- 判据不清或属别的检出 / 别的程序 → **清楚地告诉用户怎么办**（改 `.env` 的
  `COMFYAPP_PORT` 或关闭残留实例），绝不猜着杀。这是 §1.4 的直接推论，也是
  「本机 Windows 上突然起不来」最容易踩的一格 —— 误杀别人的服务比失败更难查。

回归测试与反向验证锚点：

| 用例                                                | 锁什么                                                                                                                                                                                                                                                                                                            | 反向验证（改回旧实现必失败）                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `tests/cross-platform-launcher.test.ts`             | 真起进程组、杀完数残留；会话锚点四种心跳/PID 组合；缓存指纹清留判据；**`.ps1` 只剩入口**（不得含 `taskkill` / `Get-CimInstance` / Job Object，且 < 120 行）；编排器不摸 `process.platform`                                                                                                                        | `spawnInGroup` 的 `detached` 改回 `false` → 进程组用例残留 > 0 |
| `src/lib/process/kill-process-tree.windows.test.ts` | **Windows 分支真跑**：注入同名假 taskkill，断言 `taskkill /PID <pid> /T /F`、`/IM <name> /T /F` 真的被调起；空 target 不猜测性击杀；`wait: true` 等到命令结束并把退出码写进 `via`；命令起不来返回 `ok:false` 而不抛错（「参数真的发出去了」两条在 Windows 上跳过：假件只能是 `.cmd`，Node 不能直接 spawn 批处理） | `windowsKillArgs` 去掉 `/T` → 用例必失败                       |
| `tests/dev-launcher-downstream-exit.test.ts`        | 「下游先退出」四种成因的判决表与文案（`downstreamExitKind` / `describeDownstreamExit`），只认壳侧**正标记**                                                                                                                                                                                                       | 判决表退化成「壳退了就算放弃」 → 必失败                        |
| `tests/dev-launcher-port-reclaim.test.ts`           | 端口残留回收的两层判据：显式端口 + 应用服务自证才回收；缺省端口 / 只有检出根路径 / 命令行取不到一律不碰                                                                                                                                                                                                           | 去掉 `usesExplicitPort` 开关或去掉自证 → 必失败                |
| `tests/dist-artifact-hygiene.test.ts`               | `scripts/` 白名单**真删一次**：嵌套条目保留、未登记的新文件被剔                                                                                                                                                                                                                                                   | 白名单改目录级放行 → 必失败                                    |

## 4. 日志布局（排障从上往下看）

`log/` 按子系统分区，禁止新文件平铺在根目录（路径常量的唯一事实来源：
`src/lib/log-paths.ts`，Node 侧一律从该模块取路径）：

```text
log/
├─ launcher/           双击启动链路：python 启动器 + dev-launcher 编排与预检输出
├─ nextjs/             Next dev server 原始输出（按次命名，保留 5 份）
│                     + 应用服务输出转录 nextjs-panel-<boot>.log（面板「应用服务」那一路）
├─ services/           常驻服务运行时日志（comfyui / drizzle-studio / ollama，追加写）
├─ comfyui/            ComfyUI 通信层原始回执（trace：comfy-cli stdout/stderr、WS 帧、
│                     /history 与 /queue 原文，追加写，见 §4.2）
├─ tools/              构建与工具脚本日志（tools/scripts/Log-Common.ps1、setup 脚本）
├─ workshop/           工坊生成执行日志（角色提取 / AI 拆镜 / 定妆照，按天分文件追加）
└─ archive/<yyyy-MM>/  dev-launcher 历史归档
```

| 文件                                                                        | 写者                                                                                           | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 轮转                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `log/launcher/dev-launcher.log`                                             | dev-launcher.mjs                                                                               | 本次启动全量：预检/启动步骤/清理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 每次运行覆盖；归档到 `log/archive/<yyyy-MM>/`                  |
| `log/launcher/dev-launcher-current.txt`                                     | dev-launcher.mjs                                                                               | 指向本次真实日志的 sentinel（log 被锁回退改名时靠它定位）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 同上                                                           |
| `log/nextjs/nextjs-stdout-<ts>.log` `log/nextjs/nextjs-stderr-<ts>.log`     | dev-launcher.mjs 重定向                                                                        | Next dev server 原始输出；**启动失败先看 stderr**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 按次命名，保留 5 份                                            |
| `log/nextjs/nextjs-panel-<boot>.log`                                        | Next server（`src/lib/capture-streams.server.ts`，进程启动时经 `src/instrumentation.ts` 安装） | **应用服务输出转录**：本进程 stdout/stderr 的完整副本（首屏编译错误 / Turbopack FATAL / 未捕获的服务端异常 / pino 行）。「应用日志」面板经 `GET /api/logs/current?source=app` 轮询（规范 07 §7.18.2）——此前这些输出不在任何被轮询的文件里，应用服务起不来时面板一片空白                                                                                                                                                                                                                                                                                                                                                                                                   | 按次命名（进程启动标识），保留 5 份                            |
| `log/launcher/dev-launcher-stderr.log`                                      | python 启动器重定向                                                                            | pwsh 的 stderr + app.exe 的 `[ComfyAPP]` 诊断行（dev 下壳诊断经 log:: → Stderr target 仍落这里）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 每次启动覆盖                                                   |
| `log/shell/shell.log`                                                       | Tauri 壳（tauri-plugin-log，release 构建）                                                     | 壳自持日志：导航/看门狗/侧车/窗口交换等 `[ComfyAPP]` 诊断（standalone 双击无 launcher 重定向时的兜底落盘）；get_launch_log 启动面板尾部追加展示                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | KeepOne 轮转                                                   |
| `log/launcher/start-tauri-launcher.log`                                     | python 启动器                                                                                  | 双击→pwsh→窗口检测的链路日志                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 超过 512KB 轮转，保留 5 份                                     |
| `log/launcher/pnpm-install-stdout/stderr.log`                               | dev-launcher.mjs（依赖预检）                                                                   | 自动补装依赖的原始输出                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 每次触发覆盖                                                   |
| `log/launcher/drizzle-push-stdout/stderr.log`                               | dev-launcher.mjs（schema 同步）                                                                | drizzle-kit push / heal-db 的原始输出                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 每次启动覆盖                                                   |
| `log/launcher/tauri-shell.pid`                                              | dev-launcher.mjs 写 / python 启动器读+删                                                       | 本次拉起的桌面壳 PID；启动器先退出时靠它对仍存活的壳做整树回收（`node scripts/reap-process.mjs <pid> --force`，见 §3）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 每次启动覆盖，兜底回收后删除                                   |
| `log/launcher/foreground-watch.log`                                         | python 启动器 → 交接复核进程（`scripts/win32-window-focus.py`）                                | 窗口交接时刻的前台归属裁定与执行结果（`give` / `restore` / `leave` + 句柄），排查「启动仍然抢前台」先看这里（见 §1.3）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 追加写                                                         |
| `run/launch-status.json`                                                    | python 启动器                                                                                  | 结构化启动进度，splash 页展示；launcher 退出 30s 后自删                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                              |
| 启动页「查看日志」面板                                                      | splash 前端轮询 `get_launch_log`                                                               | dev-launcher.log（经 sentinel 定位）+ dev-launcher-stderr.log + log/shell/shell.log（release）的尾部（去 ANSI、限长），启动页实时看执行到哪一步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                              |
| `.next/dev/logs/next-development.log`                                       | Next dev server                                                                                | dev server 内部日志（含锁冲突提示）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Next 自管                                                      |
| `log/services/comfyui-runtime.log`                                          | Next server（src/lib/comfyui/lifecycle.ts）                                                    | ComfyUI 拉起/spawn 参数/等待与就绪结论 + 子进程 stdout/stderr（`[out]`/`[err]` 前缀），时间戳为本地时间；每次启动/停止前会写一条 **ANSI 亮色会话横幅**（`▶`/`■` box 分隔线），使多次启动累积的日志能一眼分清会话边界；设置页「创作后端 → 启动日志」面板经 `GET /api/logs/current?source=comfyui-runtime` 实时跟随。手动启动不设硬超时（冷加载慢不误报，可手动关闭中止）；任务自动启动保留 420s 上限（防止 reaper 启动窗口被无限拉长）                                                                                                                                                                                                                                     | 追加不轮转；接口首次打开只回尾部窗口（1MB，按行对齐，见 §4.1） |
| `log/services/comfyui-keepalive-<ts>.out/.err.log`                          | dev-launcher 保活中介（Start-Process 重定向）                                                  | 保活模式下 ComfyUI 的完整原始输出，等待循环增量跟随进 runtime.log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 按次命名，不自动清理                                           |
| `log/services/drizzle-studio-runtime.log` `log/services/ollama-runtime.log` | Next server（对应 lifecycle / api 路由）                                                       | Drizzle Studio / Ollama 拉起与子进程输出，设置页日志面板跟随（同 comfyui-runtime 模式）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 追加不轮转                                                     |
| `log/services/app-runtime.log`                                              | Next server（src/lib/app-runtime-log.ts）                                                      | **应用运行期业务操作日志**：tRPC 中间件每次调用（path+duration+type）+ 生成任务入队/完成/失败等里程碑，`[日期时间] [LEVEL] [ns] msg` 本地时区行格式；仅记事件/耗时/类型，不外泄 prompt/PII；应用内「应用日志」面板经 `GET /api/logs/current?source=app-runtime` 实时轮询（规范 07 §7.11）。**面板只显示本次运行**：本文件追加不轮转，服务端在轮询响应里带回「会话起点」（dev-launcher.log 的 mtime），面板据此丢弃早于起点的历史行（`src/lib/log-session-scope.ts`，见 §4.1）。**文件侧也有会话边界**：每次应用服务启动时由 `installStreamCapture` 写一条会话分隔横幅（两侧留空行，`src/lib/session-banner.server.ts`），用户直接看文件也能看出本次从哪开始（ISSUE #592） | 追加不轮转                                                     |
| `log/comfyui/comfyui-trace.log`                                             | Next server（`src/lib/comfyui/trace.ts`）                                                      | **ComfyUI 通信层原始回执**（诊断通道，ISSUE #216）：comfy-cli 全部 stdout 原始 chunk 与解析后的 JSON 事件、stderr 原始 chunk 与退出时的完整 errBuf、本任务的全部 WS 帧、`/history` 与 `/queue` 的原始 JSON、以及各终局结论（「未找到生成结果」时附带 promptId 与 /queue 快照）。行格式 `[本地时间] [INFO] [trace] <channel> [<taskId>] <内容>`，channel ∈ `cli`/`ws`/`http`/`history`/`session`；单行上限 8000 字符（超出标注 `…(truncated)`），写入失败静默跳过（诊断通道不得把生成带崩）。**只在应用内「创作后端 → 启动日志」之外单独查看**，不参与日志面板轮询（避免大体量原文刷屏，见 §4.2）                                                                          | 追加不轮转                                                     |
| `log/tools/*.log`                                                           | tools/scripts（Log-Common.ps1）与 setup 脚本                                                   | 构建/打包/工具运行日志（build-tauri-release、build-standalone、build-launcher、rebuild-static、comfy-cli-setup 等）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 每次运行覆盖                                                   |
| `log/workshop/generation-<yyyy-mm-dd>.log`                                  | Next server（`/api/workshop/logs`，工坊前端在日志追加时异步上报）                              | **工坊生成执行日志**（JSONL，按天分文件）：角色卡提取 / 分镜提取与 AI 拆镜 / 定妆照生成的发起、模型输入输出、结果与错误。界面上各环节的「执行日志」面板即时展示本次会话，「历史」入口按需拉取落盘记录（跨刷新 / 重启可回看）；写入失败静默，绝不影响生成流程                                                                                                                                                                                                                                                                                                                                                                                                              | 按天分文件（自然轮转）                                         |
| `log/archive/<yyyy-MM>/dev-launcher-<ts>.log`                               | dev-launcher.mjs                                                                               | 历史归档                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 无限累积，定期清理                                             |

### 4.1 面板「只显示本次运行」的会话边界

`log/services/` 下的 runtime 日志（comfyui / drizzle-studio / ollama）与
`app-runtime.log` 都是**追加不轮转**的：上一次、上上一次运行的内容全留在文件里。
「应用日志」面板若照单全收，用户打开面板看到的一屏里混着历史运行的行，分不清
哪条属于本次启动。会话边界由三处配合划定：

| 环节     | 位置                                                                  | 职责                                                                                                                                   |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 粒度起点 | `dev-launcher.log` 的 mtime                                           | 双击链路每次运行都覆盖重建该文件，mtime 即本次启动时刻；读不到（非双击链路）时面板退化为不做截断，多显示几条历史也好过凭空丢掉本次日志 |
| 起点下发 | `GET /api/logs/current` 的 `sessionStart` 字段                        | **只有跨运行累积的来源**（`app-runtime` / `app`）在响应里带回起点，客户端无需额外请求；覆盖重建的来源（`launcher` / `dev`）恒为 `null` |
| 行级截断 | `src/lib/log-session-scope.ts` + `log-store.ts` 的 `dropStaleEntries` | **逐来源**判定：只有 `isSessionScopedOrigin` 认的来源比较行时刻，其余一律保留；`setSessionStart` 幂等，页面重载不会把起点往后推        |

时间戳只能回答「文件有没有在本次运行期间被写过」，回答不了「本次内容从第几个
字节开始」，因此**不做字节级跳过**——线格式自带毫秒时间戳，按行比较即可精确切分。
面板每行右侧标注来源（`dev` / `launcher` / `app` / `app-runtime`），便于对照文件排查。

**裁剪必须逐来源判定，不能整条时间线一刀切**（ISSUE #262 四审）：会话起点取自
`dev-launcher.log` 的 mtime，而启动器进程（`start-tauri-launcher.log`）在它被
创建**之前**就写下了 python / exe / cwd / 探测 Node 这些行。整条时间线一刀切会
把这些真·本次运行的行当成历史丢掉——用户读到的就是「启动和启动器日志丢失」。
覆盖重建的来源不存在「历史行」，因此不参与裁剪；完整判据表见规范 07 §7.23.1。

**行形态也是契约**（ISSUE #262 六审）：面板把 `dev` / `launcher` 的行按
`[时刻] [级别] 正文` 解析，**解析不出来时整行会以原文落板**（级别标记变成正文，
用户读到的就是「启动 / 启动器两项还是没有日志内容」）。两个来源的行形态因此各自
写死如下，改 `dev-launcher.mjs` 的 `log()` 或 python 启动器的 `log()` 时必须
同步 `LOG_LINE_RE` / `LAUNCHER_LOG_RE`：

| 来源       | 产出者                              | 行样例                                               | 解析方                                           |
| ---------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| `dev`      | `Write-Log`（级别 `PadRight(5)`）   | `[10:22:24] [INFO ] 预检通过`                        | `LOG_LINE_RE`（级别标记容错、行首允许缩进）      |
| `dev`      | 同一函数写出的缩进续行              | `  [10:22:27] [ERROR] 找不到预编译 Tauri 壳`         | 同上                                             |
| `dev`      | Transcript + ANSI（颜色码可能残缺） | `[10:22:30] [[OK] 服务器已就绪`                      | 同上（剥 SGR 后可能多一个 `[`）                  |
| `launcher` | python `log()`（裸文本、无级别）    | `[2026-09-13 10:22:24.723] === launcher started ===` | `LAUNCHER_LOG_RE`（时刻即写入时刻，级别恒 info） |

**读取窗口**（`GET /api/logs/current` 的尾部窗口）：追加写文件积累数月后可能是
几十 MB，首帧只回尾部一段。窗口 1MB（约 7000~12000 行）且**按行对齐**——起点被
截断时跳过第一个半行。窗口太窄会让面板「越读越旧、时间线从中间开始」，这条踩过
一次（ISSUE #262），回归用例见 `src/app/api/logs/current/route.test.ts`。
合并后的时间线口径（按时刻排序、跨来源去重）见规范 07 §7.17。

> 服务页「创作后端 → 启动日志」「数据库工具 → 启动日志」跟随的是
> comfyui-runtime / drizzle-studio-runtime，**不在**该机制覆盖范围内：它们是
> 单个服务的会话视图，靠会话横幅（`▶`/`■`）区分边界，由用户主动点「刷新」。

排障顺序：`log/launcher/start-tauri-launcher.log`（双击层发生了什么）→
`log/launcher/dev-launcher-stderr.log`（pwsh/壳层报错）→
`log/launcher/dev-launcher.log`（编排步骤走到哪）
→ `log/nextjs/nextjs-stderr-<ts>.log`（dev server 报错）。失败弹窗已包含后两者的尾部。

### 4.2 ComfyUI 原始回执通道（trace）与「未找到生成结果」的定位路径

生成失败时用户此前只能看到一句收口结论（典型是「✗ 生成失败：未找到生成结果」），
而**ComfyUI 到底回了什么**没有任何落盘：comfy-cli 的 stdout/stderr 只在面板显示
前 20/60 行且会过滤 Python 警告、`/history` 与 `/queue` 的原始 JSON 只存在于内存、
WS 帧解析不了就静默 return。没有现场就无法区分下面四种完全不同的成因：

| 现场                                 | 可能成因                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------ |
| ComfyUI 全程没回 `prompt_id`         | 工作流在 comfy-cli 的 UI→API 转换阶段就失败 / CLI 的 `queued` 事件没走到 |
| `/history/{prompt_id}` 是空的 `{}`   | ComfyUI 重启过、prompt 被丢弃，或 12 轮（约 3s）轮询窗口不够             |
| `/history` 有条目但 `outputs` 为空   | 工作流跑完但输出节点没产出（`SaveImage` 未执行 / 被 bypass）             |
| `/history` 有 outputs 但收集不到产物 | 输出结构是未知键（未被 `collectOutputs` 识别）                           |

`src/lib/comfyui/trace.ts` 提供 `trace(channel, taskId, message, meta?)`，把上述
原始回执按行追加写 `log/comfyui/comfyui-trace.log`（路径常量在 `log-paths.ts`，
禁止手拼）。接入点（全部是**追加**观测，不改判定逻辑）：

- `executor-cli.ts`：启动命令行与参数、stdout 原始 chunk 与每个解析后事件、
  非 JSON 行、`error` 事件、stderr 原始 chunk、未收到 envelope 退出时的完整
  errBuf + 未消费 stdout、进程启动失败；
- `executor-ws.ts`：每一条有归属任务的 WS 帧原文、无归属任务的帧、
  非法 JSON 帧、WS 报错信号；`fetchHistoryEntry` 在**命中 / 条目为空 / 12 轮
  全失败**三种终局都落原文，并在失败时额外探测 `/queue`；
- `executor-finalize.ts`：收口结论（含 promptId 与成因描述）、`execution_error`
  的完整 `status.messages`、以及「有 outputs 但没识别出产物」的 outputs 原文。

面板侧（规范 07 §7.14：大块/周期性输出先聚合再上屏）只给摘要，例如：

```
✓ history 就绪（2 节点输出）
ComfyUI history 摘要：status=success completed=true 输出节点=2
输出节点明细：
  · 节点 9 → images
  · 节点 12 → text
```

排查顺序（「未找到生成结果」）：`log/comfyui/comfyui-trace.log` 里按 taskId 过滤
→ 先看有没有 `cli [...] stdout 事件 {"type":"queued"...}`（没有 = CLI 阶段就失败）
→ 再看 `history [...] history 拉取失败` 的 `lastRaw` / `lastError`（有没有条目、
ComfyUI 是否可达）→ 最后看同一行的 `/queue 快照`（`running`/`pending` 里还有没有
这个 prompt：有 = 其实还在跑，12 轮窗口太短；没有 = ComfyUI 侧已无此任务）。

判据：**新增一条「会失败但没人看得见原始回执」的路径时，必须在 trace 里补一行**，
否则又回到「结论清晰、现场为零」。

**端口不靠「逐个试」反推，靠进程事实（ISSUE #449）**：`resolveComfyBase()` 的
解析顺序是「先问进程、再谈探测」——

1. 配了 `comfyuiPath` → 按路径查实例进程（`instance-port.ts`：`main.py` →
   解释器候选 → setup 登记的启动器 → 环境反查），**一次进程表查询 + 一次端口
   查询**同时得到「在不在跑」与「在哪个端口」，命中即直连。`resolveComfyBase`
   只负责把结论翻成地址，「实例在不在」归 `status.ts` 的进程级快照；
   `instance-port.ts` 与它同判据口径、但不做「任意解释器进程」那一级兜底
   （连错实例比连不上更糟）。
2. 拿不到进程事实（没配路径 / 查询失败 / 没命中）→ 才退回端口探测：配置端口 →
   就近偏移（ComfyUI 端口被占时会自增）→ 窗口端口，取第一个应答的。

**判据：任何「实例在哪个端口」的问题都必须先问进程，再考虑探测**——探测只能覆盖
「配置地址 + 就近偏移 + 窗口地址」这一批，实例落在别处就会整轮空扫，日志里只剩一
句「连不上」。回归测试见 `src/lib/comfyui/instance-port.test.ts` 与
`src/lib/comfyui/client.test.ts`「先问进程事实」一组。

**端口探测落空的汇总行（不走 trace 通道）**：探测路径在「配置地址 + 就近偏移 +
窗口端口」全都没人应答时写一条 **warn**（进应用日志面板），文案里逐个列出问过的
地址，并按地址清单静默 60s 只保留第一条——这条链路回答的只是「这一批地址里哪个
能连」，**不是**「ComfyUI 没在运行」（运行判据见 `comfyui/status.ts` 的进程级
快照）。排查时先看状态行结论，再用这条汇总行判断「是不是实例落在别的端口」，
两者不要互相当证据（ISSUE #449）。

### 4.3 「陈旧实例」：运行图落后于源码时的可观测性（ISSUE #389）

**这一类故障不属于「谁写错了」，而是「运行中的模块图停在改动之前」。**
桌面壳 / dev server 长开时，`src/` 的前端源码由 HMR 自动生效——但**已经挂载的
组件不会因此重建**。store 实例在挂载时创建一次，它身上的「动作集合」是那一刻
从模块取到的函数；而动作本身是模块成员，会随热更新整体替换。于是出现稳定窗口：

```
拉了新提交（或改了 store 源码）+ 窗口一直开着、页面没重载
  → 旧实例的动作集合里没有新声明的动作
  → 直接调用抛 `xxx is not a function`
  → 被 <WorkflowCanvasEditor> 的 ErrorBoundary 接住 → 编辑器整块降级成错误页（白屏）
```

历史形态：ISSUE #389 报的 `ioApi.getState().purgeMachineNames is not a function`
（`purgeMachineNames` 是后加进 store 的动作，报错窗口里运行图正好停在它之前）。

**三层处理，缺一层都不算修完：**

| 层                           | 做什么                                                                                                                | 实现                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 不让它白屏                   | 动作不在当前实例上时**跳过本次调用**并按 L1 功能降级（规范 10 §10.1），只打一条可诊断告警                             | `WorkflowStores.callStoreAction`                                                                    |
| 判定「页面是否还跑着旧代码」 | 构建标识 = 进程启动标识 + 被观测源码模块的 mtime 指纹；加载时与当前不一致、或加载后发生变化，都算「跑过一段代码更新」 | `GET /api/dev/build-id`、`src/lib/code-update-since-load.ts`                                        |
| 告诉用户怎么办               | 真的观测到陈旧实例时，应用内通知把「重载一次即恢复」讲清楚（toast + 消息中心留底）                                    | `src/lib/stale-store-instance.ts`、`src/lib/stale-store-notify.ts`、`src/components/code-update/**` |

**为什么判据用 mtime + 进程标识，而不是 Git 提交号**：本项目最常见的用法是
「桌面壳长开、边改边看」，改动往往**还没提交**——提交号根本不会变，等于没有
信号。也正因为如此，这件事**不能**塞进 `/api/update-check`：那条通道回答的是
「哪些改动需要重启才生效」，并明确把 `src/` 排除在外（HMR 会处理）；而这里要
回答的是「HMR 生效了，但已挂载的旧实例没跟上」。两件事、两套判据。

**判据的两条组成部分**（都由 `/api/dev/build-id` 给出，缺一不可）：

- **进程启动标识**（`src/lib/dev-server-id.ts` 的 bootId）：变了 = 应用服务重启
  过，页面手里的还是旧进程送来的代码；
- **被观测源码模块的 mtime 指纹**：变了 = 本机源码改过，页面还没重载到改动后
  的模块。新增「会被旧实例调用到的模块」时，把它加进 `WATCHED_MODULES`。

**「通知」这条线为什么必须与降级同时存在**：只降级不告知，用户看到的是某个
增强动作**悄无声息地失效**——比白屏更难排查。而「为什么跳过、该怎么办」在运行时
是可知的（正是「跑过一段代码更新」这个事实），所以它不该等用户来问。

**跨层送达的约定**（唯一一处，别照抄）：触发点在**最底层的 store 调用处**
（`callStoreAction`），提示要出在**应用级通道**上（toast + 消息中心）。两者之间
不能直接连线（底层模块不得反向依赖 React 组件目录），因此用模块级注册 + 订阅在
`src/lib/stale-store-notify.ts` 收口；去重（同一次会话只提示一次）也在那一层，
而不是指望每个调用点自己记得「只报一次」。若将来出现第二种同类事件，应改为
zustand 队列，而不是再加一个模块级单例。

**新增 store 动作时的两条硬约定：**

1. 新动作**必须**经 `callStoreAction` 调用（或在调用点自行判存在性）——
   直接 `getState().newAction(...)` 就是把白屏重新放回去；
2. 「陈旧实例」的下游表现（跳过调用）要有可见出口，别让它静默——降级路径
   同样是失败路径，规范 07 §7.12 与规范 10 §10.3.1 的「失败必须有出口」
   对它一样成立。

回归测试：`src/lib/stale-store-instance.test.ts`（判据与文案）、
`src/lib/code-update-since-load.test.ts`（构建标识的边界）、
`src/lib/stale-store-notify.test.ts`（送达与去重）、
`src/app/api/dev/build-id/route.test.ts`（构建标识稳定性与敏感度）、
`src/components/code-update/**`（观测器接线 + 用户可见结果）、
`src/components/studio/workflow-editor/WorkflowStores.test.ts`（降级 → 通知的接线）。

## 5. 排障手册（症状 → 已知根因）

| 症状                                                                                                                                                                                                                                                                                                                | 根因（历史案例）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 对策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **「配置了 ComfyUI 端口却像没配」**：设置里 `comfyuiPort` 留空 / 填了一个值，应用却连到了**另一个** ComfyUI 实例上——现象是上传素材失败、任务「未找到生成结果」、端口在日志里漂移，而地址栏/探测看起来一切正常（ISSUE #534 P1）                                                                                      | **同一个事实（默认端口）有多份实现**：连接侧 `resolveComfyBase()` 把 `comfyuiPort: 0` 判为「未配置」并用**硬编码**的 8188 作为探测起点；拉起侧 `resolveEffectiveLaunch()` → `buildSpawnArgs()` 同样把 `0` 当「未配置」，**不传 `--port`**，于是 ComfyUI 以它自己的默认端口启动；`lib/core/config.ts` 的 schema 默认值与错误文案里又各写了一遍 8188。四处都写 8188 看着一致，但**没有任何断言把它们绑在一起** —— 单独改一处不会有测试变红。「连错实例」比「连不上」难查得多：8188 上往往真有个别的实例在应答（Comfy Desktop 常驻），`client.ts` 的兜底探测链最后一项正是窗口地址 :8000                                                                                                                                                                                   | 已修（门禁 + 收口）：① 默认端口单点定义在 `src/lib/app-settings.ts` 的 `COMFYUI_DEFAULT_PORT`，连接侧与拉起侧一律 import；② `lib/core/config.ts` 的 ComfyUI 兜底地址改由 `endpoints.ts` 的 `comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)` 拼出，不再写裸地址；③ 设置页 placeholder / 说明文案与错误建议里的端口改为运行时取值（不再各写一遍数字）；④ 新增可失败断言 `scripts/check-comfyui-port-contract.cjs`（pre-commit 与 CI）+ `tests/comfyui-port-contract.test.ts`、`tests/check-comfyui-port-contract.test.ts`。口径见 §9.2 第 5 条                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Linux / macOS 上 `cargo build --release --features custom-protocol` 报 `error[E0425]: cannot find type IMarshal in module windows_core::imp`（×12）**                                                                                                                                                             | `Cargo.toml` 的 `windows` crate 是**无条件依赖**，`mod single_instance` 也没 `#[cfg(windows)]` 门控 —— 非 Windows 上整棵 windows 树都会参与编译，而 `windows-future` 子 crate 在那边没有该 COM 接口实现。跨平台构建立刻死在编译期，看不出与「壳的单实例保护」有关（ISSUE #489）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 已修：`windows` 挪进 `[target.'cfg(windows)'.dependencies]`；`single_instance.rs` 拆 `#[cfg(windows)]` / `#[cfg(not(windows))]` 双实现（POSIX 用检出内锁文件 + `kill(pid,0)` 存活探测 + `SIGUSR1` 唤起），模块声明不做 cfg、调用点因此不分叉。见 §9.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`cargo build` 报 ``resource path `binaries/node-x86_64-unknown-linux-gnu` doesn't exist``**                                                                                                                                                                                                                       | `bundle.externalBin` 声明的是「无后缀 basename」，打包器按目标三元组找 `node-<triple>[.exe]`，而 `build-desktop.mjs` 只产出 `.exe`（历史实现按 Windows 单一平台写的）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 已修：`scripts/build-desktop.mjs` 的 `sidecarFileName()` 与 Rust 侧 `sidecar_binary_name()` 同一平台判据（非 Windows 无后缀 + 补可执行位）。见 §9.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **启动页一直转圈、`log/shell/` 为空**                                                                                                                                                                                                                                                                               | `resolve_project_root()` 的判据绑在 Windows 专属文件（历史上的 `scripts/dev-launcher.ps1`）上 → POSIX 上恒返回空串。表现完全不像「路径判据错了」，像「启动页坏了」或「日志没写」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 已修：改判 `package.json` + **编排器的唯一实现** `scripts/dev-launcher.mjs`（`looks_like_project_root`）。见 §9.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **POSIX 上编排器退出后 `pnpm` / `next-server` 仍在跑、端口不释放**                                                                                                                                                                                                                                                  | 回收是 `taskkill /T /F`（POSIX 上等于不执行）；或虽有 POSIX 分支但 `spawn` 未 `detached`，子进程与编排器**同组** → 命中 §3.1 的防自杀判据，退化成单杀 leader，其下三层（`pnpm` / `next` / `turbopack worker`）全部残留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 已修：`scripts/dev-launcher.mjs` 用 `spawnInGroup`（`detached: true` 自建进程组）+ 整组回收；编排器被 SIGKILL 时留下的孤儿由 `run/launcher-session.json` + 心跳在下次启动回收。见 §3.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **双击 `tools\start\run-local.ps1` 初始化时 `pnpm install` 必失败**：`Packages: +1` 之后紧跟 `postinstall: 'sh' is not recognized as an internal or external command` 与 `'true' is not recognized…`，最后 `Error: ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`；提示却是「请检查网络后重新双击本脚本」（ISSUE #636） | **`postinstall` 写了一句只有 POSIX 能跑的 shell**：`sh scripts/install-git-hooks.sh \|\| true` 在 Windows 上由 **cmd.exe 语义**执行（npm / pnpm 的脚本都不是 POSIX shell），`sh` 与 `\|\| true` 两处都报「不是内部或外部命令」，postinstall 非零退出 → pnpm 以 `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED` 收尾。CI 在 Linux 上跑（那里有 `sh`），所以这条**在流水线上永远不红**；而唯一会撞上它的正是面向非开发人员的一键入口。脚本里那句「任何一步失败都不阻断安装」也救不了自己 —— `\|\| true` 就是最先失败的那一步                                                                                                                                                                                                                                                  | 已修：接钩子的实现换成 `scripts/install-git-hooks.mjs`（纯 Node，两端同一入口；不在 git 检出 / 设置失败都只提示并 `exit 0`），`postinstall` 逐字改成 `node scripts/install-git-hooks.mjs`。判据机器化在 `launcher-core/node-runner.mjs::checkPostinstall()`（postinstall 必须逐字指向该入口，且不得出现 `sh x` / `bash` / `\|\|` / `&&` / `source` / `npm`），契约测试 `tests/postinstall-cross-platform.test.ts`（含真跑入口的宿主模拟）。见 §9.5 对照表                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **双击 exe：启动即报「pnpm 工具链不可用（exit=?）：未知错误」，`dev-launcher-stderr` 空、stdout 里也没有 pnpm 自己的报错**（ISSUE #576，用户现场 `F:\AI\Other\Comfy-APP-T3`）                                                                                                                                       | **PATH 上选中了一个「存在但跑不起来」的 pnpm 形态**：corepack 的 shim 在 Windows 上看起来是三个文件（无扩展名的 `pnpm`、`pnpm.cmd`、`pnpm.ps1`），其中**只有 `.ps1`（经 PowerShell 宿主）与「已关联 node 的无扩展名 shim」能跑**，`.cmd` 只有 cmd.exe；而 `whichCommand` 只按 `PATH × PATHEXT` 找**存在的文件**、PATHEXT 又把 `.CMD` 排在最前 → 选中必然 EACCES 的那个。三个观测点彼此吻合却被误读：① `spawnSync` 起不来 ⇒ `probe.error.code = EACCES`、`probe.status = null`、**stdout+stderr 都是空串** ⇒ `detail` 落到 `未知错误`；② `exit=?` 与「stderr 空」看着像「corepack 缓存损坏」（那条真故障会在 stderr 打印 `Failed to switch pnpm to ...`），于是提示把人引向「删缓存 / 重装 Node」；③ 修复文案里的版本号是 `<项目版本>` 占位符，没人会去翻 `package.json` | 已修（§2.1.1 / §2.1.2 / §2.1.3）：① `whichCommand` 改为**选第一个真的能跑的候选**（`executableExts()` 定顺序：无扩展名 / `.EXE` → `.PS1` → `.CMD`/`.BAT` 垫底；`usableCommand()` 用 `accessSync(X_OK)` + 对 shebang 形态**真起一次**确认，起不来则回退同目录 `<name>.ps1`）；② 探测结果结构化（`not-found` / `spawn-error` / `exit-nonzero` / `no-version`），把 `error.code` 与输出头几行一起带出来，**不再把「疑似缓存损坏」写成结论**；③ 提示中的版本号取自 `package.json` 的 `packageManager`，多行提示经 `stale_shell` 横幅进启动页（`white-space: pre-wrap`）；④ `spawn-error` 一类**自动 `corepack prepare` 重建并用同一条探测复核**，复核仍失败才落回提示；⑤ `spawnDevServer()` 复用同一个命令形态（`commandInvocation`），避免「探测过了、起服务又失败一次」。自查入口 `pnpm check:toolchain`。回归测试 `tests/dev-launcher-toolchain-gate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`pnpm check:toolchain` 只报 `[WARN] 版本与 package.json 要求不一致（本机 10.34.5，要求 12.4.1）` 就结束，而真启动时启动器自己会对齐**（ISSUE #576 第三轮，同一用户同一现场）                                                                                                                                      | **自检与启动器两套口径**：版本对齐动作只写在启动器（`reconcilePnpmVersion()` → `preparePnpm()` + 复核）与 `prepare-local-run.ps1` 第 3 步里，自查入口当时只打印一行 WARN、什么也不做，还以 0 退出 —— 用户于是以为「只能手动跑 corepack」，或者以为已经可以启动了（其实下一关还有 node_modules 门禁）                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 已修（§2.1.4）：自查入口**复用同一条对齐动作**（`preparePnpm()` + 同一条探测复核），复核通过报 `[OK] 已对齐（旧版本 → 新版本）`，仍不一致才 WARN + 手动命令；并补上 `node_modules` 检查（点出下一道门禁与 `pnpm install`）。判定「一致」的判据与启动器共用 `sameVersion` 语义。回归 3 例见 `tests/dev-launcher-toolchain-gate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **同一窗口里 `pnpm --version` 是 12.4.1，`pnpm check:toolchain` 却报「pnpm 可用：10.34.5（…\pwsh.EXE）」，像是检测到了别的机器的版本**（ISSUE #576 第四轮，同一用户同一现场）                                                                                                                                       | **探测身份没打印出来，两句话各自为真却看着矛盾**：① 终端敲的 `pnpm` 由 shell 的 PATHEXT 解析（走 `.cmd` 交 cmd.exe），而 Node 侧 `whichCommand()` 只看「真的起得来」的形态，`.ps1` 经宿主执行 ⇒ 命令名变成 `pwsh.EXE`；② PATH 上并存多个 pnpm（独立安装 / 另一份 corepack 副本 / 另一个检出）时，被选中的那个就是另一个版本 —— 旧文案只给「版本号 + 命令名」，用户无从知道它指的是哪个文件，于是「本机版本为什么是 10.34.5」无解                                                                                                                                                                                                                                                                                                                                        | 已修（§2.1.5）：自检另打印**探测身份** —— `[INFO] 选中的 pnpm：<文件>`（PATH 上真正命中的那个）与经宿主时的 `[INFO] 经宿主执行：<宿主> … → <文件>`；版本漂移提示改为把方向指向「选中的 pnpm」（PATH 顺序问题），不再让人去翻项目文件。判据仍只在 `shell.mjs::commandInvocation()` 一处。回归 2 例见 `tests/dev-launcher-toolchain-gate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **`pnpm check:toolchain` 报「命令起不来（可执行形态/权限不对） —— EINVAL（未发现可回退形态）」，命令是 `...\.tools\pnpm\<ver>\bin\pnpm.CMD`**（ISSUE #576 第二轮，同一用户同一现场）                                                                                                                                | **选中了批处理，而 Node 起不了批处理**：corepack 装到 `.tools\pnpm\<ver>\bin` 的 pnpm 是 `.CMD` + `.ps1` 并排（旁边并没有可用的无扩展名 shim）。此时两个缺陷叠加：① `executableKind()` 把 `.cmd` / `.bat` 与 `.ps1` **同判为通用 `script`**，`usableCommand()` 又对「非 shebang」直接 `ok: true`（没真起一次）—— 于是 `.CMD` 一路通过候选确认被选中；② 真跑起来是 `EINVAL`（批处理既不是 PE 镜像、也没有 Node 认的 shebang），而 `shebangFallback()` **只服务 shebang**，`.CMD` 走到这里没有回退，提示于是说「未发现可回退形态」—— 而 `pnpm.ps1` 就摆在同一个目录里。表现是探测失败、命令完全不可用                                                                                                                                                                     | 已修（§2.1.1）：① `executableKind()` 把**批处理单列一类 `batch`**（`@echo` / `@setlocal` 起头判形态，不看扩展名），不再与 `.ps1` 混；② `usableCommand()` 对 **Windows 上的 `batch` 直接走回退、不真起**（真起必 `EINVAL`，白搭一次进程创建），`shebangFallback()` 改名 `siblingFallback()` 并为**所有**「Node 起不来」的形态服务；③ 回退同胞名按**「去掉自身扩展名再拼 `.ps1`」**求（`pnpm.CMD` → `pnpm.ps1`，不是 `pnpm.CMD.ps1`）；④ `commandInvocation()` / `usableCommand()` / `probeCommand()` / `preparePnpm()` 统一接受可注入的 `{ env, platform }`，让「模拟另一平台」的被测路径与真实路径同一条。shebang **不按形态一刀切**（机器上真配好文件关联时仍可用），POSIX 不受批处理短路影响。回归 5 例见 `tests/dev-launcher-toolchain-gate.test.ts`（还原修复后 4 例立即失败）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 双击 exe：启动即报「pnpm 工具链不可用 / 无法获取 pnpm 版本」并弹窗                                                                                                                                                                                                                                                  | corepack 管理的 pnpm 在切换版本时本地缓存损坏：`.tools\pnpm\<ver>\bin` 缺失 → `pnpm -v` 报 `Failed to switch pnpm to pnpm@<ver> ... ENOENT`，命令完全不可用（install/dev 全依赖 pnpm）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 已由 `Test-ToolchainGate`（弹壳前）拦截并弹 MessageBox 给修复步骤：`corepack enable && corepack prepare pnpm@<版本> --activate`（重建缓存，需联网一次），仍不行则删除损坏缓存后重装 Node/pnpm                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 启动后 splash 停在依赖预检报「关键依赖目录 typescript / @typescript/native / next 为空或缺失」                                                                                                                                                                                                                      | pnpm 中断安装/拒装留下「目录在但内容空」的残缺（如 typescript 与 @typescript/native 空目录 → tsc 垫片找不到入口），旧版只查 `.modules.yaml` / `.bin/next` 查不出                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 已由 `Test-DevDependencies` 覆盖关键目录非空检测，残缺时自动 `pnpm install` 自愈；install 后仍残缺则明确报错并指向 `log/launcher/pnpm-install-stderr.log`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm install` 已成功（exit 0）但仍报「node_modules/…为空或缺失」启动失败；同机跑 `sync-lint.ps1`/`run-local.ps1` 却正常                                                                                                                                                                                            | 假阳性：`Get-BrokenKeyDeps` 用 `Get-ChildItem -LiteralPath` 枚举顶层 junction/symlink 判空，pwsh（7.6.5 实测）对这类 reparse point 的枚举可能返回 0 项 → 健康安装被误判残缺，触发 install 后因 `.modules.yaml`/lockfile 已一致而“Already up to date”无法自愈，二次复查仍误报                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 已修：先 `Resolve-Path` 解析到链接目标真实绝对路径，再用 .NET `Directory.EnumerateFileSystemEntries` 对真实目录判非空（见 §2.2 step 5）。同步/自检脚本（sync-lint/run-local）本就只查 `.modules.yaml`+`.bin`+lockfile，故不受影响                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| junction 枚举已修（见上）后仍报「node_modules/ 仍为空或缺失」且 `pnpm install` 显示 “Already up to date”；报错串中目录名后为空                                                                                                                                                                                      | 第二处假阳性：`Get-BrokenKeyDeps` 结尾 `return ,$broken`（unary comma 防外层展开）。当依赖健康、`$broken` 为空数组 `@()` 时，`,@()` 向外输出「一个空数组」单对象，调用方 `@(Get-BrokenKeyDeps)` 收集成 `@(@())`——`.Count` 恒为 1 而非 0 → 健康环境永远被判有坏依赖，install 因依赖本就完好返回 exit 0 无法自愈，二次复查 `foreach ($d in …)` 取出空数组元素（`"$d"` 为空）再误报抛错                                                                                                                                                                                                                                                                                                                                                                                    | 已修：函数改 `return $broken`——空数组不产生输出，`@(...)` 得 0 项；非空正常展开，`foreach`/`.Count` 语义正确（见 §2.2 step 5）。勿再加 unary comma                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 双击 exe 完全无窗口、无报错                                                                                                                                                                                                                                                                                         | ① dev-launcher 静默失败（旧版无弹窗）② 日志文件被残留进程锁死                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 已修复：失败弹窗 + 日志按次命名。若复现，看 `start-tauri-launcher.log` 末行 exit code 与 `dev-launcher-stderr.log`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 窗口黑屏，左上角 `asset not found: splash.html`                                                                                                                                                                                                                                                                | splash 窗口 URL 用了 macOS/Linux 形式的 `tauri://localhost`，Windows 资源源是 `http(s)://tauri.localhost`；或改了 splash-assets 但没重编壳                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | tauri.conf.json 用相对路径 `splash.html`；重编壳                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **启动页的最小化 / 关闭点了没反应**（#412 二次回报；按钮画在右上角、能悬停高亮，就是点下去什么都不发生）                                                                                                                                                                                                            | 按钮「画出来」与「调得动窗口」是两件事：①`decorations: false` 之后窗口唯一的出口就是这两个按钮，而它们此前只挂在**一条** `addEventListener` 上——脚本没跑到绑定、监听被顶掉，点击就没人接；②兜底要靠新壳命令，而改了 `src-tauri/**` / `public/splash.html` 不重编壳时跑的是旧壳（新命令不存在），症状同样是「点了没反应」；③`--splash` 那张启动器自绘画面用的是 `ShowWindow(SW_MINIMIZE)`——`WS_EX_TOPMOST` 的无主弹窗**不会被它最小化**（系统去找可最小化的父窗口组，找不到就什么都不做）                                                                                                                                                                                                                                                                           | 已修：启动页的窗口按钮改为「三条互补路径 + 失败可见」（事件监听 / 按钮内联 `onclick` → `window.__splashWinAction` / 应用自建命令 `win_minimize`·`win_close`，三条都失败时消息区写「当前壳缺少窗口命令，请更新」）；新命令按规范三处同步（`build.rs` AppManifest / `capabilities/splash.json`），壳侧直接操作 splash 窗口、不额外授权 `core:window` 命令面；启动器自绘画面的最小化改为「隐藏 + 撤置顶 + 交还前台」并由 40ms 定时器维持，尺寸同步到 744×216（与启动页一致）；另启动器启动前比一次壳文件时间戳，过期时在画面/日志里钉一条「请重编壳」。判据见 `tests/check-file-structure.test.ts`，规范 07 §7.18.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **启动页窗口一大块没用的空白**，只有中间一张小卡片有内容；右上角只有一个 ✕、没有最小化（ISSUE #412）                                                                                                                                                                                                                | **窗口尺寸与内容尺寸脱钩**：splash 窗口按「窗口越大、日志一行越能放全」给了 1680×1000 并带原生标题栏，而内容卡片只有 720（收起日志）/1400（展开）宽——2K/4K 屏上于是大半块是空白，观感像「弹了个空窗口」。同时原生标题栏只为三个系统按钮多占一条，且窗口本身没有「跟内容一起长」的能力                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 已改为**窗口即内容 + 无边框**：①`decorations: false`（无原生标题栏），最小化/关闭由启动页右上角自绘（`-webkit-app-region: drag` 铺满标题行、按钮 `no-drag` 排除，否则点击被拖拽吞掉）；②开窗 = 紧凑档 `SPLASH_WINDOW_SIZE`（744×216，`tauri.conf.json` 同值，高度贴着收起日志时的内容），展开日志时页面调应用命令 `set_splash_compact(false)` 由壳调到 `SPLASH_WINDOW_SIZE_EXPANDED`（1424×788）并居中——**两档常量只在壳里一份**，页面不自己拼尺寸；③两档都过 `clamp_to_monitor` 收敛（小屏不越界）；④面板不再写死 320px 高度，改 `flex: 1` 吃掉窗口剩余高度，展开后既不是窄缝、下方也不留空白。新增命令已三处同步（`build.rs` AppManifest / `capabilities/splash.json`），改动 splash-assets 与 tauri.conf.json 后**必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **双击启动弹红色「启动失败：Next.js dev server 提前退出（exit=0）」，但两个 nextjs 日志都只有一行、完全看不出原因**（stderr 里那句 `$ node scripts/dev.mjs "-p" … "-H" …` 只是 pnpm 回显的启动命令行，不是报错）                                                                                                    | **把设计内的收尾路径报成了失败**：Prebuilt 链路的生命周期是「壳在，dev server 才在」——壳一退出，dev-launcher 就 `taskkill /PID <dev> /T /F` 回收整棵树（见 §3.2），而 `/F` 走的 TerminateProcess 不给进程收尾机会，dev server 于是表现成「exit=0 且几乎无输出」（启动 17s，连 `Ready in xxs` 都没来得及 flush）。触发这条路径的常见成因是**用户关掉启动页 = 放弃本次启动**（壳按约定 `exit(0)`，见 §1 链路图的 splash 分支），也可能是壳被另一次启动顶掉 / 任务管理器结束 / 壳崩溃——三种成因的退出码一样，旧文案只写 exit=0，用户只能照「dev server 编译失败」的方向查，而现场根本不在 dev server 侧                                                                                                                                                                    | 已修：dev-launcher 判定 dev server 退出时带上壳侧证据再定性——壳 stderr 含 `launch abandoned` 标记（`Test-ShellLaunchAbandoned`）+ 壳是否已退出 → `Get-DownstreamExitKind` 给出三种分支：① 用户放弃 → 写 info、按**正常退出码**收尾，不再弹失败框（与 python 启动器的 `cancelled` 语义一致）；② 壳被外部终止 → 提示明确指向 `log/shell/shell.log` 与 `log/launcher/dev-launcher-stderr.log`，不再让人去查 dev server 编译错；③ 壳仍在 → 保持原有「dev server 自身退出」提示与 stderr/stdout 现场（编译失败 / 端口占用 / pnpm 异常）。回归测试 `tests/dev-launcher-downstream-exit.test.ts` ；**后续（同 ISSUE）**：① 壳侧补「异常退出码」出口——`RunEvent::ExitRequested` 收到非 0 码时写 `exiting with non-zero code <N>`（`log/shell/shell.log` 与 launcher 重定向的 stderr 都有），单实例早退（`another instance of this checkout is running`）补一句「本次没有开窗口」；dev-launcher 据此新增第四分支 `shell-self-exited`（壳主动以异常码结束，文案不带结论但点明「若日志里还有 another instance… 说明这次双击只是把已在运行的窗口唤到前台」）；② `comfyui/status.ts` 在进程表判据链**之前**先探配置端口：有人应答即判「在跑」（`source=port`、`didQueryProcTable=true`）并跳过三次 `Win32_Process` 枚举，没人应答才照跑完整条链（端口偏移的实例不受影响），把设置页「打开就等十几秒」里最不该付的那一段去掉。回归测试见 `tests/dev-launcher-downstream-exit.test.ts` 与 `src/lib/comfyui/status.test.ts` |
| **只报「依赖与 lockfile 不一致」，却看不出哪里不一致**（ISSUE #550）                                                                                                                                                                                                                                                | 漂移判定只用 SHA256 比对两份 lockfile，答案只有布尔值：「拉取更新后未重装」成了唯一解释，用户既不知道是新增依赖、版本变更还是配置项变动，也没法判断该不该删 `node_modules` 重来                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 已修：差异定位收口在 `scripts/lockfile/lock-diff.mjs`（解析 + 比对，纯函数可单测），`diff-cli.mjs` 负责输出；`prepare-local-run.ps1`（双击入口）与 `quality-gate.ps1`（依赖预检）都调用它逐项打印差异，见 §2.2 第 6 条。回归测试 `tests/lockfile-diff.test.ts`（含「拿真仓库 lockfile 比对」的真实形态用例）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| dev server「提前退出 exit=1」且无输出                                                                                                                                                                                                                                                                               | cmd 重定向目标文件被残留进程锁定，打开即失败                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 已修复：nextjs 日志按次命名。残留进程见 §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm install` 被拒：`minimumReleaseAge` / `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`                                                                                                                                                                                                                                 | pnpm 默认拒绝发布不足 24h 的包                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 已在 pnpm-workspace.yaml 关闭；新包确认可信后可按需放开                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `pnpm install` exit 1：`ERR_PNPM_IGNORED_BUILDS`                                                                                                                                                                                                                                                                    | pnpm 默认不批准第三方 postinstall                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 已在 pnpm-workspace.yaml `allowBuilds` 批准 6 个包；新增含构建脚本的依赖需补充                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 任何 pnpm 命令连锁失败：better-sqlite3 `EPERM rename ...node`                                                                                                                                                                                                                                                       | dev server 运行中锁着原生模块 + pnpm 隐式依赖检查触发 install                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 已关闭 `verifyDepsBeforeRun`；关 dev server 再装依赖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `next dev` 报 `Invalid project directory ... \-p`                                                                                                                                                                                                                                                                   | pnpm 11 起不再剥离 `--`，字面量传给了 next                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 已修复：`pnpm dev -p 3100 -H 127.0.0.1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 所有请求挂死、`tsc` 报 typescript 缺失                                                                                                                                                                                                                                                                              | Next 16.3.2 默认 `useTypeScriptCli: true`，与 typescript6 别名不兼容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 已在 next.config.js 关闭；换回标准 typescript 包后可移除该配置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 提交时钩子报 `Class extends value undefined`                                                                                                                                                                                                                                                                        | npm 11.19 在本机解析 .bin 别名链崩溃                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 钩子已改 `pnpm exec`；勿把钩子改回 npx                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 构建 release 壳在编译收尾报 `error: failed to remove file ...\target\release\app.exe` / `Caused by: 拒绝访问。 (os error 5)`                                                                                                                                                                              | 上一次启动的桌面壳（app.exe）还开着：cargo 覆盖产物前会先删除旧 exe，Windows 不允许替换运行中进程的可执行文件。等待整个 Rust 编译（可能十几分钟）走完才失败，报错本身也看不出「壳还在跑」（2026-09-06 定位）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 不要用任务管理器单杀壳（其 Next dev server 子进程会残留占端口，见 §3）：正常关闭桌面窗口即可（壳退出时会自行 `taskkill /T` 回收 sidecar 进程树），无响应时用 `taskkill /IM app.exe /T /F`。已由 `tools/scripts/Build-Guard.ps1` 把这类占用提到编译**之前**拦截，并在失败时追加提示（见 §7）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **一键发布构建被「目标文件被占用」挡下**：双击 `tools\build\build-all.ps1`，一上来就在 `[2/4] 前置检查：目标壳是否仍在运行` 报「构建 release 壳 目标文件被占用，无法覆盖：src-tauri\target\release\`app.exe`」，构建连编译都没开始（ISSUE #412）                                                          | **前置守卫把「陈旧壳」也当成了「用户正在用应用」**：用户的实际动作是「启动 exe → 关掉窗口 → 重新构建」，而关窗后壳常常已无人使用（启动器先退出、壳成无主孤儿进程，或只剩命令行残留），守卫却一律中止构建，要求用户「先去关桌面窗口」——用户照做也关不掉（窗口早就没了），卡成死循环。而且 `Assert-ShellNotRunning` 的 `-AutoCloseShell` 开关**从来没有调用方传过**，双击构建又没人能按任意键确认，等于自动回收这条路谁都没走                                                                                                                                                                                                                                                                                                                                             | 已修（`tools/scripts/Build-Guard.ps1`）：① 命中占用先分类，**陈旧壳**（`Get-RunningLauncher` 查不到本仓库启动器 = 起它的启动器已退出，或 exe 路径指不到本仓库）直接 `taskkill /PID <pid> /T /F` 回收后**继续构建**；② 双击 / 由启动器拉起的**非交互构建**（父进程是 `explorer.exe` 或 `start-tauri*.exe`）同样自动回收，不留「按任意键」死胡同；③ 只有「本仓库启动器仍在跑」才中止，日志额外点名「先结束启动器」——启动器会拉起新壳顶上 `app.exe`，届时杀掉现有壳既丢了用户窗口、编译途中还会再次被占用。见 §7.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 构建 release 壳在编译**开局**（依赖全部编完、轮到 `app v0.1.0` 的 build script 时）报 `failed to run custom build command for app v0.1.0` + `resource path binaries\node-x86_64-pc-windows-msvc.exe doesn't exist`（2026-09-13 定位）                                                                               | `tauri.conf.json` 声明 `bundle.externalBin = ["binaries/node"]`，tauri-build 在**每次 cargo build 的编译期**都校验 `src-tauri\binaries\node-<target-triple>.exe` 存在——即便 prebuilt 壳运行时用不到 sidecar 也绕不开。而 `binaries/` 被 `src-tauri/.gitignore` 忽略不入库，`build-tauri-release.ps1` 又刻意不跑 `build-desktop.mjs`（防 8GB static 污染，只增量同步 splash），于是全新克隆 / 清理过 `binaries/` 的机器必然开局即败；此前只有 `build-standalone.ps1`（经 build-desktop.mjs 第 3/4 步）这条路会顺带生成 sidecar                                                                                                                                                                                                                                           | 已修（`tools/scripts/build-tauri-release.ps1` 第 3/4 步）：编译前检测 sidecar 缺失即从当前 Node 运行时复制补齐（与 build-desktop.mjs 同源逻辑，仅缺失时复制；PATH 无 node 时给明确报错并退出）。手动救急：把 node.exe 复制为报错所指路径后重跑                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 桌面窗口已经关了，`app.exe` 进程还在（只能手工 `taskkill /IM app.exe /T /F`）                                                                                                                                                                                                                   | **启动器先于壳退出，壳成了无主进程**：壳由编排器拉起，正常路径以「壳退出」为锚点回收；但用户关掉启动器窗口 / python 监控线程结束时 dev-launcher 的 `WaitForExit` 与 taskkill 兜底都没机会跑。旧实现的「残留壳清理」还按 `CommandLine -like "*<项目根>*"` 筛选，而预编译壳经 `ProcessStartInfo(UseShellExecute=false)` 启动、命令行里不含项目根路径 → 既漏判残留，也让残留壳锁住 `target\release\app.exe`（连带 §5「os error 5」那条）                                                                                                                                                                                                                                                                                                                         | 已三层治理（2026-09-06 定位）：①启动前按 **exe 真实路径**回收残留壳；②壳拉起后 PID 落 `log/launcher/tauri-shell.pid`，python 启动器在监控退出/异常/超时时对仍存活的 PID 执行 `taskkill /PID <pid> /T /F` 后删除该文件；③正常关窗仍走编排器的进程树回收。见 §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 打包启动器时报「无法清理 start-tauri」                                                                                                                                                                                                                                                                              | 残留的提权进程（如卡死的 pyinstaller/启动器）持有 `_internal` 文件，普通权限无法终止                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 重启后重试；应急：`pyinstaller --distpath dist-new tools/start-tauri.spec` 打到新目录后手动换文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **一键发布构建第二步卡在 `[2/3] 清理旧产物`**：`[错误] 无法清理 start-tauri，可能被其他程序占用（如 start-tauri.exe 仍在运行）`；而用户**已经关掉了桌面窗口**（他看到「壳有更改」提醒后关的），照提示去关窗口也关不掉（ISSUE #621）                                                                          | **关掉的是桌面壳，占了产物目录的是启动器自己**：`start-tauri\` 是 onedir 打包产物，运行中的 start-tauri.exe 把 `_internal\*.dll` 映射在内存里，整个目录删不掉；而启动器是独立 exe，**关掉它的启动画面 / 桌面窗口并不会让它自己退出**。旧实现只把这个根因写进一句固定文案（「可能被其他程序占用」），**没有查任何进程表** —— 既指不出是谁占着，也给不出能照做的动作                                                                                                                                                                                                                                                                                                                                                                                               | 已修：新增 `Assert-LauncherNotRunning`（`tools/scripts/Build-Guard.ps1`），打包脚本在**清理旧产物之前**按 exe 真实路径自查本仓库启动器，命中即中止并点名 PID + 给 `taskkill /PID <pid> /T /F`；清理仍然失败时兜底提示补齐自查命令与「确认无同名进程 = 权限问题」的分流。**判据后来补了第二条**：占用者不止启动器 exe——启动器拉起的 dev server（`node`→`pnpm`→`next`）会把 `start-tauri\_internal\*.dll` 映射进自己的进程（实测 pnpm 侧的 `VCRUNTIME140.dll`），启动器异常退出后它们残留成孤儿，目录照样删不掉，而按 exe 名 / 路径判断一个都查不到（现场表现为「已经关掉启动器了，仍然无法清理」，提示还在猜同一个原因）。现在 `Get-ProductDirHolder` 按「被映射文件的路径落在产物目录内」把真正的占用者查出来，与启动器命中写在同一条消息里；清理失败走 `Write-ProductDirLockHint`，先给真实异常文案 + 占用者清单 + 逐条 `taskkill`，查不到人才是「杀毒 / 索引 / 权限」那条分流。见 §7.1.1，回归测试见 `tests/check-file-structure.test.ts` 的 Build-Guard 用例组                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 启动时先看到 Edge「无法访问此页面 / ERR_CONNECTION_REFUSED」（localhost 拒绝连接），之后才出现启动进度或直接黑等                                                                                                                                                                                                    | **壳编译时没带 `custom-protocol` feature**（裸 `cargo build --release`）：tauri 的 `cfg(dev)` 由该 feature 决定，不带它 = dev 模式行为——①启动页相对 URL 解析到 `build.devUrl`（http://localhost:3100/splash.html），dev server 未就绪时 WebView2 渲染错误页且永不重试（2026-09-02 定位，冷启动必现；官方 `pnpm tauri build` 会自动带该 feature，所以生产包没这问题）②资源根本没内嵌进二进制（启动页由 dev server 提供）。叠加因素：壳二进制过期（改了 src-tauri 后未重编，旧版 splash 的 `window.location.replace` 兜底把错误页顶上来）；WebView2 对导航失败也触发 on_page_load Finished，交换窗口前不校验可达性会把错误页当应用显示                                                                                                                               | 重编壳必须带 feature：`cd src-tauri; cargo build --release --features custom-protocol`。现版壳已四重防护：splash 不再自导航、交换前 TCP 可达性校验、main 加载失败重导航循环、启动页看门狗（URL 被带走 1s 内恢复进度页）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **应用启动后有一段「未连接」状态**：窗口先显示 Edge「无法访问此页面 / **127.0.0.1 拒绝连接**」（或纯白空白），几秒后才变成 workspace；这段时间主窗**看不到关闭按钮**（ISSUE #730）                                                                                                                                  | **「端口可连」与「首帧画出来」之间那段等待没人接管**：启动页探测到应用端口可响应就调 `navigate_to_app`，而 navigate 一发起主窗画面就离开启动页；dev 模式下要等 next dev 首次编译（冷启动十几秒），这段等待里 WebView2 先给空白、连接被拒时给内嵌 Edge 错误页。**已有的 TCP 可达性校验防不住它**——连接被接受而首编译未完成时 `on_page_load(Finished)` 照样触发，交接就把错误页/空白顶出来；而主窗 `decorations: false`（标题行前端接管），页面没画出来时连右上角的关闭按钮都不存在，用户看到的是「窗口没有关闭按钮」。**别把它读成「壳没带 custom-protocol」**（那条起始画面就是错误页、且错误页永不消失）                                                                                                                                                               | 已修：新增**主窗首帧看护** `watch_main_first_paint()`（壳侧每 250ms 探测主窗 URL/DOM，应用文档还没渲染出来就 `eval` 注入加载占位 `MAIN_LOADING_STUB_JS`），启动页（进度 / 日志 / 关闭按钮）在首帧之前保持可见；占位自带重贴定时器（对抗错误页换 DOM），由应用根布局挂载时经 `clearLaunchLoadingStub()` 收尾，交接时壳再清一次。`standalone` 模式不注入（内嵌 server 随壳就绪）。见 §1.4，回归测试见 `tests/check-file-structure.test.ts` 的 ISSUE #730 用例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 应用启动完成瞬间把窗口弹到最前面，打断用户正在看的别的内容（启动期间切出去干别的了）                                                                                                                                                                                                                                | **窗口交换只做 `show()` + `set_focus()`**：启动耗时期间用户可能已切走，加载完成照样抢前台（ISSUE #359）。判据缺失——「用户刚点的启动」与「用户早就切走了」在旧实现里没被区分                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 已修：启动完成默认只 `show()`（窗口进任务栏）并 `request_user_attention` 请求任务栏闪烁提醒；是否给前台由启动器 `decide_foreground()` 判决并经 `COMFYAPP_FOREGROUND` 注入（见 §1.3），只有「前台本来就是本应用 / 显式冷启动 / 唤起已有实例」才给（双击启动同样不给，见下一行）。改的是 `src-tauri/src/**`、`Cargo.toml`（`tray-icon`）与 capabilities，**必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **启动/构建卡在「端口被别的进程占用」上，改端口只能绕开、查不到是谁占着**；`.env` 里把 `COMFYAPP_PORT` 写成了用户固定的端口，而该端口上前一次的 dev server 并未干净退出（ISSUE #621）                                                                                                                               | **兜底回收一条都没跑**：会话锚点（`run/launcher-session.json`）在正常收尾时已清掉，而 `pidBelongsToRoot` 按「命令行里有没有出现过检出根路径」判定——`pnpm dev -p N`（缺省端口链路）与 `pnpm exec next dev --turbo` 两条命令行里都没有检出根路径，于是本检出自己的残留被判成「别的检出 / 别的程序」，按 §1.4 只提示不回收                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 已修：端口归属补第 ② 层**应用服务自证**（`portOwnershipVerdict`，`launcher-core/orchestrator.mjs`）——命令行跑的是本仓库的 `scripts/dev.mjs` / `scripts/start.mjs` 或 `next dev` / `next start` CLI 即认定为本检出残留；并由 `usesExplicitPort()` 收窄到**显式端口**（缺省解析链无法与别的检出区分，一律不碰）。见 §3.3，回归测试 `tests/dev-launcher-port-reclaim.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 上面这条修完、重编壳后**启动仍然抢前台**（ISSUE #359 回归）                                                                                                                                                                                                                                                         | **交接瞬间 Windows 自己把前台放行给了主窗**，壳里那条「不抢前台」根本管不到：①启动页窗口是 `WS_EX_TOOLWINDOW`，不产生任务栏按钮；主窗 `show()` 时任务栏按钮首次创建，Windows 按「新窗口 + 用户刚启动」放行前台（实测日志就是 `show_main_window_without_focus` 里 `is_focused()` 一开始就为 true）；②旧实现「无条件调一次 `set_focus()` 再看结果」——窗口已被系统放行，这次调用必然「成功」，反而把「不抢前台」演成了「一定给前台」；③启动期的 `decide_foreground()` 只判一次，用户切去干别的几分钟后「双击入口还在前台」这条早已失真                                                                                                                                                                                                                                     | 已修（两段）：①壳侧只在 `request_focus` / `COMFYAPP_FOREGROUND=1` 时才调 `set_focus()`，不再无条件试探；②新增交接复核进程（`scripts/win32-window-focus.py`，由 `spawn_foreground_watch()` 在主窗口可见时拉起）：不该给就给前台**还回去**（`SendInput` 无副作用 Alt + `SetForegroundWindow`），该给就拿到手（含键盘焦点）。判决表与结论见 §1.3，回归测试见 `tests/check-file-structure.test.ts`。诊断入口：`log/launcher/foreground-watch.log`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **双击启动完成后主窗弹到最前；点回别处遮盖它，马上又被强拉到最前（同一此启动被打断两次）**                                                                                                                                                                                                                          | **启动期判决把「前台是双击入口」放行了**：`decide_foreground()` 曾把「前台是 explorer / 启动器自身」判为允许（理由是「用户刚点过启动」），双击启动因此恒得 `COMFYAPP_FOREGROUND=1`——壳在交换窗口时 `set_focus()` 弹到最前（第一次）；用户点回别处后，交接复核进程按「启动期判决允许 = 用户就在等」执行 `give` 又把前台强拉回来（第二次）。而「双击之后切去干别的」正是常态：等几十秒后正式窗口冒出来时，「双击入口还在前台」这条判据早已失真                                                                                                                                                                                                                                                                                                                            | 已修：①判决表删去「双击入口」分支——双击启动一律 `COMFYAPP_FOREGROUND=0`，窗口进任务栏 + 闪烁提醒；显式给前台只剩 `--foreground` / `--cold-start` / 唤起已有实例；②主窗 builder 加 `focused(false)`：tao 据此把首次 `show()` 走 `SW_SHOWNOACTIVATE`，从源头掐掉「`show()` 自带激活语义被 Windows 当新窗口放行前台」的路径（无激活就无需复核进程去「还」）。改了启动器（`scripts/start_tauri_launcher.py`）与壳（`src-tauri/src/**`）：前者必须重打包（`tools\build\build-launcher.ps1`）才对双击 exe 生效，后者必须重编壳；回归测试见 `tests/check-file-structure.test.ts` 的「启动链路『不抢前台』判据」用例组                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **双击 `start-tauri.exe` 后启动页被文件资源管理器等窗口压在后面**（用户看得到启动页露出的一个角，但不在最前面）；用户反馈「这不正常，应该显示在前面才对」（ISSUE #576）                                                                                                                                      | **把「应用窗口」的「不抢前台」策略套在了启动页上**：启动期判决（`decide_foreground`）为防打断用户，双击启动一律 `COMFYAPP_FOREGROUND=0`，壳侧 `show_main_window_without_focus()` 于是只 `show()` + 任务栏闪烁。这条对**几十秒后才冒出来**的应用窗口是对的（用户可能早已切走），但启动页是用户**刚刚双击下去**的直接反馈——不给前台的结果就是启动页出现在 Explorer 后面                                                                                                                                                                                                                                                                                                                                                                                                   | 已修（启动页单独一套判据，与主窗那套**不合并**）：① 启动器在启动页**首次可见**时拉一次独立复核进程（`spawn_splash_front()` → `win32-window-focus.py --splash`），复用已验证可靠的 `focus_window()`（Alt + `AttachThreadInput`）；判定收在纯函数 `should_front_splash()`——只抢**首次可见**那一下，one-shot；② 壳侧 `bring_splash_to_front()` 另做一次本地 `set_focus()` 兜底（冷启动时壳本就是前台进程，无须等复核进程）。改的是 `scripts/start_tauri_launcher.py`、`scripts/win32-window-focus.py` 与 `src-tauri/src/**`：前者必须重打包（`tools\build\build-launcher.ps1`），后者必须重编壳；回归测试见 `tests/check-file-structure.test.ts` 的「启动页首次可见时被带到前台」用例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **启动失败但「看不出哪有问题」**：启动页弹「启动进程 dev-launcher.mjs 提前退出（exit=1）」，`dev-launcher.log` 里 `dev server 已启动（PID …）` 后**两秒**就是 `dev server 自身退出（exit=0）`，`最近 stdout` 只有一行 `[dev.mjs] COMFYAPP_PORT=…`、stderr 全空（ISSUE #576 第五轮）                                 | **两个缺陷叠加**：① `scripts/dev.mjs` 写死 `spawnSync("pnpm.cmd", …)`，Windows 上批处理只有 cmd.exe 会解释、Node 起它必失败（`EINVAL`），于是 `result.status === null`，旧代码 `process.exit(result.status ?? 0)` 把它读成**成功退出 0** —— dev server 静默消失，Next 一行输出都没有（判据见 §2.1.1，只是「起服务那一层」没复用）；② 收尾函数还按文件名字典序重找「最近一份」nextjs 日志（历史 `_` 命名排在现 `T` 命名之后），弹窗给的路径恒定指向**上一次运行**的文件，用户照过去看自然是别的现场                                                                                                                                                                                                                                                                      | 已修：① 内层 spawn 一律经 `shell.mjs` 的 `pnpmInvocation()`（形态判据唯一出口），并把「命令没起来」（`result.error`）与「跑完非零退出」分开报、打印真实命令；② 本次运行的 `nextOut` / `nextErr` **直接传入**收尾函数（`lastNextLog` 删除），失败弹窗再补一段 **dev server 自己的输出尾部**（取 `log/nextjs/nextjs-stderr-*.log` 里 **mtime 最新**的一份）与自查入口 `pnpm check:toolchain`。见 §2.1.6；回归测试见 `tests/dev-launcher-toolchain-gate.test.ts` 与 `tests/dev-launcher-downstream-exit.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Windows 上 `pnpm format:ratchet` / `pnpm check:all` 直接崩：`[format] 无法执行 prettier:spawnSync pnpm.cmd EINVAL`**（ISSUE #638）                                                                                                                                                                                | **门禁脚本自己拼了 pnpm 可执行名**：`scripts/check-format.cjs` 写着 `process.platform === "win32" ? "pnpm.cmd" : "pnpm"`，而那正是 §2.1.1 早已判定「Node 起不来」的批处理形态（只有 cmd.exe 解释批处理，实测 `EINVAL`）。第五轮只修了「起**服务**」那一层（`dev.mjs` / `start.mjs` / `analyze-bundle.mjs`），门禁与工具脚本没进那份清单，于是同一个坑换了地方复发 —— 且同族脚本（`check-reformat-only.cjs`）的失败形态是**静默**的（每个文件都退回「无法判定」，门禁一声不吭地失效）                                                                                                                                                                                                                                                                                    | 已修（§2.1.7）：`shell.mjs` 新增 `runPnpmSync()`，与 `pnpmInvocation()` 一起构成「Node 起 pnpm」的唯一出口；`check-format.cjs` / `check-reformat-only.cjs` / `check-app-port-vectors.cjs` / `repair-imports.cjs` / `heal-db.cjs` / `db-push.mjs` / `quality-gate.mjs` / `run-tests.mjs` / `generate-docs.mjs` / `build-desktop.mjs` 全部改走它，失败时打印 `error.code` + **实际命令** + 自查入口；回归护栏改为**按形态全仓扫描**（`tests/dev-launcher-toolchain-gate.test.ts`：出现 `pnpm.cmd` 字面量 / 平台三元 / 裸起 pnpm 即失败），新增脚本自动落在判据内（它当场抓出了漏改的 `repair-imports.cjs` 与 `heal-db.cjs`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **启动页一出现就自己最小化进任务栏**（用户没点任何按钮，只能从任务栏还原回来看进度）                                                                                                                                                                                                                                | **把「探测」写成了「执行」**：splash 页脚本加载即调 `probeWindowCommands()`，用 `invoke('win_minimize')` 探壳兜底命令是否就位——但 IPC 命令没有 dry-run，`invoke` 就是**真的执行**，启动页刚显示就把自己最小化了                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 已修：删除启动期探测（对有副作用的命令无法无损探测）；「壳过期」的判定改由用户真正点最小化/关闭按钮时的三条互补路径承担（窗口 API / 内联 onclick / 壳命令 `win_minimize`·`win_close`，全失败时消息区给可见提示，见 07 §7.18.7）。改的是 `splash-assets/**`（编译期内嵌），**必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

| 关掉应用、马上重新双击 start-tauri.exe，再进工作流库看到「未找到匹配的工作流 / 共 0 个工作流」——像是工作流被清空了（ISSUE #369） | **「还没加载出来」与「真的没有」在界面上长得一样**：`workflow.list` 是服务端较慢的一跳，而服务启动期要经过依赖预检（可能触发一次 `pnpm install`）→ next dev 首屏编译 → Drizzle `push` 同步表结构，这段时间里查询一直没 resolve；列表组件只有「有数据 / 无数据」两种呈现，于是空态文案（「未找到匹配的工作流」）被当成结论显示出来。这与「数据库真的空 / 目录里真的没有工作流」逐字相同，用户无从区分 | 已修：列表三态明确分开——`loading`（正在加载）/ `loadStalled`（超过 8s 未返回 → 可重试 + 引导打开日志面板看原因）/ 真为空（区分「搜索无结果」与「还没有工作流」，给导入或配置本地目录的引导）。判据在 `use-workflow-library.ts` 的 controller，形态在 `workflow-library-config` 与 `WorkflowLibraryList`。**注意**：这类「慢一跳」的界面不能只在快路径上测；新增列表/详情页时默认要有加载态，否则同一症状会在别处再现 |

| **同一次失败，执行日志与应用日志给出的原因不一样**：工作流执行日志写着「任务卡在队列超过 32s（dev server 重启后 in-memory 队列清空，无人 re-claim）— 请重新执行」，而应用日志里同一任务的原因是「未找到生成结果」（ISSUE #378） | **同一个 taskId 有两个独立写入者，且没有共享的终态锁**：reaper（孤儿回收）与正常 executor（complete / fail / 看门狗）各自把终态写进 DB 与日志。reaper 先经 `emitter` 把「卡在队列」推给 SSE 订阅者（执行日志弹窗读到的就是这条），随后 executor 又把 DB / 应用日志覆盖成真实原因（「未找到生成结果」）；`claimSettle` 只管 executor 内部，reaper 完全不参与 | 已修（两层锁）：① reaper 与 executor 共享「终态已认领」集合 `s.settled`（reaper 侧 `claimTerminal()` 语义对齐 `claimSettle()`），谁先认领谁赢，另一方跳过；② 新增「DB 终态一次写入」锁 `s.finalized`（`claimFinalize()`），`finalizeFailure` / `finalizeSuccess` 与两条 reaper 都先抢锁再落库，重复收口只写一行 warn。这样执行日志（SSE）与 DB / 应用日志永远出自同一次收口。回归测试见 `src/lib/comfyui/reaper-decisions.test.ts` |
| **失败原因只有一句「未找到生成结果」，ComfyUI 到底回了什么完全查不到**（ISSUE #216） | **结论有出口、现场没有**：`completeInner` 在 `fetchHistoryEntry` 返回 null 时只写一句收口原因；而原始证据全在内存里即用即弃——comfy-cli 的 stdout 只在面板显示前 20 行（非 JSON）/ 只展示解析后事件，stderr 只显示前 60 行且过滤 Python 警告，`/history` 与 `/queue` 的 JSON 只在当次函数内，WS 帧解析失败静默 return。于是「CLI 没回传 prompt_id」「history 是空对象」「history 有条目但 outputs 空」「有 outputs 但收集不到产物」四种完全不同的成因在日志里长得一模一样 | 已修：新增 ComfyUI 原始回执通道 `src/lib/comfyui/trace.ts`（`trace(channel, taskId, message, meta?)`），原文追加写 `log/comfyui/comfyui-trace.log`；接入 `executor-cli`（命令行/每个 stdout chunk 与解析事件/非 JSON 行/stderr chunk/未收到 envelope 退出时的完整 errBuf）、`executor-ws`（全部 WS 帧、非法帧、history 三种终局原文、失败时额外探测 `/queue`）、`executor-finalize`（收口结论带成因、execution_error 完整 `status.messages`、有 outputs 未识别产物的原文）。面板侧同步给出摘要（history status/completed/输出节点明细），收口原因从「未找到生成结果」细化为「promptId=? + /history 无有效条目 + 原文路径」。排查路径见 §4.2，纯函数回归测试见 `src/lib/comfyui/trace.test.ts` |
| **失败原因只在弹窗顶部横幅里，日志行/时间线里找不到**（用户按「错误」筛选时一片空白）（ISSUE #378） | 面板把失败原因只渲染成横幅（`run.errorMessage` / `error`），而 SSE 的 `state`/`error` 帧可能不带对应的 `log` 帧（reaper 收口、DB 轮询补发终态、连接中断等），于是筛选视图与回放时间线里都看不到失败原因 | 已修：收口失败时**同时**补一条 error 日志行——工作流库运行记录走 `failWorkflowRun()`（`src/lib/workflow-run-store.ts`），画布面板走 `appendFailureLogLine()`（`GlobalStepLogPanel.tsx`），并做「末行同因」去重避免与服务端已有的 `✗ 生成失败` 重复。回归测试见 `src/lib/workflow-run-store.test.ts` |
| 打开设置失败，页面只剩一句「配置数据未就绪」（没有原因、没有重试、日志面板里也找不到对应失败） | **判据取错**（ISSUE #304）：设置页有两个查询（`setting.get` / `llm.configGet`），降级视图此前只在「两份数据都没拿到」时才触发。当一份成功、一份失败（如 `llm` 相关表缺失 → `no such table: llmConfig`）时，草稿两份都不齐却又不满足该条件，容器一路落到兜底文案。叠加两个观测缺陷：①补记日志的 `query` 字段写死成 `setting.get`，与实际失败的查询对不上；②只记翻译后的可读文案（`signal is aborted without reason` 被译成「请求被中断，请稍候重试」），服务端原文丢失，用户按提示反复等重启永远修不好 | 已修：`hasError = 任一查询失败 且 草稿未就绪`（一份成功一份失败也落错误视图）；日志按实际失败查询记全名称，并把原始报错（tRPC `code` / 服务端 `message` / `cause` / 堆栈首行）写入 `raw` 字段；`errorMessage` 优先取 `shape.message` 的服务端原文，不让传输层包装文案盖掉根因。见 07 §7.12.1 |
| 工作流库/项目列表整页空数据，tRPC 查询 500（console 报 no such table / Could not locate bindings） | **Drizzle 迁移三重遗漏**（2026-09-03 定位）：① better-sqlite3@11 无 Node 24 预编译包、本机无 MSVC → 原生绑定缺失，所有 DB 查询崩（升级到 v12，prebuild 下载即可）② `resolveDbPath` 用 `new URL("file:./db.sqlite")` 解析 → Windows 落到盘符根 `F:\db.sqlite` 空库（真实数据在 `prisma/db.sqlite`）③ schema.ts 表名 camelCase 与 Prisma 建的 PascalCase 表不一致 | ① better-sqlite3 钉在 v12（v13 移除预编译包，本机无编译链不能升）② 路径解析统一走 `path.resolve(process.cwd(), …)`（与 drizzle-kit 同锚点）③ 表名已重命名对齐 schema.ts；**换 Node 版本或重装依赖后先跑一次 `pnpm db:studio` 确认表与数据都在** |
| `pnpm build` 报 **`Dynamic filesystem access causes tracing of the whole project`**（若干条，围绕 `db.ts` / `lifecycle.ts` / `api/dev/build-id` / `api/update-check` 等动态路径访问点） | **动态路径访问让 Turbopack 放弃静态追踪、退化为「整个项目全量追踪」**：`fs.*` / `path.resolve` / `path.join` 的参数只要依赖 `process.cwd()`、`process.env`、目录项或 HTTP 入参，它就无法把路径静态收敛到某个子目录，于是把**整个项目**（含 `public/`）都算作 server code 的依赖。判据是**高亮行正好落在那条「算出路径」的表达式上**（`path.join(...)` / `path.resolve(...)` 那一行），而不是消费它的 `fs.statSync`。后果是 `.next/standalone` 被撑大（本仓库实测修复前 62MB、`standalone/src` 里 143 个 `*.test.ts` 与 89 份 `changelog.d/*.md` 都在里面；补上 exclude 后产物干净、测试文件归零） | **已纠正口径（ISSUE #489 实测）**：`/*turbopackIgnore: true*/` 对 `fs.*` **一概无效**——它只作用于动态 `import()` / `require()`（Next 文档里这类注解的语义是 "skip bundling"）。仓库里那些存量注解（`envfile.ts` / `debug/source/route.ts` / `localWorkflows.ts` / `db.ts`）**从未真正生效**，告警一直在；把它们换位置、做常量、写进 `path.join` 参数里都试过，5 条告警一条不少。**真正的防线是 `next.config.js` 的 `outputFileTracingExcludes`**（体积护栏 1.5GB 也靠它）：它按**最终产物路径**排除，不依赖 Turbopack 的静态分析。**不要**用 `turbopack.ignoreIssue` 去「消警」：实测它只关消息、不改行为（配了它，把哨兵目录从 `outputFileTracingExcludes` 里摘掉后，哨兵**照样**回到 `standalone`）——那是把唯一的可见信号关掉而产物照旧被放大（反模式 E9）。详见 §7.2 |
| **`pnpm build` 在 master / CI / 干净检出上必失败**（`next build` 挂在 `Collecting page data` 阶段，报错 import trace 指向 `/api/logs/history` 一类与库无关的路由） | **模块级副作用在「表还没建好」时读库**：ComfyUI 孤儿任务回收（`src/lib/comfyui/reaper.ts`）是模块级副作用（`enqueue.ts` 用裸 `import "./reaper"` 把它挂上启动路径），build 期 worker 加载模块图时同样会执行它；而干净检出只跑 `pnpm install`、没跑 `pnpm db:push`，于是 `no such table: task` / `no such table: user` 以未捕获异常浮出 worker，被 Next 聚合进 collect-page-data 阶段错误——报错行号落在无关路由上，把人引向错误方向 | 已修：新增 `src/lib/db-schema-ready.ts`（只读探 `sqlite_master` 的哨兵表，三态 ready / missing / unknown，同进程只探一次），reaper 每轮 sweep 先判就绪、未就绪整轮跳过（回收幂等且每 30s 重跑，只推迟一轮）；**不吞真故障**——「表存在但查询失败」仍照原路径暴露。该模块必须保持纯 ASCII，见下一条 |
| **CI 的 `Test` 步骤在 master 上一直红**（`pnpm test` 报 `MissingEnvFileError: 缺少 .env 环境配置文件`；本机有 `.env` 的人跑同一个用例是绿的） | **用例的 `process.cwd` 替身泄漏到了别的 `describe`，把 `src/env.js` 的 `.env` 探测带偏**（ISSUE #489）：`src/lib/db-schema-ready.test.ts` 的文件级 `beforeEach` 对文件内**所有** `describe` 都生效，而末尾「reaper 模块级副作用」那组要 `import` 真实的 `~/server/db` → `~/env`，`env.js` 拿 `<cwd>/../.env` 探测配置文件；cwd 被留在临时目录时探测必然落空。**注意只设 `BETTER_AUTH_GITHUB_CLIENT_ID` 两个变量是不够的**（实测仍然红）——校验有两层：`.env` 文件存在性 + 必填项，两层都要满足。CI 的 `Test` 是裸 `pnpm run test`（不注入 `SKIP_ENV_VALIDATION`），所以每次必挂；而 `test:coverage` 走另一条链路能过，于是呈现成「Coverage 绿、Test 红」这种最容易被忽略的形态 | 已修：cwd 替身改为**按 `describe` 建立、退出即还原**（`useTempCwd()` + 各自 `afterEach`），不再放进文件级钩子；该组自己 `vi.stubEnv` 补齐 `SKIP_ENV_VALIDATION` 与两处占位密钥，**不去读开发者本机的 `.env`**——用例的可通过性只能取决于用例自己造的东西 |
| **`pnpm build` 在 CI 上必挂**，`Collecting page data` 阶段报 `TypeError: Cannot read properties of undefined (reading 'startsWith')`（行号落在 `src/server/db.ts::resolveDbPath`，但触发路由是 `/api/debug/source`、`/api/logs/history` 一类无关路由） | **`SKIP_ENV_VALIDATION=1` 放行了校验，却没给 `DATABASE_URL` 兜底**（ISSUE #489）：CI 的 Build 步骤只设 `SKIP_ENV_VALIDATION`、不注入 `DATABASE_URL`，于是 `env.DATABASE_URL` 是 `undefined`，`db.ts` 里直接 `url.startsWith("file:")` 抛错；`db.ts` 被每条路由的模块图拉到，异常浮出 worker 后聚合进 collect-page-data 阶段。与上一行「模块级副作用读库」**同族但不同档**：那条是「表还没建」，这条是「连库路径都没有」 | 已修：`resolveDbPath` 先兜 `url || "./db.sqlite"`（`src/server/workshop/db.ts` 一直是这么写的，`src/server/db.ts` 漏了），缺值时退到与 drizzle-kit 同一锚点的默认库文件，「表可能还没建」交给运行期的可读出口（`/api/health` 的 503 + `db: empty`）而不是构建期崩溃。**`src/server/db.ts` 顺带转为纯 ASCII**（它在构建期模块图上且实测会被 code frame 渲染，见下一行的 panic 风险） |
| **`pnpm db:push` 在无 TTY 环境「成功」了，但应用起来只有真实业务页面 500**（`/`、`/api/health`、`/settings` 都 200，`/api/logs/list` 报 `SqliteError: no such table: user`） | **交互提示被静默吞掉**（ISSUE #489）：`drizzle-kit push` 需要交互确认时报 `Interactive prompts require a TTY terminal` 后 **exit 0**，并把 `db.sqlite` 留成 **0 字节**。管道输入、脚本、CI、远程会话、容器都是这个条件；文档 §9.1 的第一步就把它写成了 `pnpm db:push`。「只探首页会误判成 Linux 完全通了」是它最难查的地方——`SELECT 1` 在空库上也成功，所以 `/api/health` 照样回 `db: up` | 已修（§9.1「建库」）：`pnpm db:push` 改走 `scripts/db-push.mjs`——以 `--force` 运行（无交互、幂等），**复核库里到底有没有表**（不看退出码：无 TTY 上正是「报错但 exit 0」），复核失败即非零退出 + 可行动提示。另加两道出口：`dev.mjs` / `start.mjs` 启动即探哨兵表并警告（只警告不退出），`GET /api/health` 一并探 schema 就绪度（空库 → 503 + `db: "empty"`） |
| **给构建期模块图上的文件加中文注释后，`next build` 报的不是业务错，而是整个构建被一个 Rust panic 带走**：`thread 'tokio-rt-worker' panicked at crates/next-code-frame/src/highlight.rs:1021:45: end byte index N is not a char boundary` + `Build error occurred [Error: Panic in async function]` | **Next 的 code frame 高亮按字节偏移切串，落在多字节字符中间就 panic**（Next 16.3.2 实测）：`next-code-frame` 渲染错误现场时按**字节**取「该行的第 a..b 字节」，而一个中文字符占 3 字节；只要某个高亮区间的 `end` 落在中文字符内部，Rust 侧切片直接 panic 把 build 打死。触发条件是**组合**而非内容：某模块既在构建期被加载、又成为错误现场被渲染成 code frame，且其注释/字符串含多字节字符、偏移恰好落在字符中间——同一文件删掉中文能过、换成不同长度的中文又能复现，属偏移敏感的脆弱路径 | 规避（本仓库口径）：**会被 `next-code-frame` 渲染到的模块一律保持纯 ASCII 源码**。实践上指「new / 改动了构建期模块图上的模块」（被 `next build` worker 加载、且可能成为报错现场的那个）：注释与字符串写英文；其余文档与业务模块不受影响，中文注释照常。**排查手法**：build 报上面这段 panic 时不要去找业务 bug，先把最近新增/改动、且位于构建期模块图上的文件临时改 ASCII 再跑一次，能过即命中本条；用 `node -e 'const s=require("fs").readFileSync("f.ts","utf8");console.log([...s].filter(c=>c.charCodeAt(0)>127).length)'` 数非 ASCII 字符定位 |
| drizzle-kit push 非交互环境报 "Interactive prompts require a TTY"，或重建表时 "index xxx already exists" | push 遇到表重命名/重建差异需要交互确认；其重建路径在多次部分执行后有索引名冲突的已知缺陷 | 启动器用 `push --force`（非致命，失败仅 WARN）；手动收敛时按「清理 `__new_*` 残留表与同名索引 → 重试 push」循环；索引可安全 DROP 后由 push/schema 重建 |
| **应用服务（dev server）没起来 / 起来了但页面拿不到数据，日志面板同时是空的**——用户无从判断是「真的没日志」还是「观测链路断了」（ISSUE #360） | **失败落在面板的轮询通道之外**：面板只读 launcher / dev / app-runtime 三路，而 Next dev server 的首屏编译错误、`FATAL: An unexpected Turbopack error`、未捕获的服务端异常、pino 的 ERROR 行都落在 `log/nextjs/nextjs-stdout|stderr-*.log`（不在三路里）；面板拉不到日志时的 `catch` 又是静默的（「静默忽略」在启动阶段成立、运行阶段就是藏问题）；服务端重启前后也没有任何标识能把两个进程的输出分开 | 已修（规范 07 §7.18）：① 进程启动时把 stdout/stderr **额外**转录到 `log/nextjs/nextjs-panel-<boot>.log`，面板新增第 4 路来源「应用服务」（`capture-streams.server.ts` + `source=app`）；② pino 的 ERROR 镜像进 app-runtime（面板可见），INFO 不镜像；③ 面板拉不到日志时给一条**只说一次**的 warn（应用服务不可达 + 常见原因），恢复时补一条 info；④ 每个响应带 `bootId`，进程变化即清空时间线并重读（避免重启前后混成一条线），页脚常驻「服务 <标识>」徽标 |
| **设置页「经常出现」打开即整页「加载设置失败」**（用户以为应用服务没启动） | **把「一次读失败」当成了「界面不可用」**（ISSUE #360）：`setting.get`（SQLite）与 `llm.configGet`（还要先跑 remote storage 迁移）是服务端最脆弱的两跳，应用服务刚重启 / 编译中 / 数据库迁移的那几秒里失败是常态；而设置页只有 加载中 / 失败（整页错误视图）/ 就绪 三态，失败即把整个界面换掉 | 已修：新增「最后一次成功配置」兜底（渲染期 derived state，首值取 sessionStorage 快照），失败且草稿为空时用它播种，界面照常渲染；失败原因走**非阻塞**提示条 `serveState`（含「重新读取」）；`hasError` 收窄为「失败且连兜底都没有」。见规范 07 §7.18.5 |
| 设置/工坊/模型等 `(main)` 路由组页面整组 404（应用内「页面走丢了」），应用日志面板恒为空（全部 0 条）；同会话根级路由 `/workspace`、`/login` 正常且该坏状态持续整场 | Turbopack dev 会话级路由组失效（上游 vercel/next.js#97897 同类，偶发于某次 `next dev` 启动，2026-09-06 定位，Next 16.3.2）：坏会话内 `(main)` 组路由不进编译直接 404；日志面板轮询的 `/api/logs/current` 在同会话同样拿不到数据 → 面板全空。与代码无关（源码与 `.next` 编译产物均完好） | 关闭桌面窗口重启应用即恢复（dev server 重建路由表）；重启无效再删 `.next` 重启。持续跟进上游修复，修复后可移除本条 |

| `nextjs-stderr-<ts>.log` 被同一条 **Edge 编译噪声刷屏**（同一段文本重复数万行、可到数十 MB，去重后仅几十行唯一内容），真实的运行报错（Failed to fetch / ECONNREFUSED / JSON 解析错等）全被淹没看不见 | **Edge instrumentation 包被静态拉进 Node-only 模块**：`src/sentry.edge.config.ts` 顶层 `import { env } from "~/env"` 把整个 `src/env.js` 并进 Edge 包。env.js 虽已用 `NEXT_RUNTIME !== "edge"` 做了**运行期**守卫，但 Turbopack 编译 Edge 包时是静态把整个模块图并进去，`node:fs` / `node:path` / `node:url` 仍被静态分析识别为「Edge 不支持的内置模块」→ 每次编译都报 `⚠ ./src/env.js … not supported in the Edge Runtime` + `Ecmascript file had an error`，import trace `src/env.js → src/sentry.edge.config.ts → src/instrumentation.ts`，Edge instrumentation 编译卡进无限重试/重编循环把 stderr 刷满（2026-09-08 定位）。只加运行守卫挡不住静态打包追踪 | 已修：`src/sentry.edge.config.ts` 不再 import `~/env`，Edge 只需要 `SENTRY_DSN` 与 `NODE_ENV`，直接读 `process.env.SENTRY_DSN` / `process.env.NODE_ENV`（沿用该文件「未配置即 no-op」风格），env.js 彻底不进 Edge 包，噪声消失。server 端 config（sentry.server.config.ts）仍可用 `~/env` |
| **`/login` 与 `/workspace` 打开即 500、应用完全打不开**（`pnpm build` 也失败），`next dev` 终端输出 `FATAL: An unexpected Turbopack error occurred: Failed to write app endpoint /login/page`，`Caused by: the chunking context does not support external modules (request: node:fs)` | **纯逻辑模块混进了 Node-only IO**（2026-09-10 定位，ISSUE #317）：`src/lib/log-session-scope.ts` 顶层 `import fs from "node:fs"`，而客户端组件 `LogProvider.tsx`（`"use client"`）只需要它的纯函数 `clampLogTime`。Turbopack 编译**浏览器** chunk 时把该模块整图形入，`node:fs` 被视为「浏览器不支持的 external module」→ 该 endpoint 编译失败、页面 500。与下方 #282 那条**同源**（Node-only 模块被静态打包进浏览器图），区别是这次走的是「本该纯逻辑的模块里放了 IO」，更隐蔽：模块名和注释都写着「逻辑层」，只有第一行是 IO | 已修：按「纯逻辑 / IO」分层——`log-session-scope.ts` 只留纯函数（`resolveSessionStart` / `clampLogTime`，客户端与服务端共用），读文件 mtime 的 `fileMtimeMs` 移入 `.server.ts`（Node-only），仅服务端路由 `GET /api/logs/current` 引用。**新增静态门禁** `tests/client-bundle-node-builtins.test.ts`：从所有 `"use client"` 入口遍历 import 图（`import type` 编译期擦除，不计），命中「客户端可达且顶层 import Node 内建」即失败并打印完整引用链。同类排查手法：`rg "^import .*from \"node:(fs|path|child_process)\"" src/lib` 后反查谁在客户端 import 它 |
| 设置页 / 工作区等页面打开即报 **“An unexpected Turbopack error occurred”**（浏览器 overlay），`next dev` 终端输出 `FATAL: An unexpected Turbopack error occurred: Failed to write app endpoint /(main)/settings/page`，`Caused by: the chunking context … does not support external modules (request: node:fs)`，且非编译型报错而是整页 500 | **客户端组件链顶层 import 了 Node-only 模块**：`app-runtime-log.ts` 顶层 `import fs from "node:fs"` / `node:path`（Node 专用），却被客户端 hook `use-settings-page.ts`（`"use client"`）顶层 `import { createAppRuntimeLogger }` 引用。Turbopack 编译**浏览器** chunk 时把该模块整图形入，`node:fs` 被识别为「浏览器不支持的 external module」→ 编译该 endpoint 失败，页面 500（2026-09-09 定位，ISSUE #282 回归，由提交 29d8b1d 引入——客户端为补记 `app-runtime` 日志直接 import 了 Node 日志模块）。与 §5 上一条 Edge 噪声同源：都是「Node-only 模块被错误打包进非 Node 运行时图形」。`/*turbopackIgnore*/` 只能豁免动态访问点，**挡不住顶层 `import` 的静态打包** | 已修：客户端逻辑层不得直接 import `app-runtime-log`（Node-only）。改为经服务端写入通道——新增 `POST /api/logs/app-runtime`（route.ts 用 `createAppRuntimeLogger` 落 `log/services/app-runtime.log`，白名单 ns 与 level、截断超长消息），客户端网络层 `src/lib/log-file-client.ts` 新增 `postAppRuntimeLog()`，`use-settings-page.ts` 在 `hasError` 分支 `void postAppRuntimeLog("settings","error",msg,fields)` 取代直接 logger 调用。规范 07 §7.12 新增「客户端补记 app-runtime 必须走服务端通道」的约定 |
| 在工作流库/画布节点**上传素材**时只报一句「Configured ComfyUI instance is not running」（上传位没有提示、也没自动启动） | **上传链路没接上自动启动**（ISSUE #345）：任务提交路径（`executor-ws`）在 WS 连不上时会 `ensureComfyUiReady` 拉起实例并等就绪，而上传走的是另一条路——`/api/upload` → `uploadImage` → `resolveComfyBase()`，配置了路径且该实例没在跑时这里直接抛错，503 只带一句原始文案，前端上传位也没有错误区（失败只进 console） | 已修：新增 `POST /api/comfy/ensure`（短等 + 按配置拉起，202 = 正在启动）、客户端 `src/lib/comfy-readiness-client.ts`（`waitForComfyReady` 轮询 + 退避 + 可读文案）、`uploadImageFile` 就绪后自动重传一次；`/api/upload` 命中「不可达」时 fire-and-forget 踢一次自动启动；表单新增 `onUploadError/onUploadProgress`，工作流库节点与画布节点把「正在启动…」「启动超时，去设置页手动启动」渲染成提示条 |
| 任务报「任务卡在队列超过 Ns（…无人 re-claim）」 | ComfyUI 未运行：WS 连不上 → `processQueue` 不出队 → reaper 30s 判死 | 已加自动启动：配置 `comfyuiPath`（设置 → 创作后端）后任务执行前自动拉起 ComfyUI 并等待就绪；reaper 在启动窗口期跳过回收。也可在设置页手动点「启动 ComfyUI」。启动日志：`log/services/comfyui-runtime.log` |
| 子图（liblib）工作流每次生成的都是同一张图，且与提示词无关；日志里「真实执行 seed」恒等于工作流里存的那个默认值 | **覆盖只写到了子图 wrapper，没写进内层节点**：raw 子图 wrapper 的 `widgets_values` 只是**宿主值**；comfy-cli 把子图展开成 `wrapperId:innerId` 后，UI→API 转换读的是**内层节点**的 `widgets_values`。而「把宿主值回写进内层」（promoted-widget overlay）是 comfy-cli **1.20** 才有的逻辑，1.17~1.19 会用内层默认值整段盖掉 → 提示词/种子/步数全部失效。日志特征：`输入参数（workflowInputs，N 项）` 里值正确，但 `真实执行 seed = <工作流默认值>` 恒定不变；把临时工作流文件直接拖进 ComfyUI 跑也是同一张图 | 已修：`applyRawOverrides` 对子图 wrapper 的覆盖项按 ComfyUI 前端的映射规则（`sub.inputs[i].linkIds` → 起点为 `-10` 的边界连线 → 内层 `target_id` / `target_slot`）同步写进内层节点，seed 的 `control_after_generate` 哨兵槽与「随机值」兜底生成的随机种子同样同步。回归测试见 `src/lib/comfyui/executor-cli.test.ts`（`applyRawOverrides — 子图 wrapper 覆盖同步到内层节点`）。另注：comfy-cli 版本可用 `python-venv/comfy-cli/Scripts/python.exe -m comfy_cli --version` 确认，1.20 起两条路径都生效；版本比对与升级已由启动时后台的 `scripts/setup-comfy-cli-venv.ps1` 自动完成（见 §1.2），仍停在旧版时查 `log/tools/comfy-cli-setup.log`（离线 / PyPI 不可达会跳过升级，需手工 `-Force` 重试） |

| 任务报「任务卡在队列超过 Ns（…无人 re-claim）」——但这次 ComfyUI 明明在运行、comfy-cli 进程已启动 | **raw UI-format（liblib 子图）路径的误判**：任务经 `executeViaComfyCli` 提交，但直到 comfy-cli 子进程回传 `prompt_id` 前，DB 行保持 `QUEUED / promptId=null`。comfy-cli 的 Python 启动 + 工作流转换 + POST /prompt 可能超过 reaper 的 30s 阈值（STALE_MS），于是 `reapStaleQueuedTasks` 把这个健康在飞的任务误判为孤儿并标记 FAILED。日志特征：`✓ comfy-cli 进程已启动` 之后立刻出现 `任务卡在队列超过 Ns` | 已修：`reapStaleQueuedTasks` 增加 in-memory 认领保护 `isTaskClaimedInProcess`——任务若仍被当前进程认领（还在 `s.queue` / 有 comfy-cli 子进程 `cliProcs` / `executedWorkflow` 已记录），则不回收，交给正常执行路径收口；只有 cold restart 后无任何 in-memory 足迹的才判孤儿。回归测试见 `src/lib/comfyui/reaper.test.ts` |
| 同上症状**在该修复之后仍复现**（日志里明明有 `▶ comfy-cli 节点 [N] 开始执行` 在持续刷，任务却仍被判死；ISSUE #378） | **认领判据全是「进程内记忆」，而 raw 路径的驱动者是独立进程**：`comfy-cli` 是 `spawn` 出来的独立进程，应用服务重启后它仍在往 ComfyUI 提交/推进工作流，但新进程里 `s.queue` 空、`cliProcs` 空、`executedWorkflow` 也随内存丢了——三个信号同时落空，reaper 于是把仍在执行的任务当孤儿。两处具体缺口：① `cliProcs` 是**模块级 `Map`**（不是 globalThis 单例），Turbopack 热重载重新求值 `executor-cli.ts` 时会造出一张空表，正在跑的句柄留在旧表上——同族单例（`runner-state` / reaper 定时器 / lifecycle 启动锁）都挂了 globalThis，只有它漏了；② 判死**没有任何外部证据**，失败文案「dev server 重启后…无人 re-claim」是硬编码模板，属猜测而非事实（用户实际没重启也会看到这句）。 | 已修（ISSUE #378）：① `cliProcs` 改挂 globalThis 进程级单例（`__comfyCliProcs_v1`），与同族单例口径一致，回归测试 `src/lib/comfyui/cli-procs-singleton.test.ts` 在旧实现下会失败；② `reapStaleQueuedTasks` 判死前新增外部证据探针 `comfyHasActiveWorkflow()`（每 tick 只探一次，不按行重复请求）——问 ComfyUI `/queue`，**队列非空或探测失败（不可达）都不回收**，本轮跳过等下一 tick 对账，只有「队列空且无本次执行的 prompt_id 线索」才判孤儿（注意：`/history` 保留全部历史、无时间过滤，**不能**拿「历史非空」当在飞证据，否则孤儿会永久卡在 QUEUED）；③ 失败文案改为陈述实际判据，不再把「疑似重启」写成结论。判决矩阵回归见 `src/lib/comfyui/reaper-decisions.test.ts` |

| ComfyUI 启动失败（如「保活进程已退出」）后仍被一直自动重试，执行日志与 `comfyui-runtime.log` 里同一条失败被反复刷、进程被无谓地重复拉起 | **自动启动没有「失败即停」的出口**（ISSUE #335）：`ensureComfyUiReady` 只把失败返回给这一次调用方，WS 重连循环（退避到 15s）仍每轮重新讨要启动；路径没配好 / 环境缺依赖 / 保活进程拉起来就退这类失败重试并不能自愈 | 已修：一次自动启动以**明确失败**收尾即落 `autoStartFailed` 闩锁，非手动来源（WS 重连 / 状态轮询）后续直接回报上次失败详情并跳过重试，不再 spawn、不再刷日志；被闩锁抑制时 WS 层也不再安排重连（否则只是每 15s 空转一轮）。清闩锁的出口：手动点「启动 ComfyUI」（`manual:true`）、重新开启自动启动（`clearComfyManualStop`）、或修改「安装路径 / 启动参数」（`setting.save`） |
| 设置页 ComfyUI 状态更新不及时 / 误报：外部（Comfy 桌面版、自己的终端）已经启动了 ComfyUI，设置页仍显示「未运行」；或打开设置页要等几秒才跳到「运行中」；点「打开查看」报未运行 | 三处判据缺陷叠加（2026-09-10 定位，ISSUE #339）：① **只看 HTTP 探测**——`comfyStatus` 直接调 `probeComfyUi()`，而它底层 `resolveComfyBase()` 在配置路径下会先要求「命令行含 `main.py` 的进程」存在；Comfy Desktop 的 standalone-env 由 `uv` 启动，命令行里没有 `main.py`，于是外部实例明明在跑也**直接抛错**判未运行。② **无缓存**——每次查询都重新付一遍 PowerShell 进程表查询（冷启动高负载下可到 10s 超时）+ 6 次端口扫描，状态行先渲染「未运行」再跳。③ **前端 15s 轮询**——外部刚起来的实例最多要等一个轮询周期才被认出来。另外 `client.ts` 的 `_resolvedBase` 一记住就永不复查 | 已修：新增 `src/lib/comfyui/status.ts` 运行态快照——进程级判据（bound 子进程 → 配置路径 `main.py` → `comfy-cli` setup 登记的启动器 / `pythonw`/`python` 候选 → 任意解释器起的 ComfyUI），命中即「在跑」不等 HTTP；带 1.5s TTL 缓存 + 在途去重（并发查询只走一次 IO）；探测失败（进程表超时）标 `unverified`，**绝不当成「没在跑」**。`getComfyUiStatus()` 合并快照与 HTTP 探测给出四态：运行中（含端口偏移推导出的 base）→ 进程在但接口未就绪 =「启动中」→ 事实不可信 =「检测中…」→ 未运行。`comfyStatus` 改走该函数并透出 `probing`/`port`/`via`；设置页轮询 15s → 5s 且不在后台轮询，「打开查看」先取一份新鲜状态再打开，按钮只在「明确未运行」时禁用。回归测试见 `src/lib/comfyui/status.test.ts`。**复审（ISSUE #339 残留延迟）**：误报修掉后仍剩「打开设置页要等一会才显示运行中」，因为判定路径在排队——① 快照候选判据串行 await（每个一次 PowerShell 枚举 `Win32_Process`，~2.5s，三个就 7s+）；② `probeComfyUi()` 底下的 `resolveComfyBase()` 在配置路径时会**再查一遍进程表**才决定探哪个地址（同一件事问两遍）；③ 定位端口又要一次 `Get-NetTCPConnection`（~2.5s）。已修：候选判据**并发**查（几路同中仍按声明顺序取第一个）；快照已定位「进程 + 端口」时**直连该端口探测**，不再绕经会重查进程表的通用探测；定位端口用「配置端口是否应答」**抢跑**权威查询（没应答才回落，不用猜的端口覆盖查出来的端口）。回归测试见 `src/lib/comfyui/status.test.ts` 与 `src/lib/comfyui/lifecycle.test.ts`。**再复审（同 Issue 的第二轮：把「查询本身」变便宜）**：前面几轮都在减少**次数**（并发 / 直连 / 抢跑），两条系统查询单次的**成本**没动过——① 找 `main.py` 的 `Get-CimInstance Win32_Process` 不带 `-Filter`，把系统上每个进程的整份属性（含几 KB 的 `CommandLine`）拉过来再让 `Where-Object` 在 PowerShell 侧挑（~2.5s）；② 查 PID 监听端口的 `Get-NetTCPConnection -OwningProcess` 同样不是服务端过滤，也要枚举全部 TCP 连接（~2.5s），且要另起一个 PowerShell。已修：① 进程名过滤**下推到 WMI**（`-Filter` 只物化 `Name LIKE 'python%'` 的少数进程）；② 端口改用系统自带的 `netstat -ano -p TCP`（原生程序，毫秒级，不再起第二个 PowerShell），与启动器侧 `scripts/launcher-core/procs.mjs` 同口径；③ 「配置端口是否应答」的结论在快照内部传递，失败路径不再把同一次探测重做一遍（探失败要等满 1.5s 超时）。回归测试见 `src/lib/comfyui/proc-detect.test.ts`（解析器 + 命令口径）与 `src/lib/comfyui/status.test.ts`（不重探）。**未做**：把 `comfyStart` 改成「提交即返回 + 前端轮询」——那会改变设置页失败反馈的语义（现在靠返回的 `ok` / `detail` 弹提示），属独立改动，见 ISSUE #719 的讨论 |
| 应用日志面板「很慢、一直刷屏」：满屏同一条 `[trpc] setting.comfyStatus 10457ms`，警告计数一直涨却看不到新内容；设置页状态行也像冻住 | 三处独立缺陷叠加（2026-09-11 定位，ISSUE #346）：① **状态结论无缓存**——`setting.comfyStatus` 每轮轮询都重付一遍「PowerShell 进程表查询（10s 上限）+ HTTP 探测（1.5s）」；② **慢查询 warn 每次原样重写**——同一路径持续慢就每轮写一条内容完全相同的行，把真正新增的日志挤出视野；③ **面板按到达顺序堆叠**——三路轮询并发到达，`app-runtime` 那一路要多等两个 IO 响应，它的**旧时刻行会晚于** dev 的**新时刻行**入库，于是新增行被插进中间（滚动位置之外），看起来就是「只有计数在涨」 | 已修（见 07 §7.14）：① `getComfyUiStatus()` 对合并结论做 10s TTL + 在途去重（`starting`/`stopping` 瞬时态不缓存，启动/关闭动作显式 `resetComfyUiStatus()`）；② `recordSlowQuery` 按 `(type, path)` + 60s 时间桶聚合，同桶只写首条、桶满写一条带累计次数的汇总；③ `LogEntry.seq` 记录**入库顺序**，`appendSorted` 按它合并批次，面板用它做自动滚动与「有新内容」判定，停在历史页时页脚显示「有新的日志 · 回到最新」；顺带把会话横幅里与相邻行只差 1 秒的重复时刻去掉 |
| 设置页 ComfyUI 状态**来回跳**：点「启动 ComfyUI」后先显示「正在启动…」，`comfyui-runtime.log` 里已经打出「ComfyUI 已就绪」，上面那格却**闪回「未运行」**，几秒后才变回「运行中」 | **空窗期的瞬时结论没人兜住**（2026-09-12 定位，ISSUE #442）：拉起动作与「确认到运行中」之间有一段空窗（拉起 → 端口绑定 → `/system_stats` 就绪），而 `comfyStatus` 每 5s 轮询一次。空窗里的那一问恰好会得到「进程表还没命中 + HTTP 也没通」——`st.starting`（进程内单飞锁）在「保存配置 → 拉起 → 探测确认」这段里并不总为真，`startComfy` 的本地 `comfyStarting` 也**没进状态行的判据**；`probing` 只在「查询失败」时为真，一旦某轮查询**成功但没命中**（Comfy Desktop 由 uv 起、命令行里没有 `main.py`）就直接落「未运行」。相邻轮次反复给出相反答案，状态行就在三句话之间跳 | 已修：判定层补两条判据（收在新增纯函数 `deriveComfyUiStatus`，见 `src/lib/comfyui/lifecycle-derive.ts`）——① **「启动中」有计时窗口** `COMFY_STARTING_WINDOW_MS = 12s`：从最近一次得出「正在启动」起算，窗口内不落「未运行」，覆盖单飞锁覆盖不到的空窗；② **「探明没在跑」的结论有黏滞期** `COMFY_NOT_RUNNING_HOLD_MS = 10s`：只有「真的查过进程表且没有任何查询失败、又一条都没命中」才算探明，相邻一轮的探针抖动（查询超时、环境反查没认出 uv 实例）证据更弱，不许改口。快照层新增 `didQueryProcTable` 字段把「查过没命中」（可信的「不在跑」）与「0 条候选、根本没查」（什么都不代表）分开——后者一律显示「检测中…」而不是「未运行」。启动 / 关闭动作与 `resetComfyUiStatus()` 会显式清掉两把标记（ISSUE #344 的「已经起来了还压着启动中」正是旧结论挡新事实）。回归测试见 `src/lib/comfyui/lifecycle.test.ts`（「启动等待期不闪回未运行」一组）与 `src/lib/comfyui/lifecycle-derive.test.ts` |
| 设置页 ComfyUI 状态**一直停在「正在启动…」**：ComfyUI 早就起来了（`127.0.0.1:8188` 在浏览器里能正常打开），设置页状态行却永远显示「ComfyUI 正在启动…」，启动日志里明确有「ComfyUI 已就绪（保活）：http://127.0.0.1:8188」 | **状态判定被「查不到进程」与「粘性缓存」两头堵死**（2026-09-11 定位，ISSUE #344）：① `resolveComfyBase()` 在**配置了 `comfyuiPath`** 且进程表里查不到该路径 `main.py` 时会**直接抛错**（`Configured ComfyUI instance is not running`），而 Comfy Desktop 的实例由 `standalone-env` 启动、命令行里没有 `main.py`，于是进程在跑也查不到 —— `probeComfyUi()` 被 catch 成「不可达」，**一次 HTTP 都没发出去**；② 同函数里「进程在、端口未绑定」的分支会把**配置地址写进 `_resolvedBase` 会话缓存**，ComfyUI 随后就绪（或落在偏移端口）时本进程仍沿用这个连不上的地址；③ 快照层把「进程在、端口未绑定」当成普通结论缓存 1.5s，叠加设置页 5s 轮询，两次采样很容易都命中同一份陈旧快照 | 已修：①`client.ts` 进程表未命中**不再抛错**，只记日志退回端口探测（「实例在不在」归 `status.ts` 的快照负责，`resolveComfyBase` 只回答「连得上哪个地址」）；②新增 `probeComfyBase()` **按次探测**（探测后还原会话缓存），`probeComfyUi()` 改走它，状态判定不再被粘性结论污染；③新增 `COMFY_UNBOUND_PORT_TTL_MS = 0`，「进程在、端口未绑定」的快照不缓存，端口一出现立刻翻页；④`getComfyUiStatus()` 拿到「启动中」结论时当场 `force` 复核一次快照再判；⑤判据链补第 5 级**环境反查**——Comfy Desktop 的 `standalone-env` 解释器常由 `uv` 托管（`%LOCALAPPDATA%\uv\python\cpython-*`），不在实例根下，「按实例根解释器路径查进程表」必然落空，现在顺 `<实例根>\standalone-env\pyvenv.cfg` 的 `home`/`executable` 反查真正在跑的解释器，并补一遍 `uv` 托管目录（认 `UV_PYTHON_INSTALL_DIR` 与平台默认位置，兼容 `<env>\python.exe`、`<env>\install\python.exe`），命中即判「在跑」；同时「配置路径 `main.py` 查询失败」不再提前终止判据链（只记 `unverified` 继续放宽），避免高负载下进程表超时把 Desktop 实例误报成「未运行」。回归测试见 `src/lib/comfyui/client.test.ts`、`src/lib/comfyui/status.test.ts`、`src/lib/comfyui/env-python.test.ts`、`src/lib/comfyui/lifecycle.test.ts` |
| **ComfyUI 已经在别的端口跑着（桌面里正开着，设置里的「端口」还是 8188），启动后日志仍报 error**：`[app] [comfyui] Cannot reach ComfyUI on :8188 or any of [8189, 8190, 8191, 8192, 8193]`。症状是「要 8188..8193 全检测一遍才能知道有没有在运行」（ISSUE #449） | **一句「没探到」被写成了「故障」**：`resolveComfyBase()` 把所有候选地址依次探完仍无人应答时记一条 `error`，而这条链路只认识「配置地址 + 就近偏移（+1..+5）」——实例落在别的端口（用户在 ComfyUI 侧自定义端口、另有一套启动方式、或配置里的端口与实例实际监听的不一致）时同样落空，「端口上有实例在应答」这个事实并不会让它提前返回（那是 `comfyui/status.ts` 进程级快照的职责）。叠加两个观测缺陷：① 文案只有一句「连不上」，既没写清**问过哪些地址**、也没说「这不代表实例没在运行」，用户无从判断该改端口还是该查进程；② 结果**不缓存**（这是对的——实例随时可能起来）却导致运行期每次提交 / 上传 / 状态轮询都重扫一遍并各写一条**内容完全相同**的日志，把面板刷屏淹没真正的现场 | 已修：① 该汇总行 `logger.error` → **`logger.warn`**，把「运行判据在状态行、本函数只回答这一批地址哪个能连」写进文案，并给出可行动作（实例落在其它端口就去 设置 → 创作后端 改「端口」）；② 候选清单显式化（`probeTargets` 出 URL）+ **补上 ComfyUI 窗口端口 :8000**（Comfy Desktop 同机常驻，命中时记一条「回落到窗口地址」的 warn），汇总行里逐个列出问过的地址；③ 同一批地址按**地址清单 + 协议**静默 60s（`shouldLogProbeMiss`，globalThis 单例，dev server 重启即自然重置），单次探测的判定逻辑不变。**复审（同 issue 追加：端口不该靠试）**：探测链路只认识那一批地址，配了实例路径也照样要一路试过去——端口本是「进程监听出来的」事实。已修：`resolveComfyBase()` 配了 `comfyuiPath` 时**先问进程**（新模块 `src/lib/comfyui/instance-port.ts`，判据链与 `status.ts` 同口径：`main.py` → 解释器候选 → setup 登记的启动器 → 环境反查），一次进程表查询 + 一次端口查询即得到「在不在跑」与「在哪个端口」，命中直连；查不到（未配路径 / 查询失败 / 未命中）才退回端口探测，缓存语义不变。设置页「ComfyUI 端口」文案改口径为「默认端口（启动时按它传 --port），实例已由别的方式跑起来时按进程实际端口连」。回归测试见 `src/lib/comfyui/instance-port.test.ts` 与 `src/lib/comfyui/client.test.ts`「先问进程事实」一组 |

| 保活（keepAlive）模式下 ComfyUI 启动日志面板空白（只有 spawn 行）；或启动中报「保活进程已退出」但 ComfyUI 后来其实起来了 | 四个因素叠加（2026-09-06 定位）：① Start-Process 拉起的进程没有 stdio 管道，日志无处可去；② 进程存在性查询（Get-CimInstance 全量枚举 ~3.4s，贴近 4s 超时）在冷启动高负载下超时被当「进程不在」；③ 查询里内嵌双引号（-Filter "Name LIKE…"）经 execFile argv → PS -Command 的引号转义链路变形，恒空匹配（进程活着也查不到）；④ 字面反斜杠 Replace 在同一链路里被吞，路径分隔符归一失效 | 已修：Start-Process 把 stdout/stderr 重定向到按次命名的 `log/services/comfyui-keepalive-<时间>.out/.err.log`，等待循环增量跟随进 runtime.log；进程查询改纯单引号 + `[char]92` 运行时构造反斜杠 + Where 内 Name 过滤 + 10s 超时；判死需**连续 2 次**查询都找不到进程 | 重启应用生效；完整启动输出在重定向文件里可整段查看 |

| 启动时 `dev-launcher.legacy.ps1` 报 `ParserError: Unexpected token '-Level'`（定位到 corepack prepare 分支的 Write-Log 行），启动中断 | Write-Log 调用里把命名参数 `-Level WARN` 误写进了字符串括号内：`Write-Log ("…" -Level WARN)`，PowerShell 把它解析成对字符串的无效操作符而报语法错（2026-09-07 定位，仅当 pnpm 版本不一致且 corepack prepare 失败触发） | 已修：右括号移到字符串后：`Write-Log ("…") -Level WARN`，让 `-Level` 成为命名参数。排查同类错误：`grep -nE '\("[^"]*" -Level' *.ps1` |
| 壳内打开 ComfyUI 报「Command open_comfyui_window not allowed by ACL」（壳已重编、命令已注册、`remote.json` 已加 `core:default` 仍如此） | 根因在 Tauri 2.11 起的安全变更（tauri fix#15266，随 2.11.0 合入）：远程源调用**应用自建命令**一律强制走 ACL，**必须先在 build.rs 用 `AppManifest::commands` 声明命令**（生成 `allow-<command>` 权限条目），否则即便 `remote.json` 的 permissions 有 `core:default` 也无法命中应用命令 → 无授权被拒。`core:default` 只放行 core 插件命令，不含应用自建命令。附带影响：一旦启用 AppManifest，本地 splash 的自建命令（get_launch_status/get_app_url/get_launch_log/navigate_to_app）也随之受 ACL 管控，需补 splash 的本地授权能力 | 三处配合：①`build.rs` 改 `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[...全部命令])))`；②`capabilities/remote.json` permissions 追加应用命令授权 `allow-open-comfyui-window` / `allow-activate-main-window` / `allow-should-activate-on-launch`（main 远程窗）；③新增 `capabilities/splash.json` 给 splash 窗授 `allow-get-launch-status`/`allow-get-app-url`/`allow-get-launch-log`/`allow-navigate-to-app`（本地命令，防 AppManifest 打开后 splash 也被拦）。**新增应用命令要三处同步**：`build.rs` 的 AppManifest 列表、`capabilities/default.json`（main 本地源）、`capabilities/remote.json`（main 远程源）——少一处就是运行期「not allowed by ACL」。改壳层配置/构建脚本，须重编：`cd src-tauri; cargo build --release --features custom-protocol` |
| **ComfyUI 页签打开了，里面却是一片空白**（地址栏/CSP 都正常、日志无报错、看不出任何失败原因） | **未开 CORS 的 ComfyUI 对跨源请求返回 403，而宿主页判不出来**（ISSUE #310；成因在 2026-09-12 更正）：ComfyUI 未开 CORS 时挂 `create_origin_only_middleware()`，对 `Sec-Fetch-Site: cross-site` 或「回环地址下 Host 域名 ≠ Origin 域名」的请求**直接 403**（反 CSRF）——iframe 内嵌正是跨源请求，403 响应体为空所以一片白。**注意：成因不是 `X-Frame-Options: DENY`**（ComfyUI 与 aiohttp 都不发这个头，上一轮记错方向，导致绕道去另开窗口）。宿主页跨源读不到响应头、iframe 事件也不带原因，所以必须由服务端探 | 已修（判据见 12 §12.8.2）：① **开关握在自己手里** —— ComfyUI 由本应用 spawn，`buildSpawnArgs` 统一注入 `--enable-cors-header`（`withEmbedClearanceFlag`，幂等），跨源不再 403 并回 `Access-Control-Allow-Origin`，正常路径下必然可嵌；② 探测模拟 iframe 视角（**带 `Origin`**），按 `403` / `Access-Control-Allow-Origin` / CSP / XFO 判读，拿不到放行证据时按不可嵌处理；③ **打开方式只剩两档且都在同一窗口**：可嵌 → 内嵌页签；不可嵌 → 仍在页签里渲染可读说明（`ShellTab.blockedReason` + `TabBlockedNotice`），**不再另开独立窗口、也不跳系统浏览器**（用户要求「只要多页签」）。回归：`src/lib/comfy-embed.test.ts`、`src/lib/comfyui/lifecycle-derive.test.ts`、`src/app/(main)/settings/hooks/use-settings-page.test.ts`、`e2e/critical-flows.spec.ts`（两条都断言不弹窗） |
| ComfyUI 页签打开了，但里面是 Edge 的 **「已阻止此内容。请与网站所有者联系以解决此问题。」**（探测判「可嵌」、地址也对、日志无报错；同一地址在浏览器里能正常打开） | **拦下它的是嵌入方页面自己的 CSP**（ISSUE #310）：应用级页签把 ComfyUI 内嵌进主窗页面，而 `next.config.js` 的 CSP **没有 `frame-src`**——回退到 `default-src 'self'` 后，跨端口（127.0.0.1:3100 → :8188）即跨源被拒。与上一行（403/XFO/CSP frame-ancestors）的区别：那些由**被嵌方**响应头执行、服务端探得到；这一条由**嵌入方页面**执行，探测侧永远「一切正常」 | 已修（见 12 §12.8.4）：`next.config.js` 的 CSP 加 `frame-src 'self' http://127.0.0.1:* http://localhost:*`（应用页放行内嵌本地 ComfyUI；`frame-ancestors 'none'` 反点击劫持不变）。**两条死路勿再走**：①exe 同级 `app.exe.manifest` 的 `per_app_arguments`（#445）——非 WebView2 官方机制，参数实测到不了浏览器进程，且 `build-launcher` 清空重建 `start-tauri/` 还会抹掉该文件，已移除；②`--disable-web-security`——只关同源策略、豁免不了嵌入方 CSP，实证无效，已放弃。改 CSP 后 dev server 需重启才生效（改 `next.config.js` 属「改了配置」，双击启动链路会自动重启 dev server）。门禁见 `tests/comfyui-embed-csp.test.ts`；不可嵌时页签说明里带地址供用户自查（`ShellTab.blockedUrl`） |
| **应用内的 ComfyUI 拖不进图片 / 工作流**（拖进去毫无反应；同一个 ComfyUI 在浏览器里整窗打开却可以；页签本身显示正常、日志无报错） | **宿主窗口的原生拖放处理器把 DOM 拖放事件吃掉了**（ISSUE #616）：宿主窗口默认挂 WebView2 的原生拖放处理器（wry 的 `drag_drop_handler_enabled` 默认 true）——Tauri 的 `disable_drag_drop_handler` 文档原文就是「This is required to use HTML5 drag and drop APIs on the frontend on Windows」。处理器一接手，Chromium 不再走自己的拖放路径，`dragover` / `drop` 不派发到 DOM，文件被换成 wry 的 `on_drag_drop` 回调，而本应用没有注册它。页签里的 ComfyUI 完全靠 `drop` 的 `dataTransfer.files`，所以「一点反应都没有」；**同一地址在浏览器里没有这层壳，所以拖放照常**——这条对照就是最快的判据 | 已修（见 12 §12.8.5）：主窗 builder 显式 `.disable_drag_drop_handler()`，把拖放交回 DOM。本应用**不消费**原生文件拖放（项目画布 / 工作流库的拖放都是页内拖元素的自定义 dataTransfer，壳侧也没有注册 `on_drag_drop`、没人监听 `tauri://drag-drop`），关掉是纯收益。**需重编 Rust 壳**（`cargo build --release --features custom-protocol`），只改前端跑旧二进制等于没改。门禁：`tests/comfyui-embed-csp.test.ts`。 |
| **工作流编辑器 / 画布整块白屏**，console 报 `ioApi.getState().xxx is not a function`（ISSUE #389） | **运行图落后于源码**：桌面壳长开时拉了新提交，页面没重载；store 实例在挂载时创建一次、其动作集合也随之定格，而动作本身会随热更新整体替换——旧实例缺少新声明的动作，直接调用抛错被 ErrorBoundary 接住。**注意**：源码里该动作是存在的（`tsc` 干净、单测通过），报错的是运行中的旧实例，不是代码缺陷 | 已修（两层）：① `callStoreAction` 把「能力不存在」当 L1 降级——跳过本次调用 + 一条可诊断告警，不再让一次时序问题把整块画布打白；② 新增「页面是否还跑着旧代码」的判据（`/api/dev/build-id`）与应用内通知（toast + 消息中心），把「重载一次即恢复」和「重载不会丢工作」直接讲给用户。见 §4.3 |
| **CI 的 E2E 起不来**：`Timed out waiting 180000ms from config.webServer`（本地 `pnpm start` 却像没事） | **`next start` 不认 `COMFYAPP_PORT`**：默认端口由 3000 改 3100 那次只改了 config/文档，`pnpm start` 仍回落 Next 默认的 **3000**，而 `webServer.url` 与 `baseURL` 都按 3100 等 —— 等满 180s 超时（2026-09-12 定位；同一处遗漏还让「本地手起生产服务」与配置对不上） | 已修：`pnpm start` 改为 `node scripts/start.mjs`，与 `scripts/dev.mjs` 对称（读 `.env` 的 `COMFYAPP_PORT`，再显式 `next start -p`）。**不要**把 `start` 改回裸 `next start`。参见 11 章 §11.3.1 |
| 设置页「打开查看 ComfyUI」弹出独立第 2 窗口且空白、无法关闭 | 旧方案用 Rust `open_comfyui_window` 在壳内另开一个 `comfyui` WebviewWindow；用户反馈这违背「像文件管理器多页签」的预期，且独立窗口可能空白/难关闭 | 已改为**同一主窗口内的应用级页签**（ISSUE #310/#200 又把页签搬到窗口标题行）：`shell-tabs-store` 管理页签，`ShellTabs` 在窗口顶部渲染页签栏，ComfyUI 以 iframe 内嵌。**「壳内独立窗口」兜底档此后已彻底移除**——用户明确要求「不要打开另一个窗口，我只要多页签的形式」；内嵌放行由启动参数 `--enable-cors-header` 保证（见上一行），判到不可嵌时也在**同一个页签**里给可读说明，不再弹窗。Rust `open_comfyui_window` 命令保留未删（无 UI 调用），避免动壳编译 |
| 页签栏占用了应用内的一块区域，而不是显示在窗口标题行（用户期望「像文件资源管理器那样」） | 应用内页签方案（上一条）只解决了「不另弹独立窗口」，页签栏仍渲染在**原生标题栏下方**，等于在应用内又占掉一条 40px 区域（ISSUE #310 / #200） | 已改为**自定义标题栏**：主窗口 `decorations: false` 关掉原生装饰，页签栏与标题行合并为同一条横条——页签 + 拖拽空白区 + 最小化/最大化/关闭。配套：①`TitleBarTabs` 渲染标题行，拖拽区用 `data-no-drag` 标记排除页签/按钮（点击不被拖拽吞掉），双击空白处最大化/还原；②窗口动作（`startDragging`/`minimize`/`toggleMaximize`/`isMaximized`/`close`）统一封在 `src/lib/window-controls-client.ts`（浏览器降级为空操作），最大化状态用 `onResized` 订阅同步；③`capabilities/{default,remote}.json` 各补 5 条 `core:window:allow-*` 权限；④浏览器 / dev 无原生标题栏可让位，`shouldUseTitleBarTabs` 判据退回应用内页签栏。**改的是 `src-tauri/src/**` 与窗口配置，必须重编壳**：`cd src-tauri; cargo build --release --features custom-protocol`。回归测试见 `src/lib/title-bar-derive.test.ts` |
| **打开全屏视图（设置 / 工作流编辑器 / 脚本编辑器 / 消息中心）后，页签整条消失、切不回其它页签** | **全屏视图仍按 `fixed inset-0` 铺满整个视口，把标题行（页签栏）盖住**（ISSUE #310 回归）：页签搬到窗口标题行之后，「全屏」的坐标系变了——标题行是**应用级 chrome**，任何视图都不该盖它；而应用内那些「全屏视图」的 `inset-0` 是相对**整个视口**定位的，于是页签被自己的视图盖掉，用户只能先关掉当前视图（实测：设置页打开后顶部只剩设置自己的 header，主应用页签不可见也不可点） | 已修：新增 `src/lib/full-screen-layer.ts`（判据）+ `src/components/studio/fullscreen/FullScreenLayer.tsx`（视图层），全屏视图的定位从 `fixed inset-0` 改为 `fixed top-title-bar right-0 bottom-0 left-0`——**让出标题行、铺满其下方的内容区**（`bottom-0` 必须显式，否则靠内容高度撑开、拉伸不到底）。接入点：`SettingsOverlay`（含 loading / error / 未就绪三态）、`WorkflowEditorInner`（loading / error / 主态）、`WorkflowCanvasEditor` 崩溃兜底、`WorkflowLibrary` 动态加载占位、`ScriptMarkdownEditor`、`MessageCenterPanel`、`WorkflowCanvasSettings` / `ProjectCanvasSettings` 抽屉、`ProjectOutputs` 元数据抽屉。**踩坑**：tailwind v4 只有 `--spacing-<name>` 命名空间能生成间距类，自定义名 `--title-bar-height` **产出 0 个类**（全屏视图会静默退回 `top:auto` 继续被盖住）——标题行高度因此定为 `--spacing-title-bar: 2.25rem`，`TitleBarTabs` / `InAppTabStrip` 的 `h-title-bar` 与全屏视图的 `top-title-bar` 同取这一处。回归测试见 `src/lib/full-screen-layer.test.ts` 与 `e2e/critical-flows.spec.ts`（「打开设置后应用页签仍可见可点」，用 `elementFromPoint` 断言顶部命中页签栏） |
| **打开居中弹窗（应用日志 / 执行日志 / 任务详情 / 模型库…）后，页签与右上角的关闭按钮被挡住** | **同一处回归的第二形态：首轮只改了「全屏视图」，弹窗类浮层仍是 `fixed inset-0`**（ISSUE #310 二次回归）。页签搬到窗口标题行后，任何铺满**整个视口**的浮层都会盖住标题行；而弹窗是全项目最通用的写法（25 个文件），逐个文件手改必然再漏——用户实测：打开「应用日志」后页签与右上角关闭按钮同时不可见、不可点 | 已修（判据与门禁见 12 §12.8）：① 全屏视图与模态弹窗统一经 `overlayClass(kind, extra)` / `fullScreenLayerClass(z, extra)` 取让位定位（顶部 `top-title-bar`），不再手写 `fixed inset-0`；② 接入 21 个浮层（应用日志、执行日志 ×2、任务详情、视频队列、模型库 / 标签、来源、删除工作流、产出预览、调试链路、`ModalDialog`、设置页两个弹窗、工坊 API 渠道 / LLM 上下文、节点设置、右键菜单 / 项目切换 / 种子模式遮罩、工作流库元数据编辑、`ui/dialog` 与 `ui/sheet` 遮罩）；③ **新增硬规则门禁** `scripts/check-title-bar-clearance.cjs`（pre-commit 第 3 步 + CI），`src/components/**`、`src/app/**` 里出现 `fixed inset-0` 即阻断，避免再靠人肉逐个文件翻。豁免仅 3 条（判据模块、注释引用、装饰背景层），见脚本内 `EXEMPT`。回归测试见 `src/lib/full-screen-layer.test.ts`、`tests/check-title-bar-clearance.test.ts`、`e2e/critical-flows.spec.ts`（新增「打开应用日志面板后应用页签仍可见可点」，已反向验证：改回 `inset-0` → 用例失败） |

| **安装包里带着开发机的密钥与数据库**（用户/评审都看不出来：构建不报错、CI 全绿、体积护栏也只挡 GB 级） | **产物卫生靠「剔除目录名」的清单，而这两样是文件**（ISSUE #489）：`next build` 把仓库根的 `.env`（Next standalone 的环境加载是**无条件复制**，`outputFileTracingExcludes` 实测删不掉）与 `db.sqlite`（动态路径 tracing）复制进 `.next/standalone`，`scripts/build-desktop.mjs` 的噪声清单只剔目录名 → 随 static 被编译期内嵌进 exe。**CI 不跑 `build-desktop`（也不该跑）**，而触发条件是「开发机有真实 `.env`」——正是 `run-local.ps1` 自动生成 `.env` 的那些机器 | 已修（§7.3）：`outputFileTracingExcludes` 补 `./db.sqlite*`（实测有效）与 `./.env*`（尽力而为）；新增 `scripts/standalone-private-inputs.mjs` 作剔除清单的单一实现，`pnpm build` 收尾与 `build-desktop` 组装后各剥一次；`scripts/check-standalone-contents.cjs` 的禁忌清单补「开发机私有输入 / 开发库文件」并把范围扩到 `src-tauri/static`；门禁见 `tests/dist-artifact-hygiene.test.ts` |
| **面板里的错误日志带着密钥原文**（pino 流里明明是 `[Redacted]`，落盘的 `app-runtime.log` 里却是明文） | **ERROR 镜像是一条独立落盘通道，不受 pino `redact` 保护**（ISSUE #489）：`src/server/lib/logger.ts` 的镜像在取不到 `msg`/`err.message` 时用 `JSON.stringify(payload)` 整包兜底；而 `REDACT_PATHS` 的 `*.secret` 只匹配「属性名恰好叫 `secret`」，`BETTER_AUTH_GITHUB_CLIENT_SECRET` 这类 `*_SECRET` 命名一条都不命中——pino 的通配语义也表达不了「名字含 secret」（`*secret`/`*_SECRET`/`*secret*` 实测全无效，`*` 会把整条记录连 `msg` 打成 `[Redacted]`） | 已修（规范 07 §7.18.2.1）：镜像不再整包透传（无可读文案时只输出键名清单），并新增**值形状守卫** `redactSecretShaped()`——在日志写入边界擦掉 PEM 私钥块 / JWT / 高熵串，不问字段名因而覆盖「名字无法穷举」的密钥；`Error` 保形 |
| **照文档 `cp .env.example .env` 走完，`pnpm dev` / `pnpm start` 仍然起不来** —— 输出里先出现 `- Local: http://localhost:<port>` 与 `✓ Ready in 77ms`，**之后**才抛 `Failed to load next.config.js` + `Invalid environment variables`（或 `MissingEnvFileError`）；提示里的小贴士还让去「双击 `tools/start/run-local.ps1`」（Linux / macOS 上不存在） | **两层叠加，且失败时机误导**（ISSUE #489）：① `.env.example` 里 `BETTER_AUTH_SECRET` 与两个 `BETTER_AUTH_GITHUB_*` 就是**空串**，而 createEnv 配了 `emptyStringAsUndefined: true` —— 空串等价于「没给」，于是照文档 cp 出来仍是 `Invalid environment variables`，看不出是「值留空」；Windows 侧一直有 `prepare-local-run.ps1` 第 4 步自动补齐，**Linux / macOS 没有任何等价物**。② `src/env.js` 的校验发生在 Next 加载 `next.config.js` 的阶段，而 Next 会**先**打印 Local 地址与 `✓ Ready` —— 用户读到的是「起来了但报错」，真相是端口无人监听。**只探首页会误判**：同族形态里「服务其实没起」比「起来后 500」更难分辨 | 已修（§9.1 / §9.2 第 6 条）：新增 `scripts/env-init.mjs`（`pnpm env:init`，与 `.ps1` 同口径生成随机密钥 + OAuth 占位值，幂等、不覆盖既有配置）与 `scripts/env-preflight.mjs`（`dev.mjs` / `start.mjs` 共用，**在起 Next 之前**判「文件在 + 三项非空」，失败即打印可行动作并非零退出 —— 不再出现「先 ✓ Ready 再崩」）；缺文件提示里不再夹带任何 `.ps1` 入口。回归测试见 `tests/linux-env-bootstrap.test.ts`（真跑两个脚本；反向验证：还原旧入口 / 去掉预检，对应用例必失败） |
| **standalone 起得来、页面全 200，但每个 API 路由都 500**（报错是 `Failed to load external module …/app-route-turbo.runtime.prod.js`，看起来像业务/数据库/鉴权问题） | **Turbopack 对动态 `require("next/dist/compiled/next-server/<name>.runtime.prod.js")` 字符串的追踪不完整**（ISSUE #489）：只追到被 middleware 图带上的 `app-page-turbo`，`app-route-turbo`（所有 `route.ts` 都要它）一条 `.nft.json` 都没有 → standalone 的 `next-server/` 只有 3 个文件（仓库里 74 个）。构建期静默、CI 只跑 build，而本仓库 `next start` 与 `output: standalone` 不兼容，**没有任何常规门禁会去启动 standalone** | 已修（§7.4）：`next.config.js` 顶层补 `outputFileTracingIncludes`（`./node_modules/next/dist/compiled/next-server/*runtime.prod.js`，实测 +26 文件 / ≈2.6MB，API 全恢复 200）；`tests/standalone-runtime-completeness.test.ts` 锁配置与产物缺件；`check-standalone-contents.cjs` 加**反向**检查「必须有的」运行时脚本 |
| **安装包里带着 `AGENTS.md` 内部规范全文与整套 `scripts/` 门禁脚本**（解包即得；产物护栏却报「✓ 产物干净」） | **产物卫生清单的漏项**（ISSUE #489，与上面「密钥进包」同源、同一通道）：护栏 `FORBIDDEN` 只列了 `docs/*.md` / `src/**/*.test.*` / `changelog.d/*.md` / `.env` / `db.sqlite*`，**根级 `.md`、各 `*.config.*` 与整个 `scripts/` 一条都不匹配**；`build-desktop.mjs` 的 `STATIC_NOISE` 又**只剔目录名**——这些是文件，于是随 static 被编译期内嵌进 exe | 已修（§7.3 末节）：`stripDevArtifacts` 走**白名单**（`scripts/` 只留运行时真的会读的那几个（`install-comfyapp-helper.ps1` + 编排器 `dev-launcher.mjs` 与其运行期依赖），新增脚本默认不进产物；嵌套条目逐项登记，禁止目录级放行），根级文件黑名单逐项点名；产物护栏加 `ALLOWED_SCRIPTS` 同款白名单 + 判据锚 `^` 不误伤 `node_modules` 里的同名 README/tsconfig |
| **`pnpm test` 随机非零退出**（`Test Files N passed` / `Tests M passed / 0 failed` 全绿，退出码却来自 `Unhandled Errors`；每次点名的文件都不同） | **游离的异步链路在用例结束后才 resolve/reject**（ISSUE #489）。已实测三处同族（都是「与报错点名的文件毫无关系」的失败）：① `use-model-library.ts` 的 `listQ.refetch().finally(() => setLoading(false))` 在 jsdom 环境拆除后才 resolve，触发 React 更新调度去读不存在的 `window`（`ReferenceError: window is not defined` @ `resolveUpdatePriority` / `dispatchSetState`）；② `use-custom-nodes-settings.ts` 的「完成后提示停留 800ms」`setTimeout` 同源；③ `runner-state.ts` 的 `schedulePersistLogs` **防抖定时器不属于任何生命周期**，清空内存 state 后仍在 200ms / 1500ms 后打到已 `vi.mock` 撤销的 repository（`TypeError: taskRepository.replaceLogs is not a function`）。`cleanup()` 只卸载组件、**不会取消已发出的 promise 与已排的 timer** | 已修：① 两处 hook 加卸载标记（先判存活再 setState）；③ 新增公共取消 API `cancelPersistLogs`，用例在 `beforeEach` **与** `afterEach` 两头都掐（只在 `beforeEach` 清，定时器会在「本用例结束后、下个 `beforeEach` 之前」的窗口里触发）。回归：`use-model-library.test.ts` 用「卡住回包 + 放行后记账」把偶发变**必现**（只统计更新调度栈的 `window` 读取，避开 react-query / tRPC 的 ambient 读取噪声），`reaper-decisions.test.ts` 锁「取消后不再有排期」。反向验证：还原任一实现即挂 |
**hook 里一条脱离组件生命周期的游离 promise 链**（ISSUE #489）：`src/components/studio/hooks/use-model-library.ts` 的 `listQ.refetch().finally(() => setLoading(false))` 在测试结束（jsdom 环境已拆）之后才 resolve，于是 setLoading 触发 React 更新调度、去读已不存在的 `window` → `ReferenceError: window is not defined`（`resolveUpdatePriority` / `dispatchSetState`）。`cleanup()` 只卸载组件、**不会取消这条已发出的 promise**。谁被点名只取决于谁的 MSW handler 回包慢一拍 → 报错文件每次不同（实测 65 轮里 4 轮，约 6%） | 已修：hook 加 `aliveRef` 卸载标记，`.finally` 先判存活再 `setLoading`；回归 `src/components/studio/hooks/use-model-library.test.ts` 用「卡住回包 + 放行后记账」把偶发变**必现**（只统计更新调度栈的 window 读取，避开 react-query/tRPC 的 ambient 读取噪声）。反向验证：去掉 aliveRef 判定 → 本条挂（0 vs 10） |
| **`pnpm test` 在仓库根新建 `log/` 并写入日志**（CI 上从无到有、开发者本机悄悄多几行，其中含用例的密钥标记行） | **用例直连真实日志路径**（ISSUE #489）：`src/server/lib/logger.test.ts` 的镜像用例 import 真实 `APP_RUNTIME_LOG` 用 `slice(before.length)` 读增量，`generate.test.ts` 的业务里程碑日志也落真实文件；镜像/日志是**真实写盘**副作用，不隔离就会写字 | 已修：`createPinoLogger({ mirror })` 支持注入镜像目标，两处用例都落到自己的 mkdtemp 目录；删掉 `log/` 跑 `pnpm test` 不再重建目录 |
| **双击 `run-local.ps1`（及其它任何走 `Invoke-Entry` 的入口）在打开逻辑脚本之前就报** `Invoke-Entry: …\tools\start\run-local.ps1:32` + `无法检索变量 '$NodeScript'，因为尚未设置该变量。`（ISSUE #564） | **入口公共库引用了一个从未声明的变量**（ISSUE #562 的跨平台重构留的坑）：`scripts/entry-common.ps1` 的 `Invoke-Entry` 里有一处 `if ($NodeScript) { … }`，而 `$NodeScript` 只是注释里的一个 `.PARAMETER` 说明——**从未进过 `param()` 参数表，也从未被任何入口传过**。本库顶部是 `Set-StrictMode -Version Latest`，这一档会把「引用不存在的变量」从 `$null` 升级成**终止性错误**；而这条判断在主路径上（不是 else 分支），于是 `run-local.ps1` / `verify-quality.ps1` / `run-tests.ps1` / `generate-docs.ps1` / `sync-lint.ps1` / `register-comfyapp-protocol.ps1` 等**每一个**走 `Invoke-Entry` 的双击入口都在调起逻辑脚本之前炸掉（报错还是英文函数名 + 内部变量名，用户完全看不出该做什么）。它躲过了所有门禁：`.ps1` 引用未声明变量**在解析期不报错**，只在实际执行到那一行才炸，而 `pnpm lint` / `tsc` / 结构门禁 R7-R8 都读不到它 | 已修：删掉这条从未接线的 分支与配套的 `Invoke-NodeEntry`——本库只认 PowerShell 逻辑脚本，要调 `.mjs`（如启动编排器 `scripts/dev-launcher.mjs`）的入口各自做薄壳（`scripts/dev-launcher.ps1` 是参考形态），在 `param()` 之外新增一个没人传的开关只会再养出一个同类地雷。库头注释补上「为什么不在这里支持 `.mjs`」。回归测试 `tests/entry-common-strict-mode.test.ts`：静态核 `param()` 声明的变量覆盖函数体引用的每一个变量（反向验证：还原旧文件即失败），并在有 PowerShell 的环境里**真跑**一次 `Invoke-Entry`，断言它走到自己的「未找到逻辑脚本」出口而不是被 StrictMode 终止 |

| **打开设置页时「安装形态」徽标迟迟不出现**：路径明明配好了，徽标却要等十几秒才冒出来；「端口 / 启动参数」输入框也在这段时间里亮着，随后才被隐藏 | **形态判定与运行态探测挤在同一个响应里**：`setting.comfyStatus` 先 `await getComfyUiStatus()`（进程表查询 + 端口探测 + 解释器反查；本机空载实测进程表一步 0.5s，负载下整条链到 10s 级，见 07 章 §7.14.2），而形态是纯文件系统判定（10 次 `existsSync`，实测 ≈1.4ms）却排在它后面，于是被整条链拖着走 —— 每 10s 一次的重探测会再拖一遍 | 已修：拆出独立查询 `setting.comfyInstance`（`src/lib/comfyui/instance-kind.ts` 的 `describeComfyInstance`，fs-only，含「路径是否已配」），设置页与首屏 `setting.get` 同批拉它（毫秒级），改路径 / 启动参数保存后 refetch；`comfyStatus` 只管运行态。回归：`src/app/(main)/settings/hooks/use-settings-page.test.ts`（让 `comfyStatus` 一直悬着 → 形态仍已就绪）与 `src/lib/comfyui/instance-kind.test.ts` |

## 6. 工具链钉死项（改之前必须理解原因）

| 位置                   | 配置                                   | 原因                                                                                                                                                    |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`  | `minimumReleaseAge: 0`                 | lockfile 锁定的新包会被 pnpm 默认 24h 年龄门槛拒装                                                                                                      |
| `pnpm-workspace.yaml`  | `allowBuilds`（6 个包）                | pnpm 未批准构建脚本时非交互 install exit 1                                                                                                              |
| `package.json`         | `packageManager: pnpm@12.4.1`          | 钉死 pnpm 大版本（corepack 经它切换）；`pnpm-workspace.yaml` 里无法识别的键在 12 下会**报错而非静默忽略**（`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`） |
| `pnpm-workspace.yaml`  | `verifyDepsBeforeRun: false`           | 隐式 install 在 dev server 运行期必然 EPERM                                                                                                             |
| `next.config.js`       | `experimental.useTypeScriptCli: false` | typescript6 别名无 bin/tsc，CLI 模式误报缺失并挂死请求                                                                                                  |
| `.githooks/pre-commit` | `pnpm exec`（非 npx）                  | npm 11.19 在本机损坏                                                                                                                                    |
| `package.json`         | typescript 双别名（TS6 API + TS7 CLI） | Next 检测不认识别名，类型正确性由 `pnpm exec tsc --noEmit` 门禁保证                                                                                     |

## 7. 构建流程

| 场景                                                                                      | 命令                                                                                                         | 说明                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只改了 Rust 壳 / 窗口配置 / 启动页                                                        | `cd src-tauri && cargo build --release --features custom-protocol`（Windows 上 `;` 亦可）                    | **必须带 `--features custom-protocol`**（见 §5「启动先看到 Edge 错误页」条目：不带会把启动页导航到 devUrl 且资源不内嵌）；增量编译约 1 分钟；启动器预检会提醒壳过期。注意：裸 `cargo build` 要求 `src-tauri\binaries` 已有 Node sidecar（`tauri.conf.json` 的 externalBin 在编译期被校验，缺失即 panic）——缺失时先跑一次 `tools\build\build-tauri-release.ps1` 自动补齐，见 §5 对应条目 |
| 生产构建（standalone + 安装包）                                                           | `tools\build\build-standalone.ps1` → `tools\build\build-tauri-release.ps1`（或 `tools\build\build-all.ps1`） | build-desktop.mjs 组装 static（含体积护栏 1.5GB）+ Node sidecar，再 `pnpm tauri build`；`build-all` 结束时报告各步与总耗时（见 §7.0）                                                                                                                                                                                                                                                   |
| 前端/standalone 体积分析                                                                  | `pnpm analyze` （`node scripts/analyze-bundle.mjs` → `ANALYZE=true next build --webpack`）                   |
| `@next/bundle-analyzer` 量化各 bundle 体积。**仅 webpack 支持**（Turbopack 不支持），默认 |
| `next build` 走 Turbopack 不受影响；因此分析时强制 `--webpack`。产物                      |
| `.next/analyze/client.html` / `nodejs.html` / `edge.html`，并监听                         |
| `http://127.0.0.1:8888` 可视化报告。`output: standalone` 以 webpack 构建时同样生效，      |
| 可量化独立 server 侧 bundle。用 Node 包装以兼容 Windows（内联 `VAR=cmd` POSIX 专属）。    |
| 重新打包双击启动器                                                                        | `tools\build\build-launcher.ps1`                                                                             | PyInstaller onedir，产物 `start-tauri/`（gitignore）                                                                                                                                                                                                                                                                                                                                    |
| 开发者工具箱                                                                              | `tools\build\rebuild-static.ps1` 等 / `dev-tools`                                                            | 见 `tools/README.md`                                                                                                                                                                                                                                                                                                                                                                    |

### 7.0 构建耗时报告（`tools/scripts/Log-Common.ps1`）

构建是一轮「按分钟到按十分钟计」的等待，构建者（尤其是双击入口的用户）需要在
结束那一刻看到「这一轮到底花了多久」。耗时口径统一收敛在构建脚本共用的日志库
`tools/scripts/Log-Common.ps1`：

| 函数                 | 职责                                                           |
| -------------------- | -------------------------------------------------------------- |
| `Start-LogStopwatch` | 起一个计时器（`System.Diagnostics.Stopwatch`）                 |
| `Format-Elapsed`     | 按量级格式化成 `45.6 秒` / `3 分 12.4 秒` / `1 时 02 分 03 秒` |
| `Log-Elapsed`        | 记一行「<标签> 耗时：<格式化用时>」，控制台与日志同落          |

三层各自报告，不重复计同一笔：

- **入口** `tools\build\build-all.ps1`：收尾前打印整轮总耗时（含子进程启动开销），
  双击场景里它是关窗口前最后读到的一行；失败时同样打印（判断是否直接重跑）；
- **编排层** `tools\scripts\build-all.ps1`：汇总里给出「总耗时」，任一步失败中止时
  也报出已用时间；各步耗时由子脚本自己负责，编排层不重复计；
- **子步骤** `build-tauri-release.ps1`（第 4/4 步 cargo build）/ `build-launcher.ps1`
  （第 3/3 步 pyinstaller）：在各自的完成汇总里给出本步耗时。

新增构建/工具脚本时直接复用这三个函数，不要各写一套 `Stopwatch`——格式漂成几种
就没法横向对比，汇总也对不齐。

### 7.1 构建前置检查：目标壳不得在运行（`tools/scripts/Build-Guard.ps1`）

`build-tauri-release.ps1` / `build-standalone.ps1` 在动手前 dot-source
`tools/scripts/Build-Guard.ps1`，调用 `Assert-ShellNotRunning` 检查
`src-tauri\target\{release,debug}\app.exe` 是否正被运行中的桌面壳占用：

- **陈旧壳自动回收后继续构建**：命中占用的壳先分类——「陈旧壳」（起它的启动器已
  退出，即无主孤儿壳；或连可执行文件路径都指不到本仓库的老式残留）与「非交互构建
  下的占用」（双击构建 / 由启动器拉起的后台构建，没人能按任意键确认）
  **一律 `taskkill /PID <pid> /T /F` 回收**（禁止单杀，见 §3）再复查，回收成功即
  继续构建。`-AutoCloseShell` 显式打开同样行为；
- **只有「用户可能正开着应用」才中止**（exit 1，日志给处置提示），不让整轮编译走到
  链接收尾才报 `os error 5`（见 §5 对应行）。判据是「本仓库启动器
  （`start-tauri*.exe`）仍在运行」——启动器会把壳重新拉起来顶上
  `target\release\app.exe`，这时杀掉现有壳只是把窗口连同用户的工作一起
  干掉，而且编译途中还会被新壳占用。中止日志因此额外点名「先结束启动器」；
- **构建前也要查启动器本身**：`Get-RunningLauncher` 按 exe 真实路径（`start-tauri/`、
  `start-tauri-dev/`、`start-tauri-standalone/` 三个产物目录）列出仍在跑的本仓库
  启动器，供上面的分类判据与中止提示共用。别按进程名判断——别处的同名进程不算；
- **判据是进程可执行文件的真实路径**，而不是进程名或命令行。预编译壳由
  预编译壳经 `ProcessStartInfo` 启动，`UseShellExecute=false` 时命令行里
  不含项目根路径——历史上清理残留壳用的 `CommandLine -like "*$root*"`
  因此并不可靠，这里不能照抄。`ExecutablePath` 取不到时退回命令行匹配（宁可多提示
  一次，也不要漏判后白跑构建）；
- 需要无人值守时用 `-AutoCloseShell` 自动 `taskkill /PID <pid> /T /F` 回收（**禁止**
  单杀，见 §3），回收失败仍返回 1；
- **判据宁严勿宽**：判成「有人正在用」最多让用户手动关一次窗口；判成「陈旧」却会在
  用户正开着应用时把它的窗口一起杀掉，所以「启动器在跑」一律当作「有人用」。

回归测试：`tests/check-file-structure.test.ts` 的「Build-Guard.ps1（构建前置守卫）」
用例用 PowerShell 打桩 `Get-CimInstance` 喂造数据，锁住「本仓库 target 下的 exe 命中 /
别处同名进程不命中 / 路径大小写差异命中」「陈旧壳被自动回收（发布什么 kill）」
「启动器在跑时不自动回收、改为中止」「非交互构建下自动回收」等规则
（非 Windows 平台自动跳过）。

#### 7.1.1 打包启动器前的占用检查：产物目录被启动器自己锁住（ISSUE #621）

`build-tauri-release.ps1` 守的是**编译产物**（`target\release\app.exe`）；打包
步骤守的是**另一个产物目录** —— `build-launcher*.ps1` 的产物是整个目录
（`start-tauri\`、`start-tauri-dev\`、`start-tauri-standalone\`，onedir 布局），
清理时要 `Remove-Item -Recurse -Force` 删掉整个目录树，其中用户态被占用的
`_internal\*.dll` 删不掉。

现场形态：用户双击启动器 → 看到「壳有更改」提醒（`stale_shell`，判据是壳源码比
`app.exe` 新）→ **关掉桌面窗口** → 跑 `build-all.ps1`。第一步（release 壳）顺利
编译完，第二步在 `[2/3] 清理旧产物` 就报「无法清理 start-tauri，可能被其他程序占用
（如 start-tauri.exe 仍在运行）」。用户关掉的是**桌面壳**，而启动器自己是**独立 exe**
（`start-tauri\start-tauri.exe`，onedir 布局，窗口是它绘制的），关窗不等于它退出 ——
提示因此既指不出是谁占着，给出的动作（去关窗口）也照做无效。

**第二种现场形态（判据二要解决的那个）**：启动器起过一次应用，编排器在「回收上一次
残留」这一步崩了（实测：编排器动态加载 `src/lib/process/kill-process-tree.ts` 的说明符
没跟着目录迁移改 → `ERR_MODULE_NOT_FOUND`），于是**没人回收它拉起的 dev server**；
启动器自己随后退出。此后跑 `build-all.ps1`，`Get-RunningLauncher` 查不到任何启动器，
第二步却照样在 `Remove-Item` 上失败 —— 因为 dev server 进程把
`start-tauri\_internal\VCRUNTIME140.dll` 映射在自己地址空间里。只按 exe 名 / 路径判断
在这里必然漏判，提示也就只能继续猜「是不是启动器没关」。

| 环节                     | 判据 / 动作                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检查时机                 | 打包脚本在**清理旧产物之前**（此时什么都还没删，中止零代价）                                                                                                                                                                                                                                                                                                                            |
| 判据一                   | `Assert-LauncherNotRunning` → `Get-RunningLauncher`：exe **真实路径**落在本仓库三个启动器产物目录内。别处的同名进程不算；`ExecutablePath` 取不到时退回命令行匹配（同 `Get-RunningShellProcess`，宁可多提示也不要漏判）                                                                                                                                                                  |
| 判据二                   | `Get-ProductDirHolder -Directory <产物目录>`：把「产物目录里的文件**映射进了哪个进程**」查出来。占用者不止启动器 exe 一类——启动器拉起的 dev server（`node` → `pnpm` → `next`）会继承启动器的 DLL 搜索目录，把 `_internal\*.dll` 映射进自己进程（实测：pnpm 侧的 `VCRUNTIME140.dll` 就取自产物目录），启动器异常退出后它们残留成孤儿，目录照样删不掉，而按 exe 名 / 路径判断一个都查不到 |
| 命中后的动作             | **中止**并点名 PID + 给 `taskkill /PID <pid> /T /F`，**不自动回收**；两类命中在**同一条消息**里一起报，省掉「杀掉启动器 → 重跑 → 又被告知目录还被占着」                                                                                                                                                                                                                                 |
| 为什么不像壳那样自动回收 | 壳有「无主孤儿」这条判据（起它的启动器已退出）；启动器没有——窗口就是它自己的，「关掉窗口」这个用户动作并不代表「放弃这个入口」。替用户杀掉他刚双击过的入口不合适。dev server 那一类同理：它可能就是用户正开着的那次启动的服务                                                                                                                                                           |
| 清理仍然失败时           | 统一走 `Write-ProductDirLockHint`：**真实异常文案**（`$_.Exception.Message`）+ 查出来的持有者（PID / 进程名 / 被映射的文件）+ 逐条 `taskkill /PID <pid> /T /F`。查不到持有者时才给「杀毒 / 索引服务正在扫描，或权限不足（提权残留的 pyinstaller）」的分流——旧实现把这条分流当成唯一解释，用户照做无效                                                                                   |

回归测试同样在 `tests/check-file-structure.test.ts` 的 Build-Guard 用例组里
（打桩 `Get-CimInstance` 与 `Get-Process`）：命中即 `CODE=1` 且点名 PID；别处同名
进程 + 无命中时 `CODE=0`；三个产物目录各自都能命中；**启动器已退出、只有 dev server
孤儿占着目录时同样 `CODE=1`**（并点名孤儿 PID，不重复点名启动器）；
`Write-ProductDirLockHint` 的输出里既有真实异常文案、也有查出来的占用者，
查不到人时才是「权限 / 杀毒」那条分流。

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

### 7.2 Turbopack「全项目追踪」告警：怎么读、怎么真修（ISSUE #489）

**告警长这样**（构建非阻断，但产物会被放大）：

```
./src/app/api/dev/build-id/route.ts:32:56
Warning: Dynamic filesystem access causes tracing of the whole project
  > 32 |   const st = fs.statSync(path.join(root, rel));
     |                                         ^^^^^^^^^^^^^
```

**第一件事：读高亮行，而不是读调用点。** 判据是**那条把路径算出来的表达式**
（`path.join` / `path.resolve` / 拼接字符串），不是消费它的 `fs.statSync`。
知道这点才能判断「注释该放哪、为什么放了没用」。

**第二件事：`turbopackIgnore` 在这里帮不上忙（实测口径）。** 它的语义是
"skip bundling a dynamic import"（只作用于 `import()` / `require()` /
`require.resolve()` / `new Worker()`）。对 `fs.*` 的动态路径访问，以下四种写法
**全部无效**（逐条实测，Next 16.3.2 + Turbopack）：

| 写法                                                           | 结果                                |
| -------------------------------------------------------------- | ----------------------------------- |
| `fs.statSync(path.join(/*turbopackIgnore: true*/ root, rel))`  | 告警照旧，高亮整个 `path.join(...)` |
| `const abs = /* turbopackIgnore: true */ path.join(root, rel)` | 告警挪到 `path.join` 那一行，照旧   |
| `const abs = path.join(root, rel); // turbopackIgnore`         | 同上，照旧                          |
| 注解做成模块级常量再 `path.join(...CONST, root, rel)`          | 同上，照旧                          |

> 结论：看到别人（或历史提交）说「加个 `/*turbopackIgnore: true*/` 就好了」，
> 先按上表验一遍——**仓库里现有的这些注解都是无效的**，不能作为「已修」的证据。

**第三件事：真正的防线是 `outputFileTracingExcludes`。** 它工作在**产物路径**层面
（next.config.js 顶层键，Next 16 起不再挂 `experimental`），不依赖 Turbopack 的静态
分析，因此对「动态路径访问」这种静态判不准的情况照样有效。本仓库已排除
`src-tauri/`、`python-venv/`、`tools/`、`docs/`、`e2e/`、`tests/`、`log/` 等
（体积护栏 1.5GB 也在这一条上）。

**第四件事：告警能不能「真减量」——取决于路径能不能静态收敛（实测判据）。**
Turbopack 的判据不是「有没有动态分量」，而是**路径表达式的最末一段是不是动态值**。
在 Next 16.3.2 上逐条实测（探针路由，只改一处、其余不动）：

| 路径写法（`cwd = process.cwd()`）                                | 告警   |
| ---------------------------------------------------------------- | ------ |
| `path.join(cwd, rel)`（动态段直接挂在锚点上）                    | **报** |
| `path.resolve(cwd, raw)`（同上，`raw` 来自环境变量）             | **报** |
| `` `${cwd}/${rel}` ``（模板串拼路径）                            | **报** |
| `path.join(cwd, "src", rel)`（字面量子目录 + 动态叶子）          | 不报   |
| `path.join(cwd, rel, "package.json")`（动态中间段 + 字面量叶子） | 不报   |
| `path.join(cwd, "package.json")`（全字面量）                     | 不报   |

> 也就是说：**这条告警只可能靠「让路径落到一个可命名的子目录」来消**，而本仓库
> 那 5 处（`api/dev/build-id` / `api/update-check` / `lib/comfyui/status` /
> `lib/db-schema-ready` / `server/workshop/db`）的动态段都来自**运行期事实**
> ——`process.cwd()`、`DATABASE_URL`、用户配置的 ComfyUI 解释器路径、HTTP 入参。
> 想让它们静态收敛，等价于**改路径契约**（例如把 `db.sqlite` 从仓库根挪进
> `db/` 子目录、把被观测源码清单改成固定常量）。那是产品/存储布局决策，不是
> Lint 级别的清理，**因此本仓库的处置是「不消警、以 `outputFileTracingExcludes`
> 兜住产物」**——告警的数量本身不构成缺陷，产物里有没有不该有的东西才是。

**第五件事：`outputFileTracingExcludes` 有一个已知盲区——`instrumentation` 不被应用。**
Next 的 include/exclude 是在 `collect-build-traces` 里**按 route entry 逐个**应用的
（`entryNameFilesMap` 的每一项），而 `instrumentation.js` 的 nft 追踪**不在这个表里**。
后果：本仓库 `src/log-paths.ts` 顶层用 `path.join(process.cwd(), "log")` 解析日志目录，
`src/instrumentation.ts` 在 import 期就把它拉到图上，于是 `log/**` 会被写进
`.next/server/instrumentation.js.nft.json`——**即使 `./log/**` 已在 excludes 清单里**。
判据与自查：

```bash
node -e "const j=require('./.next/server/instrumentation.js.nft.json');   console.log(j.files.filter(f=>/\/log\//.test(f)))"
```

命中即说明产物会带上这几份运行期日志（本仓库实测 6 个文件、几十 KB，量不大但
属于「运行期产物混进构建输出」）。这类泄漏只能靠**构建后的产物级检查**发现，
所以处置办法不是加注解，而是 `scripts/check-standalone-contents.cjs` 那条真数文件的
护栏（见下方「门禁」）。

**三条禁令**

1. **不要**用 `turbopack.ignoreIssue` 消这条警：它只过滤 CLI 输出与 overlay，
   **不改行为**——实测「配了 ignoreIssue + 把哨兵目录从 excludes 里摘掉」后哨兵
   照样回到 `standalone`。用它等于把信号关掉而问题留着（反模式 E9「降级不得静默」）。
2. **不要**为了消警去改动态路径的写法（拆 `path.join`、加中间变量、换 `resolve`）。
   高亮位置会跟着移动，告警一条不少，却把代码改得更绕。
3. **不要**在构建期模块图上给这类改动加无谓的包装（如给每个路径都套一层
   `map`/展开）。实测这会把 Turbopack 打到 Rust panic：
   `ModuleGraph::get_traces` / `there must be a path to a root`，整个
   `next build` 被 `Error: Panic in async function` 带走，`--debug` 也只丢一行
   `FATAL`、指不到业务原因。构建期模块图上的改动保持「最小、直接」。

**门禁**（两层：配置层 + 产物层）：

- **配置层** `tests/turbopack-tracing-excludes.test.ts`：锁 excludes 的完整性
  ——键位在顶层、关键目录清单不缺（含 `changelog.d/` 与 `src/**/*.test.ts`）、
  改动不静默失效，并断言 `turbopack.ignoreIssue` 没有拿来遮这条告警。
- **产物层** `scripts/check-standalone-contents.cjs`（CI 在 `pnpm build` 之后调用）：
  真去数 `.next/standalone` 里有没有测试文件 / 变更碎片 / 文档，命中即非零退出。
  为什么必须有这一层：「清单还在」不等于「清单生效」（历史事故：键位挂在
  `experimental` 下一个字都没被读），且上面第五件事那种 `instrumentation` 盲区
  只有数产物才看得见。产物不存在时该脚本跳过——它守的是构建结果，不是构建本身。

> 清单只锁「关键目录在不在」，不锁白名单全量：全量比对会在每次合理地新增排除项时
> 无谓变红，反而让人习惯性改测试。产物层那条才是真正的兜底。

### 7.3 分发产物卫生：开发机私有输入不得进包（ISSUE #489）

**症状与判据**（实测复现）：把仓库根的 `.env` 与 `db.sqlite` 留在检出里跑
`pnpm build`，两者都会出现在 `.next/standalone`：

```
.next/standalone/.env        1974 B   ← BETTER_AUTH_SECRET / GitHub OAuth 密钥，明文
.next/standalone/db.sqlite   328 K    ← 开发库，23 张表
```

而 `scripts/build-desktop.mjs` 的噪声剔除清单**只剔目录名**（`log` / `tests` …），
文件级不做处理 → 两者随 `src-tauri/static` 组装的产物被**编译期内嵌进 exe**。

**为什么这不是「多带了点文件」**：

1. `.env` 里的 `BETTER_AUTH_SECRET` 与 OAuth client secret 以**明文**随安装包分发，
   拿到包的人解包即得；
2. 壳以 `current_dir(res_dir)` 启动 sidecar（`src-tauri/src/lib.rs::spawn_sidecar`），
   而 `resolveDbPath` 按 `process.cwd()` 解析 `db.sqlite`（`src/server/db.ts`）
   —— 被带进包的开发库**就是**应用首次启动时读写的那个库，开发者本机的工坊数据 /
   设置会被当成出厂数据。

**为什么以前没被发现**：CI 不跑 `build-desktop`（也不该跑），而它的触发条件是
「开发机有真实 `.env`」——正是 Windows 上 `run-local.ps1` 会自动生成 `.env` 的那类机器；
`pnpm build` 本身也不会因此报错。

**两道防线**（实测口径，别想当然）：

| 手段                                                     | 对 `db.sqlite` | 对 `.env`   |
| -------------------------------------------------------- | -------------- | ----------- |
| `outputFileTracingExcludes`（`./db.sqlite*`、`./.env*`） | ✅ 有效        | ❌ **无效** |
| 构建后显式删除                                           | ✅             | ✅          |

`.env` 之所以拦不住：Next standalone 的环境加载是**无条件复制**的，
`./.env`、`./**` 下的 `.env` 都试过，文件照旧在。因此：

- **源头层**：`next.config.js` 的 `outputFileTracingExcludes` 补 `./db.sqlite*`
  与 `./.env*`（前者真拦，后者尽力而为）；
- **产物层**：`scripts/standalone-private-inputs.mjs` 是剔除清单的**单一实现**
  （`.env` 家族 + `db.sqlite*`，含 SQLite 的 WAL/SHM 边车文件），被两处复用 ——
  `package.json` 的 `build`（`next build && node scripts/standalone-private-inputs.mjs`，
  保证 `pnpm build` 自身产出的 standalone 就是干净的，**CI 只跑 build**）与
  `scripts/build-desktop.mjs`（组装 static 后再剥一次，唯一能覆盖 static 这一层的地方）。

**门禁**（配置层 + 产物层）：

- `scripts/check-standalone-contents.cjs` 的禁忌清单新增「开发机私有输入」与
  「开发库文件」，并把检查范围从 `.next/standalone` 扩到 `src-tauri/static`
  （后者更接近用户拿到的东西）。此前它对着含 `.env` 的产物照样报
  「✓ 产物干净」——**清单还在 ≠ 清单生效**，这次栽在清单本身的漏项上。
- `tests/dist-artifact-hygiene.test.ts`：锁「清单条目还在」「build-desktop 复用同一
  实现而不是各写一套」「`pnpm build` 自身收尾就剥离」。

> **新增会被打包的敏感输入时**（另一种 `.env` 变体、证书、token 缓存…）：先按上表
> 实测 `outputFileTracingExcludes` 是否真拦得住，拦不住就往
> `scripts/standalone-private-inputs.mjs` 的清单里加一项，并向
> `check-standalone-contents.cjs` 的禁忌清单补一条形状。**别只加 excludes 就当修好了。**

**同族缺陷：开发期文件与整套内部门禁脚本也在产物里**（同一轮实测）。全项目
tracking 还会带上仓库根的 `AGENTS.md`（内部协作规范全文）、`CHANGELOG.md`、
`README.md`、各 `*.config.*`（`eslint` / `playwright` / `vitest` / `drizzle` /
`prettier`）与 **整套 `scripts/`（46 个文件 / 544K，含 16 个 `*.cjs` 门禁脚本）**
外加 `scripts/__pycache__/`。这些随 static 被编译期内嵌进 exe，**解包即得**。
判断标准不是体积，而是**它们不可能是任何 server code 的运行时依赖**
（路由跑的是 `.next/server/**` 的编译产物）。

处理方式与私有输入同一条通道（`stripDevArtifacts`，`pnpm build` 收尾 +
`build-desktop` 各跑一次），但**清单形态不同**：

|            | 形态                            | 理由                                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------------------ |
| 根级文件   | **黑名单**逐项点名              | 根目录是「工程配置清单」，变动低频且显式                                 |
| `scripts/` | **白名单**（`RUNTIME_SCRIPTS`） | 脚本会不断新增；黑名单欠完备，漏掉是静默的（`db.sqlite` 就这么漏过一次） |

白名单当前只有两项，判据是「代码里能指到 `process.cwd()` + 路径拼接」：

- `install-comfyapp-helper.ps1` —— `src/app/api/helper/{install,status}/route.ts`
  把它当下载内容返回（`installerAvailable` 也靠它判）；
- `dev-launcher.mjs` —— `src-tauri/src/lib.rs::looks_like_project_root()` 的项目根判据。

产物层由 `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS` 白名单同款守：
**产物 `scripts/` 下的每个条目都必须是登记过的**（比正则形状更严，新脚本进来即命中）。
反向验证：把白名单条目从剔除实现里去掉重新 build，产物护栏立刻报出 44 个门禁脚本。

### 7.4 standalone 运行时完整性：Next 自带运行时脚本必须显式包含（ISSUE #489）

**症状**（实测复现）：`.next/standalone/server.js` 起得来、页面（RSC 渲染）与
middleware 全部正常，**但每一个 API 路由都 500**：

```
⨯ Error: Failed to load external module
  next/dist/compiled/next-server/app-route-turbo.runtime.prod.js:
  Error: Cannot find module '…/app-route-turbo.runtime.prod.js'
```

「首页 200、接口全 500」这个形态极具误导性：看起来像业务代码 / 数据库 / 鉴权
问题，实际是**产物缺文件**。

**根因**：Turbopack 对

```js
t.exports = e.x(
  "next/dist/compiled/next-server/app-route-turbo.runtime.prod.js",
  () =>
    require("next/dist/compiled/next-server/app-route-turbo.runtime.prod.js"),
);
```

这类**动态 require 字符串**的追踪是**不完整的**。实测 nft 清单里只有
`app-page-turbo.runtime.prod.js`（被 middleware 图带上），而
`.next/server/chunks/[root-of-the-server]__*.js` 里明确 require 了
`app-route-turbo`，且它**不在任何 `.nft.json` 的 files 里**。于是 standalone 的
`node_modules/next/dist/compiled/next-server/` 只有 3 个文件，而仓库里是 74 个。

**为什么常规门禁抓不到**：

- 构建期**不报错**（缺口是运行期才暴露的），CI 只跑 `pnpm build`；
- 本仓库 `next start` 与 `output: standalone` **不兼容**（Next 会打
  `"next start" does not work with "output: standalone"` 警告），也就是说
  **没有任何常规门禁会去启动 standalone 服务**；
- `pnpm dev` 走的是源码，不经过 standalone。

**修法**（`next.config.js` 顶层键）：

```js
outputFileTracingIncludes: {
  "/**": ["./node_modules/next/dist/compiled/next-server/*runtime.prod.js"],
},
```

补上是 26 个文件（≈ +2.6MB），实测 API 路由从「全 500」恢复为 200。

> **方向性提醒**：这条只能靠 `includes` 补。往 `outputFileTracingExcludes` 里
> 加东西是**反方向**的（excludes 只做减法，补不回缺失的文件）——
> `tests/standalone-runtime-completeness.test.ts` 有一条用例专门守这个方向。

**门禁**（配置层 + 产物层）：

- 配置层 `tests/standalone-runtime-completeness.test.ts`：锁
  `outputFileTracingIncludes` 在顶层、条目还在、且没有被人用 excludes 反着写。
- 产物层 `scripts/check-standalone-contents.cjs`：**反向检查**「必须有的」——
  逐个点名 `REQUIRED_RUNTIME_FILES`（`app-route-turbo` / `app-page-turbo` /
  `pages-turbo`），缺任一份即非零退出。这是该脚本里唯一一条「查缺件」而非
  「查多余」的规则，因为缺件的表现恰恰是运行期 500、而构建期静默。

> **自查一行**（产物已存在时）：
> `ls .next/standalone/node_modules/next/dist/compiled/next-server/` ——
> 只看到 3 个文件就是缺件。

---

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

| 层             | 位置                                                                    | 职责                                                                                        |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 入口（双击用） | `tools/<分类>/*.ps1`（启动类 `tools/start/`、构建类 `tools/build/` 等） | 定位项目根、打印中文提示、调用逻辑脚本、透传退出码、双击场景等待按键                        |
| 逻辑           | `scripts/*.ps1`、`tools/scripts/*.ps1`                                  | 环境检查 / 构建 / 编排 / 日志落盘                                                           |
| 公共库         | `scripts/entry-common.ps1`                                              | `Get-ProjectRoot` / `Get-Pwsh` / `Invoke-Entry` / `Complete-Entry` / `Test-IsDoubleClicked` |

> **根目录不再放双击入口**（ISSUE #29，2026-09-04）：6 个启动入口曾平铺在仓库根，与
> `package.json` / `tsconfig.json` 等工程配置混排，既看不出「哪些是入口」，也让根目录
> 随入口增长持续膨胀。现统一归入 `tools/start/`，与 `tools/build/`、`tools/registry/`、
> `tools/studio/` 同构；根目录只保留工程配置与文档。入口的 discoverability 由 README 的
> 入口清单承担，不靠「铺在根目录第一眼看见」。该约束由 `scripts/check-file-structure.cjs`
> 的 R9 规则在 pre-commit 阶段强制（详见 §12.8）。

入口映射（改逻辑时别改错文件）：

| 入口                                                                  | 逻辑                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tools/start/start-web.ps1`                                           | `scripts/dev-launcher.ps1`（入口）→ `scripts/dev-launcher.mjs`（编排）                          |
| `tools/start/start-tauri.ps1`                                         | 直接启动 `start-tauri\start-tauri.exe`（prebuilt，见 `scripts/start_tauri_launcher.py`） |
| `tools/start/start-tauri-dev.ps1`（隐藏窗口，原 `.vbs`）              | `scripts/dev-launcher.ps1 -Tauri` → `dev-launcher.mjs --mode tauri`                             |
| `tools/start/run-local.ps1`                                           | `scripts/prepare-local-run.ps1`                                                                 |
| `tools/start/verify-quality.ps1`                                      | `scripts/quality-gate.ps1`                                                                      |
| `tools/start/sync-lint.ps1`                                           | `scripts/sync-lint.ps1`                                                                         |
| `tools/start/register-comfyapp-protocol.ps1`                          | `scripts/install-comfyapp-helper.ps1`                                                           |
| `tools/start/start-desktop.ps1`（原 `run-desktop.bat`，自检逻辑内联） | —                                                                                               |
| `tools/build/*.ps1`                                                   | `tools/scripts/*.ps1`（同名）                                                                   |
| `tools/registry/start-registry.ps1`                                   | `tools/scripts/start-registry.ps1`                                                              |
| `tools/studio/start-studio.ps1`                                       | `tools/studio/start-studio.logic.ps1`                                                           |

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
5. **碰 `scripts/entry-common.ps1` 时遵守 StrictMode**（ISSUE #564）。本库顶部是
   `Set-StrictMode -Version Latest`：引用一个**没有声明**的变量（哪怕只是漏进了
   `param()` 之外的某处判断）**不是返回 `$null`，而是当场终止整个入口**。它躲得过
   所有门禁——`.ps1` 的解析期不报错，`pnpm lint` / `tsc` / 结构门禁都读不到——所以
   规则是：**只在 `param()` 里声明、只在函数体里用**，别在公共库留「以后可能会用到」
   的可选开关（历史上正是这么一个没人传的 `$NodeScript`，让全部走 `Invoke-Entry`
   的双击入口同时不可用）。回归测试 `tests/entry-common-strict-mode.test.ts`。

### 8.6 tools/ 目录分类（新增入口放哪）

| 目录              | 放什么                                                         | 现有入口                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools/start/`    | **启动/初始化类**：起 dev server、起桌面壳、环境自检、质量门禁 | `start-web.ps1`、`start-tauri.ps1`、`start-tauri-dev.ps1`、`start-desktop.ps1`、`run-local.ps1`、`verify-quality.ps1`、`sync-lint.ps1`、`register-comfyapp-protocol.ps1` |
| `tools/build/`    | **构建打包类**：编译壳、打启动器 exe、重建 static              | `build-all.ps1`、`build-launcher*.ps1`、`build-standalone.ps1`、`build-tauri-release.ps1`、`rebuild-static.ps1`                                                          |
| `tools/registry/` | 团队 shadcn Registry                                           | `start-registry.ps1`                                                                                                                                                     |
| `tools/studio/`   | 数据库工具                                                     | `start-studio.ps1`                                                                                                                                                       |
| `tools/scripts/`  | 上述入口对应的**逻辑脚本**（与入口同名不同层）                 | `build-*.ps1`、`start-registry.ps1`、`Log-Common.ps1`                                                                                                                    |

入口与逻辑同名时靠**目录**区分（`tools/build/build-all.ps1` 是入口、
`tools/scripts/build-all.ps1` 是逻辑）；同目录内无法同名时用后缀区分，如
`tools/studio/start-studio.logic.ps1`。

### 8.5 排障补充：双击 .ps1 只是打开了记事本

| 症状                                         | 根因                                                                             | 对策                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 双击入口用记事本打开了脚本、没有执行         | 未做文件关联（§8.3 的一次性前置没跑）                                            | 右键 `scripts/enable-ps1-double-click.ps1` →「使用 PowerShell 运行」                                                                                |
| 双击闪一下就没了，看不到报错                 | 入口已执行并快速退出；`.ps1` 退出后窗口随之关闭                                  | 入口在双击场景（父进程是 explorer）会自动暂停，见 `Complete-Entry`；若仍闪退说明脚本在收尾前抛异常，改用终端执行 `pwsh -File .\入口.ps1` 看完整输出 |
| 终端执行提示「禁止运行脚本」                 | 机器执行策略为 Restricted                                                        | `pwsh -ExecutionPolicy Bypass -File .\入口.ps1`（入口内部已自带该参数，直接双击不受影响）                                                           |
| 报 `无法检索变量 '$xxx'，因为尚未设置该变量` | 入口公共库在 `Set-StrictMode -Version Latest` 下引用了未声明的变量（ISSUE #564） | 把该变量补进 `param()`，或删掉这条没人传的分支——**不要**降级 StrictMode（它挡的是本来会静默取 `$null` 的错）。见 §8.4 第 5 条                       |

## 9. 跨平台模式（Linux / macOS，零 `.ps1` 依赖）

> 2026-09-14 制定（ISSUE #489），2026-09-15 扩到「启动全链路 + 桌面壳」
> （ISSUE #489 后续）。**适用范围**：在 Linux / macOS / CI 上开发前端、
> 业务逻辑，并构建桌面壳的人。
>
> - §9.1 纯 Web 链路（`pnpm dev` / `pnpm build` / `pnpm start`）
> - §9.3 桌面壳的跨平台构建与运行（`pnpm tauri build`）
> - §9.4 仍**未**解决的部分（comfy-cli venv、`.ps1` 启动链、e2e、保活语义）

### 9.1 这条链路怎么跑

```bash
pnpm install
pnpm env:init               # 必须：生成/补齐 .env（随机密钥 + 本地 OAuth 占位值）
pnpm db:push                # Drizzle 同步表结构（经 scripts/db-push.mjs，见下方「建库」）
pnpm dev                    # 经 scripts/dev.mjs 解析端口（缺省按检出路径推导）
```

**`.env` 引导（`pnpm env:init`）为什么不能只写 `cp .env.example .env`**：
`src/env.js` 的 createEnv 配了 `emptyStringAsUndefined: true`，而
`.env.example` 里 `BETTER_AUTH_SECRET` 与两个 `BETTER_AUTH_GITHUB_*` 正是
**空串** —— 空串等价于「没给」，于是照文档 cp 出来的人拿到的是
`Invalid environment variables`，看不出是「值留空」。Windows 侧一直有
`scripts/prepare-local-run.ps1` 的第 4 步自动补齐（随机密钥 + 占位值），
**Linux / macOS 此前没有任何等价物**。`scripts/env-init.mjs` 就是那份能力
（与 .ps1 同款口径：`BETTER_AUTH_SECRET` 用 64 位随机 hex、OAuth 两项填
本地占位值，其余行原样保留），幂等、不覆盖已有配置。详见 §9.2 第 6 条。

`dev.mjs` / `start.mjs` 在**起 Next 之前**做同一份预检（`scripts/env-preflight.mjs`）：
未就绪即打印可行动作并非零退出。这条是必需的——否则 Next 会先打印
`- Local: http://localhost:<port>` 与 `✓ Ready in 77ms`，**之后**才抛
`Failed to load next.config.js`：用户读到的是「起来了但报错」，而真相是端口
无人监听；且旧提示里的小贴士指向 `tools/start/run-local.ps1`（Windows 专属，
与本模式的零 `.ps1` 依赖相悖）。

**建库（`pnpm db:push`）为什么不能直接写 `drizzle-kit push`**：它在需要交互确认
时会在无 TTY 环境（CI、脚本、远程会话、容器）报 `Interactive prompts require a
TTY terminal` 后 **exit 0**，并把 `db.sqlite` 留成 **0 字节**。此时 `/`、
`/api/health` 都 200，只有真实业务路由 500（`no such table`）——**看起来通了**
比直接失败更难查（§9.2 第 3 条禁止的静默失败形态，历史上 `db:push` 就这么潜伏过）。
现在 `pnpm db:push` 走 `scripts/db-push.mjs`：

- 以 `--force` 运行（无交互、幂等；已有 schema 时输出 `No changes detected`）；
- **复核库里到底有没有表**——不看 drizzle-kit 的退出码（它在无 TTY 上正是
  「报错但 exit 0」，退出码在这条链路上不是事实来源）；
- 复核失败即**非零退出**并打印可行动提示，绝不把「留了个空库」当成功。

> `--force` 的语义是「自动批准会丢数据的语句」（drop column / 重建表等）。
> 首次建表与增量加表都没有丢数据的语句，无风险；但**当 schema 变更需要丢弃
> 既有数据时它会直接执行而不询问**——那时请先备份，或改用 `pnpm db:generate`
>
> - `pnpm db:migrate` 审阅 SQL 后再应用。

**三道防线一起看**（ISSUE #489 实测）：

| 时点 | 探针                                             | 空库时的表现                                                                             |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 建库 | `scripts/db-push.mjs` 数用户表                   | 非零退出 + 可行动提示                                                                    |
| 启动 | `scripts/dev.mjs` / `scripts/start.mjs` 探哨兵表 | 打印「表还没建 → 先跑 `pnpm db:push`」的 ⚠（**只警告不退出**：改纯前端的页面不该被挡住） |
| 运行 | `GET /api/health` 一并探 schema 就绪度           | 503 + `db: "empty"`（此前只探 `SELECT 1`，空库照样回 `db: up`，探针因此漏报整档）        |

全链路**不调用任何 `.ps1` / `pwsh` / `taskkill`**：

| 环节        | Linux 上的实现                                                                                                                                                                                                                                                                                                                                                                                          | 平台判断位置                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入口        | `pnpm dev` → `node scripts/dev.mjs`                                                                                                                                                                                                                                                                                                                                                                     | 无分支（Node 脚本本身跨平台）                                                                                                                                             |
| 完整编排    | `node scripts/dev-launcher.mjs`（预检 / 缓存 / 拉起 / 就绪 / 回收 / 进度快照，与 `.ps1` 同契约）                                                                                                                                                                                                                                                                                                        | §3.3；平台机制差异只在这一处                                                                                                                                              |
| 端口        | `.env` → 路径推导（3200~3999）→ 兜底 3100                                                                                                                                                                                                                                                                                                                                                               | `scripts/app-port.mjs`，规范化只对相对路径 resolve（§1.1）                                                                                                                |
| 进程树回收  | `process.kill(-pid)` 杀进程组                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/process/kill-process-tree.ts`（§3.1）                                                                                                                            |
| 进程探测    | POSIX：`ps -eo pid,args` 查命令行；监听端口用 `/proc/net/tcp{,6}`（LISTEN 的 socket inode）∩ `/proc/<pid>/fd` 的 `socket:[…]`（**POSIX 侧不依赖 `lsof` / `ss` / `netstat`** —— 很多发行版默认不装，缺它时探测会静默返回 null，正是 §9.2 第 3 条禁止的形态）。Windows：`Get-CimInstance Win32_Process -Filter`（进程名过滤下推到 WMI，不做全表枚举）查命令行；监听端口用系统自带的 `netstat -ano -p TCP` | `src/lib/comfyui/proc-detect.ts`。Windows 侧的两条都用系统自带能力且**不额外起 PowerShell 查端口**，与启动器侧 `scripts/launcher-core/procs.mjs` 的 `netstat -ano` 同口径 |
| 解释器发现  | `.venv/bin/python3` / `.venv/bin/python` + `lib/python3.x/site-packages`                                                                                                                                                                                                                                                                                                                                | `src/lib/comfyui/launch-path.ts`                                                                                                                                          |
| 打开浏览器  | `xdg-open`                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/open-in-browser.ts`                                                                                                                                              |
| Ollama 关闭 | `pkill -TERM -x ollama`                                                                                                                                                                                                                                                                                                                                                                                 | `src/app/api/llm/ollama-stop/route.ts`                                                                                                                                    |

### 9.2 平台判断的统一约定

新增任何「只在一个平台成立」的依赖时，按下面三条落位，不要散在各处：

1. **判据收在一处**：进程树机制 → `src/lib/process/kill-process-tree.ts`；
   解释器可执行名与目录布局 → `src/lib/comfyui/launch-path.ts` 的
   `INTERPRETER_NAMES` / `venvDirs`。调用方表达意图（「回收这棵树」、
   「找解释器」），不自己摸 `process.platform`。
2. **不引入发行版可选的二进制**：`lsof` / `pstree` / `pwsh` 都可能不在。
   优先用 Node 内建（`process.kill`、`fs`、`os.homedir()`）。
3. **失败路径要有出口**：平台不支持某项能力时，给可行动的提示
   （如「请在 ComfyUI 自己的终端里关闭」），不要静默返回 null —— 静默失败
   比抛错更难排查（§5 多条事故同源）。
4. **不依赖 TTY**：任何会被 CI / 脚本 / 容器调用的命令，都要在
   `stdin`/`stdout` 不是终端时也能给出确定结果。`drizzle-kit push` 无 TTY 时
   「报错 + exit 0 + 留空库」正是这条的反例（见 §9.1 建库）；判据落在
   `scripts/db-push.mjs`。新增这类封装时，**结果复核不要看退出码**——
   以「目标状态是否真的达成」为准。
5. **默认端口只定义一次，两侧共用同一常量**（ISSUE #534 P1）：ComfyUI 的默认
   端口（`COMFYUI_DEFAULT_PORT`，`src/lib/app-settings.ts`）同时被**连接侧**
   （`client.ts` 的 `resolveComfyBase()`）与**拉起侧**（`lifecycle.ts` →
   `buildSpawnArgs` 的 `defaultPort`）读取，视图文案也要显示它。此前连接侧硬编码
   8188、`lib/core/config.ts` 的 schema 默认值又写了一遍裸地址，几处从未对过——
   单看每一处都「没毛病」，这正是它能潜伏的原因，而分叉的表现是**静默连到另一个
   实例**（用户读到的是上传失败 / 端口漂移）。门禁
   `scripts/check-comfyui-port-contract.cjs`（pre-commit 与 CI）把这条变成可失败
   的断言：常量单点、两侧共用、`buildSpawnArgs` 的 `>0` 口径、源码无裸端口字面量。
   回归测试见 `tests/comfyui-port-contract.test.ts`（契约）与
   `tests/check-comfyui-port-contract.test.ts`（门禁自身）。
6. **`.env` 的生成与预检走跨平台入口，不依赖 `.ps1`**（ISSUE #489）：
   生成/补齐用 `scripts/env-init.mjs`（`pnpm env:init`，与 Windows 的
   `prepare-local-run.ps1` 第 4 步同口径），预检用 `scripts/env-preflight.mjs`
   （`dev.mjs` / `start.mjs` 共用）。三条判据缺一不可：
   - **空串等于没给**：`src/env.js` 配了 `emptyStringAsUndefined: true`，
     所以 `.env.example` 的 `KEY=""` 不能算「已配置」——判据必须查「非空」，
     只看「文件在不在」会让 `cp .env.example .env` 被误判为就绪；
   - **预检必须在起 Next 之前**：否则 Next 先打印 `✓ Ready` 再抛错，用户读到的是
     「起来了但报错」，而端口其实无人监听（同族形态见 §5「先 ✓ Ready 再崩」）；
   - **提示里不得出现 Windows 专属入口**：旧实现在缺文件时提示「双击
     `tools/start/run-local.ps1`」，与本模式的零 `.ps1` 依赖直接矛盾。
     回归测试见 `tests/linux-env-bootstrap.test.ts`（含真跑 `env-init.mjs` 与
     `dev.mjs`，反向验证：还原旧入口/去掉预检，对应用例必失败）。

### 9.3 桌面壳的跨平台（`pnpm tauri build`）

壳侧此前**整条都是 Windows 独占**：`Cargo.toml` 的 `windows` crate 是无条件
依赖、`mod single_instance` 无 cfg 门控、sidecar 写死 `node.exe`、
`kill_sidecar` 写死 `taskkill`、`resolve_project_root()` 校验
`dev-launcher.ps1` 是否存在（Windows 入口文件）。四项都会在 Linux / macOS 上直接炸：

| 症状                                                                     | 根因                                                                                 | 现在的判据                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error[E0425]: cannot find type IMarshal in windows_core::imp`           | `windows` crate 无条件依赖；`windows-future` 子 crate 在非 Windows 上没有该 COM 接口 | Cargo 的 `[target.'cfg(windows)'.dependencies]`                                                                                                                                     |
| `mod single_instance` 编不过 / 单实例失效                                | 模块只有 Windows 实现（`CreateMutexW` / `CreateEventW`）                             | 模块内 `#[cfg(windows)]` / `#[cfg(not(windows))]` 双实现，调用点不分叉                                                                                                              |
| ``resource path `binaries/node-x86_64-unknown-linux-gnu` doesn't exist`` | `build-desktop.mjs` 只产出 `node-<triple>.exe`                                       | `sidecarFileName()`（Node 侧）与 `sidecar_binary_name()`（Rust 侧）同一判据                                                                                                         |
| 壳退出后 sidecar 与 next-server 仍在跑                                   | `kill_sidecar()` 是 `taskkill`，在 POSIX 上等于不执行                                | 两道：`tauri-plugin-shell` 的 `CommandChild::kill()`（跨平台机制由插件选）**加上** `scripts/reap-process.mjs` 的统一回收（Node 之下的 next-server / worker 才是真正会残留的那几层） |
| 启动页一直转圈、`log/shell/` 为空                                        | `resolve_project_root()` 只认 Windows 入口文件 → POSIX 上恒返回空串                  | `looks_like_project_root()`：`package.json` + `scripts/dev-launcher.mjs`（编排器的唯一实现）                                                                                        |

**sidecar 的命名判据必须两处同源**：`bundle.externalBin` 声明的是「无后缀
basename」，打包器按目标三元组找 `node-<triple>[.exe]`，打进资源后按平台补
`node.exe` / `node`。只改一处会得到「编译期 panic」或「编过了但运行时找不到
sidecar」两种不同形态的失败。

**POSIX 单实例为什么不是 `flock`**：锁随**文件描述符**存活，而壳要在启动早期
判定、之后长期持有——fd 被 fork 出的子进程继承或意外关闭时锁会静默失效。
改成「`run/shell-<检出哈希>.pid` 写 PID + `kill(pid, 0)` 存活探测」后判据是
**可读的**：崩了留下的锁文件被判定为陈旧并覆盖。二次启动经 `SIGUSR1` 请首实例
把窗口带到前台（Windows 侧是 `SetEvent`，同一语义两条通道）。

**安全边界**：shell 插件只在 Rust 侧使用，caps 里**不授**
`shell:allow-execute` / `shell:allow-spawn` —— 前端窗口拿不到任意命令执行能力。

实测（本机 Debian 12）：`cargo build --release --features custom-protocol`
从「复现 IMarshal 失败」变为 `Finished`（零 warning），
`cargo test --release` 4 项通过；`cargo check --target x86_64-pc-windows-msvc`
的资源校验也按 `node-x86_64-pc-windows-msvc.exe` 通过（Windows 侧命名未回归）。
回归测试：`tests/cross-platform-launcher.test.ts`、
`src/lib/process/kill-process-tree.windows.test.ts`。

### 9.4 这个模式**仍不**解决的问题（别误当成完整跨平台支持）

- **`.ps1` 入口**：`tools/**/*.ps1` 是 Windows 的**双击/打包入口**（定位项目根、
  中文提示、拉起逻辑）。**启动编排不在这里** —— 那是 `scripts/dev-launcher.mjs`
  （§3.3），`scripts/dev-launcher.ps1` 只是它的 Windows 调用入口。因此
  「POSIX 上跑 `.ps1`」既无必要也无意义：Linux / macOS 直接 `pnpm dev` 或
  `node scripts/dev-launcher.mjs`。仍有 Windows 专属语义的是**双击交互模型**
  （资源管理器双击、启动器 exe 的 Win32 启动画面）。
  **但「跑不了 `.ps1`」不等于「这个动作在 POSIX 上没有」**：日常动作（质量门禁 /
  只跑测试 / 生成文档 / 端口自检 / `.env` 引导 / 建库）都有 `.mjs` 等价实现与
  `pnpm` 脚本，见 §9.5 的对照表 —— 那张表由
  `scripts/check-ps1-consistency.mjs` 守着，缺一侧会在提交时被拦下。
  真正仍无 POSIX 等价的只有下面几条（**它们是入口形态问题，不是逻辑问题**）。
- **comfy-cli 的 venv**：由 `scripts/setup-comfy-cli-venv.ps1` 建
  （Windows 侧），Linux / macOS 上需手工准备；解释器发现与进程探测本身
  已支持 POSIX 布局（§9.1）。这是**仍待补的缺口**（该脚本尚未跨平台化），
  不是「设计上不需要」。
- **打包类入口**（`tools/build/**`）与 **本机固定目录的 Registry**
  （`tools/registry/start-registry.ps1`）：前者靠 Rust / PyInstaller 工具链且面向
  Windows 分发，POSIX 上按 §7 的等价 `pnpm tauri build` 等命令直接跑；后者指向
  开发机上一个固定路径，没有可移植的语义。
- **「保活」模式的 POSIX 语义**：`src/lib/process-launch.ts` 的 keepAlive
  分支在 POSIX 上未经真机回归（Windows 侧走 `powershell Start-Process` 中介）。
- **e2e（Playwright）**：需要浏览器与显示环境；无头容器里需自行准备。
- **双击入口**：POSIX 没有「双击 `.ps1`」这种交互模型，Linux / macOS 侧的入口
  是 `pnpm` 脚本与 `scripts/dev-launcher.mjs`（README「快速上手」已按平台分列）。

### 9.5 跨平台动作对照表（`.ps1` 与 `.mjs` 不许分叉，机器强制）

§9.4 说明了 `.ps1` 入口「在 POSIX 上跑」既无必要也无意义——但这件事有个必须
堵住的副作用：**同一个动作在两侧各有一份实现**，而「记得同步另一侧」全靠自觉。
启动编排已经栽过一次（Windows 一条 `.ps1` 链、POSIX 一条 `.mjs` 链，各自演进，
最终 Windows 侧的端口口径、端口占用回收、就绪等待与收尾命名四项都与 POSIX 侧
不同，见 §3.3）。因此其余动作一律**照着同一个形态办**：跨平台逻辑只有一份 `.mjs`，
`.ps1` 是它的 Windows 调用入口；有 `.ps1` 而无 `.mjs` 的动作则改写为「`.ps1` 调
`.mjs`」，`.ps1` 只留「定位 → 转交 → 透传退出码 / 收尾」。

**对照表**（新增动作两处都要加：这里 + `package.json` 的一条脚本）

<!-- cross-platform-pairs -->

| 目的                                                 | Windows 双击入口                                                         | 跨平台入口（Linux / macOS / CI）                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动开发环境（完整编排）                             | `scripts/dev-launcher.ps1`                                               | `scripts/dev-launcher.mjs`（`pnpm dev`）                                                                                                             |
| 质量门禁（typecheck / lint / test）                  | `scripts/quality-gate.ps1`                                               | `scripts/quality-gate.mjs`（`pnpm check:all`）                                                                                                       |
| 只跑测试（排除基线失败 / `-Full`）                   | `scripts/run-tests.ps1`                                                  | `scripts/run-tests.mjs`（`pnpm test:file` / `pnpm test:full`）                                                                                       |
| 生成原文文档（doc:check + doc:render）               | `scripts/generate-docs.ps1`                                              | `scripts/generate-docs.mjs`（`pnpm doc:gen`）                                                                                                        |
| 端口推导跨语言自检                                   | `scripts/check-app-port-vectors.ps1`                                     | `scripts/check-app-port-vectors.cjs`                                                                                                                 |
| 生成 / 补齐 `.env`                                   | `scripts/prepare-local-run.ps1`（第 4 步）                               | `scripts/env-init.mjs`（`pnpm env:init`）                                                                                                            |
| 建库（Drizzle 表结构同步）                           | `scripts/prepare-local-run.ps1`（前置）/ 启动器预检 8                    | `scripts/db-push.mjs`（`pnpm db:push`）                                                                                                              |
| `pnpm` 可用性自检与修复（工具链门禁的独立入口）      | `scripts/prepare-local-run.ps1`（第 2/3 步）                             | `scripts/check-pnpm-available.mjs`（`pnpm check:toolchain`）                                                                                         |
| `src/lib` 的 Node-only 声明与可达性（规范 §18.4）    | `scripts/prepare-local-run.ps1`（跑门禁链时一并执行）                    | `scripts/lib-node-only-scan.mjs`（`node scripts/lib-node-only-scan.mjs`，契约测试 `tests/lib-node-only-declarations.test.ts`）                       |
| UI 基元复用棘轮（规范 16 §16.2.3）                   | `scripts/prepare-local-run.ps1`（跑门禁链时一并执行）                    | `scripts/check-ui-primitives.cjs`（`pnpm ui:primitives`，契约测试 `tests/check-ui-primitives.test.ts`）                                              |
| 浮层层级刻度棘轮（规范 16 §16.2.5）                  | `scripts/prepare-local-run.ps1`（跑门禁链时一并执行）                    | `scripts/check-overlay-z.cjs`（`pnpm ui:overlay-z`，契约测试 `tests/check-overlay-z.test.ts`）                                                       |
| prettier 格式棘轮（规范 §13.5 / ISSUE #575 第 9 项） | `scripts/quality-gate.ps1`（`-Mode format`）                             | `scripts/check-format.cjs`（`pnpm format:ratchet`，契约测试 `tests/check-format.test.ts`）                                                           |
| 格式化提交与行为改动分离（规范 §13.5）               | `scripts/quality-gate.ps1`（`-Mode format`）                             | `scripts/check-reformat-only.cjs`（`pnpm format:reformat-guard`，契约测试 `tests/check-reformat-only.test.ts`）                                      |
| `src/lib` 的零消费值导出棘轮（规范 §12.16）          | `scripts/prepare-local-run.ps1`（跑门禁链时一并执行）                    | `scripts/check-dead-exports.cjs`（`node scripts/check-dead-exports.cjs`，契约测试 `tests/check-dead-exports.test.ts`）                               |
| pnpm 可执行形态的唯一出口（规范 §2.1.1 / §2.1.7）    | `scripts/prepare-local-run.ps1`（第 2/3 步经它）                         | `scripts/launcher-core/shell.mjs`（`pnpmInvocation` / `runPnpmSync`，契约测试 `tests/dev-launcher-toolchain-gate.test.ts`）                          |
| 依赖表结构自愈（Drizzle push 失败后补列 / 补索引）   | `scripts/dev-launcher.ps1`（schema 同步阶段）                            | `scripts/heal-db.cjs`（被启动链路的 schema 同步阶段调用）                                                                                            |
| 接上提交门槛（`core.hooksPath=.githooks`）           | `scripts/prepare-local-run.ps1`（由 `pnpm install` 的 postinstall 触发） | `scripts/install-git-hooks.mjs`（`node scripts/install-git-hooks.mjs`；postinstall 逐字调用它，契约测试 `tests/postinstall-cross-platform.test.ts`） |

**为什么 `.mjs` 里不写中文**：门禁/构建期模块会经 Next 的 `next-code-frame` 渲染，
而它按**字节**切串——高亮区间端点落在多字节字符内部时 Rust 侧直接 panic、整个
`next build` 被带走（AGENTS 硬规则 15 / §5）。因此 `scripts/*.mjs` 的错误文案用
`[ERROR] …` 的英文短句，中文提示放在 `.ps1` 入口与文档里。

**门禁**：`scripts/check-ps1-consistency.mjs`（pre-commit 与 CI，规范 §12.8 的
提交防线）核两件事：

1. 本表登记的每个脚本**真实存在**（表被删空、或登记了不存在的路径 → 失败）；
2. **会「静默失效」的清单不许各写一份**：`KNOWN_FAILED_FILES`（已知基线失败）
   只能定义在 `scripts/quality-gate-shared.mjs`，两侧的 `.ps1` 只能是**读取**它。
   此前它定义在 `quality-gate.ps1` 里、由 `run-tests.ps1` 正则解析 `.ps1` 源码
   —— 那等于把另一门语言的源码当数据源，改一次写法就静默返回空数组，而
   「排除项悄悄为空」看起来就像「本来就没有基线失败」（红/绿不再可归因）。

回归测试见 `tests/ps1-consistency.test.ts`。

### 9.6 注释语言与「纯 ASCII 模块」白名单（ISSUE #678，机器强制）

**判据一句话**：注释一律中文；**只有「会被 `next-code-frame` 渲染到」的构建期模块**
例外（英文注释并保持纯 ASCII），其余地方写英文注释即违规。

**为什么需要例外**：§5 那条 Rust panic 的根因是 **Next 的 code frame 按字节偏移切串**，
高亮区间端点落在多字节字符内部时直接 panic，整个 `next build` 被一个与业务无关的
错误带走（触发是**偏移敏感**的，同一文件删掉中文能过、换个长度的中文又能复现）。
所以「注释一律中文」这条规则在构建期模块图上**不能一刀切** —— 一刀切下去的表现是
「文档要求中文、构建偶尔随机崩」，而下一个人只会看到那个 panic。

因此规则拆成两半，口径各自唯一：

| 位置                                                                   | 注释语言 | 判据                                                      |
| ---------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| 常规模块（业务 / 测试 / 脚本 / 文档）                                  | **中文** | 规范 12 §12.4.6 的 ASCII 比例棘轮（只许降不许升）         |
| 「纯 ASCII 模块」：会被 `next-code-frame` 渲染到的构建期模块图上的模块 | 英文     | 文件头一条说明注明原因；白名单登记在 `reference-facts.md` |

**白名单当前只有三个文件**（名单越短越好，新增必须能说出「它为什么会被 code frame
渲染到」）：

| 文件                              | 为什么在名单里                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/db-schema-ready.ts`      | 构建期被加载（reaper 的模块级副作用先经它判就绪），且确实是报错现场          |
| `src/server/db.ts`                | 每条路由的模块图都拉到它，实测被 code frame 渲染（`resolveDbPath` 那次报错） |
| `src/lib/shell/tracing-ignore.ts` | 同上：构建期模块图上的纯工具，报错现场就在它自己的调用点上                   |

**门禁与清单只定义一次的地方**：白名单登记在 `docs/reference-facts.md` 的
`comment.language.asciiOnly` 一行（源码见 `scripts/doc-facts.cjs` 的 FACTS），
由 `pnpm doc:check` 核对「文档写的名单」与「脚本读的名单」一致；
规范 12 §12.4.6 的棘轮读同一份名单。

**另有第二类豁免：工具指示注释**（规范 12 §12.4.6 的表里同款）。行首即
`@vitest-environment` / `@ts-ignore` / `@ts-expect-error` / `eslint-disable*` /
`@jsx*` 的行不参与统计 —— 它们不是给人读的注释，而是工具按**字面量**解析的指令：
改成中文不是报错，而是**静默失效**（用例悄悄跑回默认环境、类型豁免悄悄失效）。
判据只认「行首就是该指令」，避免把「解释某个指令」的正常中文注释一起放行。

**自查入口（跨平台）**：`pnpm exec vitest run tests/comment-language.test.ts`。
**排查手法**：真要给名单里的文件加中文注释时，先在浏览器里打开
`settings` 页触发一次编译错误看 code frame 是否渲染它 —— 渲染不到就别加，
不确定就别加（名单只有三个，加错一个的代价是构建偶发崩）。
