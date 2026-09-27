# P3 §5 第 2 期：ComfyUI 执行器迁出 Next 进程（executor-host.mjs）

- 日期：2026-09-26
- 状态：**实施中** —— Phase 2-A/2-B/2-C、3-A、3-B0、3-B1、3-C、3-D 已合入 master（#1124 / #1131 / #1133 / #1138 / #1151 / #1157 / #1168）；§13 是逐期落地时的已签修正，§14 是 Phase 4（删旧）的签字；`COMFY_EXECUTOR=host` 目前**仅 dev 可用**，桌面包支持拆 ISSUE #1169（3-E）
- 前置：P3 §5 第 1 期已完全收线（#1042/#1045/#1053/#1056/#1060/#1068/#1071/#1074/#1075/#1077/#1080/#1083/#1086/#1090 共 14 PR，整条 ComfyUI 执行链 + lib 层地基都进 §18.4 第三类；host boot 顺序与 inject 接缝已就位）
- 上游方案：`outputs/p3-executor-process-migration-plan.md`（审计 §2.7 / 架构级）
- 范围：
  - Phase 2：新增 `scripts/executor-host.mjs`，作为 launcher 的一个受管子进程；用 `COMFY_EXECUTOR=host|inline` env 开关，**默认 inline、host 只是可起、不接管流量**
  - Phase 3：把提交侧写 DB 队列 + host 领任务；SSE 通道走「短轮询 DB」；env 切 `host` 灰度
  - Phase 4：删 Next 侧 `comfyRunner` 全局 + 三层补丁里被 host 取代的部分
  - Phase 5：`film/orchestrator.ts` 的 `watchFilm` 纳入 host（或 boot 扫描）
- **不做**：`../core/repository` 数据层双宿主（独立议题，见 §11）

---

## 1. 目标与非目标

**目标**

1. 状态所有权唯一化：queue / WS / per-task 进度只活在 host 里；Next 不再持有 `comfyRunner`。
2. 事实源仍是 SQLite（`task` 表）：Next 通过 DB + SSE 读状态，host 写状态。host 是 DB 执行字段的唯一写者。
3. 崩溃隔离：Next 重启（dev 热编译、设置页操作）不再打断在跑的 ComfyUI 任务；host 崩溃时任务状态留在 DB，host 重启后扫表恢复。

**非目标**

1. 不引入外部消息中间件（Redis / NATS / RabbitMQ）—— 单机桌面应用，SQLite 是天然 sink。
2. 不改前端 UI / 客户端 API 契约：`/api/tasks/[id]/stream` 对外形状保持一致。
3. Phase 2 不动 Next 侧任何路径；只在开关下多起一个「干跑不接管」的进程验证 boot 链通。
4. 不改 ComfyUI 侧（comfy-cli / WS 协议）。

---

## 2. 进程拓扑

**当前**：单一 Next server 进程承担「请求服务 + 执行编排」。

**目标（Phase 3 起）**：

```
Tauri shell (app.exe)
├─ launcher (scripts/dev-launcher.mjs)
│  ├─ Next dev/start server     ← 请求服务、UI、SSE
│  ├─ executor-host.mjs          ← ComfyUI 编排（Phase 2 起）
│  └─ ComfyUI（spawned by host，keepAlive 语义）
```

- **launcher 是唯一的父**：host 与 Next 都是它的直接子进程；任一崩了 launcher 感知并处理（重启 / 报用户）。
- **host 与 Next 之间不建直连**：通信走 DB（唯一 sink）+ Next 侧的 SSE 短轮询（§5）。
- **host 与 ComfyUI 的关系**：与今天的 `lifecycle.ts` 一致，host 里 `spawnManaged` 起 ComfyUI，通过 `killProcessTree()` 收；`keepAlive` 语义不变（保活模式仍走 `COMFYAPP_SHELL_EXE --spawn-detached`）。

## 3. 未决问题（**需评审**）

### Q1：host ↔ Next 的实时通道

**方案 A（推荐）：Next SSE 短轮询 DB**

- 现有 `/api/tasks/[id]/stream` 里已经带 3s 心跳的 DB 轮询底子在（B1/stream 路由）——把「事件推送」从这个通道降级为「轮询 + 增量行返回」。
- 优点：**0 新增地基**；host 与 Next 完全解耦，谁挂了另一边不受影响；SSE 语义（先 `state` 后 `error`）保持。
- 缺点：进度粒度受轮询周期限制（3s 内跳变看不见，最终一致）；每次轮询读一坨 logs / progress 列。
- 缓解：日志列尾窗口截断（已有 `tailWindow`）+ 状态字段用「updatedAt > lastSeenAt」增量拉，避免整行重传。

**方案 B：host ↔ Next 本机回环 WS/SSE**

- host 起一个 `127.0.0.1:0`（随机端口，launcher 传下来）的 mini WS 服务，Next SSE 处理器订阅它 + 转推给浏览器。
- 优点：进度实时。
- 缺点：**新增一条独立通道**，与「DB 是唯一 sink」的架构原则相冲突；Next 挂了 host 得缓冲重传；port 分配、鉴权、断线重连都是新代码面。
- 缓解：只有当「短轮询 3s 明显不够」的场景真出现（例如按节点进度可视化）再回来做 B。

**评审要点**

- 用户能接受进度粒度 3s 吗？现有前端 progress bar 是不是本来就有节流？
- 有没有非 SSE 消费者依赖实时事件（工坊 pipeline 前端 / raw-cli 面板）？

**当前倾向：方案 A**（plan §4 建议；本 ADR 也按 A 展开后续节）。

### Q2：孤儿 / host 崩溃恢复

**症状**：host 崩了、留下 DB 里 `status=RUNNING` 但 ComfyUI 那边其实没在跑或已经跑完没人收的行；或者 host 与 Next 都活着但 Next 侧的 `comfyRunner` 内存里还有 stale queue。

**方案：单一清扫器落在 host 侧**

- host 启动时扫 `SELECT * FROM task WHERE status IN ('RUNNING','QUEUED') AND updatedAt < now - grace_period`——沿用 reaper 现有 `reapStaleQueuedTasks` / `reapStaleRunningTasks` 判决（现 reaper.ts 已经拆出 `reaper-decisions.ts` 纯判决 + 单测）。
- **Next 侧不再跑 reaper**（Phase 4 删；Phase 3 期间双跑用 env 开关互斥，见 §6）。
- host 心跳：每 N 秒 touch 一遍 RUNNING 行的 `updatedAt`（复用 `markRunning`），Next 侧读到「updatedAt 陈旧」就提示「执行器失联」。

