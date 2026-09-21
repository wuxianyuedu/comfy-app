# Comfy-APP-T3 术语表（统一领域词汇）

> 起因（ISSUE #401）：同一个词在不同子系统里指不同东西，讨论/Issue/PR 里一写
> 「画布」就分不清是哪一个——项目画布、工作流编辑器画布、还是已废弃的旧画布。
> 本表把**术语 → 唯一所指 → 代码落点**钉成一份对照，作为全项目（文档、注释、
> Issue、PR、UI 文案、代码标识符）的**统一叫法**。
>
> 用法：写文档/起 Issue/Review 时说术语时**优先用「正式名」**；口头简写（如
> 直接说「画布」）在必须区分语境时补限定词（「项目画布」「编辑器画布」）。
> 术语与代码不一致时，**以本表 + 代码为准，并回头修文档**。

---

## 1. 为什么需要术语表

| 问题 | 现象 | 本表怎么治 |
|---|---|---|
| 一物多名 | 「流程库」「工作流库」「workflow 管理页」混用 | 每行给**正式名 + 允许的别名 + 禁止的叫法** |
| 一名多物 | 「画布」同时指项目画布 / 工作流编辑器画布 / 旧画布 | 每行标注**唯一所指**与**代码落点**，歧义词给判别口诀 |
| 中英不齐 | 中文说「节点」，代码里 `node` 又分 ReactFlow 节点 / ComfyUI 节点 / 项目画布节点 | 给三者的字段级判别（`id` / `comfyId` / `data.kind`） |
| 跨层同名 | 「运行」= 本地会话态 / 服务端任务 / ComfyUI 内部执行 | 分别命名：运行记录 / 任务 / ComfyUI 执行 |

**判定标准**：一个词能在两句不同语境里指两个不同代码对象，就必须进本表。

---

## 2. 核心歧义词：三种「画布」（ISSUE #401 的直接诉求）

本项目有**三个**都叫「画布」的东西，其中两个在用、第三个（旧流程画布）已删除。
**不带限定词的「画布」不得单独使用**——写「画布」时一律补限定词。

| 正式名 | 界面/导航叫法 | 代码落点 | 是什么 | 状态 |
|---|---|---|---|---|
| **项目画布** | 左侧导航「画布」(`NAV_ITEMS` id `canvas`) | 视图 `src/components/studio/ProjectCanvas.tsx`；逻辑 `src/lib/project-canvas/`；节点 `src/components/studio/project-canvas/` | 用户编排**创作流程**的主画布：节点是生成单元（`image`/`video`/`script`/`workflow`…），产出直接是素材 | 在用（核心） |
| **工作流编辑器画布** | 工作流库里「在工作流编辑器中打开」 | 视图 `src/components/studio/canvas/WorkflowCanvasEditor.tsx`（内含 `workflow-editor/`）；节点 `src/components/studio/canvas/WorkflowNode.tsx` | 把**一份 ComfyUI 工作流**摊开成图：节点是 ComfyUI `class_type`，用于看结构 / 改参数 / 配 IO | 在用 |
| ~~**旧流程画布**（`workflow-canvas`）~~ | 无独立入口 | ~~`src/components/workflow-canvas/`~~ | 早期「可执行工作流引擎」画布 | **已删除**（ISSUE #419）——死代码清掉，仍被复用的节点注册表 / 节点样式已归位到 `src/lib/comfyui/` 与 `studio/canvas/`，详见本表下方注 |

**判别口诀（三问定一个画布）**：

1. 入口在哪？→ 左侧导航「画布」= 项目画布；工作流库里打开 = 工作流编辑器画布。
2. 节点是什么？→ 生成单元（能出图/出视频）= 项目画布；ComfyUI `class_type` = 工作流编辑器画布。
3. 路径前缀？→ `project-canvas` = 项目画布；`studio/canvas` 或 `workflow-editor` = 工作流编辑器画布。
   （第三种「旧流程画布」已删除，路径前缀不存在了。）

