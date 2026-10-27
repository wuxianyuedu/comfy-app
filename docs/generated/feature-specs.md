<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/product/feature-specs.md`。改动请回源文件，再重新生成。 -->

# 功能需求详述（Feature Specs）

> 与 [feature-catalog.md](feature-catalog.md) 同编号同标题。
> 每条四格：**状态 / 需求 / 行为与验收 / 落点**。「行为与验收」写的是
> **怎么判做到**——能跑命令、能指路径；不写不可判的词。
> 做改动前读对应条；改行为同批改本文件（规则见 [README.md §5](README.md)）。

---

## 1. 工作区与导航（FR-WS）

#### FR-WS-01 工作区容器与 17 视图注册表

- 状态：已上线
- 需求：产品主体是一个全屏工作区容器；所有主界面以「视图」在其中切换，
  视图清单只有一份注册表（侧栏 / 页签 / 顶栏标题 / 命令面板都读它）。
- 行为与验收：`src/components/studio/NavItems.tsx` 的 `NAV_ITEMS` 是唯一
  注册表；新增视图不同步登记它 = 该需求被破坏（入口会缺）。屏内页头标题
  统一取 `pageHeaderTitle(view)`，视图内不再出现第二个名字
  （回归：`tests/page-name-single-source.test.ts`）。
- 落点：`src/app/workspace/page.tsx`、`src/components/studio/NavItems.tsx`、
  `src/components/studio/AppShell.tsx`、`WorkspaceViewStack.tsx`

#### FR-WS-02 视图页签（多开 / 切走保留 / 瞬时页签）

- 状态：已上线
- 需求：视图以页签打开，可同时开多个；切走再切回来保留编辑态；
  设置 / 模型适配 / 模式契约是瞬时页签（切走即关）。
- 行为与验收：同一份注册表里 `transient` 标记决定行为；不变式是
  「最多只有当前页可以是 transient」（`withTransientPruned`）。
  画布 / 工坊这类有编辑态、跑长任务的视图**不得**标 transient。
- 落点：`src/lib/shell/shell-tabs-store.ts`、`src/components/studio/ShellTabs.tsx`、
  `workspace-tabs.ts`

#### FR-WS-03 命令面板（打开全局视图）

- 状态：已上线
- 需求：命令面板可搜索并打开全部全局视图，与侧栏、「+」菜单同一份数据源。
- 行为与验收：面板列表由 `globalNavItems()` 派生（非第二份清单）；
  搜索命中项与侧栏可见项一致（设置不在侧栏但可被搜到）。
- 落点：`src/components/studio/CommandPalette.tsx`

#### FR-WS-04 项目界面与项目视图入口

- 状态：已上线
- 需求：项目类六个视图（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）只在
  项目界面出现；入口为「+」菜单与侧栏项目分组；没有活跃项目时不放项目类视图。
- 行为与验收：项目视图经 `projectTabs()` 切出；「+」菜单在无活跃项目时
  不放行项目类入口（落了也是闸门，等于给一个开不了的项）。
- 落点：`src/app/workspace/page.tsx`（「+」菜单清单）、`NavItems.tsx`

#### FR-WS-05 明暗主题

- 状态：已上线
- 需求：全应用明暗两态，两态共用同一套设计 token，不为暗色单写一套色。
- 行为与验收：主题切换不重载应用；取值冲突以 `src/app/globals.css` 为准
  （设计契约见 `docs/DESIGN.md`，样式判据见规范 03 章）。
- 落点：`src/app/layout.tsx`（`ThemeProvider`）、`src/app/globals.css`

#### FR-WS-06 日志面板（分类开关 / 虚拟列表）

- 状态：已上线
- 需求：应用内可查看运行日志；日志列表虚拟化；可按分类显隐。
- 行为与验收：分类开关持久化在本地（写失败仅内存态，不崩）；
  长日志滚动不卡（虚拟列表）；日志落盘布局见规范 07 章。
- 落点：`src/components/studio/logs/`（`LogProvider` / `LogPanel` /
  `VirtualLogList.tsx`）、`src/lib/log/app-runtime-log.ts`

#### FR-WS-07 陈旧实例提示（长开期间拉到新代码）

- 状态：已上线
- 需求：应用一直开着、期间拉到新代码时，应用内主动提示「界面比代码旧」
  并给出一次修好的办法，不等用户撞上白屏。
- 行为与验收：构建号变化被检测到即有提示；处置办法见
  `docs/guide-stale-code.md`。
- 落点：`src/app/layout.tsx`（`CodeUpdateWatcher`）、`docs/guide-stale-code.md`

#### FR-WS-08 全局状态面（消息中心 / 浏览器状态栏）

- 状态：已上线
- 需求：全局挂载消息中心与状态栏，承载应用级提示与连接状态。
- 行为与验收：两者挂在根布局、不随视图卸载；不承载业务交互
  （业务提示走各视图内的 toast / 错误条）。
- 落点：`src/app/layout.tsx`（`MessageCenterPanel` / `BrowserStatusBar`）

---

## 2. 账号与访问（FR-AU）

#### FR-AU-01 邮箱注册 / 登录

- 状态：已上线
- 需求：邮箱 + 密码注册与登录；密码最少 12 位。
- 行为与验收：注册 / 登录走 better-auth `emailAndPassword`；
  失败有可见错误（不静默）；`/login` 是唯一登录入口路由。
- 落点：`src/app/login/page.tsx`、`src/server/better-auth/config.ts`

#### FR-AU-02 GitHub OAuth（桌包内不可用）

- 状态：已上线（带边界）
- 需求：支持 GitHub OAuth 登录；**桌包内明确不可用**（回环 origin +
  运行期端口，GitHub 侧无法登记回调）。
- 行为与验收：OAuth 配置在 `socialProviders.github`；桌包场景不展示
  无效入口（边界写在配置注释里）；origin 策略动态 baseURL +
  显式 trustedOrigins。
- 落点：`src/server/better-auth/config.ts`、`src/server/better-auth/origin-policy.ts`

#### FR-AU-03 本机单用户回落（默认）

- 状态：已上线
- 需求：默认本机单用户模式——不要求登录即可用，会话回落演示用户。
- 行为与验收：开关是 `app-settings.json` 的 `loginRequired`（默认 false）；
  判决只有一个单点（`src/lib/auth-server.ts`），tRPC 上下文不各自判。
- 落点：`src/lib/auth-server.ts`、`src/server/api/trpc.ts`

#### FR-AU-04 会话与端点限流

- 状态：已上线
- 需求：会话落 `session` 表；鉴权端点限流（auth 端点 10s/100 次、
  邮箱登录 10s/5 次、忘记密码 60s/3 次）。
- 行为与验收：超限返回可感知的错误而非无限等待；会话解析在 tRPC 上下文
  统一完成。
- 落点：`src/server/better-auth/config.ts`（rateLimit）、
  `src/server/api/trpc.ts`

---

## 3. 项目画布（FR-CV）

#### FR-CV-01 画布项目增删改查（本地 store + 服务端镜像）

- 状态：已上线
- 需求：画布项目（`proj_*`）可创建 / 重命名 / 删除 / 切换；本地即时、
  服务端镜像（nodes / edges JSON）。
- 行为与验收：本地 store 是交互真值、服务端是持久真值；
  删除在只剩一个项目时为空操作（至少保留 1 个）；
  项目 id 客户端生成、服务端 upsert 不重发 id。
- 落点：`src/lib/project-canvas/canvas-store.ts`、
  `src/server/api/routers/project.ts`

#### FR-CV-02 生成单元节点（8 种 kind）

- 状态：已上线
- 需求：项目画布上的节点是生成单元：`image` / `video` / `script` /
  `agent` / `workflow` / `text` / `picture` / `movie`；产出直接是素材。
- 行为与验收：节点 id 由 `makeNodeId()` 生成（`n_*`）；类型判别看
  `data.kind`（ glossary §3 字段级判别）；节点可连成创作流程。
- 落点：`src/lib/project-canvas/canvas-types.ts`、
  `src/components/studio/ProjectCanvas.tsx`、
  `src/components/studio/project-canvas/`

#### FR-CV-03 子工作流节点（折叠 / 展开下钻）

- 状态：已上线
- 需求：画布上可放「一份可展开工作流」的节点：折叠态是卡片，展开态下钻。
- 行为与验收：折叠 / 展开不丢内部状态；展开态复用工作流编辑器画布
  （不是第二套渲染）。
- 落点：`src/components/studio/canvas/WorkflowSubgraphNode.tsx`、
  `SubgraphHeader.tsx`

#### FR-CV-04 服务端对账（索引并集 / 打开服务端项目先拉回本机）

- 状态：已上线
- 需求：侧栏项目列表 = 本地索引与服务端的并集；「服务端有、本机没有副本」
  的项目，打开时先拉回本机再落画布，不落闸门。
- 行为与验收：并集取数只有一个实现（侧栏与「所有项目」同一支）；
  拉回失败有可见出口。
- 落点：`src/components/studio/hooks/use-sidebar-projects.ts`、
  `use-open-server-project.ts`

#### FR-CV-05 从工作流库「使用」落到当前项目画布

- 状态：已上线
- 需求：在工作流库点「使用」→ 该工作流作为节点落到当前打开的项目画布。
- 行为与验收：跳转不丢「待落下工作流」意图（经 workspace 的
  pending 状态中转，而非 URL 参数）；落点后即选中可编辑。
- 落点：`src/app/workspace/page.tsx`（`handleUseWorkflow`）

#### FR-CV-06 项目内资源库视图

- 状态：已上线
- 需求：项目内可管理本项目资源（素材 / 中间产物）。
- 行为与验收：资源库是项目页签之一（`library`），只在项目界面出现；
  内容与「产出」视图区分（资源是输入 / 中间态，产出是成品）。
- 落点：`src/components/studio/library/ResourceLibrary.tsx`

---

## 4. 工坊（FR-WP）

> 链路流程（阶段图 / 分叉 / 失败出口）以
> `docs/guides/feature-workshop-flow.md` 为功能方向口径；本节只钉需求与验收。

#### FR-WP-01 六阶段流水线

- 状态：已上线
- 需求：工坊以六阶段组织创作：① 剧本 → ② 角色卡（含定妆照）→
  ③ 场景分镜 → ④ 镜头生图 → ⑤ 视频生成 → ⑥ 成片合成。
- 行为与验收：阶段定义只有一份（`STAGE_DEFS`），阶段标题与导航同源；
  每阶段有独立编辑面与完成度记账（`computeStageRatios`）。
- 落点：`src/components/workshop/stage-config.ts`、
  `src/components/workshop/WorkshopPipeline.tsx`

#### FR-WP-02 阶段导航与缺失素材提示

- 状态：已上线
- 需求：阶段顺序是**推荐流不是闸门**；右栏提示下游阶段缺失的素材。
- 行为与验收：缺前置素材时给温和提示（如「先在剧本阶段编写」），
  **不静默阻断也不放行造假**：确需前置的操作（如剧本为空就提取角色）
  按钮禁用 + 原因文案。
- 落点：`src/components/workshop/WorkshopStageRail.tsx`、
  `WorkshopAside.tsx`、`stagePrereq`

#### FR-WP-03 本地生成通道（ComfyUI 工作流）

- 状态：已上线
- 需求：镜头生图 / 视频生成可走本机 ComfyUI：入口
  `generate.generate`（tRPC）→ 写 task 行 → 入队 → SSE 回写。
- 行为与验收：本地通道**无内置模板**，唯一可执行来源是工作流库
  （没选工作流时给阻断文案）；进度与执行日志经 SSE
  `/api/tasks/:id/stream`；未落到端口的输入在发起前提示（哪些设置本次未生效）。
- 落点：`src/lib/workshop/generation-client.ts`（`startLocalGenerate`）、
  `src/server/api/routers/generate.ts`

#### FR-WP-04 API 直连通道（远端模型 relay）

- 状态：已上线
- 需求：同一两阶段可走远端模型：`POST /api/workshop-api/generate` relay，
  异步任务靠轮询推进。
- 行为与验收：分叉只发生在镜头生图 / 视频生成两阶段；密钥只在服务端
  （浏览器只见脱敏视图）；远端 API 未配置时通道按钮标注「未配置」并给引导。
- 落点：`src/app/api/workshop-api/generate/route.ts`、
  `src/lib/workshop/generation-client.ts`（`apiGenerateImage` 等）

#### FR-WP-05 草稿持久化（本地 + 服务端镜像 + 项目索引）

- 状态：已上线
- 需求：任何阶段编辑都持久化；清缓存 / 隐私模式 / 存储重置都不丢内容。
- 行为与验收：600ms 防抖写 localStorage（`comfyapp.workshop.draft.<项目id>.v1`）
  与服务端镜像（`workshopDraft` 表）；卸载时立即落盘；切项目先落盘当前再读目标；
  服务端真值优先但只覆盖「本地为空」的项目；**服务端镜像不含**工坊选定的
  `workflowId` / `videoWorkflowId`（本机设备选择，只落本地）。
- 落点：`src/lib/workshop/draft-store.ts`、
  `src/app/api/workshop/draft/route.ts`、`src/server/workshop/draft-repository.ts`

#### FR-WP-06 定妆照上传到 ComfyUI 输入目录

- 状态：已上线
- 需求：角色卡的定妆照可上传并供本机生图引用。
- 行为与验收：上传把本机图放进 ComfyUI 输入目录再引用
  （`preparePortraitReferences`）；失败有错误条，不静默丢图。
- 落点：`src/app/api/workshop-local/prepare/route.ts`、
  `src/lib/workshop/`（portrait references）

#### FR-WP-07 服务端编排（5 阶段 orchestrator）

- 状态：灰度（MCP 驱动）
- 需求：服务侧有一条 5 阶段编排（脚本 / 角色 / 分镜 / 生图 / 生视频）+ 成片合成，
  由 MCP 工具调用；界面当前不直连它。
- 行为与验收：编排是纯函数流水线（`src/server/workshop/orchestrator.ts`）；
  会话落 `workshopSession` 表；界面多项目草稿与服务端创作结果是两套，
  不互相写入。
- 落点：`src/server/workshop/orchestrator.ts`、`src/server/mcp/workshop-mcp.ts`

#### FR-WP-08 AI 自主执行 run（项目主页操纵台）

- 状态：灰度（Phase 6 地基）
- 需求：项目主页提供 AI 自主成片操纵台：启动 / 暂停 / 恢复 / 审批 /
  取消，以及文本评审与单镜重生成。
- 行为与验收：run 生命周期有服务端真值（`production.run` 列）；
  控制面齐全（`run` router：status / start / pause / resume / approve /
  cancel / reviewShot / reviewCharacter / regenerateShot）；界面只投影不私存。
- 落点：`src/server/api/routers/run.ts`、
  `src/components/studio/project-home/`

---

## 5. 工作流库（FR-WF）

> 链路流程以 `docs/guides/feature-workflow-library-flow.md` 为功能方向口径。

#### FR-WF-01 列表与本地磁盘扫描

- 状态：已上线
- 需求：库列表 = 已入库工作流 + 本地磁盘扫到未入库的「待载入」占位行。
- 行为与验收：待载入行的 id 由绝对路径 sha1 派生（`pendingId`），记住
  `sourcePath`；扫描根来自设置里的 ComfyUI 路径推导，不在库里另配一份。
- 落点：`src/server/api/routers/workflow-list.ts`、
  `src/lib/workflow/localWorkflows.ts`

#### FR-WF-02 三条导入路径

- 状态：已上线
- 需求：① 粘贴 JSON / 拖入文件；② 本地待载入项「⤓ 载入」；
  ③ 已有行编辑（改模式 / 标签 / paramMap）。
- 行为与验收：三条路径都落到 `workflowTemplate` 行；导入只认
  ComfyUI **RAW**（导出工作流格式），逐字落 `rawJson`，**不做格式互转**；
  API 格式（导出 API）明确不支持导入。
- 落点：`src/components/studio/workflow-library/hooks/use-workflow-import.ts`、
  `src/server/api/routers/workflow-mutations.ts`

#### FR-WF-03 只认 ComfyUI RAW 格式

- 状态：已上线
- 需求：库里承存的只有 RAW 原件；任何「猜格式 / 互转」的顺手转换都不做。
- 行为与验收：识别链是 `isRawWorkflowJson`；非 RAW 给可读的拒绝原因，
  不静默导入一份半成品。
- 落点：`src/lib/workflow/`（RAW 识别）、`workflow-mutations.ts`

#### FR-WF-04 详情四页签

- 状态：已上线
- 需求：打开一条工作流的详情有四个页签，顺序即渲染顺序：
  **工坊封装**（默认）/ **编辑对外参数** / **实际使用** / **源文件**。
- 行为与验收：默认落最轻的页签（工坊封装）——不牵画布引擎与 JSON 树；
  「编辑对外参数 / 实际使用」共用同一常驻实例，切页签只切视图模式，
  表单值与运行态不丢。
- 落点：`src/components/studio/workflow-library/workflow-library-detail-config.ts`
  （`DETAIL_TABS` / `DEFAULT_DETAIL_TAB`）

#### FR-WF-05 工作流参数与 IO 编辑

- 状态：已上线
- 需求：可编辑工作流对外暴露的参数（paramMap）与输入 / 输出端口映射
  （workflowIO）。
- 行为与验收：参数编辑在「编辑对外参数」页签的画布上做（落点 ↔ 端口）；
  IO 映射含节点内建 IO；改动即时进 `workflowTemplate` 行。
- 落点：`src/lib/workflow/workflow-param-mapping.ts`、
  `src/lib/workflow/workflow-io-types.ts`、`io-exposure.ts`

#### FR-WF-06 磁盘跟踪（校验和重链 / diskDirty / diskMissing）

- 状态：已上线
- 需求：库与磁盘文件是「跟踪」关系：文件被重命名 / 移动能自动重链；
  内容变了提示同步；文件没了如实说。
- 行为与验收：按内容校验和自动重链重命名文件；`diskDirty` → 「↻ 同步」入口；
  `diskMissing` → 「文件已不存在」；三种态都不静默。
- 落点：`src/lib/workflow/localWorkflows.ts`、
  `src/server/api/routers/workflow-mutations.ts`（`resync`）

#### FR-WF-07 就地运行（两个入口、同一份运行态）

- 状态：已上线
- 需求：不跳画布，在库内直接运行选中工作流；入口有两个（「实际使用」页签的
  ▶ 生成、「工坊封装」页签的执行流程测试），共用同一份运行态。
- 行为与验收：运行登记表在客户端（`workflow-run-store`，localStorage 写穿，
  上限 32 条运行 / 300 行日志）；运行日志有弹窗（`WorkflowRunLogModal`）；
  两个入口不各存一份态。
- 落点：`src/lib/workflow/workflow-run-store.ts`、
  `src/components/studio/workflow-library/WorkflowRunLogModal.tsx`

#### FR-WF-08 模式与模型标签

- 状态：已上线
- 需求：工作流可按内容类别分栏（`modes` / `defaultMode`）；可打模型标签
  并可按标签筛选。
- 行为与验收：模式与标签落在 `workflowTemplate` 行与
  `workflowModelTag`（显式 m2m）；标签库是用户级全局（`workflowModel` router）。
- 落点：`src/server/api/routers/workflow-mutations.ts`、
  `src/server/api/routers/workflow-model.ts`

---

## 6. 生成与任务（FR-GN）

#### FR-GN-01 统一生成入口

- 状态：已上线
- 需求：所有生成（画布 / 工坊 / 就地运行）走同一个入口：写 task 行 + 入队。
- 行为与验收：入口只有一个（`generate.generate`）；调用方不自己拼
  `<rev>:<path>` 逐条 rev-parse（取证走 `merged-side-loss-git` 层，
  回归见 `tests/merged-side-loss-git.test.ts` 末组）。
- 落点：`src/server/api/routers/generate.ts`

#### FR-GN-02 任务状态机

- 状态：已上线
- 需求：任务五态：`QUEUED` → `RUNNING` → `SUCCEEDED` / `FAILED` /
  `CANCELLED`；终态集合只有一个出处。
- 行为与验收：`TERMINAL_TASK_STATUSES` 是终态判据单一出处；服务端 SQL 侧
  派生与客户端同源（`repository-task.ts` 的 `TERMINAL_STATES`）；
  取消是终态（不是「即将消失的中间态」）。
- 落点：`src/lib/task-state.ts`、`src/lib/core/repository-task.ts`

#### FR-GN-03 SSE 进度与执行日志

- 状态：已上线
- 需求：任务进度与执行日志实时到端；日志含节点级进度。
- 行为与验收：`GET /api/tasks/:id/stream` 是唯一进度通道；断线不猜状态
  （重连后以服务端真值为准）；远端通道的进度靠轮询（响应式不同，
  不冒充 SSE）。
- 落点：`src/app/api/tasks/[id]/stream/route.ts`

#### FR-GN-04 任务取消

- 状态：已上线
- 需求：在跑 / 排队任务可取消；取消后状态回 `CANCELLED`，素材侧提示
  「已取消，可重新生成」。
- 行为与验收：取消经 `task.cancel`；取消后不留在「假在跑」态
  （reaper 对账兜底，见 FR-QE-04）。
- 落点：`src/server/api/routers/task.ts`

#### FR-GN-05 历史列表

- 状态：已上线
- 需求：任务历史分页 / 按日分组 / 筛选 / 排序。
- 行为与验收：分页一页 8 条（`PAGE_SIZE`）；排序 newest / oldest；
  列表在「历史」视图，不占独立路由。
- 落点：`src/components/studio/history/HistoryList.tsx`、
  `src/components/studio/history/hooks/use-history-list.ts`

#### FR-GN-06 任务详情弹窗

- 状态：已上线
- 需求：任务详情在历史列表内的弹窗查看（产物网格 + 执行日志 +
  comfy-cli 原始输出 + 打开目录）。
- 行为与验收：详情是弹窗不是独立路由（「在这里点开就显示详情」）；
  产物行带 `localPath` / `mediaType` / seed / 宽高；
  `raw-cli` 是 comfy-cli 完整原始输出（排障用，不加工）；
  打开目录走 FR-OP-05 的闸门。
- 落点：`src/components/studio/history/HistoryDetailModal.tsx`

#### FR-GN-07 任务删除与工作流快照下载

- 状态：已上线
- 需求：任务可删除（限流）；可下载该任务当时的工作流快照。
- 行为与验收：删除是限流 mutation（防误触连点）；快照来自任务的
  `workflowSnapshot`（执行时固化，不随后续库编辑变）。
- 落点：`src/server/api/routers/task.ts`（`delete` / `workflow`）

---

## 7. 队列与执行（FR-QE）

#### FR-QE-01 队列监视视图

- 状态：已上线
- 需求：独立「队列」视图看在跑与排队的任务。
- 行为与验收：与 ComfyUI 内部队列对账展示（不另造一份假队列）；
  切走再切回保留滚动与筛选。
- 落点：`src/components/studio/queue/QueueMonitor.tsx`

#### FR-QE-02 执行器 inline / host 两档

- 状态：灰度（开关默认 inline）
- 需求：ComfyUI 执行可分两档：inline（应用进程内调度，默认）与
  host（独立宿主进程，`COMFY_EXECUTOR=host` 开启）。
- 行为与验收：开关只认壳进程继承的环境变量；不写开关 = inline，
  与灰度前逐字相同；派发循环只有一个实现（`executor-dispatch.ts`），
  不存在两条 pull；host 侧宿主是 `scripts/executor-host.mjs`。
- 落点：`src/lib/comfyui/executor-mode.ts`、
  `src/lib/comfyui/executor-dispatch.ts`、`scripts/executor-host.mjs`、
  `docs/guide-executor-host.md`

#### FR-QE-03 任务归属

- 状态：已上线
- 需求：任务记录由谁执行（`claimedBy` ∈ `inline` / `host`）与何时认领。
- 行为与验收：NULL 归 inline（判决在 `executor-mode.ts` 单点）；
  归属可见（排障时能回答「这条任务谁在跑」）。
- 落点：`src/server/db/schema.ts`（`task.claimedBy` / `claimedAt`）、
  `src/lib/comfyui/executor-mode.ts`

#### FR-QE-04 陈旧任务回收（reaper）

- 状态：已上线
- 需求：卡死的任务被回收：`QUEUED` 超 30s 无 promptId → `FAILED`；
  `RUNNING` 拿 ComfyUI `/history` + `/queue` 对账定终态。
- 行为与验收：inline 侧（`src/instrumentation.ts`）与 host 侧
  （`scripts/executor-host.mjs`）各一处显式启动，加载零副作用；
  死信规则只收「没有任何宿主片会领」的行；回收幂等（跳过安全，下轮重跑）。
- 落点：`src/lib/comfyui/reaper.ts`、`src/lib/comfyui/lifecycle-*.ts`

---

## 8. 产出与成片（FR-OP）

#### FR-OP-01 产出网格

- 状态：已上线
- 需求：项目产出以网格汇总，大数量不卡。
- 行为与验收：列表虚拟化（`@tanstack/react-virtual`）；产物行来自
  `taskImage`（含封面 / 排序）；空项目有空状态。
- 落点：`src/components/studio/ProjectOutputs.tsx`

#### FR-OP-02 视频队列弹窗（只读）

- 状态：已上线（批量提交已退役）
- 需求：视频类任务的队列可集中查看；4s 轮询刷新。
- 行为与验收：**只读**——批量提交草稿页签已整格撤掉（#2169），
  本弹窗不再承担提交；点任务进详情（入口以历史视图为准，
  见 #2422）。
- 落点：`src/components/studio/VideoQueueModal.tsx`、
  `src/lib/media/video-queue-client.ts`

#### FR-OP-03 成片项目

- 状态：已上线
- 需求：成片是独立项目实体：自由建片 / 从统一项目建片；逐镜管理；
  可起跑 / 取消。
- 行为与验收：`filmProject` ↔ `filmShot` 一对多；逐镜关联
  `production.shots[].id` 与 taskId；从项目建片不复制素材、
  只建关联。
- 落点：`src/server/api/routers/film.ts`、
  `src/components/studio/FilmStudio.tsx`

#### FR-OP-04 成片合成（服务端 ffmpeg + BGM）

- 状态：已上线
- 需求：成片可合成出 mp4；可配 BGM。
- 行为与验收：合成走服务端 ffmpeg（`compose-film.ts`）；缺 ffmpeg 时
  **如实提示**「本次仅产出合成清单」，不静默降级；
  BGM 上传 / 选择有独立入口（`/api/film/bgm`）。
- 落点：`src/server/film/compose-film.ts`、
  `src/server/film/orchestrator.ts`、`src/app/api/film/bgm/route.ts`

#### FR-OP-05 产物寻址与打开

- 状态：已上线
- 需求：产物落盘规则可预期；打开产物目录有闸门。
- 行为与验收：路径规则唯一出处 `output-paths.ts` / `output-layout.ts`
  （普通 `generated/<taskId>`、项目 `generated/projects/<projectId>/<taskId>`、
  成片 `generated/films/<id>.mp4`）；打开目录优先 `setting.revealPath`
  （闸门：存在 + 在检出目录内），`comfyapp://` 深链是老路（见 FR-MC-02）；
  读产物经 `/api/generated/...`。