> **与现状的差（Phase 4 签字时逐条核实，2026-09-27）**：上面三条里有两处按设想想、实际没长出来，另有一处口径已变。① `reaper-decisions.ts` **从未拆出**——判决逻辑仍在 `reaper.ts` 里，`reaper-decisions.test.ts` 直接测它；② stale 判据读的是 **`createdAt`**（`repository-task-impl.ts:325`、`:360`），不是本条设想的 `updatedAt`，而「touch `updatedAt` 心跳」从未落地（跨进程失联只能靠下一次的 30s 扫描发现）；③ 「Next 侧不再跑 reaper」在 Phase 3 期间并未生效：`reaper.ts:553` 顶层自启 + `enqueue.ts:11` 裸 import，host 在 `:230` import 同一模块，于是**两进程各跑一个 30s 常驻循环**，互斥靠 `ownedBy()` 分片而不是 env 开关。收口形态见 §14 D3。

**评审要点**

- grace_period 用现 reaper 的 `STALE_MS=30s` 还是另定？host 崩溃检测粒度 vs 假阳性权衡。
- 「updatedAt 陈旧」在 UI 怎么显示（是「生成中…」还是「执行器失联，请重启应用」）。

### Q3：launcher 集成 + 灰度

**接入点**：`scripts/dev-launcher.mjs` 里现有「拉起 Next」那一段旁边加一个 `spawnHost()`；平台机制走 `scripts/launcher-core/procs.mjs` 的 `spawnInGroup`（POSIX 自建进程组 / Windows taskkill 整树）—— **不新造 spawn 语义**（AGENTS 硬规则 3）。

**env 开关**：`COMFY_EXECUTOR=inline|host`，默认 `inline`。三种运行态：

- `inline`（当前）：Next 起 reaper + 心跳，host **不起**。零风险、零回归。
- `host`（Phase 3 目标）：Next **不起** reaper / heartbeat / executor 路径；只写 QUEUED 行 + 从 DB 读进度；host 起、消费队列。
- `both`（Phase 3 灰度期）：Next 与 host 都跑，用队列表的 `claimedBy` 列原子领取避免双写（host 只处理 `claimedBy='host'` 的行）。**过渡状态**，Phase 4 收掉。

**回收**：host 与 Next 同为 launcher 子进程；launcher 退出 → 走 `killProcessTree()` 一次性收整树（含 ComfyUI 与 host 里 spawn 的 comfy-cli）。保活模式下 ComfyUI 仍走 §3.4 的 CreateProcess breakaway 逃 job，行为不变。

**评审要点**

- 灰度期是否需要 UI 提示「本任务由 host 执行 / 由 inline 执行」？还是完全对用户透明？
- 出问题时怎么快速回退到 `inline`：改 `.env` 的 `COMFY_EXECUTOR` 重启即可，还是要提供设置页的 kill switch。

---

## 4. host 侧 boot 顺序（P3 §5 第 1 期已备好）

`scripts/executor-host.mjs`（伪代码，实际由 Phase 2 首个 PR 落地）：

```js
// 1. 加载 tsx runtime + 环境变量
import "tsx/cjs";
import { ensureEnv } from "./launcher-core/env-preflight.mjs"; // 已有
ensureEnv(); // 缺 DATABASE_URL / BETTER_AUTH_* 直接抛，与 dev.mjs 同一策略

// 2. 加载执行链 + 按序 configure（每条都提供 host 版实现；Next 侧那条 dynamic import 永不 fire）
const { configureRunner } = await import("../src/lib/comfyui/runner-state.ts");
const { configureExecutorCli } =
  await import("../src/lib/comfyui/executor-cli.ts");
const { configureExecutorFinalize } =
  await import("../src/lib/comfyui/executor-finalize.ts");
const { configureExecutorWs } =
  await import("../src/lib/comfyui/executor-ws.ts");
const { configureEnqueue } = await import("../src/lib/comfyui/enqueue.ts");
const { configureReaper } = await import("../src/lib/comfyui/reaper.ts");
const { configureTraceLogPath } = await import("../src/lib/comfyui/trace.ts");

const hostRepo = buildHostRepository(); // 用 node:sqlite 或 libsql 直连
const hostLog = buildHostLogger(); // 走 stderr + host 专属日志文件

configureRunner({ taskRepo: hostRepo, log: hostLog });
configureExecutorCli({
  taskRepo: hostRepo,
  logger: hostLog,
  resolveComfyBase: hostResolveBase,
});
configureExecutorFinalize({
  taskRepo: hostRepo,
  getView: hostGetView,
  runtimeLog: hostLog,
});
configureExecutorWs({ taskRepo: hostRepo });
configureEnqueue({ taskRepo: hostRepo });
configureReaper({ taskRepo: hostRepo });
configureTraceLogPath(
  process.env.COMFYAPP_HOST_TRACE ?? "log/comfyui/comfyui-trace-host.log",
);

// 3. 首次扫表恢复（Q2）
await reapStaleQueuedTasks();
await reapStaleRunningTasks();

// 4. 主循环：轮询 QUEUED → 走 enqueue → 交给 executor-cli/ws 驱动
```

`buildHostRepository` 是 Phase 2 唯一**新写**的一层薄壳——它复用 `src/lib/core/repository-task.ts` 里那 4 个方法（`markRunning` / `listStaleQueued` / `listStaleRunning` / `finalizeSuccess` / `finalizeFailure` / `finalizeFromReaper` / `updateProgress` / `findStatusAndPromptById` / `cancel` / `createImages` / `replaceLogs` / `findExecutionMeta`）的 SQL 逻辑。**但不通过 `../core/repository` barrel 加载**（那条路会撞 server-only）——而是直接实例化 host 侧的 `RepositoryTask`（Phase 2 起手 PR 会加一层 `src/lib/core/repository-task.driver.ts` 把 better-sqlite3 / libsql 与 drizzle 分开，让 host 可以传 node:sqlite 进去）。见 §11。

## 5. 数据流（Phase 3 完成后）