> **写文档时的硬约定**：涉及画布性能（[主规范 §6.1](../standards/Comfy-APP-T3-项目开发规范.md)、
> [02 §2.11](../standards/02-性能规范.md)）默认指**项目画布**；涉及 ComfyUI 图结构 /
> `class_type` / 参数映射时默认指**工作流编辑器画布**。二者都涉及时一律写全名。

> **旧流程画布删除后的归位去向**（曾经的「节点注册表与节点样式被复用」的那部分）：
>
> | 原位置 | 现位置 | 说明 |
> |---|---|---|
> | `workflow-canvas/types.ts` 的类型段 | `src/lib/comfyui/node-config.ts`（`NodeTypeConfig`/`PortSpec`/`FieldDef`） + `src/lib/comfyui/field-types.ts`（`FieldType`） | 纯类型，lib 层 |
> | `workflow-canvas/node-registry.ts` | `src/lib/comfyui/node-registry.ts` | 内置 `class_type` 配置表 |
> | `workflow-canvas/nodes/PackageFooter.tsx` | `src/components/studio/canvas/PackageFooter.tsx` | 节点卡片左下角来源标签 |
> | `workflow-canvas/CustomNodesSettings/` | `src/components/studio/workflow-library/CustomNodesSettings/` | 「自定义节点设置」弹层，工作流库在用 |
>
> 真正无人消费的死代码（`WorkflowCanvas.tsx`/`WorkflowCanvas.parts.tsx`/`NodeEditor.tsx`/
> `graph-utils.ts`/`workflow-canvas-utils.ts`/`nodes/`（ComfyNode 族）/`index.ts`/
> `workflow-canvas-render-chain.ts` 与 `globals.css` 的 `.workflow-canvas*`、`.wf-*` 样式段）
> 已一并删除。

---

## 3. 画布相关配套术语

| 术语 | 唯一所指 | 代码落点 / 判别 | 禁止的叫法 |
|---|---|---|---|
| **画布项目**（`CanvasProject`） | 项目画布里的一个可命名、可切换、可持久化的作品单位 | `src/lib/project-canvas/canvas-store.ts` 的 `CanvasProject`；id 前缀 `proj_*` | 「画布」「项目文件」（「项目」还被 `NAV_ITEMS` id `works`「项目」占用，指作品相册，见 §6） |
| **画布节点**（项目画布节点） | 项目画布上的一个生成单元 | `CanvasNodeType`（`src/lib/project-canvas/canvas-types.ts`），id 由 `makeNodeId()` 生成（`n_*`），`data.kind` ∈ `image\|video\|script\|agent\|workflow\|text\|picture\|movie` | 「节点」（不加限定） |
| **编辑器节点**（工作流节点） | 工作流编辑器画布上的一个 ComfyUI 节点 | `src/components/studio/workflow-types.ts` 的 `WorkflowNodeData`，字段 `nodeId`（ComfyUI 图里的 key）+ `classType` | 「ComfyUI 节点」以外的简称 |
| **ComfyUI 节点 / 节点 id** | ComfyUI 图 JSON 里的键与 `class_type` | 图结构 `ComfyGraph = Record<string, ComfyGraphNode>`；编辑器显示的右上角编号是**真实节点 id**（如 `#1670`，见 [15 附录 §15.5](../standards/15-附录.md)） | 「编号」单独用 |
| **子工作流节点** | 项目画布上代表「一份可展开工作流」的节点（折叠态是卡片，展开态下钻） | `src/components/studio/canvas/WorkflowSubgraphNode.tsx`、`SubgraphHeader.tsx` | 「嵌套节点」 |
| **视口（viewport）** | 画布可见区域（pan/zoom 状态） | ReactFlow `useReactFlow()`；不进全局 store（[02 §2.11](../standards/02-性能规范.md)） | 「画布」 |

---

## 4. 工作流族（workflow）