- 落点：`src/lib/media/output-paths.ts`、`output-layout.ts`、
  `src/lib/history-detail-actions.ts`

---

## 9. 模型库（FR-MD）

#### FR-MD-01 模型扫描与列表

- 状态：已上线
- 需求：扫描 ComfyUI 模型目录，列出模型（按目录分组）。
- 行为与验收：扫描可重扫（`model.sync`）；条目唯一键是
  `fileName + folder`；扫描根来自设置里的 ComfyUI 路径。
- 落点：`src/server/api/routers/model.ts`、`src/lib/models.ts`

#### FR-MD-02 每目录启用管理

- 状态：已上线
- 需求：可按目录启用 / 停用 / 删除模型配置（决定创作时暴露哪些模型）。
- 行为与验收：启用态在 `userModelConfig`（用户级）；停用即从创作面消失，
  不删磁盘文件。
- 落点：`src/server/api/routers/model.ts`（`configList` / `configSave` /
  `configDelete`）、`src/components/studio/hooks/use-model-folder-config.ts`

#### FR-MD-03 模型收藏

- 状态：已上线
- 需求：模型可收藏，便于快速找回。
- 行为与验收：收藏落 `favorite` 表（用户级）；收藏不改变启用态。
- 落点：`src/server/db/schema.ts`（`favorite`）

