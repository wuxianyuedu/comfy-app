# 代码驱动视频生成（CodeFilm）：设计规格

> 本文定义「先生成代码、再由代码生成视频」能力在本项目中的**边界、数据流与分期**，不含逐步实现脚本。
> 参考范式：ONE SWEEP · 一掃（https://github.com/anstapnever/one-sweep）——78 秒日漫打斗，
> 全片由 Claude Code 写 Three.js 逐帧渲染，无 AI 生图 / 生视频。
> 代码落点为可读性索引；门禁与口径一律以 `docs/standards/` 与 `AGENTS.md` 为准。

## 1. 背景与判据

用户口径：**先生成代码、再由代码生成视频**，并要求后续能产出「含打斗场景的动漫剧集视频」，
即需支持复杂分镜、动作编排、多镜头连续生成。

现状核对（2026-11-28）：

| 事实 | 出处 |
| --- | --- |
| 工坊六阶段：剧本→角色→分镜→生图→视频→成片；生图 / 生视频共用一条链路 | `docs/guides/feature-workshop-flow.md` |
| 本地生成唯一入口 `createWorkflowRunTask()`；执行载荷恒为工作流库 `rawJson`，无内置模板 | `src/lib/workshop/workflow-run.server.ts` |
| 唯一队列是 `task` 表 + `executor-dispatch.ts`（`MAX_CONCURRENCY=1`），kick 只省节拍 | `src/lib/comfyui/executor-dispatch.ts` |
| 逐镜批处理与成片已有：`startFilm()` / `film-watch.ts` / `compose-film.ts` | `src/server/film/` |
| 分镜真值是 `production.shots`（JSON 列，形状由 Zod 派生），已有 `duration/motion/transition/clipUrl` | `src/lib/workshop/types.ts`、`src/server/db/schema.ts` |
| 外部 AI 已有端到端边界：MCP 15 工具 + `production-bridge.ts` | `docs/workshop-mcp.md` |
| Agent 的 `generate_shot_images` 是 stub，返回「需手动触发」 | `src/lib/agent/executor.ts` |
| 仓库**没有**任何「代码/脚本生成 → 驱动渲染」的实现；视频节点靠自定义节点包解析（只读 AST） | `src/app/api/custom-nodes/route.ts` |

**判据**：缺的不是渲染引擎，而是 ONE SWEEP 那套「制片合同 + 单一真相源 + 自动 QA + 文件所有权」的
**生产范式**。本能力的第一形态应是「代码作为编排程序」，而非引入第二套渲染栈。

## 2. 两种范式与选择

| 读法 | 「代码」是什么 | 渲染者 | 与现有架构 | 风险 |
| --- | --- | --- | --- | --- |
| A · 编排程序（主干） | 受 Schema 约束的声明式**制片合同**：共享地图 + 镜头表 + 时间轴 + 动作节拍 + QA 规则 | 合同编译成 `RunWorkflowInput`，驱动 ComfyUI / API 逐镜生成 | 完全复用 task 表、执行器、成片链路 | 低 |
| B · 渲染器（可选后端） | 真正的 Three.js / WebGL 场景代码 | headless Chrome 逐帧渲染 → ffmpeg | 新增渲染运行时，不经过 ComfyUI | 高（新依赖、沙箱、GPU 竞争） |

**决定**：以 A 为主干；把渲染后端抽象成可插拔接口，Phase 3 挂 B 作为「代码渲染后端」，
两者共用同一份合同与 QA 门禁。这样打斗场景既能用模型生成，也能用纯代码渲染。

## 3. 总体架构

```
导演 LLM / 用户
      │  生成（受 Schema 约束）
      ▼
制片合同 Contract ── 唯一真相源 ── 共享地图 · 镜头表 · 时间轴 · 动作节拍 · QA 规则
      │
      ├──────────────┬──────────────┐
      ▼              ▼              ▼
本地 ComfyUI      API 直连       代码渲染（P3）
（已有）          （已有）        （新增后端）
      └──────────────┴──────────────┘
                     ▼
              逐镜片段 clipUrl
                     ▼
              自动 QA 门禁
                     ▼
              ffmpeg 成片合成
```