| 术语 | 唯一所指 | 代码落点 | 备注 |
|---|---|---|---|
| **工作流** | 一份 ComfyUI 工作流（graph JSON + 参数/IO 元数据） | `workflowTemplate` 表（`graph` / `paramMap` / `workflowIO` / `rawJson` / `positions`） | 中英混用时可写 `workflow` |
| **工作流库** | 浏览/搜索/编辑/就地运行工作流的页面 | `src/components/studio/workflow-library/`；导航名「流程」(`NAV_ITEMS` id `workflows`) | ❌「流程库」「workflow 页面」；UI 标题与代码统一叫**工作流库** |
| **工作流编辑器** | 打开单份工作流进行图编辑的全屏编辑器（承载「工作流编辑器画布」） | `workflow-editor/`（`WorkflowEditorInner.tsx` 等）+ `canvas/WorkflowCanvasEditor.tsx` | 与「工作流编辑器画布」区别：编辑器是**整个界面**，画布是其**图区** |
| **工作流参数（paramMap）** | 工作流对外暴露的**可填参数**（提示词/尺寸/步数…） | `workflow-param-mapping.ts`；UI 为 `WorkflowParamCard`（卡片列在库详情「画布节点」页签） | ❌「变量」「字段」 |
| **工作流 IO（workflowIO）** | 工作流的**输入/输出端口映射**（含节点内建 IO） | `src/lib/workflow-io-types.ts`、`io-exposure.ts` | ❌「接口」 |
| **就地运行** | 在工作流库内直接运行选中工作流（不跳转画布） | `src/lib/workflow-run-store.ts` 注释头；`WorkflowRunLogModal.tsx` | ❌「快速运行」 |

---

## 5. 运行 / 任务族（三个「运行」必须分开）

| 术语 | 唯一所指 | 代码落点 | 生命周期 |
|---|---|---|---|
| **任务**（task） | 服务端真值：一次生成请求的记录（状态/进度/日志/产物） | `task` / `taskImage` 表；`TaskLogEntry` | 持久（SQLite），客户端真值以服务端为准 |
| **运行记录** | 客户端侧的会话观察态（跨页签/关窗后恢复「正在生成」视角） | `src/lib/workflow-run-store.ts` 的 `WorkflowRunMeta`（最多 32 条、日志最多 300 行，localStorage 写穿） | 会话级 + 本地缓存，可丢 |
| **ComfyUI 执行** | ComfyUI 内部真正跑图的过程 | `src/lib/comfyui/**`（executor-ws / lifecycle） | 进程级 |
| **生成模式**（mode） | 工作流按内容类别的分栏（图/视频等） | `generation-client.ts`；`workflowTemplate.modes` / `defaultMode` | 配置 |
| **任务类型**（taskType） | 工作流类型分类码（`T2I`/`I2V`/`S2V`…） | `src/lib/workflow-types.ts` 的 `WorkflowTypeDefinition.code` | 配置 |

> **一句话**：说「运行」时补名词——服务端叫**任务**，前端叫**运行记录**，ComfyUI 内部叫**执行**。

---

## 6. 应用结构与导航族

| 术语 | 唯一所指 | 代码落点 | 易混点 |
|---|---|---|---|
| **工作区**（workspace） | 主应用容器页面（左侧导航 + 视图切换 + 页签） | 路由 `src/app/workspace/page.tsx`；导航 `WorkspaceNav.tsx` | 与「工作流」缩写相撞，禁止把工作区写成 `workflow` |
| **工作室**（studio） | **组件库命名空间**，不是产品名、不是页面 | `src/components/studio/` | ❌「Studio 页面」；页面叫工作区/工作流库等 |
| **工坊**（workshop） | 剧本→分镜→成片的 LLM 流水线模块 | `src/components/workshop/`、`src/lib/workshop/` | 与「工作室」一字之差，指代完全不同，勿混用 |
| **页签**（shell tab） | 窗口标题行上的内容页签（可挂内部浏览器页） | `src/lib/shell-tabs-store.ts`、`ShellTabs.tsx` | ❌「标签页」（那是 `Tag`/`Badge`） |
| **视图**（view） | 工作区内切换的主内容区（home/canvas/workflows/…） | `WORKSPACE_VIEWS`（`src/app/workspace/page.tsx`）、`WorkspaceView` 类型 | ❌「页面」（页面特指 Next 路由） |
| **设置浮层**（SettingsOverlay） | 覆盖在工作区上的设置面板（不是独立路由） | `src/components/settings/SettingsOverlay.tsx` | 另有 `/settings` 路由页，两者别混 |
| **项目**（`works`，「项目」导航） | 产出素材相册视图 | `NAV_ITEMS` id `works`；`WorksGallery` | **与「画布项目」不是一回事**（§3） |
| **产出**（outputs） | 项目输出物汇总视图 | `ProjectOutputs.tsx` | 与「项目」视图区分 |