> 2026-10-26 #2424：`/models` 路由的**浏览版**实现（`src/components/model/**`）
> 已退役，路由页改挂工作区管理版 —— 模型库只有 `src/components/studio/` 一份
> 实现，FR-MD 各条的 UI 落点以它为准。

---

## 10. 控制台（FR-CS）

#### FR-CS-01 预设命令七组

- 状态：已上线
- 需求：控制台提供预设命令：质量门禁 / 数据库 / 启动与端口 / 版本库（只读）/
  诊断 / 规范与文档等七组。
- 行为与验收：预设清单唯一出处 `console-catalog.ts`；版本库组全部只读
  （不提供写操作的预设）。
- 落点：`src/lib/console/console-catalog.ts`、
  `src/components/console/ConsoleView.tsx`

#### FR-CS-02 执行与 SSE 输出

- 状态：已上线
- 需求：命令执行后实时看输出：`start` → `out` → `exit` 三段事件流。
- 行为与验收：`POST /api/console/run` 回 SSE；退出码原样回传
  （不把非零念成「没跑」）；忙时（已有命令在跑）拒绝并说明。
- 落点：`src/app/api/console/run/route.ts`

#### FR-CS-03 三道安全闸与执行边界

- 状态：已上线
- 需求：执行前三道闸：回环请求 / 会话 / 入参形态（不经过平台 shell）；
  执行有边界：命令长度上限、时长上限（10 分钟）、忙时拒绝、
  断开即回收整棵进程树。
