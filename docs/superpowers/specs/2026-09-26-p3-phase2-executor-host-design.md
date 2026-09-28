# P3 §5 第 2 期：ComfyUI 执行器迁出 Next 进程（executor-host.mjs）

- 日期：2026-09-26
- 状态：**实施中** —— Phase 2-A/2-B/2-C、3-A、3-B0、3-B1、3-C、3-D、4-A1~4-A4 已合入 master（#1124 / #1131 / #1133 / #1138 / #1151 / #1157 / #1168 / #1178 / #1183 / #1186 / #1190）；4-B1 已合入 #1193（`c2ea2b1d`），4-B2 已合入 #1196（`601a6c67`），4-B3（两条派发循环收成一条 pull）已合入 #1203（`90c627e3`）——§14 D1 点名的四个进程内依赖至此全部摘完；4-B4 已合入 #1208（`d9c4a8fa`），4-B5（排队期写下的行在领取之后还在，ISSUE #1206）已合入 #1212（`37ef62f0`）；3-E1（宿主的运行时图构建期预编译进产物 + 收尾真起进程冒烟，ISSUE #1169 的第一半）已合入 #1219（`3e8b1b3f`）；3-E2（桌包 standalone 下由谁拉起宿主）另记 ISSUE #1216，**其立项前提已被实测否掉**（standalone 形态从未接通，五层各自断掉），更正与落地见 §16；§13 是逐期落地时的已签修正，§14 是 Phase 4（删旧）的签字，§15 是 3-E1，§16 是 3-E2；`COMFY_EXECUTOR=host` 目前**仅 dev 可用**
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

  **落地记录（4-B1，2026-09-27，四个依赖里的第一个 + 一处比签字时更严重的事实）**：动手前先把 emitter 的读者数了一遍，结论是**它在 3-C 之后就没有读者了**——`/api/tasks/[id]/stream` 早已不订阅进程内事件，`enqueue.subscribe` 全仓唯一剩下的消费者就是首帧那一处。于是那 13 处 `emit` 全是空转，而空转比缺代码更坏：它让后来人以为「取消会发事件」「成功有 done 帧」，照这条契约给新宿主写代码就必然再长出一个首帧那样的洞。所以这一刀的形态从「改首帧的读法」扩成「整条进程内事件通道退役」：`RunnerState.emitter` 字段、`TaskEvent` 类型、`createEmptyState(emitter)` 形参、`enqueue.subscribe`、以及客户端解析器里再也收不到的 `done` / `error` / `progress` 三种帧分支，一并删除；首帧改读 `findExecutionProgress`（窄投影补一列 `error`，否则用户可见的失败原因从「CUDA out of memory」退化成「首帧生成失败」），等待节拍收进 `~/lib/retry-policy` 的具名策略 `FIRST_FRAME_WAIT`。回归由新增的 `tests/in-process-event-channel-retired.test.ts` 钉（含一条「判据本身有效」的反向验证），退役后的跨宿主语义写进 `docs/guide-executor-host.md` 的「对外只有一条通道 = 数据库那一行」。一条 §18.4 的连带变化按判据走：`runner-state.ts` 不再顶层 import `events`，于是它不再落进 scanner 的 `unguarded`，`PURE_NODE_HOSTS` 那条登记依「清单只许变短」撤掉——**「不许带 `server-only`」这条约束一字未动**，理由搬进模块头部。剩余三个依赖：`queue-status`、`raw-cli`、懒拉起触发点。

  **落地记录（4-B2，2026-09-27，第二与第三个依赖：状态栏那一格 + cli 原文面板）**。三处形状签字选定「给库补列」而不是「降级」，理由是 Phase 4 的终态就是 inline 分支被删掉——留一个「只有 inline 能用」的功能，等于给那条分支留活命的理由：① **`claimedAt` 列**（「已运行 mm:ss」的基准；内存里那个 `startedAt` 只有执行进程自己看得见）。写入三处：`claimNextQueued` 无条件覆写（一次领取就是新一轮的起点），`markRunning` 与首条进度帧用 `COALESCE` 定格（进度帧每几秒一发，跟着刷等于耗时永远接近零；而 raw 路径的 `promptId` 常常整轮跑完才回传，无条件覆写会让耗时从收尾那一刻重新开始）。历史 RUNNING 行不回填，读侧对 `claimedAt IS NULL` 退回 `createdAt` 近似，并写明那只是本列上线前一小撮旧行的兜底。② **`progressNode` 增存 `classType`**（状态栏历史上显示的是类名，库里只有中文 `label`）：两个都存，画布与状态栏各读各的，可见契约零变化；comfy-cli 那条事件源本来就拿不到 `class_type`，此时类名为空——与内存版旧行为一致，不是新缺口。③ **`rawCli` 列 + 收口时整包写一次**（成功 / 失败 / 取消三条收口都写；不跟着日志的 200ms 防抖走，那等于把几千行原文白写几十遍）。「查看完整输出」的读侧因此不再碰 Next 内存，`getRawCli` 收成模块私有。主模型那一格不加列：`primaryModelName()` 两种图形态都能认，而 `execPayload` 是执行侧唯一一定写得上的载荷（`workflowSnapshot` 要到成功收口才落）。

  4-B2 的实测副产物是一条**测试基建的镜像漂移**：`tests/helpers/test-db.ts` 用的是手写 `CREATE TABLE` 文本，加列时漏改它的表现是 `SqliteError: table task has no column named rawCli`、栈指向 drizzle 的 insert，看不出真正要改的是那个 helper。新增 `tests/test-db-schema-drift.test.ts` 把「schema 每张表的每一列都在测试库 DDL 里」变成判据（并自证有效：一张表都没比对到就自己红）；`jsonColumns` 那一半盖不住——它的缺失表现是读回来是字符串而不是对象，本判据不硬造替代断言。另记一条实现层事实：`sql` 模板里的值**不走**该列的 `toDriver`（只有 `.set()` 直接赋值才走），而 better-sqlite3 / libsql 都只能绑 primitive——所以 `claimStamp()` 给的是 ISO 字符串而不是 `Date`，落库形态与 `toDriver` 的产物一致。

  **落地记录（4-B3，2026-09-27，第二刀：两条派发循环收成一条 pull）**。签字形态选 (a)「领之前先确认本进程跑得动」（而不是「先领回来看情况」），于是 `RUNNING` 只剩一个意思：**真的在跑**。三处形状随之定下：
  - **在飞记账用 Set 不用计数**：`RunnerState.queue: Job[]` + `active: number` 换成 `pendingDispatch: Set<string>`（`markDispatched` / `releaseDispatchSlot` / `isDispatchedHere` 三个出口）。用 Set 的理由是「reaper 要问的是『这一条是不是我的』，计数答不了」；它同时是并发槽位判据、`isTaskClaimedInProcess` 的第一个信号与取消路径归还槽位的依据——三处读同一份，不再各记各的。
  - **懒拉起的触发点搬进领取循环**：原来挂在 `enqueue()` 里的 `void connect()` 现在在不就绪分支里发（每次不过门控都试一次），「谁负责起 ComfyUI」与「谁负责领任务」合并成同一处。
  - **提交方只写库 + kick 一次**：`kickQueue` 总线从一条回调扩成两条（另一条是 `announceToQueuedTasks`——通道层要告诉排队的行「ComfyUI 正在自动启动 / 已就绪」，而「谁在排队」只有调度层知道，直接 import 调度层就是又造回边）。kick 只负责**省掉等 2s 节拍**，正确性靠常驻循环，所以注册缺失时只 warn 一次。
  - **double-failure 不再立刻再领**：`finalizeFailure` 自己抛（库写不进去）时只归还槽位、不 kick——在那种时刻自旋只会把每次领取都变成一次失败，交给 2s 节拍才是有退避的推进。这条是**写测试时抓到的**：原来的 `void processQueue()` 形态搬到 pull 上会变成「假仓储一直返回同一行 → 无界递归 → vitest worker 直接崩」，生产里对应的是「库坏了还不停去领」。
  - `claimAndDispatchOnce({ skipReadyGate })` 只给 host 的 `--claim-once` 契约钩子用（它验的是领取与载荷重建的机械步骤，就绪门控在不跑真 ComfyUI 的机器上永远过不去）；常驻循环与 kick 都不传。
  启动点仍是「两宿主各一处显式调用」（与 §14 D3 的 reaper 同形态），由新增的 `tests/dispatch-startup-points.test.ts` 钉：Next 侧 `instrumentation.ts` 一处、host 脚本里出现 `startDispatchLoop(` 即为双循环、全仓调用点数恰为一。副产物两条：`claimNextQueued` / `findExecJob` 随 Next 也成为领取宿主而补进 class delegate；`executor-scheduler.ts` 与其用例整体删除（契约原样搬进 `executor-dispatch.test.ts`，另加「载荷缺失不留 RUNNING 僵尸」「重跑清收口锁」与「等待提示在同一条被领走之后仍在」（后者是 4-B5 补的）两条）。

  **落地后实测更正（4-B3 端到端取证，2026-09-28，PR #1203 评论）**：本刀合并前在 `docs/guide-executor-host.md` 与 changelog 碎片里写过一句「冷启动遗留的 `QUEUED` 行会被领回执行」，端到端量下来**只对 <30s 的重启成立**，已按实测收回（同批改掉的还有「状态栏排队数」那句：恒 0 是 host 模式那段的形状，不是两种模式都这样）。抢同一行的是两条 boot 机制：`startReaper()` 的首扫当场发起，两宿主都把它排在领取循环 `setInterval` 注册**之前**，而第一拍最早 1.5s、还要过 WS OPEN 门控。实测一个 aged 48s 的遗留行在新宿主 `inject-ok 02:35:27.684` 之后 1.4s（`02:35:29.052`）被 `marked 1 stale QUEUED task(s) as FAILED`，而同批 boot 诊断数出的是 `hostShardQueued=1`——**同一时刻这条行对领取循环完全可领**；把重启间隔压到 12s（aged ≈13s）时同一行被新宿主 `18:38:03.127Z` 领回并跑到 `SUCCEEDED`。判决语义的收口记 ISSUE #1204，推荐选项 (b)：pull 模型下 `QUEUED` 已经是健康的等待态（等槽 / 等宿主起来 / 等 ComfyUI 起来），而那条 30s 规则针对的形状——「`QUEUED` 且无 `promptId` = raw 路径正在 POST 途中」——随唯一提交实现收进 comfy-cli（`executor-ws` 的直连 `/prompt` 已无调用方）而不复存在，「领到了却没跑起来」已由 `RUNNING` 那两条 sweeper（含 #1184 的两轮登记）覆盖。同批取证另外量到两处：① 签字的顺序判据成立——宿主 `inject-ok` 后前两拍都没领（4.5s 后才翻 `RUNNING`），而宿主在 `inject-ok` 之前被整树收走时两行仍是 `QUEUED / claimedAt=null`，「先领后判」没有复活；② 「⏳ 等待 WebSocket 就绪」那行会被领取时的日志缓冲重开（`store.logs.set(taskId, [])`）加上整包 `replaceLogs` 抹掉——等待期间可见、开跑后从历史消失，判据只断了「写过」没断「领走之后还在」，另记 ISSUE #1206（**已随 4-B5 修掉**，见下）。

  **落地记录（4-B4，2026-09-28，ISSUE #1204：回收器的 `QUEUED` 判据对齐 pull 模型）**。上一条实测把现象指到「boot 顺序」，但签字选定的是**改判据**而不是改顺序（选项 (b)，不是 (a)「只挪 boot 顺序」）：(a) 只是把窗口从 0 挪到「领取节拍 + WS 就绪」那么长，ComfyUI 起不来时门控过不去、首扫照样判死——根因是那条规则的**前提**没了，不是它跑早了。落地的判据：`reapStaleQueuedTasks` 的候选集从 `ownedBy(owner)` 换成它的补集（`claimedBy` 既不是 inline 也不是 host；NULL 归 inline 所以不匹配），另外三条（`QUEUED` / 无 `promptId` / 过 `STALE_MS`）不变。`isTaskClaimedInProcess`、`isComfyStarting()` 与 ISSUE #378 那层「向 ComfyUI 要外部证据」的守卫**全部保留**——它们约束的是任何一次误杀，与归属无关，成本是一行判断。方法随之改名 `listStaleUnownedQueued(cutoff, take)` 并**去掉 owner 参数**：「带分片参数的 QUEUED 扫描」这个形状本身就是旧模型的残留，留着它等于给下一个人留一条「本片孤儿池」的误读路径，判决矩阵里钉了一条「调用只许有两个参数」。判死原因从「请重新执行」换成「没有任何执行宿主会领它（`claimedBy=「X」`）— 请核对 `COMFY_EXECUTOR` 配置」：让用户重跑是**假出口**，重跑写回的仍是同一个没人领的值；投影因此要带出 `claimedBy`。host 的 `q2-scan hostShardQueued=` 从「数 stale 行」改成「数本片排队行」，从此这行诊断与判决不再互相矛盾。判据落点：impl 契约测新增「正常归属（NULL / `inline` / `host`）的 aged `QUEUED` 行**一律不返**」（把谓词换回 `ownedBy()` 这条立刻红 = 反向自证）与「命中形状必须带 `claimedBy`」；`repository.test.ts` 那处 facade 断言按新判据翻转。接受的取舍写进指南与 §5 排障表：**没有活宿主时排队行不再有失败判决**，可解释性由状态栏排队数 + 行上那句「⏳ 等待…」承担（后者当时还会被领取时的日志缓冲重开抹掉，已随 4-B5 修掉，见下）。实测（副本库 + 真 ComfyUI，同一份两行脚本、间隔拉到 48s）：改动前新宿主 boot 后 1.4s 打出 `marked 1 stale QUEUED task(s) as FAILED`；改动后宿主日志零条 QUEUED 判死，遗留行在 `inject-ok` 后 3.8s 被领回并 `SUCCEEDED`（用时 7.7s、`rawCli` 17 行、`taskImage` 1 行）。同批确认 RUNNING 侧没被带坏——宿主 A 崩溃留下的 `RUNNING` 行由 B 连续两轮对账在 117s 收口（ISSUE #1184 的两轮守卫原样生效）。

  **落地记录（4-B5，2026-09-28，ISSUE #1206：排队期写下的行在领取之后还在）**。第一版把日志的轮次边界整体从「领取」挪到「收口」（新增 `closeLogRound`，收口时落库后删缓冲），端到端一跑就坏了：落库是**整包 `replaceLogs`**，而 `complete()` 在 `await persistLogs` **之后**还要打「✓ 全部完成（总耗时 Xs）」，那一行带着自己的防抖落库把整列覆盖成一行——实测库里的现场从 38 行变成 1 行，比原缺陷严重得多，那一版当场回退。最终形态只把「本轮排队期写下的行」单独保住：`RunnerState.queuedEntries` 存这几个条目（`logWhileQueued` 写、`takeQueuedEntries` 取走即清，按 Map 插入顺序做有界淘汰），领取处 `s.logs.set(taskId, takeQueuedEntries(taskId))` 以它为起点重开缓冲，其余时序一字不改。**顺带修掉一处同类隐患**：`state()` 的单例键从 `comfyRunner` 升成 `comfyRunner_v2`——`??=` 只认键名，加字段不升版号，热重载后的旧单例就没有这个字段（`pendingDispatch` 是 4-B3 加的、当时也没升，同一个坑），这件事写进模块头注释当规则。判据：`runner-state.test.ts` 四条（登记取回一次即清 / 普通 `log()` 不登记 / **落库之后再打的行必须仍带着之前的现场**——就是上面那次坏法的反向钉 / 有界淘汰），`executor-dispatch.test.ts` 按真实时序跑「不就绪写提示 → 就绪 → 领取」并断言缓冲里等待提示的下标在领取行之前。**残留限制（不藏）**：跨宿主时上一个宿主写的行仍会被新宿主的整包替换覆盖，本刀只保证同一宿主内「排队期 → 开跑」这一段不断链。