**核心红线**：LLM 只产出**声明式合同（数据）**，绝不拼 `rawJson`、绝不直接操作 task 表。
合同到执行载荷的翻译全部经受控的 `contract-to-*` 模块，保持「工作流唯一来源是库里的 rawJson、
落点只认作者连的线」这一既有口径不被绕过。

## 4. 制片合同（Contract）数据模型

合同是 LLM 与渲染器之间的**唯一契约**，必须是结构化、可验证、可 diff 的数据，不是自由代码。

| 字段 | 形状 | 用途 |
| --- | --- | --- |
| `meta` | `{ title, type, tone, logline, fps, size }` | 项目元信息，对齐 `ProjectMeta` |
| `layout` | `Array<{ id, kind, position, bounds?, props? }>` | 共享地图：场景 / 道具 / 角色的世界坐标，切镜不丢连续性 |
| `shots` | `Array<ShotSpec>` | 镜头表：`id, index, sceneId, shotType, description, duration, transition, camera, actionBeats` |
| `timeline` | `{ totalFrames, shots: [{ shotId, startFrame, endFrame }] }` | 全局时间轴：每个镜头的帧偏移，保证多镜连续 |
| `qaRules` | `{ checkContinuity, checkDurationSum, maxShots, maxFrames }` | 静态 QA 阈值与开关 |
| `renderBackend` | `"comfy" \| "code"` | 渲染后端选择（P0 只接受 `comfy`） |

`ShotSpec.actionBeats` 是**动作编排**的核心：

```
{ t, actorId, action, targetId?, easing?, fxRef? }
```

- `t`：镜内相对时间（秒），用于排序与插值；
- `action`：动作标识（挥扫 / 闪避 / 冲击 / 蓄力…），P2 做成可复用动作库；
- `actorId` / `targetId`：引用 `layout` 中的实体 ID，不允许裸字符串（QA 校验引用可解析）；
- `easing` / `fxRef`：运动曲线与特效引用。

## 5. 核心模块清单

| 类型 | 模块（路径） | 职责 |
| --- | --- | --- |
| 新增 | `src/lib/codefilm/contract-schema.ts` | 合同唯一 Zod schema（含 `ShotSpec` / `actionBeats`）；schema 是事实源，类型由 `z.output` 派生 |
| 新增 | `src/lib/codefilm/qa-rules.ts` | **纯函数**静态 QA：时间轴连续性、时长求和、实体引用可解析、镜头/帧数上限 |
| 新增 | `src/lib/codefilm/contract-to-shots.ts` | 合同镜头 → 现有 `Shot[]`（写 `production.shots` 的入参），保留 `editedRef` 手改语义 |
| 新增 | `src/lib/codefilm/contract-to-runs.ts` | 合同镜头 → `RunWorkflowInput[]`（经 `createWorkflowRunTask` 入队） |
| 新增 | `src/lib/codefilm/contract-compiler.server.ts` | LLM 从剧本 / 灵感生成合同：`completeLLMStructured` + 校验修复回路（Node-only） |
| 新增 | `src/server/codefilm/orchestrator.ts` | 编译 → QA → 逐镜入队 → 监看 → 合成，复用 `watchFilm` / `composeFilm` |
| 新增 | `src/server/codefilm/render-backend.ts` | 渲染后端接口 `compile(contract) → RenderPlan`；P3 接 Three.js 实现 |
| 新增 | `src/server/api/routers/code-film.ts` | `compile` / `validate` / `start` / `status` / `cancel` / `log` |
| 新增 | `src/server/mcp/workshop-mcp.ts`（扩展） | `workshop_compile_contract` / `workshop_validate_contract` / `workshop_render_codefilm` |
| 修改 | `src/server/api/root.ts` | 挂载 router，并配执行者测试（E3） |
| 修改 | `src/lib/workshop/types.ts` | `Shot` 增可选 `actionBeats` / `contractRef`（走 Zod schema 单源） |
| 修改 | `src/lib/agent/tools.ts` + `src/lib/agent/executor.ts` | 补 `generate_shot_images` stub、加 `compile_contract` / `render_codefilm` 工具 |
| 修改 | `docs/product/*`、`feature-workshop-flow.md`、`glossary.md`、`changelog.d/` | 需求编号、流程与术语同步；**不直接改 `CHANGELOG.md`** |