- 行为与验收：三道闸缺一不可；**刻意不做**危险命令黑名单
  （黑名单是会静默失效的清单）；进程回收走
  `killProcessTree()`（整树，不单杀 leader）。
- 落点：`src/app/api/console/run/route.ts`、`src/lib/console/console-guard.ts`、
  `docs/guide-console.md`

#### FR-CS-04 输入框边界（不是 shell）

- 状态：已上线
- 需求：输入框只接受「一条预设或其参数形态」，不是任意 shell。
- 行为与验收：入参经 `parseConsoleLine` 形态校验；不接受管道 /
  重定向 / 多命令串；边界写在输入框附近（用户看得见）。
- 落点：`src/app/api/console/run/route.ts`（`parseConsoleLine`）

---

## 11. ComfyUI 后端管理（FR-CU）

#### FR-CU-01 后端控制视图

- 状态：已上线
- 需求：ComfyUI 有**自己的屏**：运行状态、启动 / 关闭 / 打开查看、
  每次启动的日志。与「设置 → 创作后端」（改配置）分开。
- 行为与验收：归全局视图（与「当前是哪个画布项目」无关）；
  切走再切回保留滚动与全屏日志态；探不到时说出候选与原因。
- 落点：`src/components/studio/comfyui/ComfyuiControl.tsx`