- **D2 取消 = 统一出口 + 条件性 interrupt**。把 `enqueue.ts:100-211` 那份全量收尾（kill / CANCELLED 日志 / 终态锁 / interrupt / 内存清理 / emitter 合成 / persistLogs）抽成共享内核，传输层由宿主注入（§18.4、§12.12：内核不落任何一侧的 IO），inline 与 host 两条路径都走它。**interrupt 只在「被取消的行正是 ComfyUI 当前在跑的那个 prompt」时发**：`POST /api/interrupt` 不带 prompt 参数、是全局停（`client.ts:426-433`），而 ComfyUI 实例跨进程共享、两片的在飞任务都可能排在它后面——无条件 interrupt 会把**另一片正在跑的任务**一起打断并判成失败。排队中但未开跑的任务取消 = 只标状态，由派发侧不再放行。

  **落地记录（4-A3，2026-09-27，含一处判据依据的更动）**：签字时设想的中断判据是「问 ComfyUI 这个 prompt 是否正在跑」（`/queue` 的 `queue_running`）。端到端实测把它否掉了：comfy-cli 提交的 prompt 在整轮执行期间**不出现在** `queue_running`（真跑 10s，`/queue` 与 `/api/queue` 全程 `running=[]`），照这个判据实现的结果是「永远不中断」——功能存在但一次都不会触发。因此改成**构造性的归属判据**：谁握着该任务的在飞子进程谁发中断。inline 在 `cancelTask` 里以 `cliProcs.has(taskId)`（取值必须在 kill 之前）决定发不发；host 在 `reconcileCancelled` kill 之后发。跨进程由此天然互不误停，且 `cancelTask` 里不再要求行上有 `promptId`（同一个实测：`promptId` 往往到收尾才落库）。取消的其余语义收在 `enqueue.cancelTask` 这一处出口：tRPC `task.cancel` 改为调它（此前只写 `status+finishedAt`，面板上看不到「用户取消」这一行），历史面板那份绕过集中出口的 `api.task.cancel` 也并回 `task-cancel-client`。`interrupt()` 加了 `!res.ok` 抛错——否则调用方分不清「发出去了」与「ComfyUI 没接」，`cancel-reaped … interrupt=sent` 这句日志就没有判据。行已是终态时不再补发合成的 `CANCELLED`/`error` 事件（4-A1 的守卫会把它挡成 `skipped-terminal`，事件却照发，等于把「已完成」翻成取消）。实测链（副本库 + 真 ComfyUI）：`claim-dispatched 17:41:19.5` → comfy-cli 起 `17:41:27.9`（Next 侧同时记「本进程没有该任务的在飞执行…不发送全局中断」）→ cli 被收走 `17:41:28.07` → `cancel-reaped … interrupt=sent 17:41:30.6` → 行 `CANCELLED`、`error=null`、`taskImage` 零行。实测同时暴露的「`promptId`/`progress` 整轮不回写 ⇒ `RUNNING` 且无 `promptId` 的行两条 sweeper 查询都不匹配 ⇒ 宿主崩溃时永久卡生成中」另记 ISSUE #1184。

