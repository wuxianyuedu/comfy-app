# 统一项目与生产模型（画布 / 工坊 / 成片收敛）设计

- 日期：2026-09-21
- 状态：提案（待评审）
- 类型：ADR + 统一生产模型草案（Phase 0 地基，不含行为改动）
- 范围：
  - 项目画布（`src/lib/project-canvas/`、`src/components/studio/ProjectCanvas.tsx`、`project` 表）
  - 工坊（`src/lib/workshop/`、`src/components/workshop/`、`workshopDraft` 表）
  - 成片（`src/server/film/`、`src/components/studio/FilmStudio.tsx`、`filmProject`/`filmShot` 表）
  - 工作区启动与视图切换（`src/app/workspace/page.tsx`）

---

## 1. 背景：四套并行的"项目"命名空间

同一个"作品/项目"概念，今天被四套互不引用的模型分别表达：

| 概念                     | id 前缀  | 存储                              | 归属列                  | 完成状态来源                                         |
| ------------------------ | -------- | --------------------------------- | ----------------------- | ---------------------------------------------------- |
| 画布项目 `CanvasProject` | `proj_*` | `project` 表 + localStorage       | `userId` NOT NULL       | 无（各节点自持 `status`）                            |
| 工坊 Workshop            | `wsp_*`  | `workshopDraft` 表 + localStorage | `userId` 可空           | 纯派生 UI 态（`use-workshop-pipeline.ts`），刷新即丢 |
| 成片 FilmStudio          | cuid     | `filmProject` / `filmShot` 表     | 仅 `userId`，无项目关联 | DB `status`/`progress`                               |
| 工坊服务端会话           | cuid2    | `workshopSession` 表              | `userId` 可空           | `stage` 列                                           |

**证据**：工坊代码里搜不到 `proj_` / `CanvasProject`；`filmProject` 没有 `projectId` 列。三者唯一的公共底座是**工作流库**（可执行来源）与 **task 表 + SSE**（生成链路）——工坊流程文档 `docs/feature-workshop-flow.md` 第 1 节自己写明"与项目画布同一条链路"。

**后果**：用户在工坊推进剧本/分镜/镜头，画布上看不到；画布上跑的东西工坊不认得；成片又是第三个孤岛。这就是"割裂"的根因。

**关键前提**：目标能力"AI 从剧本自动产出完整短剧"**已经存在**——`src/server/film/orchestrator.ts` 的 `createFilm → startFilm → watchFilm → composeFilm`（含 ffmpeg 合成）就是端到端自动驾驶，只是被关在 FilmStudio 视图里、不共享项目。本设计不重造 AI，而是**收敛项目模型 + 把已有编排接上去**。

## 2. 目标

- 一个**统一项目**作为脊柱：画布与工坊是同一项目的两种投影（画布=图操作，工坊=流水线操作），共享同一份"场景 / 角色 / 镜头"生产模型与同一份完成状态。
- **shot 级双向同步**：工坊产出一个镜头，画布即出现对应节点；画布上对某镜头的生成/编辑，工坊阶段视图同步反映。
- 启动后**先建项目**再进入后续操作（Phase 1 落地）。
- 终局：在项目里输入剧本 → AI 跑完六阶段 → 画布与工坊实时看同一份进度 → 产出成片。

## 3. 非目标

- 不迁移存量数据（当前基本无数据，见决策 D2）。
- 不改生成链路本身（`generate.generate` + task + SSE 与工作流库口径不动）。
- Phase 0 只交付本设计 + 模型草案，不落地代码；代码在 Phase 1–5 分 PR 推进。
- 不引入新的顶层 `src/hooks` / 杂物目录（遵循 §12.5、§18.14）。

## 4. 决策（ADR）

### D1 — 脊柱选 `project`（`proj_*`）

**决定**：以现有 `project` 表（`src/server/db/schema.ts` 的 `project`，id 为客户端生成的 `proj_*`）为唯一项目实体；工坊、成片都收敛为挂在它下面的视图/子状态，不再各持独立项目 id。

**理由**：`task.projectId` 已经指向 `proj_*`（画布生成时 `use-generate.ts` 用 `getActiveId()` 打点），产出/历史/素材面板也已按 `proj_*` 聚合——选它做脊柱，**迁移面最小**、下游零改。工坊的 `wsp_*` 与成片的 cuid 都是后来各自造的平行命名空间。

**代价**：工坊 `use-workshop-pipeline.ts` 的项目 API（`createProject/switchProject/...`）改为面向 `proj_*`；`workshopDraft` 主键语义从 `wsp_*` 迁到 `proj_*`（无存量数据，直接改键规则即可）。

### D2 — 存量数据不迁移

**决定**：当前环境基本无历史数据，Phase 1–2 直接切换键规则，**不写一次性数据迁移脚本**。

**理由**：迁移脚本本身是成本与风险来源；在零数据前提下写它 = 为不存在的数据引入会出错的代码。