#### FR-CU-02 就绪探测与 ensure

- 状态：已上线
- 需求：用前确保后端就绪：探测 / 确保 / 停止 / 打开 / 状态查询。
- 行为与验收：`probeComfyUi()` / `ensureComfyUiReady()` 等是唯一入口；
  启动中不重复拉起（globalThis 单飞锁）；失败有退出报告
  （`lifecycle-exit.ts`），不静默。
- 落点：`src/lib/comfyui/lifecycle.ts`、`lifecycle-derive.ts`、
  `lifecycle-launch.ts`、`lifecycle-exit.ts`

#### FR-CU-03 队列与统计面

- 状态：已上线
- 需求：后端队列与统计可查（在跑 / 排队 / 系统状态），队列变化可订阅。
- 行为与验收：REST 面在 `/api/comfy/*`（ensure / liveness / queue /
  stats / state / queue events）；消费方不各自拼 ComfyUI 地址
  （端点收口见规范 12 §12.14）。
- 落点：`src/app/api/comfy/*/route.ts`

#### FR-CU-04 创作后端配置

- 状态：已上线
- 需求：设置里可配：安装路径 / 端口 / 启动参数 / comfy-cli Python 解释器 /
  CPU 档位 / 是否自动启动。
- 行为与验收：配置落设置分区「创作后端」；改端口不与 dev 端口族相撞
  （端口契约见规范 §1.1）；改路径后下次启动生效并有权威提示。
- 落点：`src/server/api/routers/setting.ts`（`comfy*` procedures）、
  `src/app/(main)/settings/`

#### FR-CU-05 真出图前提（comfy-cli 解释器）

- 状态：已上线（带边界）
- 需求：桌包里要真出图，还需一个装好 comfy-cli 的 Python 解释器
  （百 MB 级环境，不随包）。
- 行为与验收：解释器路径填在「设置 → 创作后端」；留空时行上的错误
  与建议可读（指向指南第 4 点），不静默失败。
- 落点：`docs/guide-executor-host.md`、设置「创作后端」分区

---

## 12. LLM 与模式契约（FR-LM）

#### FR-LM-01 LLM 配置

- 状态：已上线
- 需求：LLM 可配 provider（`local` / `remote`）、baseUrl、模型、密钥。
- 行为与验收：provider 是收紧的 enum（不接受任意字符串）；
  密钥脱敏——客户端只看到「有没有配」，不回明文。
- 落点：`src/server/api/routers/llm.ts`、`src/lib/llm/types.ts`

#### FR-LM-02 本地候选与远端独立模型

- 状态：已上线
- 需求：本地候选模型（纯名字串）与远端独立模型（可带独立 baseUrl / apiKey）
  分开放。
- 行为与验收：本地候选在 `llmConfig.extraModels`；远端独立模型在
  `remoteModel` 表；拆分逻辑单点（`splitExtraModels()`）。
- 落点：`src/server/db/schema.ts`（`remoteModel`）、
  `src/lib/llm/types.ts`

#### FR-LM-03 按任务温度

- 状态：已上线
- 需求：不同任务类型可用不同温度（`txt2img` / `img2video` / `chat` /
  `code` / `creative`）。
- 行为与验收：映射表是 `TASK_TYPES` → `temperatureByTask`；
  未配置任务回落默认温度，不报错。
- 落点：`src/lib/llm/types.ts`

#### FR-LM-04 模式契约注册表

- 状态：已上线
- 需求：每种生成模式声明统一输入 / 输出（契约），是工作流配落点的依据。
- 行为与验收：契约可读可写（`modeContractsGet` / `modeContractsSave`）；
  「模式契约」是全局瞬态视图（与当前项目无关）。
- 落点：`src/components/workshop/mode-contract/ModeContractView.tsx`、
  `src/server/api/routers/llm.ts`

#### FR-LM-05 模型适配器

- 状态：已上线
- 需求：每个远端模型 × 每个模式可配字段映射（统一输入 → 接口字段名）。
- 行为与验收：适配器可读可写（`workshopAdaptersGet` / `Save`）；
  「模型适配」是全局瞬态视图。
- 落点：`src/components/workshop/ModelAdaptersView.tsx`、
  `src/server/api/routers/llm.ts`

#### FR-LM-06 远端生图 / 生视频接入

- 状态：计划中（配置已在，运行时未接）
- 需求：远端模型除 chat 外，还将承画图 / 视频生成。
- 行为与验收：`REMOTE_MODEL_KINDS` 已含 `image` / `video`（先落配置）；
  当前运行时只有 chat 参与；接入时以 FR-WP-04 的 relay 为落点，
  不新开第三条通道。
- 落点：`src/lib/llm/types.ts`（`REMOTE_MODEL_KINDS`）

---

## 13. 设置（FR-ST）

#### FR-ST-01 九个设置分区

- 状态：已上线
- 需求：设置九分区：外观 / 应用更新 / 本地模型（Ollama）/ 远程模型 /
  创作后端 / 数据库 / 备份与恢复 / 退出与后台服务 / 日志。
- 行为与验收：分区表唯一出处（`SETTINGS_SECTIONS`）；外壳三态
  （首帧 loading / 失败降级 / 就绪）；同一份实现挂两个点
  （工作区设置页签 + `/settings` 路由），只差视口高度。