- **D3 reaper = 摘顶层自启 + 双宿主显式启动**（含一处判据方向翻转，已签字）。`reaper.ts:553` 的顶层裸调删除、`startReaper()` 变显式调用；Next 侧启动点 = `src/instrumentation.ts` 的 `NEXT_RUNTIME === "nodejs"` 分支（Next 官方「每进程一次」钩子，动态 import 形态与既有 `capture-streams.server` 一致，Edge 图不受影响）；host 侧在注入链之后显式 start，注释写清「Q2 首扫 = 第一次 sweep」。`tests/reaper-side-effect.test.ts` 两条锁「模块必须自启」的断言随之翻转，但该护栏的原始动机（不许依赖调用方记得调）要以**更强形式保留**：新增断言「`instrumentation.ts` 的 nodejs 分支里存在且仅存在一处 reaper 启动」，把「会不会漏」从口头约定变成机器判据。

  **落地记录（4-A2，2026-09-27）**：`stopReaper` **没落** —— 全仓至今没有任何停表需求（旧实现里也不存在调用方），先不造无人消费的口，真出现停表调用点再加。实测 Next 侧启动路径正常：副本库 + `next dev` 起服务，instrumentation 编译完成后首扫即把一行 5 分钟前的 stale `QUEUED` 判成 `FAILED`（日志 `[comfyui] reaper: marked 1 stale QUEUED task(s) as FAILED`）。附带一条对灰度有用的观察：**dev 下 Turbopack 懒编译 instrumentation**，`✓ Ready` 之后约 40s 才跑完首扫，所以冷启动后短暂看到遗留行还在原状态是正常的（standalone 无编译步骤，`register()` 随服务起即跑）。