**提交路径**（Next → host）：

1. 用户在 UI 点「运行」→ tRPC `generate` 或 `/api/generate`。
2. Next 侧生成 `Task` 行（`status=QUEUED`, `claimedBy='host'`, `promptId=null`）。
3. Next 立即返回 `taskId`；前端开 SSE。
4. host 轮询 `WHERE status='QUEUED' AND claimedBy='host'` → 原子 UPDATE 到 `RUNNING` 领取 → 走 `executeViaComfyCli` 或 `connect()`+WS。

**进度回传**（host → Next → UI）：

1. host 在 progress / executing 帧里 `UPDATE task SET progress=?, updatedAt=? WHERE id=? AND status='RUNNING'`。
2. host 收口时 `UPDATE task SET status='SUCCEEDED'/'FAILED', ...`。
3. Next SSE `/api/tasks/[id]/stream` 每 3s 轮询：`SELECT status, progress, logs, updatedAt WHERE id=?` → 拼 `TaskEvent` 发给客户端（现有 `TaskEvent` 契约不变，见 `runner-state-shape.ts`）。

**取消**：Next 侧写 `status=CANCELLED` + `updatedAt=now`；host 下一次 tick 看到 `CANCELLED` 就 `killProcessTree(comfy-cli child)` 或 `interrupt()` ComfyUI（现 `enqueue.cancelTask` 逻辑挪到 host 侧一份）。

## 6. Phase 3 期间的互斥

**问题**：`inline` 与 `host` 并存时会抢同一 QUEUED 行——两边都跑 `executeViaComfyCli`，DB 里出现「两次 finalizeSuccess / 一次成功一次失败」的错乱。

**方案**：`task.claimedBy` 列（Phase 3 首个 PR 加，drizzle schema + `db:push`）：

- Next inline：领 `claimedBy IS NULL OR claimedBy='inline'`。
- host：领 `claimedBy='host'`。
- 提交侧（tRPC）：读 `COMFY_EXECUTOR` env 决定写哪个值。

**过渡期结束（Phase 4）**：`claimedBy` 列可以保留（历史行标注）也可以删；关键是 inline 分支代码整体移除。

## 7. 分阶段 PR 切法（每个独立可回退）

**Phase 2（本 ADR 通过后）**

- 2-A：`src/lib/core/repository-task.driver.ts` 抽 driver 层；Next 与 host 共用同一 SQL、只是 driver 传参不同。零行为变化。
- 2-B：`scripts/executor-host.mjs` 起 + boot 顺序 inject + **不接管流量**（`COMFY_EXECUTOR=host` 时也只是**同时跑**、queue 由 inline 侧继续处理，host 只是 poll 但不领），跑通「独立进程活着 + 日志/trace 落对地方 + 收到 SIGTERM 走 `killProcessTree` 整树收」三条。
- 2-C：`dev-launcher.mjs` 加 `spawnHost()` 受 env 控制；launcher 就绪等待 / 回收链纳入 host；`tests/cross-platform-launcher.test.ts` 加「host 也是被 spawnInGroup 管的子进程」用例。
- 2-D：`.mjs` 白名单登记（`RUNTIME_SCRIPTS`）；`check-standalone-contents.cjs` 真数产物含 `executor-host.mjs`。

**Phase 3**

- 3-A：`claimedBy` 列 + migration + drizzle schema。
- 3-B：host 侧真正「领 `claimedBy='host'` 的行」；tRPC `generate` 按 env 写值。
- 3-C：SSE 从「进程内 EventEmitter」改成「短轮询 DB」（方案 A）；`/api/tasks/[id]/stream` 的 `replaySrc` 分支保留兜底。
- 3-D：灰度期观察 + 文档。

**Phase 4**

- 4-A：删 Next 侧 `comfyRunner` 全局（`runner-state.ts` 的 `globalThis.comfyRunner` 与 `state()`），或退化为只走 host 的 stub。
- 4-B：删 Next 侧 reaper 副作用与 `startHeartbeat`；`enqueue.cancelTask` 挪到 host 一份、Next 侧改成写 `status=CANCELLED` 让 host 收。
- 4-C：删 `claimedBy` 互斥分支（host 是唯一消费者）。

**Phase 5**

- 5-A：`film/orchestrator.ts` 的 `void watchFilm()` 挪到 host（或 boot 时一次性扫 GENERATING）；对齐「进程重启后不再卡 GENERATING」诉求。

**独立**：`../core/repository` 数据层双宿主（server-only 摘除 / driver 化）—— 见 §11。

## 8. 风险与回退

| 风险                               | 缓解                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Phase 3 切流量后 host 崩、任务停摆 | Q2 恢复扫描；UI 侧「updatedAt 陈旧 → 提示重启」；`COMFY_EXECUTOR=inline` 一键回退                |
| Phase 3 SSE 改轮询后浏览器压力     | 每 3s 一次、只拉增量、日志列尾窗口截断；对比 inline 期内存事件的成本，其实更低                   |
| Phase 4 删旧路径太激进             | 分 4-A/4-B/4-C 三个独立 PR；每步都跑全量测试 + 手工回归                                          |
| 与 launcher 现有编排冲突           | §3 里 host 只是一个 `spawnInGroup` 子进程，不引入新的进程语义；沿用 `kill-process-tree` 唯一收口 |
| standalone 产物缺 host.mjs         | Phase 2-D 白名单登记 + `check-standalone-contents.cjs` 真数产物                                  |

## 9. 验证计划

- 单测：Phase 2-A driver 层用内存 SQLite 真库夹具（沿用 §18.11 那套）。
- 契约测：Phase 3-A `claimedBy` 加一列，`tests/comfyui-port-contract` 那族风格核 Next/host 两侧对 `task` 状态机口径一致。
- 手工端到端：`COMFY_EXECUTOR=host` 下起一批任务 → 中途重启 Next（任务应继续跑）→ 取消（host 应回收）→ 杀 host 整树（launcher 重启 host、DB 恢复扫描接管）。
- 崩溃注入：kill host 进程树；观察 Next SSE 侧「updatedAt 陈旧」提示 + host 重启后扫表回收 RUNNING 孤儿。
- `pnpm check:all` 与 `pnpm build` 每次 PR 都过。

## 10. 未落笔的问题（**留给评审**）

