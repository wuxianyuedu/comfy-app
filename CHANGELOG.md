# 更新日志

本文件记录**两次发布之间用户可感知的差异**。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **什么该记 / 什么不该记**，见
> [前端工程规范 §13.10](docs/standards/13-提交与-code-review.md#1310-changelog-记录规范)。
> 简述：外部可见的功能、行为变更、破坏性变更、影响升级的修复才进本文件；
> 内部重构、lint/类型清理、注释与文档修订一律归 `git log`。

## [Unreleased]

### Fixed

- **设置打开失败时不再只剩一句「配置数据未就绪」死角（ISSUE #304）**：此前只在「两份配置都没拿到」时才显示错误视图——当 `setting.get` 成功、`llm.configGet` 失败（如库表缺失），失败为真却两份草稿都不齐，界面既不显示错误、也没有重试按钮与日志指引，只留下没有原因的「配置数据未就绪」把用户冻住。现「任一查询失败且草稿未就绪」即落错误降级视图，给出可读原因、重试、完整错误与日志面板入口；兜底态同样给可操作出口。

- **设置加载失败的日志不再报错查询名与丢失服务端原文（ISSUE #304）**：补记到应用日志面板的那条错误，查询名字段此前恒显示 `setting.get`（无论实际失败的是哪个查询），且只记翻译后的可读文案——服务端真实报错（如 `no such table: llmConfig`）在面板里彻底丢失，用户拿着「请求被中断，请稍候重试」无从排查。现按实际失败的查询记全名称，并把原始报错（tRPC `code` / 服务端 `message` / `cause` / 堆栈首行）一并写入日志的 `raw` 字段。

- **tRPC 失败不再被传输层包装文案掩盖根因（ISSUE #304）**：批量流式链路失败时，顶层错误文案常是 `signal is aborted without reason`（React Query 重试时中止上一轮请求所致），而真正的服务端报错在 `shape.message` 里。此前取值只看顶层，把「库里没有这张表」误报成「请求被中断，应用服务可能正在重启」，用户按提示反复等重启永远修不好。现在服务端原文优先，并对该类中断给出更贴合实际的可读提示。

- **桌面窗口关了以后不会再留下无主的 `app.exe` 进程（ISSUE #301）**：此前启动器在壳还活着时退出（用户直接关掉启动器窗口 / 拉起它的 python 进程先结束），没人回收已经弹出的桌面壳——窗口没了进程还在，占着内存、锁住 `target\release\app.exe`（下次编译又报「拒绝访问」），只能手工 `taskkill /IM app.exe /T /F`。现三层治理：①启动前按进程 exe 真实路径（`src-tauri\target\{release,debug}\app.exe`，而非命令行，预编译壳的命令行里不含项目根路径，旧判据会漏判）回收上一轮遗留的壳；②python 启动器把本次拉起的壳 PID 落盘（`log/launcher/tauri-shell.pid`），监控线程在 dev-launcher 已退出/异常/超时时检查该壳是否仍存活，存活即 `taskkill /PID <pid> /T /F` 补刀后清掉 PID 文件；③正常路径关闭桌面窗口仍由 dev-launcher 的 `WaitForExit` + 进程树回收负责，不变。

- **构建 release 壳不再因桌面壳还开着而白跑一轮编译（ISSUE #301）**：上一次启动的桌面窗口没关闭时，`cargo build --release` 会在编译收尾阶段报 `failed to remove file ... app.exe / 拒绝访问 (os error 5)`——要等整轮 Rust 编译走完才失败，且错误本身看不出根因。现在构建脚本（`tools\build\build-tauri-release.ps1` / `build-standalone.ps1`）会在编译开始前检测运行中的桌面壳，命中即中止并提示关闭窗口（或 `taskkill /IM app.exe /T /F`）后重跑；失败路径也会补一句「壳被打开」的排查提示。

- **工作流库执行任务时能看清排队/启动状态，失败不再只显示「等待日志…」与「任务连接中断」（ISSUE #295）**：此前任务入队后若 ComfyUI 的 WebSocket 尚未就绪（未运行 / 自动启动中 / 连不上），进程会在队列里静默等待，前端执行日志只能看到「等待日志…」；任务若在 SSE 订阅建立前就已终态，回放顺序是「先终态 state、后日志」，前端一收到终态就关闭了连接，后面的失败原因日志被丢弃，只剩下笼统的「任务连接中断」。现改为：
  - 排队任务在 WS 未就绪时写一条可见提示（防心跳刷屏），自动启动的每步进度也实时写进排队任务日志；任务执行日志会依次提示「ComfyUI 未运行，正在自动启动…」「ComfyUI 启动：…（启动进度）」「ComfyUI 已就绪，继续执行工作流…」，自动启动失败也会把失败原因写进日志面板，便于定位；
  - SSE 初始回放先发日志、再发终态 state，保证失败原因先到达前端，日志面板不再空等。

- **工作流编辑 IO 后，库里的参数默认值会跟着刷新（ISSUE #288）**：在画布编辑器的 IO 预览里改了参数默认值并保存，回到工作流库时，「画布节点」与「参数配置」两个页签里未被改动的参数会显示新默认值，你已经手动改过的参数则保持你填的值不变。此前服务端详情缓存与客户端查询都没有随保存失效，回到库界面仍显示旧默认值。

- **设置页「启动 ComfyUI」按钮状态同步（ISSUE #296）**：ComfyUI 被自动启动（提交任务时未运行触发自动拉起）期间，设置页原本仍显示可点击的「启动 ComfyUI」按钮，与状态行「正在启动…」不一致。现该按钮在服务端启动进行时同步禁用并显示「启动中…」，避免用户在自动启动窗口期内重复触发启动。

- **修复设置页 / 工作区打开即整页报错（“An unexpected Turbopack error occurred”）**：客户端逻辑层误把 Node-only 的 `app-runtime-log` 模块（顶层 `import node:fs`）引入客户端 bundle，Turbopack 编译 `/(main)/settings` 与 `/workspace` 时报 `does not support external modules (request: node:fs)` 导致页面 500（回归，由提交 29d8b1d 引入）。现客户端补记 `app-runtime` 日志改走服务端写入通道（新增 `POST /api/logs/app-runtime` + `postAppRuntimeLog()`），设置页加载失败的日志仍能落到应用日志面板，页面恢复正常。

### Added

- **comfy-cli 会在启动时自动检查并升级到最新版**：项目内的 comfy-cli（`python-venv\comfy-cli`）此前只在虚拟环境缺失时被自动安装，装过一次后就再没人管——停在旧版时，子图（liblib）工作流的提示词/种子/步数覆盖会整段失效（promoted-widget 回填是 1.20 才有的逻辑），而界面上看不出任何异常。现每次启动都后台比对已装版本与 PyPI 最新版，落后即自动 `pip install --upgrade`（默认 24 小时才联网检查一次，离线或 PyPI 不可达只记日志、保持已安装版本，绝不阻断启动）。想立即检查可直接执行 `scripts\setup-comfy-cli-venv.ps1 -Force`，过程见 `log/tools/comfy-cli-setup.log`。

- **底部状态栏显存双口径显示**：显存占用同时展示 `nvidia-smi` 物理专用显存（与任务管理器「专用 GPU 内存」同口径）与 ComfyUI 上报的 CUDA 逻辑口径，两者并列便于对照（ComfyUI 的 CUDA 口径在 WDDM 下有时与任务管理器数值不一致）。`nvidia-smi` 查询失败 / 非 NVIDIA 卡时自动隐藏该项，仅保留 ComfyUI 口径。

- **应用端口可配置**：本地开发/桌面壳端口改为通过 `.env` 的 `COMFYAPP_PORT` 统一配置（默认 3000），启动器、Tauri 壳、前端 tRPC 客户端会一致读取；当端口与其他应用冲突时，改一处 `.env` 重启即可，无需改代码。
- **桌面应用自更新（应用更新）**：接入 `tauri-plugin-updater` 与 `tauri-plugin-process`，设置页新增「应用更新」分区——检测是否有新版本、下载并自动安装、更新完成后重启生效；另提供「重启应用」按钮（更新源与签名公钥由 `src-tauri/tauri.conf.json` 的 `plugins.updater` 配置，接入后需生成签名密钥）。
- **底部状态栏新增系统消息铃铛**：本地更新需重启等提示不再只在右下角一闪而过——状态栏常驻铃铛按钮，有未读消息时显示数量徽标，点击可全屏查看消息正文（含需重启的文件清单）与已读/清空操作。
- **工坊 Agent 创作指挥浮层**：在工坊页面新增可浮动的「创作指挥 Agent」对话面板，支持用自然语言指挥完整创作管线——生成/修改剧本、从剧本提取角色、添加新角色、规划分镜等操作。Agent 面板实时展示每一步工具执行的过程与状态。
- **LLM OpenAI 兼容 tools 协议支持**：后端 `/api/llm` 新增 `tools` 参数支持，模型可用 function calling 返回结构化工具调用；不支持 tools 的模型自动回退到「prompt 约束输出 JSON 指令序列」的轻量方式，两种路径在 Agent 层统一。
- **执行日志改为弹窗，并采用「应用日志」同款样式**：画布右上角新增「执行日志」入口按钮，
  点击以居中弹窗查看，运行新任务时自动弹出；弹窗内使用与应用日志一致的 level 配色、
  单选过滤按钮、毫秒时间戳与 13px 等宽字体行样式。原底部常驻面板会压缩画布可用空间，
  且与右下 MiniMap / 底部状态栏重叠。
- **执行日志任务选择器按画布节点短序号展示**：任务下拉框优先显示 `#1 · 状态` / `#2 · 状态`，
  方便直接定位是哪个画布节点产生的执行日志，而不是辨认工作流名或 taskId。
- **应用日志代码位置列可读性提升**：自动还原 Turbopack / 某些 webpack source-map 配置下
  把 `/` 编码为 `_` 的模块路径（`src_components_studio_...` → `src/components/studio/...`），
  列宽加宽到 280px，点击可复制完整路径。
- **两个日志弹窗支持加宽 / 收缩**：执行日志与应用日志弹窗头部新增展开图标，
  点击从 `max-w-5xl` 切换到 `max-w-[96vw]`（几乎占满视口），再次点击恢复。
- **应用日志代码位置列换行显示**：location 列改为 `max-w-[45%] break-all`，
  优先展示完整文件路径与行号，不再截断。
- **comfy-cli 虚拟环境随启动自动准备**：`start-tauri.exe` 启动时检测
  `python-venv/comfy-cli`，缺失则后台自动创建 venv 并安装 comfy-cli，不阻塞启动。
- **UI 与逻辑分离护栏（棘轮）**：新增 `scripts/check-ui-logic-separation.cjs`，
  统计视图层里的 `fetch(` / `vanillaApi.*` / tRPC hook 三类 IO，违规数**只许降不许升**，
  已接入 `pre-commit` 与 CI（治理后必须 `--update` 收紧基线）。
  当前基线 16 处 / 10 文件（P1–P4 已落地，104 → 16）。
  配套规范：[docs/standards/17-UI与逻辑分离.md](docs/standards/17-UI与逻辑分离.md)
  （含全库分批推进计划 P1–P4）。
- **UI 与逻辑分离首批（P1）落地**：`ApiChannelSettings`、`studio/history/*`、
  `MaterialLibraryPanel` 三个域按「配置 / 逻辑 / 视图 / 容器」四层拆开，
  业务逻辑下沉到 `hooks/` 与 `lib/*-client.ts`，共清掉 8 处视图内 IO、
  新增 78 个逻辑层测试；三个组件的对外 API 与视觉保持不变，消费方零改动。
- **UI 与逻辑分离第二批（P2）落地**：`FilmStudio`、`TrainingStudio`、
  `studio/ModelLibrary`、`model/ModelLibrary`、`ModelTagManager` 五个域完成拆分，
  共清掉 27 处视图内 IO（基线 96 → 69）、新增 116 个逻辑层测试。新增
  `src/lib/error-message.ts` 收敛项目内 8 份各自实现的 `(e as any)?.message`
  兜底逻辑（空消息一律回落，避免渲染出空白提示条）。
- **UI 与逻辑分离第四批（P4）落地**：`studio/project-canvas/*`（8072 行）与
  `studio/workflow-editor/*`（3378 行）两个最大域完成治理，共清掉 26 处视图内 IO
  （基线 42 → 16）、新增 103 个逻辑层测试（全量 632 → 735）。
  关键手法是**归位优于拆分**：7 个本属逻辑层却不在 `hooks/` 下的文件靠 `git mv`
  白拿 12 处指标（含 `workflow-editor-detail-loader.ts` → `hooks/use-workflow-detail-loader.ts`，
  顺带修正「文件名不反映实际内容」）；`canvas-store.ts` / `canvas-types.ts` 定性为
  逻辑层迁入 `src/lib/project-canvas/`；`canvas-helpers.ts` 劈成纯函数（154 行）
  与 `canvas-api.ts`（228 行，收口上传 / 启动生成 / 轮询 / LLM 扩写四个请求）。
  新增 `src/lib/workflow-mutations.ts`、`src/lib/task-cancel-client.ts`、
  `src/lib/task-images-client.ts`。五个视图组件的对外 API 与视觉不变。
  ⚠️ 本批**记录但未修复**一处既有缺陷：画布节点的 `mode` 存的是工作流类型 code
  （`T2I` / `T2V`），而连线传播与生成载荷里的自动切换比的是小写（`txt2img` / `t2v`），
  故「接上游图片后自动切图生图 / 图生视频」这条行为一直未生效——已用测试锁住现状，
  留待独立修复（见规范 §17.9.7）。
- **新增 `tools/` 构建脚本目录**：`build-launcher.ps1` 可一键重新打包
  `start-tauri.exe`；打包配置 `start-tauri.spec` 纳入版本控制（此前被 `.gitignore`
  的 `start-tauri*.spec` 规则一并忽略，打包流程无法从仓库复现）。
- **Windows 双击入口全部 .ps1 化，删除所有 `.bat` / `.vbs`**（ISSUE #23）：
  `start-web.ps1` / `run-local.ps1` / `verify-quality.ps1` / `start-desktop.ps1`
  （原 `run-desktop.bat`）/ `start-tauri.ps1`（原 `start-tauri.vbs`）/
  `register-comfyapp-protocol.ps1` 及 `tools/**` 下 9 个入口；新增
  `scripts/entry-common.ps1` 收敛「定位项目根 / 解析 pwsh / 透传退出码 / 双击暂停」，
  新增 `scripts/enable-ps1-double-click.ps1` 做一次性双击关联（用户级 HKCU，免管理员）。
  **升级注意**：首次双击 `.ps1` 前需右键 `scripts/enable-ps1-double-click.ps1`
  →「使用 PowerShell 运行」，否则 Windows 默认用记事本打开脚本。
- **双击入口归位 `tools/`，根目录只留工程配置**（ISSUE #29）：6 个启动类入口由仓库根
  迁入 `tools/start/`（`start-web` / `start-tauri` / `start-desktop` / `run-local` /
  `verify-quality` / `register-comfyapp-protocol`），与既有的 `tools/build/`、
  `tools/registry/`、`tools/studio/` 按用途并列；根目录不再混排「入口」与「配置」。
  **升级注意**：已存在的旧路径快捷方式/脚本需改指 `tools\start\`；根目录新增 `.ps1`
  入口会被提交门禁（R9）拒绝。

- **历史记录列表条目级增删/排序加平滑过渡**（AutoAnimate）：历史记录页的任务卡片列表接入
  `@formkit/auto-animate`，切换「时间倒序 / 时间正序」、切换状态筛选、删除任务时，
  卡片以 FLIP 位移 + 淡入淡出平滑换位，不再生硬跳变。仅用 `transform`/`opacity`
  合成器属性，符合规范 §2.7（不触发整树 layout 重排）。
  该过渡**不再受系统「减弱动态效果」开关影响**：开启 `disrespectUserMotionPreference`，
  在系统开启减弱动画时仍保留 250ms 的适量过渡动画（产品决策：允许适量动画而非完全禁用）。

### Fixed

- **遇到错误时「应用日志」面板不再一片空白**：三类此前面板收不到的失败现已落盘可见
  —— ① 设置页 tRPC 查询失败只体现在降级 UI、不经过 console/unhandledrejection，
  现由逻辑层主动补记 app-runtime 错误日志（同一错误只记一次）；
  ② 设置弹层（工作区内打开设置）失败视图与独立设置页共用同一套可读降级
  （完整错误可展开/复制 + 日志面板指引），并保留「返回工作区」；
  ③ 启动/开发转录里的 `[Fast Refresh] rebuilding` 沾染上一条编译错误的级别标记时
  不再被解析成 error（热更新进行中 ≠ 应用出错）。

- **修复前端集成测试（MSW）整批失败**：`setupTrpcServer` 的拦截路径不含 host 前缀，
  msw 对「绝对 URL 请求」（测试 client 的 `httpBatchStreamLink` 打的正是
  `http://localhost:3100/api/trpc/...`）不匹配，use-settings-page / 集成自检 /
  模型库等 7 个文件共 78 个用例在 master 上就已失败。改为 `*/api/trpc/*`
  （与 host 无关，换端口不用跟着改）后全部恢复。

- **修复子图工作流种子选「随机值」仍生成同一张图**：raw 子图（liblib 模板，`class_type` 为 UUID）wrapper 只暴露内层 seed、却未暴露其随机化控制（ComfyUI 将其隔离进 `proxyWidgetErrorQuarantine`），`widgets_values` 里没有 `control_after_generate` 哨兵槽，前端下发 `randomize` 覆盖被跳过、种子保持固定值。现改为：这类节点哨兵槽缺失时，若请求的是「随机值」，回退为在提交前直接生成一颗随机种子写入 seed 槽，保证每次生成的图不同；普通 KSampler 仍走哨兵槽写入随机化模式，行为不变。

- **修复子图（liblib）工作流「换了提示词 / 种子仍生成同一张图」**：raw 子图 wrapper 上的 `widgets_values` 只是**宿主值**，comfy-cli 把子图展开成 `wrapperId:innerId` 后真正被采样器读到的是**内层节点**的 `widgets_values`。此前 `applyRawOverrides` 只写 wrapper，而「把宿主值回写进内层」是 comfy-cli 1.20 才有的 promoted-widget 回写逻辑，老版本（1.17~1.19）会在转换阶段用内层默认值整段盖掉覆盖 —— 于是提示词、种子、步数等入参全部失效，每次都跑工作流里存的那张图（日志里的「真实执行 seed」恒等于内层 KSampler 的默认值）。现改为：落在子图 wrapper 上的覆盖项按 ComfyUI 前端的映射规则（`sub.inputs[i].linkIds` → 起点为 `-10` 的边界连线 → 内层 `target_id`/`target_slot`）同步写进内层节点，seed 的 `control_after_generate` 哨兵槽与「随机值」兜底生成的随机种子同样同步；普通（非子图）节点行为不变，comfy-cli 新旧版本下覆盖都生效。

- **dev server 重启标记改为「真正重启时间」并排除误报**：原来的右下角重启标记
  把「探测失败」当成重启信号，显示器关闭 / 浏览器后台节流 / 瞬时断网都会导致
  网络探测失败而被误报成「后端重启」。现改用进程启动标识（bootId）作为真正
  重启的权威信号：仅当检测到 dev server 进程重启（bootId 变化）时才展示重启
  标记与真正重启时间，探测抖动不再误报。

- **修复 dev server 重启后 reaper 误判正在执行的任务为失败**：dev server
  「重启中」标记源于前端对 `/api/comfy/stats` 的存活探测（网络层短暂失败即告警），
  进程未必真的重启。此前 reaper 仅凭任务 `createdAt` 超过 60s 且 ComfyUI
  `/history`/`/queue` 均无该 prompt 就判定为 orphan FAILED，会误伤仍在被
  comfy-cli / WS 正常监控执行的任务（用户会遇到「任务在跑却被报『重启后无人监控』」）。
  现在 reaper 在对账前先确认该 prompt 是否仍被当前进程的 in-memory runner 监控
  （`promptToTask` 中有映射）；仍有监控者则跳过，交给正常收口路径——只有真正
  冷重启（内存状态丢失、无人认领）的任务才交给 reaper 对账。

- **修复提交 raw 子图工作流时「生成后控制」误写坏模型名**：comfy-cli 路径给
  子图 wrapper 节点（如 z_image 等 `class_type` 为 UUID 的模板）的种子设
  「生成后控制 = 随机值」时，会把 `randomize` 写进种子后面的下一个真实控件
  （扩散模型名 COMBO）槽位，导致提交后模型名变成 `randomize`、整单无法运行。
  现改为仅当该节点确在 `widgets_values` 里携带 seed 的 `control_after_generate`
  哨兵槽时才写入（普通 KSampler 仍正常随机/固定），子图 wrapper 未暴露该控制时
  不再覆盖相邻控件，模型名得以保留。

- **应用日志不再把框架自身日志伪报成业务位置**：过滤 Next.js dev 自身的
  `[Fast Refresh] done in …ms` 提示（保留在浏览器 console，降为 debug），并让
  位置列只展示能映射回项目源码（`.ts/.tsx`）的调用点。此前这类框架输出会带着
  一串看不懂的编译 chunk 路径（如 `src/00vplg9./.js:1879`）混入面板，
  误导用户以为那是某段业务代码打印的。
- **comfy-cli 启动报错更友好**：`executeViaComfyCli` 在 spawn 前检查 Python 解释器
  是否存在；缺失时给出明确的安装命令或 `COMFY_CLI_PYTHON` 环境变量覆盖方式，
  不再把原始 `ENOENT` 抛给用户。
- **画布节点错误面板给出可行动建议**：错误文本会匹配出一行纠错提示（wrapper 子图未安装 /
  显存不足 / 模型文件缺失 / 参数类型不匹配 / 请求超时）。未识别的错误形态不编造建议，
  保留原始错误块。

### Changed
- **应用默认开发端口改为 3100**：开箱默认端口由 3000 改为 3100，避开其他应用常见的 3000 占用，统一由 `.env` 的 `COMFYAPP_PORT` 控制，启动器、Tauri 壳、前端 tRPC 客户端一致读取。原有 `COMFYAPP_PORT` 配置继续生效，自定义端口不受影响。

- **设置界面打开即显示框架，加载态下沉到内容区**：独立路由 `/settings` 与
  workspace 内设置浮层都先渲染「返回栏 + 左侧分区导航」，配置数据在内容区
  就地显示「加载中」/ 错误重试，不再用整屏 loading 挡掉导航等全部配置就绪，
  打开设置更快且能随时切换分区。

## [0.1.0] - 2026-08-31

首个版本基线。本文件自本次提交起建立，**此前的变更以 `git log` 为准，不做回溯补全**
（回溯会失真）。

当前基线已包含的主要能力：

- 项目画布 / 工作流画布双画布：节点、连线、素材库、历史记录、空态引导
- 工作流库（左右分栏列表 + 详情）与工作流编辑器（子图下钻、IO 曝光、RAW JSON 查看）
- 任务执行 + SSE 实时步骤日志；应用日志面板（`Ctrl+Shift+L` 开关）
- 模型库、素材库、作品库、剧本 Markdown 编辑器、Workshop Pipeline
- Windows 启动器（`start-web.bat` / `start-tauri.vbs`）与 ComfyUI `custom_nodes` 只读解析器

---

### 版本类型说明

| 段落 | 记什么 |
|------|--------|
| `Added` | 新增的用户可见功能 |
| `Changed` | 行为变更（含默认值、UI 形态变化，即使不是 bug） |
| `Deprecated` | 即将移除的能力 |
| `Removed` | 已移除的能力 |
| `Fixed` | 已修复的缺陷 |
| `Security` | 安全相关修复/加固 |