- **D4 终态 CAS = 终态守卫全落 + 按 id 写路径带归属**（签字时选了比「只修 finalize 两条」更彻底的那档）。impl 七个裸写方法（`updateProgress:129`、`markRunning:149`、`finalizeSuccess:215`、`finalizeFailure:240`、`cancel:260`、`findExecJob:196`、`replaceLogs:296`）统一收口成两条 WHERE——`status NOT IN (TERMINAL)` 与 `ownedBy(owner)`；owner 是**构造期声明**（`createTaskRepoImpl(db, { owner })`，形参故意必填：默认成 inline 会让 host 悄悄改写别人的行，漏传比错传更危险），判据只从 `ownedBy()` 单一定义点出、不留第二处 SQL 拼法。四个终态写（`finalizeSuccess` / `finalizeFailure` / `finalizeFromReaper` / `cancel`）的返回值是四态 `TaskWriteOutcome`（`written` / `skipped-terminal` / `skipped-not-owned` / `skipped-missing`）——收成 boolean 就把「已被别处收口」和「没我的份」混成一团，调用点只能靠猜；两条进度写保持既有 boolean。两处按各自语义取舍：`replaceLogs` 只带归属守卫、**不带**终态守卫（收口之后的尾随日志正是失败原因，挡掉等于抹掉排障线索）；`findExecJob` 带归属条件（它读出来的就是要交给 ComfyUI 的图）。附带的同源约束：reaper 的 repo 实例 owner 必须与 `configureReaper({ owner })` 同源，不同源的表现是「判了却没落库」，返回值里的 `skipped-not-owned` 是唯一线索（已配用例钉住）。**一处必须显式的例外（对签字口径的必要修正，不静默改）**：`cancel` **不带** owner 条件。理由：取消是用户对「本机这次任务」的动作，而 UI 与取消 RPC 只活在 Next 进程里，host 名下的行必须由 Next 侧标成 CANCELLED——带归属条件等于把「取消 host 任务」这条合法路径堵死。跨归属的只是**状态标记**，「kill 在飞执行」仍归 owner 自己做（host 走 `reconcileCancelled`、inline 走自己名下的 `cliProcs`），非 owner 不越界写执行细节。