- 落点：`src/app/(main)/settings/hooks/use-settings-page-types.ts`、
  `src/components/settings/SettingsView.tsx`、`SettingsShell.tsx`

#### FR-ST-02 备份与恢复

- 状态：已上线
- 需求：数据库可备份 / 恢复；保留最近 3 份；恢复下次启动生效。
- 行为与验收：备份走 `VACUUM INTO` + `integrity_check` 验证，落
  `<应用根>/data/backups/`；恢复**只写标记**，真正换文件在下次启动
  （`applyPendingRestoreAtBoot`）；**刻意不提供**就地换文件
  （运行期多进程持有该库）；换文件前必先留退路。
- 落点：`scripts/db-backup-core.mjs`、
  `src/server/api/routers/setting.ts`（`backup*`）、
  `docs/guide-database-backup.md`

#### FR-ST-03 退出与后台服务

- 状态：已上线
- 需求：退出应用时杀掉后台拉起的服务（ComfyUI / Ollama）。
- 行为与验收：退出即杀（不等自然超时）；杀整棵树（平台判据收两处，
  见 AGENTS 硬规则 3）。
- 落点：`src/server/api/routers/setting.ts`（exit 区）、
  `src/lib/process/kill-process-tree.ts`

#### FR-ST-04 数据库工具

- 状态：已上线
- 需求：可从这里起停 Drizzle Studio、在浏览器打开。
- 行为与验收：起停有状态回显（不假装「已起」）；端口不撞 dev 端口族。
- 落点：`src/server/api/routers/setting.ts`（`dbStudio*` procedures）

---

## 14. 集成（FR-MC）

#### FR-MC-01 工坊 MCP

- 状态：已上线（界面侧会话共享待后续）
- 需求：外部 AI 客户端可经 MCP 端到端指挥工坊创作：17 个工具
  （会话 / 元信息 / 剧本 / 角色 / 分镜 / 生图 / 视频 / 合成 / 绑工作流）。
- 行为与验收：两个 transport（stdio / http，`pnpm mcp:stdio` /
  `pnpm mcp:http`）；**只可达本机回环**；HTTP origin 逐条登记
  （`MCP_HTTP_ALLOWED_ORIGINS`，不做通配）；会话落 `workshopSession` 表。
  边界：MCP 与界面**目前不共享会话**（界面侧接入待后续）。
- 落点：`src/server/mcp/workshop-mcp.ts`、`tools/workshop-mcp-stdio.ts`、
  `tools/workshop-mcp-http.ts`、`docs/workshop-mcp.md`

#### FR-MC-02 comfyapp:// 深链

- 状态：已上线
- 需求：经 `comfyapp://open?path=<产物目录>` 打开产物目录；未装协议助手时
  给可执行提示，不静默失败。
- 行为与验收：URL 由服务端产生（`task.openFolder`）；助手探测有判据
  （导航后 2s 内页面失焦视为 OS 已接管，否则提示安装）；
  注册入口跨平台（`register-comfyapp-protocol.ps1` /
  `install-comfyapp-helper.ps1` / `api/helper/{install,status}`）。
  已知风险：helper 由外部实现，需单独审计防任意网页利用本机路径
  （P3 卫生条目）。
- 落点：`src/lib/external-open.ts`、
  `src/server/api/routers/task.ts`（`openFolder`）

#### FR-MC-03 revealPath（系统文件管理器打开）

- 状态：已上线
- 需求：在系统文件管理器里揭示产物目录；有闸门（路径存在 + 在检出目录内）。
- 行为与验收：队列面板等处的「打开目录」走它（未装协议助手时也有确定行为）；
  越界路径拒绝并说明。
- 落点：`src/server/api/routers/setting.ts`（`revealPath`）、
  `src/lib/history-detail-actions.ts`

#### FR-MC-04 应用更新端到端

- 状态：计划中（P0-2，等外部输入）
- 需求：应用可检查更新并完成下载 / 安装 / 重启。
- 行为与验收：**检查**已在役（手动快捷键 + 自动开关，本地读数）；
  端到端还缺：minisign 密钥对 + 托管 latest.json 的 HTTPS 地址
  （`tauri.conf.json` 的 updater 段待配）。缺件时**不假装能更新**
  （检查结果如实呈现）。
- 落点：`src/components/update-check/`、`src/lib/shell/app-update-client.ts`、
  `docs/guides/PRODUCTION-GAPS.md`（P0-2）

---

## 15. 系列与剧集结构（FR-SR）

> 北极星「多剧集影视动漫」的结构承载（[overview §1.2 / §5.2](overview.md)）。
> **容器层已实现（#2477）**：`series` / `season` / `episode` 三表 + `episode.projectId`
> 外链 + tRPC `series` router + 项目主页「系列/季/集」面板。角色库（`character` 实体表）
> 已在 schema 落地，**系列角色库 router + UI + 与 `production.characters` 双向同步**为下一切片。
> 角色与镜头目前仍是 `production` 的 JSON 列（破坏性抽取走 `db:migrate`，单列处理）。

#### FR-SR-01 系列（Series）实体与层级

- 状态：已实现（容器层，#2477）
- 需求：一部作品 = 一个系列；层级为 **系列 → 季 → 集 → 创作链路**（剧本 / 角色 /
  分镜 / 镜头）。系列持有跨集共享的东西（角色库、风格锚、场景设定）。
- 行为与验收：① schema 里有 `series` 表，且 `episode` 经外键链到它（不是靠名字匹配）；
  ② 新建一集时可直接**引用**所属系列的角色与风格，不需要重新生成（角色引用待 PR2 角色库）；
  ③ 删除系列时，其它系列的资产不受影响（`onDelete: "cascade"` 仅清本系列子树，不波及他系列）；
  ④ 现有数据可迁移：既有的 `project` / `production` 归入一个默认系列，迁移后**不丢**（未做自动回填，
  由用户在新面板手动归属，零数据风险）。
- 落点（现状）：`src/server/db/schema.ts`（`series` / `season` / `episode` 三表）、
  `src/server/api/routers/series.ts`、`src/components/studio/project-home/SeriesOrganizer.tsx`

#### FR-SR-02 季（Season）与集（Episode）

- 状态：已实现（容器层，#2477）；集号唯一约束与单集时长校验待补
- 需求：集有**季号 / 集号 / 排序 / 单集目标时长**；一集 = 一次完整创作链路 + 一部成片。
- 行为与验收：① 列表按 (季号, 集号) 排序（`seasons`/`episodes` 查询已 `orderBy`）；
  **同一系列内集号唯一约束**尚未加（目前是界面约定，待补唯一索引）；② 单集目标时长
  （`targetDurationSec`）字段已落，但其进入分镜阶段的总量校验**待做**；
  ③ 集号可调整且调整后顺序与成片导出顺序一致（字段已支持）。
- 落点（现状）：`src/server/db/schema.ts` 的 `episode`（`seasonId`/`episodeNumber`/
  `targetDurationSec`/`status`）、`src/server/api/routers/series.ts`

#### FR-SR-03 跨集资产复用（角色库 / 风格锚 / 场景库）