- Q1 短轮询周期是否 3s 合适？（现 reaper 是 30s、SSE `replaySrc` 是 task-start 一次性）
- Q3 host 的 stdout/stderr 落哪份日志？跟 Next 一样按 boot 分文件、还是复用 `log/services/comfyui-runtime.log`？
- `claimedBy` 列命名与是否 nullable；历史行迁移怎么写（NULL → inline）。
- Phase 3 灰度节奏：先只让「工坊运行」走 host，「工作流库运行」留 inline，还是全量同时切。
- host 是否需要单独的 health-check（Next 定时 ping）？还是完全靠 DB 心跳。

## 11. 数据层双宿主（独立议题、不阻塞本 ADR）

`../core/repository` 目前仍带 `import "server-only"`；host 通过 §4 的 `configureXxx` 注入自己的 `hostRepo` 实现，不 load 那个 barrel。所以 Phase 2-5 全部**不阻塞**。

Phase 5 之后再评估：

- 若 `hostRepo` 薄壳与真 `repository-task.ts` 已经飘出行为差 → 值得把真模块本身拆 driver（2-A 的一半工作）。
- 若 host 侧只用 4-5 个方法、注入版本能长期稳住 → 保持分离，`../core/repository` 的 server-only 继续作为「浏览器图别引我」的兜底（better-sqlite3 / libsql 不在 `NODE_BUILTINS` 白名单，拿掉只能靠 review 兜底）。

**决策**：Phase 2-A 里的 `repository-task.driver.ts` 抽一层就够；**不做**摘 `../core/repository` 的 server-only。

---

## 11.1 Phase 2-A 详细设计（回答 §11 结尾的两个开放点）

### 摸底：exec 链用到的 12 个方法

先把范围钉死——**只有 12 个方法在 exec 链里被调用**，且它们**全部用 `.select().from(task)` / `.update(task).set().where()` / `.insert(taskImage).values()`** 的普通 drizzle 语句，**没有一个走 relational query**（`db.query.task.findMany({ with: ... })`）。原 ADR §11 里「545 行 class + 12 个 repository-*.ts 波及」的担心是**多虑**：

| 方法                                                                 | 现位置 (`repository-task.ts`) | 现形态                                                                                                                                                     | host 侧用途                          |
| -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `findExecutionMeta(taskId)`                                          | 261                           | `.select({ 7 列 }).from(task).where(eq(id)).limit(1)`                                                                                                      | executor-finalize 收口时读归属与参数 |
| `updateProgress(taskId, pct)`                                        | 369                           | `.update(task).set({ progress, status:"RUNNING" }).where(and(eq, notIn(TERMINAL))).returning(id)`                                                          | executor-ws 进度回写                 |
| `markRunning(taskId, promptId)`                                      | 379                           | `.update(task).set({ status, promptId }).where(and(eq, notIn(TERMINAL))).returning(id)`                                                                    | executor-cli 领任务时                |
| `finalizeSuccess(taskId, {resultImages, params, workflowSnapshot?})` | 388                           | `.update(task).set({ status:"SUCCEEDED", progress:100, finishedAt, ... }).where(eq(id))`                                                                   | executor-finalize 成功收口           |
| `finalizeFailure(taskId, error, validationErrors?)`                  | 411                           | `.update(task).set({ status:"FAILED", error, validationErrors:JSON.stringify?, finishedAt }).where(eq)`                                                    | executor-finalize / reaper 失败收口  |
| `cancel(taskId)`                                                     | 429                           | `.update(task).set({ status:"CANCELLED", finishedAt }).where(eq)`                                                                                          | enqueue 用户取消                     |
| `finalizeFromReaper(taskId, status, error)`                          | 436                           | `.update(task).set({ status, finishedAt, error }).where(eq)`                                                                                               | reaper 孤儿判决后落库                |
| `findStatusAndPromptById(taskId)`                                    | 447                           | `.select({ status, promptId }).from(task).where(eq).limit(1)`                                                                                              | enqueue.cancelTask 前置判            |
| `replaceLogs(taskId, logs)`                                          | 458                           | `.update(task).set({ logs }).where(eq)` + `.catch(→undefined)`                                                                                             | runner-state.persistLogs 落库        |
| `listStaleQueued(cutoff, take)`                                      | 466                           | `.select({ id, createdAt, workflowName }).from(task).where(and(eq QUEUED, isNull(finishedAt), lt(createdAt, cutoff), isNull(promptId))).limit(take)`       | reaper 扫 QUEUED 孤儿                |
| `listStaleRunning(cutoff, take)`                                     | 488                           | `.select({ id, promptId, createdAt, workflowName }).from(task).where(and(eq RUNNING, isNull(finishedAt), lt(createdAt), isNotNull(promptId))).limit(take)` | reaper 扫 RUNNING 孤儿               |
| `createImages(taskId, images[])`                                     | 518                           | `.insert(taskImage).values([...])`                                                                                                                         | executor-finalize 落产物             |

**关键判据**：没有一个用到 `db.query.task.findMany/findFirst`。relational query（`with: { images: ... }` 那套）只在 `findById` / `listByUser` / `findByProject` 里出现，都是 **UI 列表卡与详情页** 的路径，host **完全不需要**。

因此 driver 层的 scope 就是这 12 个方法，不是整个 `TaskRepository` class。

### 决定 1：host 用哪个 sqlite 客户端

**结论：`@libsql/client` 的本地文件模式（`createClient({ url: "file:./db.sqlite" })`），与 Next 侧 `src/server/db.ts` 用同一个包**。理由：

1. **零新依赖**。`@libsql/client` 与 `drizzle-orm/libsql` 已在 `package.json`。引入 Node 22 `node:sqlite`（`DatabaseSync`，被 `db-schema-ready` 用作**只读探针**）会多一套 SQL 语法边界（node:sqlite 目前对某些 PRAGMA / collation 的支持仍在演进），且**无法与 Next 侧共用同一 drizzle schema**——`drizzle-orm/node-sqlite` 适配器是**另一条** API。
2. **同文件并发访问**：`src/server/db.ts` 头注释已经论证过——libsql 是 async 客户端、与 `better-sqlite3` 的 sync 客户端比不阻塞事件循环。host 是独立进程、自己那侧 libsql 就行。两进程通过 WAL mode 并行读写同一 `db.sqlite`，这是 SQLite 原生支持（`guide-database-backup.md` 里已经写了 WAL 损坏恢复流程，运维侧现成）。
3. **不用 better-sqlite3**：那条已被 db.ts 明确弃用（"any slow SQL ... pinned the whole Next server event loop"），别再引回来。
4. **不用 node:sqlite**：那是 `db-schema-ready` 的**只读探针**专用，写路径用它要背 Node 版本兼容（22.5 起才有）；且与 Next 侧的 drizzle adapter 不同、host 与 Next 各自的 schema 集成会漂。