**D5（4-A4，签字时以「默认口径」给出、本轮落码）= `COMFY_EXECUTOR` 判据：同层收成一份 + 跨层加一致性门禁**。三处实现里 Next 侧（TS）与 launcher 规则一致，host 脚本那份是 `(process.env.COMFY_EXECUTOR ?? "inline").toLowerCase()` —— 既没 `trim()` 也没 `.env` 回读，于是两类静默错配：写 `" host "` 时 Next 把行写成 `claimedBy='host'` 而 host 起着骨架；只在 `.env` 里给开关 + 手工起 host 同样跑成骨架。两种表现都是「任务永远停在队列里等回收器判失败」，界面与日志都看不出为什么。

- 跨层**不**合成一份（这是签字时那条「不抽跨宿主共享内核」的原始理由）：让 launcher 复用 TS 那份要给它引入 tsx，而 launcher 正是拉起 tsx 的那一层；让 `src/lib` 去 import `scripts/*.mjs` 撞 §18.4 分层与 Node-only scanner。
- 同层（launcher 与 host 脚本都是纯 Node）**收成一份** `scripts/launcher-core/executor-mode.mjs`：`normalizeExecutorMode` / `readExecutorEnvRaw` / `resolveExecutorMode`，并复用既有 `parseEnvFile`。同层去重没有跨层代价，且符合 §12.18。新脚本随之登记进 `RUNTIME_SCRIPTS` 与 `ALLOWED_SCRIPTS`（两处同源，缺一份就是桌包里 host 静默跑骨架）。
- 两份之间的漂移由门禁管：`tests/executor-mode-consistency.test.ts` 用**一份共享向量**（`tests/fixtures/executor-mode-vectors.json`，17 条，含大小写/首尾空白/制表/换行/空值/未知值/中文值）让 Node 与 TS 两侧真跑同一组输入逐值比对，另断言两个纯 Node 宿主都不许再长出第二份归一化（去注释后扫源码）。形态沿用既有的 `tests/app-port-cross-language.test.ts`。
- 优先级语义钉死一条：**进程 env 给了值（哪怕是空串）就不再回读 `.env`**，与 @next/env 的覆盖规则同形；这条两侧必须一致，否则「显式关掉」在 Next 侧生效、在 host 侧被 `.env` 顶回去。
- 顺带纠正一处测试的非 hermeneic：`tests/executor-host.test.ts` 的骨架组原先靠「不设 env」表达骨架，而本地 `.env` 完全可能写着 host（实测这台机器就是）——改为显式 `COMFY_EXECUTOR=inline`，让环境不再决定用例结论。

**Phase 4 的实测副产物：回收判据补一条（ISSUE #1184，2026-09-27）**