## 6. 数据流

1. 用户 / 导演 LLM 给创意 → `contract-compiler.server` 产出合同草案（JSON DSL，**非自由代码**）。
2. `qa-rules` 静态门禁：不通过则带字段路径回流 LLM 重生成（有界重试）。
3. 通过后 `contract-to-shots` 写入 `production.shots`（含 `actionBeats`、全局帧偏移、layout 锚点）。
4. `contract-to-runs` 逐镜调 `createWorkflowRunTask()` → `task` 行（`claimedBy` 按宿主）→ `kickQueue()`。
5. `executor-dispatch` → comfy-cli（`--wait`，禁用 `--client-id`）→ 进度走 **CLI stdout NDJSON**。
6. 产物落 `generated/<mediaType>/<model>/<mode>/<taskId>/` → 回写 `clipUrl` / `clipStatus`。
7. 全部镜头 SUCCEEDED → `composeFilm` ffmpeg 合成 `generated/films/<id>.mp4`。
8. 渲染后端为 `code` 时：第 4–6 步替换为「合同 → 场景代码 → headless 帧渲染 → PNG 序列 → ffmpeg」，
   其余（QA、成片、回写）不变。

## 7. 接口边界

| 边界 | 规则 |
| --- | --- |
| 合同 ↔ 执行 | LLM **只产出声明式合同**；翻译全部经 `contract-to-*`，不拼 `rawJson`、不碰 task 表 |
| 工作流来源 | 唯一来源是 `workflowTemplate.rawJson`，保留 `hasExecutableWorkflow` 判空与作者连线口径 |
| 队列 | 复用 `task` 表单一派发循环，不建第二队列；不做并行 GPU 抢占 |
| 路径 | 只经 `artifactDiskPath()` / `taskOutputDir()`，不自行拼 `path.join("public",…)` |
| 错误 | tRPC 一律 `TRPCError` 带正确 code；REST 一律 `errorResponse()`；不手写错误信封 |
| 产物归属 | 视频阶段只写 `clipUrl` / `clipStatus`，**不得改写 `imageUrl`** |
| 用户代码执行 | P3 白名单渲染 worker + 回环 + 会话 + 无 shell argv + 整树回收 + 看门狗 + 输出上限；禁任意 Node import |

## 8. 关键约束与风险控制

### 8.1 执行层既有坑（不可重踩）

1. 应用自己的 WS **收不到执行帧**（ISSUE #1315），进度必须走 `executor-cli-stream.ts`。
2. `execution_success` 在 CLI 流里是**每节点**完成、在 WS 适配器里是**整任务**完成——靠 `claimSettle` + `/history` 轮询兜住。
3. 成功信号早于产物落盘，保留 `fetchHistoryEntry()`（12×250ms）。
4. `--client-id` 与 `--wait` 自 comfy-cli 1.26 互斥，不重新引入。
5. 单 GPU 串行：首帧合成 + 视频生成是两次任务，失败补偿取消必须可靠。

### 8.2 工程约束