**Phase 2-A 不引入新依赖、不引入新 SQL 方言**。

### 决定 2：relational query → select/where 的映射表

**结论：exec 链的 12 个方法**都**不需要**这个映射（它们本来就是 select/where/update/insert）。真正需要这张表的是**Phase 3-B**（host 侧「按镜头批量取进度」的 `findExecutionProgressMany`）与**Phase 5**（film 侧「按项目列任务带封面」的 `listByUser` / `findByProject` 那三个 relational 查询）——那些**不属于 Phase 2-A 的 scope**。

Phase 2-A 只抽这 12 个方法；等 Phase 3-B 真需要 `findExecutionProgressMany` 时（**它已经在 `repository-task.ts` 里、本来就是 `.select().from(task).where(inArray(id, ids))` 普通查询、不是 relational**）照同一模板补进 impl；等 Phase 5 film 侧需要带 `images` 关联的 `listByUser` 时，再做那张 relational→select/where 的映射。

（这里避免「预先设计一个 Phase 5 才用到的映射表」的 §12.15 陷阱——没有第二个消费者的抽象就抽象得过早。）

### 抽法：新增 impl + `repository-task.ts` delegate（不孪生）

**新文件** `src/lib/core/repository-task-impl.ts`（3rd class 无 server-only）：

```ts
// 类型只从 schema 拿、不引 lib/db 与 server/db（那是 server-only 链）
import { task, taskImage } from "~/server/db/schema";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
} from "drizzle-orm";
import { TERMINAL_TASK_STATUSES } from "../task-state";
import type { DrizzleSqliteClient } from "./repository-task-impl-types";

const TERMINAL_STATES: string[] = [...TERMINAL_TASK_STATUSES];

/** 12 个 exec-chain 方法的**唯一实现**；Next 与 host 各用自己的 db 传入。
 *  `db` 类型用 `ReturnType<typeof drizzle<...>>` 结构最小约束——只依赖 drizzle
 *  的 select/update/insert 三条 builder，不锁具体 driver。 */
export function createTaskRepoImpl(db: DrizzleSqliteClient) {
  return {
    findExecutionMeta: async (taskId: string) => {
      /* ... */
    },
    updateProgress: async (taskId: string, pct: number) => {
      /* ... */
    },
    // 剩下 10 个方法照搬 repository-task.ts 里 261-540 行的 SQL 主体
  };
}
export type TaskRepoImpl = ReturnType<typeof createTaskRepoImpl>;
```

**修改** `src/lib/core/repository-task.ts`（Next 侧、保留 server-only）：

```ts
import "server-only";
import { db } from "~/lib/db";
import { createTaskRepoImpl, type TaskRepoImpl } from "./repository-task-impl";

// 模块级建一次，`this.xxx()` 与 barrel 消费方拿到的引用形态不变。
const impl: TaskRepoImpl = createTaskRepoImpl(db);

export class TaskRepository extends DrizzleRepository<Task> {
  // ... 非 exec 方法（create / listByUser / findById / findByProject /
  //     findExecutionProgress(Many) / findSseSnapshot / attachImages）留原样

  // 12 个 exec 方法各 delegate 一行；SQL 从 repository-task.ts 整体搬走、不重复
  findExecutionMeta: TaskRepoImpl["findExecutionMeta"] = (id) =>
    impl.findExecutionMeta(id);
  updateProgress: TaskRepoImpl["updateProgress"] = (id, pct) =>
    impl.updateProgress(id, pct);
  markRunning: TaskRepoImpl["markRunning"] = (id, pid) =>
    impl.markRunning(id, pid);
  finalizeSuccess: TaskRepoImpl["finalizeSuccess"] = (id, d) =>
    impl.finalizeSuccess(id, d);
  finalizeFailure: TaskRepoImpl["finalizeFailure"] = (id, e, v) =>
    impl.finalizeFailure(id, e, v);
  cancel: TaskRepoImpl["cancel"] = (id) => impl.cancel(id);
  finalizeFromReaper: TaskRepoImpl["finalizeFromReaper"] = (id, s, e) =>
    impl.finalizeFromReaper(id, s, e);
  findStatusAndPromptById: TaskRepoImpl["findStatusAndPromptById"] = (id) =>
    impl.findStatusAndPromptById(id);
  replaceLogs: TaskRepoImpl["replaceLogs"] = (id, l) => impl.replaceLogs(id, l);
  listStaleQueued: TaskRepoImpl["listStaleQueued"] = (c, t) =>
    impl.listStaleQueued(c, t);
  listStaleRunning: TaskRepoImpl["listStaleRunning"] = (c, t) =>
    impl.listStaleRunning(c, t);
  createImages: TaskRepoImpl["createImages"] = (id, imgs) =>
    impl.createImages(id, imgs);
}

export const taskRepository = new TaskRepository();
```

**为什么不孪生**（§12.12 判据：逐行重合 ≥75% **且** 两边 ≥60 行）：SQL 主体只活在 impl 一处；`repository-task.ts` 的 delegate 每一行都是 `(id, ...) => impl.xxx(id, ...)` 的转发，与 impl 里的实际 SQL **不重合**。`check-code-duplication.cjs` 逐行比对时看到的是「一行 method 定义 + 一行方法名 + 一行 return」，与 impl 里十几行的 select/where 结构完全不同形态。

### Phase 2-A 的 host 侧使用

Phase 2-D（host 主循环起）之前，host 骨架（Phase 2-B/2-C）不 inject 任何 taskRepo。到 Phase 2-D 才在 boot 里加：