D4 落地后按「跑真任务找出口」的口径继续做 4-A3 端到端，抓到一个不属于任何一刀的缺陷：`listStaleRunning` 带着 `promptId IS NOT NULL`，而 `listStaleQueued` 只认 `QUEUED` —— 于是「已被领取、`prompt_id` 还没回传」这段时间的 `RUNNING` 行**两条 sweeper 都看不见**；宿主恰好在这段时间崩溃，那行就永久停在「生成中」，界面上没有任何出口（用户只能删行或重启数据库）。根因还有一层：comfy-cli 的 stdout 在非 TTY 管道上是块缓冲，`prompt_id`/progress 事件成批迟到（实测整轮 `promptId` 为 NULL、收尾才出现），所以这段窗口不是毫秒级而是**整轮**。

处置两条一起做：执行侧 spawn 注入 `PYTHONUNBUFFERED=1`（窗口从「整轮」缩到亚秒）；回收侧放开 `promptId` 条件 + 用**两轮观察**替代单轮判定（`reaperState.noPromptSeen`，跨 HMR 的全局状态因此升到 `__comfyReaper_v2`）。为什么不单轮判：「刚 `claimNextQueued` 完、还没走到 `enqueueJob`」的行与真孤儿形状完全相同，而领取→入队是亚秒级、两轮之间隔 30s，单轮必然误杀。依据链上还有一句前提要记：**同一 shard 只允许一个宿主进程**（launcher 负责），否则「本进程没有内存足迹 ⇒ 真孤儿」不成立。

---

## 15. 3-E（桌面包支持 host）——切法与 3-E1 落地记录

**签字（2026-09-28）两条**：

1. **切法 = 拆两半，先做产物完整性**（选项「拆两半」）。摸底时把 3-E 当成一件事（「桌
   包里跑不起来」），实测后它其实是两件，混在一刀里会让「产物缺件」和「没人拉起」互相
   遮掩：3-E1 = 产物里那份执行图能不能 boot（本刀）；3-E2 = 谁在 standalone 形态下起这个
   已经能 boot 的进程（ISSUE #1216）。
2. **宿主运行时的形态 = 构建期预编译**（签字口径「哪个对使用者最好就选哪个」之后的
   定性）。两条候选：**构建期 esbuild 预编译** vs **随包带 tsx + `src/lib` TS 源**。
   选前者：`tsx` 是 devDependency、还带一份平台专属的驱动二进制，为了一个灰度开关把
   它们装进分发的桌面应用是拿使用者的下载体积和安装面换开发方便；预编译只多一份约
   1.4 MB 的 ESM（实测 306 个输入、1 471 724 字节），并且把 devDependency 从运行期路径
   上彻底摘掉。

**3-E1 落地记录（2026-09-28，本 PR）**：

- **图从哪儿来**：新增 `src/lib/comfyui/host-runtime.ts` 作为宿主图的**静态**汇出点
  （`host-runtime` 只做再导出 + `createHostRepo(dbFile)`，不含编排逻辑）。必要性：esbuild
  要一个静态入口才能把图算全，而 `scripts/executor-host.mjs` 里原本是七段 `await import()`
  拼出来的——那种形状打包器看不见。
- **入口按内容选加载通道**：`RUNTIME_BUNDLE` 在 → 用它；不在 → 装 tsx 钩子加载 TS 源。
  判据是「文件在不在」，不是「是不是桌包 / 有没有 `.env`」——与 §1.5 壳按「检出里有没有
  编排器」定形态同一条取向。缺预编译件在产物里仍然 `boot FAILED` 大声退出，不会半接线跑。
- **两处非显然的取舍**（都会静默炸，写在脚本文件头，这里留结论）：`server-only` 做成
  bundle 内的内存桩而不是 external（external 会被 ESM hoisting 提到顶部、加载即抛，破坏
  「没被问到就不加载」的 lazy 边界）；bundle 顶部注入 `createRequire` banner（被包进来的
  CJS 运行期 `require("node:crypto")`，纯 ESM 没有 `require`）。后者**只有真起进程的冒烟
  抓得到**，tsc / eslint / 单测都不覆盖——这也是「冒烟放构建收尾、且排在私有输入剥离
  之后」这条顺序签字的理由。
- **external 名单的判据不是「哪些是外部包」**：只有 `@libsql/client` / `ws` / `pino` 保持
  external（原生绑定 / 可选加速 / 进程级单例），`drizzle-orm` / `zod` / `@paralleldrive/cuid2`
  必须打进来，因为裁剪版 `node_modules` 顶层根本没有它们（Next 把这几个编进了 server
  chunk）。谁 external 由构建清单 `executor-host.build.json` 记账，冒烟按清单逐条 `resolve`，
  不靠人记。
- **四层门禁**：`tests/executor-host-artifact.test.ts`（构建链顺序 / externals / banner /
  `server-only` 桩 / 入口不残留裸 `../src/lib/*.ts` 导入 / `isSchemaReady` 守卫 / 白名单登记 /
  `build-desktop` 跳过+断言 / 冒烟对空目录的判定 / 有真产物时的 boot 用例）；
  `check-standalone-contents.cjs` 的 `REQUIRED_HOST_FILES`（`server.js` 在场才查，standalone 与
  static 两层）；`build-desktop.mjs` 剥离后的缺件断言；`pnpm build` 收尾冒烟。
- **实测**：一次干净 `pnpm build` 走完四步，冒烟输出 `externals ok (6 recorded, 306 bundled
  inputs, 1436 KB)`、队列扫描那行报 `schema-not-ready`（临时空库里没有表，正是 §18.4 纯
  Node 宿主该有的行为），宿主进程 `runtime inject-ok` 后 `--once` 正常退出 0。