**代价 / 兜底**：若个别环境确有旧 `wsp_*` / `filmProject` 数据，采用"只读共存"——旧行不并入、也不再出现在新列表（可后续按需补一次性脚本），不阻塞新模型上线。

### D3 — 同步粒度：shot 级

**决定**：画布与工坊共享到**镜头级**——每个 `Shot` 有稳定 id，画布为每个镜头物化一个带 `shotId` 反向引用的节点；两边读写同一个 `Shot`。

**理由**：项目级共享（各管各的内容）无法实现"工坊产出什么、画布就出现什么"。shot 级语义清晰，且与工坊既有的单向数据流红线（剧本→场景→分镜→镜头→视频→成片）天然对齐：`Shot` 就是这条链上被画布投影的那一环。

**代价**：需定义冲突规则（见 §6.4 单一写入者）。

## 5. 统一生产模型（草案）

> 落地位置拟定为 `src/lib/production/`（新子域）。**实现时按 §18.14 同批登记 `check-file-structure.cjs` 的 `DOMAINS`/`DOMAIN_EXEMPT`（R14）并按 §18.6 在 `vitest.config.ts` 设实测门槛**；纯函数、无 React（§18.2）。类型从工坊 `src/lib/workshop/types.ts` 提升为画布/工坊/成片共用，工坊侧改为 re-export 以免两份漂移（§12.12）。

```ts
// src/lib/production/types.ts（拟定）

/** 统一项目承载的「生产」视图。脊柱仍是 project 表的 proj_* 行。 */
export interface Production {
  projectId: string; // = project.id（proj_*）
  meta: ProjectMeta; // title / type / tone / logline
  scriptMarkdown: string; // 剧本原文（工坊阶段①）
  scenes: Scene[]; // 阶段①产物
  characters: Character[]; // 阶段②（含定妆照候选/选定）
  shots: Shot[]; // ← 画布与工坊共读共写的唯一镜头清单
  progress: ProductionProgress; // ← 单一完成状态来源（两侧一致展示）
}

/** 一个镜头 = 生产链上被画布投影的那一环。 */
export interface Shot {
  id: string; // 稳定 id（沿用 workshopUid("shot")）
  index: number; // 镜号
  sceneId: string;
  characterIds: string[];
  shotType: ShotType;
  description: string;
  prompt: string;
  negativePrompt: string;
  params: Record<string, unknown>; // params.size = SizeSpec
  dialogue?: string;
  motion?: MotionLevel;
  duration?: number;
  transition?: Transition;
  image: GenerationState; // 阶段④ 镜头生图
  video: GenerationState; // 阶段⑤ 视频生成
  canvasNodeId?: string; // ↔ 画布节点反向引用（shot 级同步的锚）
}

/** 生成态统一：画布节点与工坊阶段共用同一份，不再各存 status。 */
export interface GenerationState {
  status: "idle" | "queued" | "running" | "done" | "failed" | "stale";
  taskId?: string;
  url?: string; // imageUrl / clipUrl 归一
  progress?: number;
  error?: string;
}

/** 完成状态：由 shots 派生 + 一个持久化的阶段游标，取代工坊/film/session 三处状态源。 */
export interface ProductionProgress {
  stage:
    | "script"
    | "character"
    | "storyboard"
    | "shots"
    | "video"
    | "render"
    | "done";
  rendered: boolean; // 成片是否已导出/合成（持久化，修工坊刷新即丢）
}
```

画布侧扩展：`StrictCanvasNodeData`（`src/lib/project-canvas/canvas-types.ts`）增可选 `shotId?: string`，使 image/video 节点成为某 `Shot` 的投影；不新增节点 kind，复用现有 `image`/`video`。

## 6. 画布 ↔ 工坊 ↔ 成片 映射

### 6.1 工坊 → 画布

工坊阶段③产出/更新 `Shot[]` → 同步层为每个 shot 物化一个画布节点（`canvasNodeId` 回填、`shotId` 前向引用）。落点：新增纯函数 `src/lib/production/sync.ts`（`shotsToNodePatches` / `nodeEditToShot`），画布与工坊都经它，不各写一份。

### 6.2 画布 → 工坊

画布上对某节点（带 `shotId`）的生成/参数编辑，经同一 reducer 写回对应 `Shot` 的 `GenerationState`/`params`；工坊阶段视图读 `Shot`，自然反映。

### 6.3 成片

`filmProject` 增 `projectId`（→ `proj_*`）作为**渲染作业**挂到统一项目下；`server/film/orchestrator.ts` 的自动驾驶改为**读统一项目的 `Shot[]`**（而非自建 filmShot 的平行解析），产出成片 URL 回写 `Production.progress` / 对应 shot 的 `video.url`。FilmStudio 视图保留，但作为"某项目的成片渲染/预览"入口，而非独立项目。

### 6.4 单一写入者（冲突规则）

沿用工坊文档"数据单向流"红线并扩展为字段级单一写入者：