```js
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
const url = process.env.DATABASE_URL ?? "file:./db.sqlite";
const db = drizzle(createClient({ url }));
const { createTaskRepoImpl } =
  await import("../src/lib/core/repository-task-impl.ts");
const hostTaskRepo = createTaskRepoImpl(db);
configureRunner({ taskRepo: hostTaskRepo, log: hostLog });
configureExecutorCli({
  taskRepo: hostTaskRepo,
  logger: hostLog,
  resolveComfyBase: hostResolveBase,
});
// 依 §4 boot 顺序填满 6 个 configureXxx
```

（Phase 2-D 与 Phase 3-B「host 领任务」是同一批 PR 的一部分，见 §7。）

### 单测覆盖（Phase 2-A 独立锁）

**新增** `src/lib/core/repository-task-impl.test.ts`：用**内存 SQLite 真库夹具**（沿用 §18.11 里 `repository.test.ts` 的 `drizzle(createClient({url:":memory:"}))` 那套），12 方法各至少一条正/反用例：

- `updateProgress` / `markRunning` 的「终态行不生效」判据（compare-and-set 语义）
- `finalizeSuccess` 有 / 无 `workflowSnapshot` 两分支
- `finalizeFailure` `validationErrors?` 传值 / undefined 两分支（`JSON.stringify` 只在有值时跑）
- `listStaleQueued` 的 4 条件 AND（QUEUED + `finishedAt IS NULL` + `createdAt < cutoff` + `promptId IS NULL`）逐个破一条都不返
- `listStaleRunning` 同族判据 + `isNotNull(promptId)` 与 Queued 版对偶
- `replaceLogs` 内部 `.catch(→undefined)` 的 swallow 语义（表不存在时不抛）

`repository.test.ts` 保留（`taskRepository.xxx()` 走 delegate 命中同一路径），跑一遍断言无回归。**不**测 `listByUser` / `findById` 那些 relational 方法（它们不属于 Phase 2-A scope）。

### 破坏性面（0）

**外部 API 零变化**：`taskRepository` 单例的方法签名与返回类型完全一致（delegate 的 `TaskRepoImpl["method"]` 从 impl 反推），所有 Next 侧调用点（tRPC routers、api routes、executor-\* 内部）不动一行。`../core/repository` barrel 也不动。

`configureXxx`（runner-state / executor-cli / executor-finalize / executor-ws / enqueue / reaper）的 `taskRepo` 参数类型是**结构化的 Pick**（各自只挑自己用的方法），impl 返回的对象天然满足；不需要为 host 额外改 configureXxx 签名。

### 分 PR 切法（Phase 2-A）

- **2-A-1**：抽 `repository-task-impl.ts` + `repository-task.ts` 改 delegate + 新增 `repository-task-impl.test.ts`（12 方法各一条最小正/反例）。**这一步 Next 侧零行为变化**（delegate 转发同一段 SQL）。跑全量 `pnpm exec vitest run src/lib/core` + `src/lib/comfyui` 证明无回归。
- **2-A-2**：`tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS` 登记 `src/lib/core/repository-task-impl.ts`（它无 `import "server-only"` 但顶层**没有** Node 内建 value import——只引 `~/server/db/schema`（drizzle 定义、非 Node 内建）+ `drizzle-orm` + `../task-state`；实际**不**会进 `unguarded`，这一条只是给未来「impl 里加 `node:fs` 之类」兜底留位；如果 2-A-1 PR 时 scanner 显示 impl 不进 unguarded，2-A-2 **可以省**、直接并入 2-A-1）。

预期 2-A 只 1 个 PR 就能收；如果 delegate + 测试 + scanner 都在一个改动里干净跑绿，就是**一个 PR**。

---

## 12. 评审记录

- 2026-09-26：v1 起草。Q1/Q2/Q3 + §10 五个未决点等待评审。
- 2026-09-26：v2 新增 §11.1 · Phase 2-A 详细设计。回答两个开放点：
  - **host db 客户端**：`@libsql/client`（与 Next 侧同源、零新依赖、WAL 并行）；**不**引入 `node:sqlite` / `better-sqlite3`。
  - **relational→select/where 映射**：Phase 2-A scope 内的 12 方法**全部本来就是** select/where/update/insert，**无需**映射；relational 只出现在 UI 列表卡（`listByUser` / `findById`），留到 Phase 5 film 侧真需要时再抽。
  - 新增 §11.1 · 摸底表 + 决定 1 + 决定 2 + 抽法（impl + delegate、避开 §12.12 孪生）+ 单测覆盖 + 破坏面 0 + 分 PR 切法（预期 1 个 PR）。

---

## 13. 实施增补（v3，3-A / 3-B0 落地时的已签修正）

§12 评审记录追加：

- 2026-09-26：v3 记录 3-A 与 3-B0 实施期的四个已签决定与两处形态修正（均经签字，不重开方向）：

**3-A（#1131）**

1. `claimedBy` 索引 = 独立 `task_claimed_by_idx(status, claimedBy)`，不扩 `task_status_finished_idx`（领取谓词与孤儿判决语义分离）。
2. 原子领取形态：原拍板 `db.transaction`+BEGIN IMMEDIATE，实施查证后改签为**单语句** `UPDATE … WHERE id IN (SELECT … ORDER BY createdAt LIMIT ?) RETURNING id`。两条理由：共享 impl 的同步测试宿主（better-sqlite3）上 async 事务回调会在 continuation 前 COMMIT、原子性静默失效；drizzle-orm 0.45.2 的 libsql session 忽略 `transaction` 的 behavior 配置（源码形参 `_config`），IMMEDIATE 无法表达。**不加 `claimedAt` 列**（领取时刻 ≈ RUNNING 行的 `updatedAt`）。
3. `claimedBy` 写入时机 = 建行时按 `COMFY_EXECUTOR` 写（§6 灰度并存判据推 (a)）；NULL 天然归 inline，历史行免 backfill。
4. 3-A scope 收在「列+索引+`claimNextQueued`+契约测+db:push」，不接线。

**3-B0（本 PR）——分派修正：原 §7 的「3-B 接流量」经摸底拆为两步**