---

## 7. 基础设施族

| 术语 | 唯一所指 | 代码落点 |
|---|---|---|
| **桌面壳**（Tauri 壳） | Rust 编写的窗口/sidecar 宿主 | `src-tauri/` |
| **启动器**（launcher） | **已废弃的历史概念**：原先指打包出的 `start-tauri*.exe` 入口。现在唯一的启动入口是壳本身（`src-tauri\target\release\app.exe`），编排由壳承担 | `src-tauri/src/shell_launch.rs`（ISSUE #784 起） |
| **启动编排** | 真正起 dev server / 壳 / 探端口的逻辑脚本 | `scripts/dev-launcher.ps1`（唯一编排者） |
| **侧车**（sidecar） | 壳托管的 Node 运行时进程（跑 Next standalone） | `src-tauri/src/lib.rs`（sidecar 目录 `src-tauri/binaries/` 为构建产物，本地可能不存在） |
| **启动页**（splash） | 冷启动加载页 | `public/splash.html`（`tauri.conf.json` 的 `windows[0].url`） |
| **应用运行时日志** | 应用自身写盘的结构化日志（按子系统分目录） | `src/lib/app-runtime-log.ts`、`log/`（布局见 [主规范 §4](../standards/Comfy-APP-T3-项目开发规范.md)） |
| **日志面板** | 应用内查看日志/运行输出的 UI | `src/components/studio/logs/`（`LogProvider` / `LogPanel`） |

---

## 8. 使用规则（写文档 / 起 Issue / Review 时）

1. **歧义词必带限定词**：`画布` `节点` `运行` `项目` `视图` 五个词单独出现即视为表述不清；
   先按本表补齐（如「项目画布节点」「客户端运行记录」）。
2. **正式名优先**：标题、Issue/PR 标题、代码注释里的域术语用本表「术语」列；
   别名仅用于口语与 UI 文案，且要与 UI 实际文案一致。
3. **一次沟通只用一个名字**：同一段话里不得「项目画布」与「画布」交替指同一对象。
4. **新增术语必须登记**：引入新域概念（新表、新页面、新节点种类）时，往本表对应
   分组补一行（术语 / 所指 / 代码落点）；无代码落点的词不许进表。
5. **术语漂移即修文书**：发现代码改名导致本表失效时，随本次提交一起更新本表与
   [docs/README.md](README.md) 的索引，不留过期条目。
6. **命名冲突就地隔离**：新增文件前先看本表所在分组，确认目录内没有语义撞车的
   同族名词（既有约定见 [12 §12.8](../standards/12-代码组织与文件结构.md)「同名不同物就近隔离」）。

---

## 9. 关联文档

- 命名硬约束（文件/组件/变量/常量）：[主规范 §3](../standards/Comfy-APP-T3-项目开发规范.md)、[12 §12.6](../standards/12-代码组织与文件结构.md)
- 目录与域划分（画布三体系的物理落点）：[12 §12.1](../standards/12-代码组织与文件结构.md)
- 文档体系统一索引与冲突裁决链：[docs/README.md](README.md)