- 状态：计划中（实体表已落地，库 router + UI + 双向同步待 #2477 后续切片）
- 需求：角色、风格、场景成为**可被多集引用**的实体（引用，不是拷贝）。
- 行为与验收：① 在 B 集引用 A 集的角色后，改 A 集角色卡时给出「该角色被 N 集引用」的提示，
  **不静默改**（改了别的集会跟着变，这件事必须让操作者看见）；
  ② 引用关系可查（能列出「这个角色被哪些集用了」）；
  ③ **拷贝即失去一致性**：以「复制一份到本集」实现的复用不算本条达标。
- 落点（现状）：`character` 实体表与 `episode_character` 关联表已在 `src/server/db/schema.ts`
  落地（`series` 级角色库，字段对齐 `Character`）；系列角色库的 tRPC router + UI 面板 +
  与 `production.characters` 的双向同步为下一切片（#2477 续）。当前仍靠 `production.characters` JSON 列。

#### FR-SR-04 剧集级排期与批量（整季调度 / 断点续跑）

- 状态：计划中
- 需求：能一次提交**整季 / 跨集**的生成任务，并能从断点继续。
- 行为与验收：① 一次提交 N 集 × M 镜，失败只重跑失败项（已完成的不被动）；
  ② 中断后重跑从断点继续，**不重复已完成镜**（以 `taskId` 幂等，不是靠记忆）；
  ③ 进度可读到「第几集 第几镜」，不是只有一个总数。
- 落点（现状）：项目内批量并发上限 2（`src/lib/workshop/generation-client.ts`），
  只在单个项目内遍历 `Shot[]`，无跨集调度

#### FR-SR-05 剧集元数据与导出（交付清单）

- 状态：计划中
- 需求：每集有标题 / 简介 / 封面 / 字幕，并能导出一份**交付清单**。
- 行为与验收：① 导出清单逐集列出：成片路径、时长、分辨率、文件大小、字幕文件；
  ② 封面可指定，默认取第一镜关键帧（不指定时也有确定行为）；
  ③ 字幕文件与成片同源（改了字幕要能重新合成，不是另存一份）。
- 落点（现状）：成片落 `generated/films/<id>.mp4`（`src/server/film/compose-film.ts`），
  无剧集级元数据与清单导出

---

## 16. 成片质量与一致性（FR-QA）

> 六阶段各一条质量口径。逐阶段的**完整契约**（输入 / 输出 / 人的用法 / AI 的用法 /
> 验收 / 当前状态 / 已知缺口 / 代码落点）在
> [pipeline-stages.md](pipeline-stages.md) 的同名阶段节 —— 本节只写「这一条要判什么」，
> 不重复那份契约。

#### FR-QA-01 剧本质量口径

- 状态：计划中
- 需求：剧本要**能被下游自动拆出场景**，且类型 / 基调要真的进入后续提示词。
- 行为与验收：① 生成的剧本能被拆出 `Scene[]`，拆不出即为不可用（不是警告了事）；
  ② 改剧本的基调后重跑分镜，镜头描述随之改变（证明基调进了提示词
  `src/lib/workshop/prompt-builder.ts`）；③ 无「长度失控 / 重复段落」的评审环节 ⇒ 本条未达标。

#### FR-QA-02 角色一致性口径

- 状态：计划中
- 需求：同一角色跨镜、跨集可辨 —— 这是「多剧集能不能接上」的关键一条。
- 行为与验收：① 每个角色有且仅有一张**生效定妆照**（`portraitUrl`），缺锚定给出可见提示；
  ② 镜头按 `characterIds` 收集定妆照作为 `referenceImages` 上传，生图请求里能查到该字段；
  ③ **角色 ↔ 模型（LoRA）可绑定**（当前无此机制，LoRA 只能由工作流内部承载）；
  ④ 视觉一致性评审可用（当前只评审文本，`src/server/agent/review.ts` 等后续多模态能力）。

#### FR-QA-03 分镜质量口径

- 状态：计划中
- 需求：镜头表可执行：指向存在的角色、提示词随输入变化、时长可用。
- 行为与验收：① 每镜的 `characterIds` 都指向存在的 `Character`（指向不存在 = 红）；
  ② 改场景 / 角色 / `skill` 任一输入后重跑，提示词必须变化；
  ③ 镜头时长之和与成片目标时长同量级（全为 0 或空 = 分镜不可用）；④ 镜头顺序可回读不丢。

#### FR-QA-04 生图质量口径

- 状态：计划中
- 需求：关键帧可复现、可追溯，且失败能只重跑失败项。
- 行为与验收：① 同一 seed + 同一工作流 + 同一参考图重跑产出一致（复现性可验；
  **本地 ComfyUI 通道**判此条，API 直连通道在上游声明同 seed 确定性时才判）；
  ② 每张图能追回 `taskId` 与参数快照；③ 只重跑失败镜，已完成的不被动
  （历史面的任务级原样重跑见 #2481，带修改的重跑见 FR-QA-09）；
  ④ **自动优选（抽卡 N 选 1）**可用 ⇒ 当前未实现（依赖 FR-QA-07 的视觉评审）。

#### FR-QA-05 生视频质量口径

- 状态：计划中
- 需求：片段首帧即关键帧、时长与分镜一致、片段级可重试可审批。
- 行为与验收：① 首帧确实是 `Shot.imageUrl`（是图生视频，不是文生视频另起一张）；
  ② `clipStatus` 有终态、失败可单独重跑；③ 片段时长与分镜设定一致（差一个数量级 = 参数没传进工作流）；
  ④ 合成前所有镜头 `clipUrl` 非空；⑤ 片段级审批（人能否掉一条片段）⇒ 当前未实现。

#### FR-QA-06 合成质量口径

- 状态：计划中
- 需求：成片可交付：能播、时长对、缺镜不可合成、有黑帧 / 静音校验。
- 行为与验收：① 产出文件能播，时长等于各镜之和（含转场）；
  ② **缺任一镜头的 `clipUrl` 时不可进入合成**（不是合成出一部缺镜的片）；
  ③ 合成失败能定位到「哪一镜没就绪」；④ 成片有基础校验（黑帧 / 静音 / 分辨率不符）；
  ⑤ 工坊阶段⑥（客户端清单）与 `film`（服务端 MP4）**两条链路不混用**，且⑥有「去成片」的出口指引。
- 落点（现状）：`src/server/film/compose-film.ts`（真合成）、
  `src/components/workshop/FinalComposer.tsx`（清单）

#### FR-QA-07 质量评审与评分闭环

- 状态：计划中（承接：评分地基 #2477 · 剧本循环 #2478 · 图像评审 #2479）
- 需求：让 FR-QA-01 ~ 06 的静态口径**可执行**——评审产出**维度化数字评分**
  （每维度 1~5 分 + 分值锚点 + rubric 版本号），判定与每轮分数落库留痕，
  收敛条件是「分数阈值达线」而不是只有过 / 不过；剧本、角色、分镜、生图四环节
  用**同一套判定形状**（`ReviewVerdict` 扩展），剧本补上评审位（当前完全不在评审面）。
- 行为与验收：① `ReviewVerdict` 带 `scores`（维度 → 分 + 一句话依据）与 rubric 版本，
  旧数据（无 scores）读作「未评分」不报错；② `run.reviewScript` 可用，判定写回
  `production` 的剧本评审位（当前无 `reviewScript`，全仓可 grep 验证）；③ 剧本 /
  角色卡 / 分镜各有一张 rubric（每分值有锚点描述），评审温度走 `temperatureByTask`
  的 `review` 档（`TASK_TYPES` 现无此档）；④ run 引擎按「低分维度定向改写 → 再评」
  迭代，有界收敛（复用 `REVIEW_MAX_RETRY` 的有界思路），每轮分数可回看（分数曲线可查）；
  ⑤ 视觉评审可用：生图后按生图 rubric 打分（与提示词对齐 / 角色一致性对照定妆照 /
  构图景别 / 画面瑕疵），不合格自动走 `gacha` / `reprompt`，达上限不再自动重试、
  转人工（`src/server/agent/review.ts` 头注自证的 P8-2 由本条闭环）。