- 摸底事实：2-B/2-C 交付的 host 是纯骨架（无 tsx/libsql/configure 调用），§4 启动链一行未接；「3-B host 领 `claimedBy='host'` 行」隐含的前提（§4 boot 链已通）不成立。硬推 = 把地基与接流量挤进一个 PR。
- 拆法（已签）：**3-B0 = host 运行时地基**（tsx 加载 + libsql file 客户端 + `createTaskRepoImpl` + boot 注入 + Q2 首扫，不领流量）；**3-B1 = 接流量**（tRPC `generate` 写值 + host claim 循环 + runner/executor-cli/executor-finalize/executor-ws 四条 seam 的 host 版 deps）；**3-B 领取模型**（已签）：inline 保持 push 驱动、host 独占 pull+claim；**ComfyUI 进程归属**（已签）：host 沿用 launcher 已起的 ComfyUI，不自 spawn。
- **reaper 归属分片从 3-B1 提前到 3-B0**（代码事实倒逼，非方向变更）：`reaper.ts` 模块加载即有一次 sweep（`startReaper()` 副作用），而孤儿判决依赖**进程内**内存足迹——host 不分片就会把 inline「QUEUED>30s 尚未进 ComfyUI」的在飞任务误判成孤儿杀掉。落地形态：`listStaleQueued/listStaleRunning` 加 `owner` 参数（缺省 `'inline'`，Next 侧调用签名与行为不变），谓词与领取共用 impl 的单一定义 `ownedBy()`；`configureReaper({ taskRepo, owner: "host" })`；`resolveTaskRepo()` 在未注入且 Next barrel 不可达时**跳过本轮 + 一次性 warn**（修掉 host 加载 reaper 即两条 unhandled rejection 的实测崩溃）。
- 3-B0 注入面收口：只 inject 已验证可纯 Node 加载且 Q2 需要的三条 seam（reaper/enqueue/trace）；其余四条属 3-B1（缺的是 host 版执行依赖，不是接线）。
- host 的 `DATABASE_URL` 解析优先级对齐 Next 侧（进程 env → `.env` 回读 → 默认），复用 `scripts/env-preflight.mjs` 的 `parseEnvFile`——launcher 只透传 `process.env`，自定义库路径下不读 `.env` 会让 host 连错库。

**3-B1（接流量）——实施前已签的四个决定（2026-09-26 追加，签 A/A/A + 打包）**

1. **host 执行载荷来源 = 建行时持久化**（选 A）：`createQueued` 新增 `execPayload` 列落提交时刻的 `tpl.rawJson`，host 领到行后从 `execPayload` 重建 Job。拒「host 现查模板」（模板改/删破坏可复现性）、拒「塞 `workflowSnapshot`」（那是产物复现快照，语义污染）。两处建行入口（tRPC `generate` + 工坊 `workflow-run.server.ts`）同一改动。
2. **灰度期日志空窗 = 接受、3-C 收口**（选 A）：实测 `src/app/api/tasks/[id]/stream/route.ts` 已有每 5s `findSseSnapshot` DB 轮询转发 `status/progress/error` 差异——host 执行的状态变化本就跨进程可见，唯一缺的是执行中实时 log 流（日志仍经 host `persistLogs` 落 DB 列，下次连接 replay 可见）。拒「log-poll 提前进 3-B1」（PR 变胖），log 进轮询投影属 3-C 自然内容。
3. **host 侧取消收尾 = 最小版进 3-B1**（选 A）：host tick 检查自己 RUNNING 行的取消/终态 → 本地 `killProcessTree`/丢弃在飞 comfy-cli。现状 `interrupt()` 是 POST 共享 ComfyUI、跨进程仍有效，但 cli 子进程在 host 进程内 Next 摸不到 → 不补会有「取消后还出图」新事故面。ADR 4-B 的完整 `cancelTask` 搬迁照旧留 4-B。
4. **打包小口径**：inline 建行也显式写 `claimedBy='inline'`（NULL 只服务历史行）；claim 节奏每 tick `take=1` + 2s tick（与 inline 串行并发语义对齐）；claim 后执行抛错走 `finalizeFailure`、不造 RUNNING 僵尸（host 片 reaper 兜底）。host 版 `resolveComfyBase`/`getView`/logger 首选 import 同一份 client.ts/logger（已第三类），前置实测「六 seam 全加载 + getSettingsSync 在 host 读到同一份设置」通过才接线。

**3-C（SSE 单源化）——三个已签决定（2026-09-27 追加）**

- **D1 节点级进度持久化**：`task.progressNode`（json，`{id,label?,value,max}`）由 `updateProgress` 可选第三参写入；帧无节点信息时**不覆写**，标签不闪没。动机：#1151 后状态/收口已走 DB，但画布「当前节点+步数」仍只在进程内 progress 帧里，host 模式拿不到——两模式观感分叉。**两条执行路径都要接**：executor-ws 的 WS progress 帧，以及 comfy-cli stdout 的 `type:"progress"` 事件——E2E 实测 raw 路径的进度全走 cli 不走 WS，cli 的 `onProgress` 此前只发进程内 emitter，单源化后进度全程 0%（本 PR 补 DB 回写；cli 路径拿不到 raw graph 的 class_type，label 缺省、id/步数照存）。
- **D2 轮询节奏 5s → 3s**（Q1 原提议值）。本机 libsql 异步驱动、个位数活跃流，成本可忽略。
- **D3 stream 路由退役 `subscribe`（emitter→SSE 通道）**：路由变成纯 DB 单源——log 增量按游标 diff 发帧、state 帧带 node/终态带 images（#1151 已铺）；单一来源无重复帧，inline/host 同一契约（代价：inline 实时性从即时变 ≤3s + persistLogs 200ms 防抖）。`subscribe` 本体保留（`firstframe.ts` 进程内消费不受影响），emitter 彻底删除在 4-A。
- 初始回放的 `replaySrc` 分支按 ADR 原案保留（内存日志优先、DB 兜底，接住防抖窗口）。

**3-D（灰度文档）落地记录（2026-09-27）**