- **明确没做**（别把本刀读成「桌包能用 host」）：standalone 形态下的拉起者（#1216，还
  含 `src-tauri/static → resource_dir()` 那层资源装配的定性——要先真跑一次
  `pnpm tauri build` 才允许定范围）；冒烟只证明「boot 到 `inject-ok` + 一次队列扫描」，
  不证明连 ComfyUI 出图。分发口径仍是**桌包里不要设这个开关**，README 与指南同步收到
  这条口径。
- **同批另开一条**：摸底时量到「一次干净 `pnpm build` 之后 `.next/standalone` 里带整棵
  源码树」（377 个 `src/**\/*.test.ts(x)` / 745 个 `changelog.d\/*.md` / 502 个 `docs\/*.md`，而
  `next.config.js` 的 `outputFileTracingExcludes` 已逐条写了这些 glob）—— 与本刀无关、
  `master` 上就红，另记 ISSUE #1217，不在本 PR 里顺手修（§7.2 那条告警的清理与它同一条
  线，混进 host 这刀会让两边判据都没法独立回退）。

## 16. 3-E2（桌包 standalone）——前提被实测否掉的更正与 3-E2a 落地记录

**3-E2 立项时写的那条前提错了，这里按实测更正**（ISSUE #1216 正文里同步过）：当时判断「宿主件已随包、也能起来，缺的只是没有进程去起它」。真跑一次 `pnpm tauri build` 之后，实情是 **standalone 形态从未接通**，而且断点不止一处：

| #   | 断点                                                                                   | 一手证据（2026-09-28 真构建）                                                                        |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `bundle.resources` 缺席 → `src-tauri/static` 没有任何装配者进安装包                     | 生成的 `installer.nsi` 里 `; Copy resources` 段为空，Install 段只有主 exe 与 `node.exe`               |
| 2   | 壳拼 `resource_dir()/binaries/node.exe`，打包器落 `resource_dir()/node.exe`             | 同上一行的 `File /a "/oname=node.exe"`；`target/release/node.exe` 是 8-26 的陈旧残留                  |
| 3   | 载荷**不自包含**：`.next/standalone/node_modules` 顶层是指向仓库 store 的绝对软链       | `cpSync({dereference:true})` 摊平后 `Cannot find module '@swc/helpers/_/_interop_require_default'`    |
| 4   | 首启建不了表：载荷只带生产依赖，`drizzle-kit` 不在其中                                   | `/workspace` 200、`/api/health` 503 + `db:"empty"`，hint 让人「执行 pnpm db:push」                    |
| 5   | 运行期没有 `.env`（硬规则 17 剥掉了），而 `src/env.js` 判的是「文件在不在」              | `MissingEnvFileError`                                                                                |

第 7 层（第 6 层修好、sidecar 真的在 `boot pid=… port=1239` 上起来之后才暴露）：窗口仍停在启动页 0%，因为 `splash.html` 第一轮就把应用地址锁存了（`if (!appUrl) appUrl = await resolveAppUrl()`），拿到的是壳的**初始**地址（按检出路径推导的默认端口），而 standalone 的端口是 `pick_free_port()` 现挑的、在那之后才写回状态。壳侧那句「更新应用 URL，供启动页 ready 后导航」本来就要求一条持续通道。修法：每轮向壳重取 `get_app_url`。

第 8 层（同一次重跑）：模式决定发生在 setup 末尾，而启动页从建窗那一刻起每 250ms 问一次状态；standalone 实测这中间隔着 8 秒，那 8 秒里壳只能按「项目根推不出来」回答——健康启动被指控成环境问题（三段指错方向的提示 + 66 条同一条 WARN）。修法把这一次决定提到 `run()` 建窗之前，并把结果记进应用状态；`get_launch_status` 空根时先判形态标记。两条契约 + 「模式判据只有一处」都由 Rust 用例钉住（`launch_mode_is_decided_before_the_splash_ever_asks` / `standalone_reports_no_status_file_without_the_env_warning`）。

顺带量到一条**必须与装配同刀修掉**的泄漏：`.next/standalone/data/` 里带着开发机的 `llm-secret.key` 与 `app-settings.json`，而 resources 一旦真装配就会随安装包出去（解包即得密钥）。