- 剧本 / 场景 / 角色 / 分镜提示词：工坊写，画布只读投影。
- 单镜头的生成态（image/video status、url、taskId）：谁触发生成谁写，但都写进同一个 `Shot`（经 `sync.ts` reducer）。
- 画布自由摆放的**非镜头节点**（text/picture/自定义 workflow 节点）：仍归画布私有，不进 `Production`，不参与同步——统一项目是"叠加"在生产模型之上，不吞并画布的即性编排。

## 7. 完成状态统一

三处状态源（工坊派生态、`filmProject.status/progress`、`workshopSession.stage`）收敛为 `ProductionProgress` 一份，持久化在统一项目上（`project` 行新增一列 JSON，或 `production` 子文档）。画布顶栏与工坊阶段导航读同一份、展示一致；刷新不丢（修工坊 `rendered` 只在 React state 的问题）。

## 8. 分阶段落地（Phase 1–5）

| 阶段                   | 目标                                                                                                                                              | 主要落点                                                                                          | 独立可发 PR | 风险             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- | ---------------- |
| **P1 启动先建项目**    | 工作区无当前项目时先走"新建/选择项目"闸门；统一"新建项目"同时初始化画布+工坊所需                                                                  | `app/workspace/page.tsx`、`lib/project-canvas/canvas-store.ts`、`use-workshop-pipeline.ts` 初始化 | 是          | 低               |
| **P2 统一项目实体**    | 工坊面向 `proj_*` 读写；`workshopDraft` 键从 `wsp_*` 改 `proj_*`；归属列对齐（userId NOT NULL）                                                   | `use-workshop-pipeline.ts`、`draft-sync-*`、`workshopDraft` schema                                | 是          | 中（键规则变更） |
| **P3 shot 级双向同步** | 落地 `lib/production/`（types + sync reducer，按 §18.14 登记子域 + §18.6 门槛）；画布节点 ↔ Shot 物化/回写                                        | 新增 `lib/production/`、`canvas-types.ts` 加 `shotId`、`ProjectCanvas` 投影、工坊阶段视图         | 可拆 2 PR   | 高（核心）       |
| **P4 完成状态统一**    | 三处状态源收敛为 `ProductionProgress` 持久化；两侧一致展示                                                                                        | `lib/production/`、`project` 行、工坊 `stage-config` 派生、画布顶栏                               | 是          | 中               |
| **P5 AI 一键出片接入** | `server/film/orchestrator.ts` 改读统一项目 `Shot[]`；`filmProject.projectId` 关联；补 agent 视频/合成工具（`lib/agent/tools.ts`）；两侧实时看进度 | `server/film/`、`lib/agent/`、工坊/画布进度展示                                                   | 是          | 中               |
| **P6 项目主页**        | 进入项目后落到**项目主页**（项目页签第一项）：六个阶段的完成状态 + 素材计数 + `RunControlBar`；阶段完成由**内容**派生（不靠阶段游标，回退不误报）；画布去掉 `RunControlBar` 浮层 | 新增 `lib/production/project-home.ts`、`components/studio/project-home/`、`NavItems.tsx`、`workspace/page.tsx` | 是 | 低 |

**推进原则**：每阶段独立 PR、独立可回滚；P3 是承重的双向同步核心，前置于 P4/P5；先 P1 拿到"先建项目"的可见收益，再逐层收敛。

## 9. 风险与约束

- **lib 子域纪律**：新增 `src/lib/production/**` 必须同批登记 `DOMAINS`/`DOMAIN_EXEMPT`（R14）并按实测设 `vitest.config.ts` 门槛（§18.6/§18.14），否则门槛挂在判据不认识的目录上。
- **视图层 IO**：同步/取数一律进 `hooks/` 与 `lib/production/`，视图不新增 `fetch`/tRPC（§17、硬规则 10）。
- **类型单一来源**：`Shot`/`Scene`/`Character` 提升到 `lib/production` 后，工坊 `lib/workshop/types.ts` 改为 re-export，避免孪生（§12.12）。
- **task.projectId 无 FK**：成片/工坊任务此前不打 projectId；统一后生成打点应一致带 `proj_*`（`use-generate.ts` 已如此，工坊侧需补齐）。
- **归属不一致**：`project.userId` NOT NULL vs 工坊/会话表 userId 可空——统一后以 `project.userId` 为准。

## 10. 关联文档

- 术语口径：`docs/glossary.md` §3（画布项目）/ §6（工坊 / 项目 works / 视图）
- 工坊流程与红线：`docs/feature-workshop-flow.md`
- 工作流库流程：`docs/guides/feature-workflow-library-flow.md`
- lib 层纪律：`docs/standards/18-lib层规范.md`；UI/逻辑分离：`docs/standards/17-UI与逻辑分离.md`
- 本文落地时若改 `docs/standards/**`、`docs/guides/**` 需跑 `pnpm doc:check`（specs/ 目录本身不在纳管范围）。