- 落点（现状）：`src/lib/production/review-types.ts`（判定形状）、
  `src/server/agent/review.ts`（评审执行器）、`src/server/agent/run-engine.ts`
  （自动评审阶段）、`src/lib/llm/prompts.ts`（评审 / 改写提示词）

#### FR-QA-08 人工评分与校准

- 状态：计划中（承接：#2480）
- 需求：人的判断**留痕且优先**——产物级人工评分 / 收藏（当前 `taskImage` 无任何
  评分字段，`favorite` 表只挂模型库），实体级人工裁决（approved / rejected + 理由）
  **优先于 AI 判定**；人评过的样本成为 AI 评审的校准基准。
- 行为与验收：① 历史页与工坊镜头卡可直接给产物打分 / 收藏，评分可查
  （`taskImage` 有评级字段且进产物元数据面板）；② 人判废的镜头 / 角色 / 剧本
  不因 AI 判过而放行进下一阶段（与 FR-AG-02「质量停点由人拍板」同口径）；
  ③ 能按维度聚合出「人评分 vs AI 评分」的偏差读数（只读查询即可），
  作为调 rubric 提示词的依据；④ 图像评审（FR-QA-07⑤）达上限转人工时，
  落到本条的裁决入口而不是无处可去。
- 落点（现状）：`src/server/db/schema.ts`（`taskImage` / `favorite`）、
  `src/components/studio/history/`、`src/components/workshop/ShotStudio.tsx`

#### FR-QA-09 带修改的重跑（局部重绘 / 放大）

- 状态：计划中（承接：#2483；原样重跑的历史面落点见 #2481，不占本条）
- 需求：图「方向对、局部有瑕疵」时不必整张重抽——产物 / 关键帧上可发起
  **局部重绘（inpaint）**与**放大（upscale）**，两者都是「带修改的重跑」，
  走既有 task 链路。
- 行为与验收：① 产物 / 镜头关键帧可画蒙版（画笔粗细级即可）并发起局部重绘，
  任务照走 `task` 链路（复用工作流模板 + 参考图注入）；② 产物有「放大重出」动作；
  ③ 重绘 / 放大的产物与原任务**可追溯**（能看出这是哪张改出来的，parentId 或等价）；
  ④ INPAINT / UPSCALE 不再只是 taskType 标签（现状：仅文案与模式猜测，
  无蒙版编辑器与专用入口）。
- 落点（现状）：`src/lib/workflow/model-mode-contract.ts:112`（仅模式标签）、
  `src/components/studio/outputs/ProjectOutputsMetadataSheet.tsx:29`（仅文案）

---

## 17. AI 操作者（FR-AG）

> AI 与人是**对等的操作者**（[overview §2.2](overview.md)）。
> 与 `FR-WP-07 / FR-WP-08` 的分工：那两条是**工坊内**的服务端编排与自主 run；
> 本域是**跨入口**的 AI 操作者契约。

#### FR-AG-01 双操作者同一能力面

- 状态：计划中
- 需求：人与 AI 读写**同一份状态与产物**，不存在第二套真值。
- 行为与验收：① 人在界面改了镜头，AI 接着跑读到的是改动后的版本（同一 `production.id`
  两侧读出一致的 `shots`）；② AI 改了内容，界面刷新后可见（不需要重开应用）；
  ③ MCP 会话与界面会话**共享**（当前不共享 —— `FR-MC-01` 明写的边界）⇒ 未共享即本条未达标。
- 落点：`src/server/api/routers/run.ts`、`src/server/mcp/workshop-mcp.ts`、
  `src/components/workshop/hooks/use-workshop-pipeline.ts`

#### FR-AG-02 自主编排含独立视频阶段与审批停点

- 状态：计划中
- 需求：自主成片的计划里有**独立的视频阶段**，并在关键节点有**人工审批停点**；
  AI 能全自动执行，但**不能自己判定质量**。
- 行为与验收：① 计划步骤里存在独立的 `render_videos`（不是合并进 `render_film` 一步触发）；
  ② 三个停点（生图后 / 生视频后 / 合成前）状态可查，未批准**不自动进入下一阶段**；
  ③ 任一停点可「重出单镜」（`regenerateShot`）而不回退整条链路；
  ④ 视觉评审未实现前，停点**默认停**（不默认放行）。
- 落点（现状）：`src/lib/production/run-types.ts`（规划步骤）、
  `src/server/agent/run-engine.ts`（`render_film` 合并触发了逐镜视频 + 合成）、
  `src/server/api/routers/run.ts`（`approve` / `reviewShot` / `regenerateShot`）

#### FR-AG-03 Skill 驱动的阶段策略

- 状态：计划中
- 需求：阶段的风格模板、参数与温度由 **skill** 决定，不是硬编码状态机。
- 行为与验收：① 改一个 skill 后，自主 run 生成的提示词随之变化（可验：同一输入两次跑，
  提示词按 skill 差异而不同）；② 新增一种风格**不改代码**（改 skill 记录即可）；
  ③ skill 覆盖不到的阶段有明确回落（不是静默用默认值）。
- 落点（现状）：`skill` 表 + `src/lib/workshop/prompt-builder.ts` 已支撑文本层；
  `run-engine.ts` 的动作仍是硬编码状态机

#### FR-AG-04 MCP 工具面覆盖六阶段 + 一键跑完

- 状态：计划中
- 需求：六阶段各有对应 MCP 工具，并有一个**复合工具**一次调用跑完指定阶段序列。
- 行为与验收：① 六阶段工具齐备（现状：17 个工具已覆盖）；
  ② 新增复合工具：一次调用指定阶段序列，返回**可轮询的 run id**（不是让外部 AI 自己编排）；
  ③ 工具清单与 `SERVER_INSTRUCTIONS` **一致**（#2475 已闭环：原说明谎称「成片合成暂未提供」，
  已补第 7 步 `workshop_compose_final`）。
- 落点：`src/server/mcp/workshop-mcp.ts`

#### FR-AG-05 机器面可观测与干预

- 状态：灰度
- 需求：AI 在跑什么、跑到哪、为什么停，人和外部 Agent 都**看得见、插得手**。
- 行为与验收：① `run` 控制面已提供 `status` / `start` / `pause` / `resume` /
  `approve` / `cancel` / `reviewShot` / `regenerateShot`（`src/server/api/routers/run.ts`）；
  ② 每个阶段有可读状态与停下的原因（不是只有一个「进行中」）；
  ③ **MCP 侧同样可查 run 控制面状态**（运行中 / 停在哪一步 / 停点原因 / 待审批）
  ⇒ 当前 MCP 只能查会话状态（`workshop_get_session`），查不到 run 控制面，是本条的缺口；
  ④ 干预只影响被干预的那一镜（不牵连已完成项）。
- 落点：`src/server/api/routers/run.ts`、`src/server/agent/run-engine.ts`、
  `src/server/mcp/workshop-mcp.ts`