- 新增 `src/lib/codefilm` 子域须**同批**：`DOMAINS` 登记 + `vitest.config.ts` 实测覆盖率门槛 + §18.4 Node-only 声明。
- 文件 ≤900 行、函数 ≤400 行；禁 `any`；注释中文；工具名 / 路径不写历史流水。
- 每个 procedure 配执行者测试（`tests/trpc-surface-executors.test.ts`）。
- 改行为同批补测试（ISSUE #4059）；闸门类判据「拒绝 + 副作用未发生」两句同时断言（§11.2.1）。

### 8.3 风险登记

| 风险 | 控制措施 |
| --- | --- |
| LLM 幻觉镜头不连续 | 共享 `layout` + 全局时钟；`qa-rules` 校验帧偏移、场景锚点、角色引用 |
| 自由代码执行逃逸 | P0/P1 只出声明式数据；P3 白名单渲染 worker + 进程树回收 + 输出上限 |
| 成本 / 时长失控 | 合同层硬上限（镜头数、每镜帧数、总帧数）+ `generationControl.paused` 闸 |
| 不可复现 | 每镜固定 seed 写入合同；合同版本入库，产物 manifest 记录哈希 |
| 提示词注入 | Zod `.strict()` + 字段枚举；合同文本不进入 shell / 代码执行路径 |
| 长视频被看门狗误杀 | 借 progress 续期；长镜拆段 |

## 9. 分期

| 阶段 | 内容 | 验收重心 |
| --- | --- | --- |
| **P0（本次落地）** | 合同 schema + 静态 QA + 合同→Shot / RunWorkflowInput 纯映射 + `code-film` API（编译/校验/预览，**不落库、不接真实渲染**）+ 测试 + 文档同步 | 纯函数与 API 可测，不依赖 ComfyUI 是否运行 |
| P1 | 编译器接 LLM、落库 production、逐镜入队、取消/恢复、Agent stub 补齐、MCP 三工具 | 3 镜端到端真出图 |
| P2 | `actionBeats` 动作库、全局时钟、多镜头连续、整季批量复用 | 打斗分镜动作编排可验收 |
| P3 | Three.js 代码渲染后端 + headless 帧渲染 + ffmpeg；QA 移植穿模 / 脚滑 / 抖动 / 突现检测 | 打斗场景纯代码渲染 |

> P0 刻意不落库、不接渲染：这样门禁可全绿、行为可验证，避免「依赖本机 ComfyUI 恰好在跑」的不确定性。

## 10. 验收标准

| 项 | 可测判据 |
| --- | --- |
| 合同 schema | 合法合同 → `parse` 通过；字段缺失 / 非法枚举 → 抛 `ZodError` 且带字段路径 |
| 静态 QA | 构造悬空实体引用 / 时长不符 / 超镜头上限的合同 → `validate` 返回**逐条错误路径**且不进入编译 |
| 合同→Shot | 3 镜合同 → 3 个 `Shot`，`index` 连续、`duration` 原样透传、`actionBeats` 保留 |
| 合同→Run | 合同镜头 → `RunWorkflowInput`，`prompt` 非空、`values` 形状符合 `WorkshopExposedValues` |
| API | `compile` / `validate` / `toShots` 三个 procedure 均有执行者测试真调用；错误出口 code 正确 |
| 失败出口 | 非法合同 → `BAD_REQUEST` + 用户可读路径；无静默吞错、无无落点 500 |
| 门禁 | `typecheck` / `lint` / `vitest` / 文件结构 / Node-only 声明 / 覆盖率门槛全绿 |

### 10.1 目标场景（P2/P3 终极验收）

≥8 镜打斗剧集：`actionBeats` 完整、连续性 QA 通过、成片时长 ≥ 目标秒数、
穿模 / 脚滑抽检无失败、逐镜 `clipUrl` 非空。

## 11. 明确不做

- 登录 / 账号 / 权限改造；产物按用户鉴权。
- 新建分镜表、新建产物目录体系、新建任务队列。
- P0 阶段：真实 LLM 调用、真实入队、真实渲染、UI 编辑器、产品编号（用户可见行为未变）。
- P3 之前：任意用户代码在服务端直接执行。