- 用户/运维文档：`docs/guide-executor-host.md`（用途、开法与「必须走 launcher」的坑、回退、日志通道、恢复语义、已知观察项），README 与 docs/README 索引已挂点；`launch-and-build.md` §5 排障手册 +2 行（任务停队列=入口选错；boot FAILED=tsx/库路径，含桌面包边界）。
- **3-B1 决定 2 的日志空窗已由 3-C 收口**（log 进 DB 轮询投影，两模式同一契约），该决定的历史口径以本条为准。
- **桌面包口径（3-D 拍板：B=要支持）→ 拆独立立项 3-E（ISSUE #1169）**：摸底实测缺口 = standalone 产物不含 host 的 `src/lib/**` 源码态闭包与 tsx/esbuild（devDependencies）；壳的编排链本身已通（`shell_launch.rs` 走 `dev-launcher --mode prebuilt`，6.5 步共用）。3-E 范围：闭包计算+拷贝进产物（复用 §13.5.8 静态 import 图机制）、`check-standalone-contents` 真数产物门槛扩展、`--once` 于 `.next/standalone` 内冒烟、壳环境端到端实测。3-D 文档按「当前仅 dev」口径写。
- `[comfy-cli 原始]` 行 prompt 字段 GBK 乱码（python stdout 管道编码，先于本线存在）：3-D 拍板记独立 ISSUE #1164、不混进文档 PR。

---

## 14. Phase 4（删旧）——四个已签决定（2026-09-27 签字）

签字前先核实的事实（纠正既有叙述，其中两条是本线自己写错的）：

1. UI 取消链路是 `use-cancel-task.ts:58` → `task-cancel-client.ts:13` → `task.ts:129` → `repository-task-impl.ts:260-265`，**只写 `status=CANCELLED + finishedAt`**：不发 interrupt、不写日志、不碰执行方。`interrupt()`（`client.ts:426`）唯一调用点在 `enqueue.ts:160` 的 `cancelTask`，而它在生产里没有调用方（唯一的 `cancelFilm` 也没有入口）。据此 `docs/guide-executor-host.md`「行为语义」里那句「界面点取消 → Next 写 CANCELLED + POST /interrupt」与本节 3-B1 决定 3 的同一表述**作废**。
2. `reconcileCancelled`（`executor-host.mjs:194`）SIGKILL 之后，由被杀 cli 的 close 回调（`executor-cli.ts:453-495`）走 `finalizeFailure`（impl `:240-256`，当时无终态守卫）把 CANCELLED **覆盖成 FAILED**——用户体感是「我点了取消，界面显示失败」。
3. `reaper.ts:553` 是模块顶层裸调 `startReaper()`，host 在 `:230` import 它 → host 也常驻 30s 循环，3-B1 口径里的「一次性 Q2」名不副实；陈旧判据读的是 `createdAt`（impl `:325`、`:360`），本节早期章节写的 `updatedAt` 与代码不符。

- **D1 范围主线 = 先拆进程内依赖、再收敛派发循环（两刀，不许并成一刀）**。4-A 做地基：D2/D3/D4 三条 + `COMFY_EXECUTOR` 跨宿主一致性 + `reconcileCancelled` 补测。4-B 才把两条派发循环（`executor-scheduler.ts:35-93` 的 `shift()` 与 `executor-host.mjs:152-178` 的 `claimTickOnce`）收敛成一条 pull 并删掉 `runner-state` 的 `queue`。**4-A 必须先落的理由**：`firstframe.ts:59`（靠 emitter 的 done 事件，host 下永不发 → 挂满 `:53` 的 5min 超时，直接断 film 首帧）、`queue-status.server.ts:35-60`（读 Next 进程内存）、`raw-cli/route.ts:22`、ComfyUI 懒拉起的触发点 `enqueue.ts:80` —— 这四个进程内依赖不先摘，删队列会同时断掉首帧 / 状态栏 / cli 原文面板 / 「谁负责起 ComfyUI」。
- **D2 取消 = 统一出口 + 条件性 interrupt**。把 `enqueue.ts:100-211` 那份全量收尾（kill / CANCELLED 日志 / 终态锁 / interrupt / 内存清理 / emitter 合成 / persistLogs）抽成共享内核，传输层由宿主注入（§18.4、§12.12：内核不落任何一侧的 IO），inline 与 host 两条路径都走它。**interrupt 只在「被取消的行正是 ComfyUI 当前在跑的那个 prompt」时发**：`POST /api/interrupt` 不带 prompt 参数、是全局停（`client.ts:426-433`），而 ComfyUI 实例跨进程共享、两片的在飞任务都可能排在它后面——无条件 interrupt 会把**另一片正在跑的任务**一起打断并判成失败。排队中但未开跑的任务取消 = 只标状态，由派发侧不再放行。
- **D3 reaper = 摘顶层自启 + 双宿主显式启动**（含一处判据方向翻转，已签字）。`reaper.ts:553` 的顶层裸调删除、`startReaper()` 变显式调用；Next 侧启动点 = `src/instrumentation.ts` 的 `NEXT_RUNTIME === "nodejs"` 分支（Next 官方「每进程一次」钩子，动态 import 形态与既有 `capture-streams.server` 一致，Edge 图不受影响）；host 侧在注入链之后显式 start，注释写清「Q2 首扫 = 第一次 sweep」。`tests/reaper-side-effect.test.ts` 两条锁「模块必须自启」的断言随之翻转，但该护栏的原始动机（不许依赖调用方记得调）要以**更强形式保留**：新增断言「`instrumentation.ts` 的 nodejs 分支里存在且仅存在一处 reaper 启动」，把「会不会漏」从口头约定变成机器判据。
- **D4 终态 CAS = 终态守卫全落 + 按 id 写路径带归属**（签字时选了比「只修 finalize 两条」更彻底的那档）。impl 七个裸写方法（`updateProgress:129`、`markRunning:149`、`finalizeSuccess:215`、`finalizeFailure:240`、`cancel:260`、`findExecJob:196`、`replaceLogs:296`）统一收口成两条 WHERE——`status NOT IN (TERMINAL)` 与 `ownedBy(owner)`；owner 由调用方（宿主）声明，返回 `boolean` 让调用点能区分「没我的份」与「已被别处收口」，判据只从 `ownedBy()` 单一定义点出，不留第二处 SQL 拼法。**一处必须显式的例外（对签字口径的必要修正，不静默改）**：`cancel` **不带** owner 条件。理由：取消是用户对「本机这次任务」的动作，而 UI 与取消 RPC 只活在 Next 进程里，host 名下的行必须由 Next 侧标成 CANCELLED——带归属条件等于把「取消 host 任务」这条合法路径堵死。跨归属的只是**状态标记**，「kill 在飞执行」仍归 owner 自己做（host 走 `reconcileCancelled`、inline 走自己名下的 `cliProcs`），非 owner 不越界写执行细节。
