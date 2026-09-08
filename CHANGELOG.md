# 更新日志

本文件记录**两次发布之间用户可感知的差异**。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **什么该记 / 什么不该记**，见
> [前端工程规范 §13.10](docs/standards/13-提交与-code-review.md#1310-changelog-记录规范)。
> 简述：外部可见的功能、行为变更、破坏性变更、影响升级的修复才进本文件；
> 内部重构、lint/类型清理、注释与文档修订一律归 `git log`。

## [Unreleased]

### Added

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

### Fixed

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