第 2 层里还藏着第二条（真跑壳才暴露）：Windows 上 `std::env::current_exe()` 返回 `\\?\` 开头的 verbatim 路径，`resource_dir()` 由它派生。Rust 侧 `exists()` 判得对、文件确实在那儿，但把这份字符串当**参数**交给 node，node 会在 `\\?\F:` 处断开并报 `EISDIR: illegal operation on a directory, lstat 'F:'`——现场与根因完全连不上，而且这条只在真桌包形态下才走到（开发检出永远走 prebuilt 分支，所以历史上从没人碰过）。落法因此改成： 运行目标用**相对载荷根**的两个常量（`SIDE_REL_RUNTIME_ENTRY` / `SIDE_REL_SERVER`），`exists()` 判据与传给 sidecar 的参数同源于同一常量，Rust 单测禁止再把绝对路径当参数传。

第 6 层（把 1–5 层都修好之后重跑壳才暴露）：`COMFYAPP_LAUNCH_MODE` 只在 `start_self_orchestration` 里写，而 `self_launch` 要求「项目根推得出来」——真安装目录里两件判据文件都没有 ⇒ 模式从未被写 ⇒ `setup_standalone_runtime` 读到空串跳过 sidecar。这一层与载荷无关，所以「桌包永远起不了内嵌 server」还有一道独立的门。修法是幂等写一次模式——但**写在哪**由第 8 层决定（提到 `run()` 里、建启动页之前）。

**签字**：① 范围走「先把 standalone 接通，再补宿主拉起者」——不再让「谁起宿主」这一刀去背上面五层；② 运行期数据落位 = **每用户目录**（实测 NSIS 默认 perUser → `%LOCALAPPDATA%\ComfyAPP`，载荷根因此本来就可写）；③ 切口 = **新增一个 standalone 运行入口**（`scripts/standalone-runtime.mjs`），否掉「由 Rust 壳直接装配 env」与「由 Next 进程 fork 宿主」两条（理由与 #1216 正文一致：判据分叉 / 把 4-B3 卸掉的耦合装回去）。

**3-E2a 落地记录（本 PR）**：接通 1–5 层与入口的 server 半边。

- 装配：`bundle.resources: ["static/"]`（实测落点 `resource_dir()/static/**`，前缀保留）；壳侧载荷根与 sidecar 各只拼一处，且 `spawn_sidecar` 的源码形态由 Rust 单测**反向**钉住（拼回 `binaries` 即红）。
- 载荷实体化：`build-desktop.mjs` §载荷实体化 把 `.pnpm` 里的包上提到顶层再删 `.pnpm`（实测 404 MB → 245 MB；上提 36 个包 / 顶层 42 个候选名），随后**真解析** `next/dist/server/next.js`、`@swc/helpers/_/_interop_require_default`、`@libsql/client`——解析不到就构建失败，而不是让用户双击时才发现。「同名多版本取第一个发现者」这条取舍写在函数上方，它之所以可以接受，正是后面那三条解析断言在兜。
- 首启建表：§首启建表 用 `drizzle-kit export --sql` 现生成 `schema.sql`（实测 24 张表 / 13 KB）随包，入口在**零表**时应用；两条构建期断言——必须有 `CREATE TABLE`、**不许出现 `INSERT INTO`**（这条是「不带出厂数据」的机器判据，而不是注释承诺）。
- 运行期 env：`scripts/launcher-core/standalone-runtime-env.mjs` 装配 `SKIP_ENV_VALIDATION` + 四项必填 + **绝对** `DATABASE_URL`；`BETTER_AUTH_SECRET` 持久化在 `data/runtime-secret.json`，「文件在但内容不可用」一律抛错——悄悄换一把等于把既有会话全部作废，而现场不会有任何线索。`OAUTH_PLACEHOLDER` 与 `newAuthSecret()` 收成一个定义点，`env-init.mjs` 改为 import（原先两份字面量各自都能起来，分叉了没人报红）。
- 卫生：`src-tauri/static` 顶层改成**默认拒绝**（`STATIC_ALLOWED_TOPLEVEL` + `RUNTIME_SRC` 逐文件），并给 `PRIVATE_INPUTS` 补上 `data/llm-secret.key` / `data/app-settings.json`。`src` 只放行 `lib/process/kill-process-tree.ts` 一份——那是 `reap-process.mjs` / `dev-launcher.mjs` 运行期 `await import` 的目标（硬规则 3 的单点），随包能跑是因为 Node 22.18+/24 的类型擦除默认开启、而**随包的 Node 就是构建机那份二进制**。
- 实测（不装安装包，直接在装配出来的 `src-tauri/static` 上按首启形态跑）：入口 `schema bootstrap tables=0->24` → `boot pid=… port=3975`，`/`、`/workspace`、`/api/health` 全 200（health 从 503 变 200 就是首启建表生效的证据）；收尾用真回收入口 `node scripts/reap-process.mjs <pid> --force` → `taskkill /T /F（exit 0）`、端口失联，整棵树没有留孤儿。
- 端到端（壳这一侧，同样不装安装包）：在**检出之外**摆一份与打包器同布局的假安装目录（`app.exe` + `node.exe` + `static\**` 真拷贝），双击 `src-tauri/target/release/app.exe` → 壳日志依次出现 `launch mode=standalone` → `[sidecar] [standalone-runtime] schema bootstrap tables=0->24` → `boot pid=… port=14178` → `navigate_to_app called with url: http://127.0.0.1:14178/workspace`（端口与 boot 行一致 = 第 7 层生效） → `main window Finished` → 首页渲染出来，`/api/health` 回 `{"status":"ok","db":"up"}`；而 `COMFYAPP_PROJECT_ROOT 为空` 那条 WARN 归零（第 8 层生效）。第 6–8 层只有这一种验法：上面两条自查命令都绕过了壳。

**明确不在本刀**：入口的**宿主半边**（`resolveExecutorMode()` → 起 `executor-host.mjs`、孙子层回收、灰度口径放开）= 3-E2b，收口 ISSUE #1216；`bundle.resources` 之外那条「`--no-bundle` 只产出裸壳、不产出可运行载荷」的文档口径要按实测安装包内容再写（不凭推断）。
