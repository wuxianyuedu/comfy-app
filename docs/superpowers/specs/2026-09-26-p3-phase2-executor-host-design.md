# P3 §5 第 2 期：ComfyUI 执行器迁出 Next 进程（executor-host.mjs）

- 日期：2026-09-26
- 状态：**实施中** —— Phase 2-A/2-B/2-C、3-A、3-B0、3-B1、3-C、3-D、4-A1~4-A4 已合入 master（#1124 / #1131 / #1133 / #1138 / #1151 / #1157 / #1168 / #1178 / #1183 / #1186 / #1190）；4-B1 已合入 #1193（`c2ea2b1d`），4-B2 已合入 #1196（`601a6c67`），4-B3（两条派发循环收成一条 pull）已合入 #1203（`90c627e3`）——§14 D1 点名的四个进程内依赖至此全部摘完；4-B4 已合入 #1208（`d9c4a8fa`），4-B5（排队期写下的行在领取之后还在，ISSUE #1206）已合入 #1212（`37ef62f0`）；3-E1（宿主的运行时图构建期预编译进产物 + 收尾真起进程冒烟，ISSUE #1169 的第一半）已合入 #1219（`3e8b1b3f`）；3-E2（桌包 standalone 下由谁拉起宿主）另记 ISSUE #1216，**其立项前提已被实测否掉**（standalone 形态从未接通，五层各自断掉），更正与落地见 §16；§13 是逐期落地时的已签修正，§14 是 Phase 4（删旧）的签字，§15 是 3-E1，§16 是 3-E2a（已合入 #1231 `e4a3e042`），§17 是 3-E2b（ISSUE #1216 收口），§18 是 #1239 的签字与落地（解释器改由设置项指路径，PR #1251），§19 是 5-A（成片监看的 boot 续跑扫描；「搬进宿主」那条形态的前置记 ISSUE #1255）；`COMFY_EXECUTOR=host` 现在 **dev 与桌包 standalone 两条链路都会拉起宿主**，仍属灰度（默认不设 = inline）。桌包侧 comfy-cli 的 Python 解释器边界已按「用户自备 + 设置页指路径」收口（ISSUE #1239，见 §18），同轮实测到的「收口写失败被吞」另记 ISSUE #1250
- 前置：P3 §5 第 1 期已完全收线（#1042/#1045/#1053/#1056/#1060/#1068/#1071/#1074/#1075/#1077/#1080/#1083/#1086/#1090 共 14 PR，整条 ComfyUI 执行链 + lib 层地基都进 §18.4 第三类；host boot 顺序与 inject 接缝已就位）
- 上游方案：`outputs/p3-executor-process-migration-plan.md`（审计 §2.7 / 架构级）
- 范围：
  - Phase 2：新增 `scripts/executor-host.mjs`，作为 launcher 的一个受管子进程；用 `COMFY_EXECUTOR=host|inline` env 开关，**默认 inline、host 只是可起、不接管流量**
  - Phase 3：把提交侧写 DB 队列 + host 领任务；SSE 通道走「短轮询 DB」；env 切 `host` 灰度
  - Phase 4：删 Next 侧 `comfyRunner` 全局 + 三层补丁里被 host 取代的部分
  - Phase 5：`film/orchestrator.ts` 的 `watchFilm` 纳入 host（或 boot 扫描）—— 已收口：签的是 boot 扫描那半句（§19），host 那半句判为不搬（§23）
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

- 5-A：`film/orchestrator.ts` 的 `void watchFilm()` 挪到 host（或 boot 时一次性扫 GENERATING）；对齐「进程重启后不再卡 GENERATING」诉求。**已落：签的是 boot 扫描那一半（§19）；「挪到 host」那一半由 §23 判为不搬，本行不再有后续刀。**

**独立**：`../core/repository` 数据层双宿主（server-only 摘除 / driver 化）—— 见 §11，收口于 §23。

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

本节那句「Phase 5 之后再评估」（= 把成片编排迁进宿主）**已经在 §23 收口**：取到代码证据之后判为不搬。
往后再有人读到 §11，评估结论看 §23，不必从这一节重算一遍。

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

Phase 2-A 只抽这 12 个方法；等 Phase 3-B 真需要 `findExecutionProgressMany` 时（**它已经在 `repository-task.ts` 里、本来就是 `.select().from(task).where(inArray(id, ids))` 普通查询、不是 relational**）照同一模板补进 impl；等 Phase 5 film 侧需要带 `images` 关联的 `listByUser` 时，再做那张 relational→select/where 的映射。**这一格随 §23 一起作废**：film 侧不进宿主 ⇒ 那张映射表没有排期，UI 列表卡继续用 Next 侧的单例仓储。

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
  - **relational→select/where 映射**：Phase 2-A scope 内的 12 方法**全部本来就是** select/where/update/insert，**无需**映射；relational 只出现在 UI 列表卡（`listByUser` / `findById`），留到 Phase 5 film 侧真需要时再抽。（这一格已随 §23 作废：film 侧不进宿主，映射表不再排期。）
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

- **D1 节点级进度持久化**：`task.progressNode`（json，`{id,label?,value,max}`）由 `updateProgress` 可选第三参写入；帧无节点信息时**不覆写**，标签不闪没。动机：#1151 后状态/收口已走 DB，但画布「当前节点+步数」仍只在进程内 progress 帧里，host 模式拿不到——两模式观感分叉。**两条执行路径都要接**：executor-ws 的 WS progress 帧，以及 comfy-cli stdout 的 `type:"progress"` 事件——E2E 实测 raw 路径的进度全走 cli 不走 WS，cli 的 `onProgress` 此前只发进程内 emitter，单源化后进度全程 0%（本 PR 补 DB 回写；cli 路径拿不到 raw graph 的 class_type，label 缺省、id/步数照存 —— **这半句由 §24 推翻并修掉**：`executing` 事件本来就带 `class_type`，`progress` 不带但那张图就在手上）。
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

  **落地记录（4-B2，2026-09-27，第二与第三个依赖：状态栏那一格 + cli 原文面板）**。三处形状签字选定「给库补列」而不是「降级」，理由是 Phase 4 的终态就是 inline 分支被删掉——留一个「只有 inline 能用」的功能，等于给那条分支留活命的理由：① **`claimedAt` 列**（「已运行 mm:ss」的基准；内存里那个 `startedAt` 只有执行进程自己看得见）。写入三处：`claimNextQueued` 无条件覆写（一次领取就是新一轮的起点），`markRunning` 与首条进度帧用 `COALESCE` 定格（进度帧每几秒一发，跟着刷等于耗时永远接近零；而 raw 路径的 `promptId` 常常整轮跑完才回传，无条件覆写会让耗时从收尾那一刻重新开始）。历史 RUNNING 行不回填，读侧对 `claimedAt IS NULL` 退回 `createdAt` 近似，并写明那只是本列上线前一小撮旧行的兜底。② **`progressNode` 增存 `classType`**（状态栏历史上显示的是类名，库里只有中文 `label`）：两个都存，画布与状态栏各读各的，可见契约零变化；comfy-cli 那条事件源本来就拿不到 `class_type`，此时类名为空——与内存版旧行为一致，不是新缺口（**这句由 §24 推翻**：只对 `progress` 成立，且由 ISSUE #1202 修掉，真出图读数在 §24）。③ **`rawCli` 列 + 收口时整包写一次**（成功 / 失败 / 取消三条收口都写；不跟着日志的 200ms 防抖走，那等于把几千行原文白写几十遍）。「查看完整输出」的读侧因此不再碰 Next 内存，`getRawCli` 收成模块私有。主模型那一格不加列：`primaryModelName()` 两种图形态都能认，而 `execPayload` 是执行侧唯一一定写得上的载荷（`workflowSnapshot` 要到成功收口才落）。

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

| #   | 断点                                                                              | 一手证据（2026-09-28 真构建）                                                                      |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `bundle.resources` 缺席 → `src-tauri/static` 没有任何装配者进安装包               | 生成的 `installer.nsi` 里 `; Copy resources` 段为空，Install 段只有主 exe 与 `node.exe`            |
| 2   | 壳拼 `resource_dir()/binaries/node.exe`，打包器落 `resource_dir()/node.exe`       | 同上一行的 `File /a "/oname=node.exe"`；`target/release/node.exe` 是 8-26 的陈旧残留               |
| 3   | 载荷**不自包含**：`.next/standalone/node_modules` 顶层是指向仓库 store 的绝对软链 | `cpSync({dereference:true})` 摊平后 `Cannot find module '@swc/helpers/_/_interop_require_default'` |
| 4   | 首启建不了表：载荷只带生产依赖，`drizzle-kit` 不在其中                            | `/workspace` 200、`/api/health` 503 + `db:"empty"`，hint 让人「执行 pnpm db:push」                 |
| 5   | 运行期没有 `.env`（硬规则 17 剥掉了），而 `src/env.js` 判的是「文件在不在」       | `MissingEnvFileError`                                                                              |

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

## 17. 3-E2b（standalone 入口的宿主半边）——签字与落地记录

**签字四问**（动手前问的，四条都按推荐签）：

| #   | 决定                        | 签的口径                                                                                                                                                                                                                                                                      |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 桌包里开关从哪读            | **只认壳进程继承的环境变量**。不新增 `data/executor.json`、不读库里的设置——多一个来源就是多一处会与人对不上的判决，而 `resolveExecutorMode()` 是 ADR §14 D5 收口过的唯一定义（它保留的 `.env` 回读在桌包里仍然生效，但载荷根本没有那份文件，文档因此不许写成「`.env` 没用」） |
| 2   | 宿主起不来 / 中途退出怎么办 | **大声报，不降级不重启**。降级回 inline 会让已经写成 host 归属的行变成没人领的孤儿；重启会把「起不来的宿主」掩盖成「慢」。server 继续跑，用户仍看得见界面与排队数                                                                                                             |
| 3   | 桌包灰度口径                | **放开为「可用但仍标灰度」**：README 与指南改成「设了就起、判据看这三行」，§5 那条「连 `boot pid=` 都没有」的老判据换成按三行日志定性                                                                                                                                         |
| 4   | 验收强度                    | **要真出图**（不是只看 boot）：桌包库里一行 `SUCCEEDED` + 真 PNG + 由桌包 server 发出来                                                                                                                                                                                       |

**落法**（三条，都写在规范 §7.6 的「入口的宿主半边」）：宿主与 server 是同父兄弟而不是 Next 的 fork（回收因此收两棵树、先宿主后 server）；env 复用同一份装配结果，只覆盖 `COMFY_EXECUTOR`（归一化值）与 `COMFYAPP_HOST_BOOT_ID`（与两份日志同一个 stamp，算一次传下去）；`NODE_ENV=production` 由装配步显式给。

**真桌面上又数到两条**：① `NODE_ENV` 不给 production 时，pino 会去找 devDependency `pino-pretty`（两层产物都没有），宿主在模块加载阶段退出 1——而 `pnpm build` 收尾的冒烟**结构上看不见这一条**，因为它跑在仓库里、模块上溯撞到仓库的 dev 依赖。② 桌包真出图还差 comfy-cli 的 Python 解释器（载荷里没有、也不该有）；找不到时任务被大声判 FAILED 并给出中文错误 + 建议 + 重试，这条边界 = ISSUE #1239，不在本刀顺手做。

**验收记录（假安装目录 = 与打包器同布局的真拷贝，双击重编后的 release 壳）**：

- 壳日志：`launch mode=standalone` → `schema bootstrap tables=0->24` → `boot pid=96148 server=99920 port=5714` → `executor mode=host` → `host pid=106344 out=… err=…`。
- 宿主日志（载荷根 `log/services/`）：`boot pid=… mode=runtime` → `runtime inject-ok seams=runner+cli+finalize+ws+enqueue+reaper(owner=host)+dispatch(owner=host)+trace` → `q2-scan hostShardQueued=0 bootId=2026-09-29-09-06-50` → 每 5s 心跳，bootId 与两份日志文件名同一个 stamp。
- 真出图：桌包库里 `pkg3e2bmulzd6a9` = `SUCCEEDED` / `progress=100` / `claimedBy=host` / `promptId=6bdbf72e-…` / `resultImages=/api/generated/pkg3e2bmulzd6a9/img_0.png`；磁盘上该文件 1,265,859 字节（另带 `manifest.json` / `workflow.json`）；**由桌包 server 经 `GET /api/generated/…` 取回 200 与同样字节数**——「宿主写的文件 server 发得出来」这条跨进程交接是本轮的关键证据。
- 失败出口同样验到：没设 `COMFY_CLI_PYTHON` 时那一行是 `FAILED` + 「未找到 comfy-cli Python 解释器：…\python-venv\comfy-cli\Scripts\python.exe」，应用「历史」页把这句连同「建议」和「重试」按钮渲染出来了（截图）。
- 回收：关窗后 `comfyapp-pkg-sim` 下的三个 node（入口 / server / 宿主）全部消失；**用户自己的 ComfyUI（另一棵进程树）仍在**（`/system_stats` 200），说明收的是自己那棵树、没有越界。
- 门禁：`tests/standalone-runtime.test.ts` 28 条（新增 6 条：NODE_ENV 单测 + 起 / 不起 / 缺件 SKIPPED / 中途退出 / 值归一化 / 子进程真拿到 production）；`check-standalone-contents` 两层干净；`build-desktop` 全流程 exit 0。

---

## 18. #1239（桌包真出图的最后一格：comfy-cli 解释器由设置项指路径）——签字与落地记录（PR #1251）

**签字口径**：#1239 三条候选里签 **B —— 用户自备 + 设置页指路径**，与 `comfyuiPath` 完全同形。
不随包 Python（百 MB 级环境 + 平台与版本矩阵都要进装配步，且载荷根出现 `python-venv/` 会撞
硬规则 17 的私有输入判据），也不做首启引导（桌包用户没有终端）。

**落法**（三条，全部收在既有唯一口径上，没有新开第二条链）：

| 层   | 落点                                                                                | 为什么在这里                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 值   | 设置项 `comfyCliPython`，`DEFAULTS` 的默认值取 `COMFY_CLI_PYTHON`                   | 「环境变量是设置项的默认值」这条形态 `comfyuiPath ← COMFYUI_PATH` 已经走通；老用法（给壳进程设 env）一字不改照旧生效                                                                               |
| 推导 | 纯叶子 `src/lib/comfyui/comfy-cli-python.ts`（§18.4 第三类，同族 `launch-path.ts`） | 落点优先级与「找不到」的提示是纯解析；为这一行去 mock 整条派发链不值。形态分叉的判据用**文件**（`pnpm-lock.yaml` 在不在），不用环境变量，也不能用 `scripts/dev-launcher.mjs`（那份随桌包载荷出去） |
| 出口 | `error-advice.ts` 新增一条且**排最前**；设置页字段 + tRPC schema                    | 报错原文带 Windows 绝对路径，会被「模型缺失 / not found」按子串误抢；建议表是全项目唯一口径，别再在组件里写第二份                                                                                  |

**端到端又数到两条**（都是「文档里写着、代码里没成立」那一类）：

1. **宿主读的设置必须按文件指纹失效**。桌包里 `data/app-settings.json` 由内嵌 server 写、由执行
   宿主读，两个进程各一份模块级缓存；`getSettingsSync()` 旧实现「有缓存就永远用缓存」，于是宿主
   把第一次读到的空值钉死 —— 用户照提示填完解释器点「重试」，看到的还是同一条 FAILED。修法是
   把缓存失效判据改成 `mtimeMs` + `size`（与 `localWorkflows` 的校验和备忘同口径），且**先取指纹
   后读内容**（顺序反过来会把「新指纹 + 旧内容」钉住）。回归：守卫改回 `if (cache) return cache`
   → 三条用例即红。**这条对后续所有「由宿主取」的设置项都成立**，别再在调用点各自加一层缓存。
2. **提示里指的分区名必须是界面上真有的那个**。第一版写「设置 → ComfyUI → comfy-cli 解释器」，
   打包界面上那张卡叫「创作后端（ComfyUI）」、导航项叫「创作后端」。这类漂移不会让任何用例变红，
   所以钉成 `tests/settings-hint-label-matches-page.test.ts`（分区名取自 `SETTINGS_SECTIONS`、
   字段名按卡的源码核对）。

**验收记录（假安装目录 `%LOCALAPPDATA%\comfyapp-pkg-sim`，载荷 = 本次 `build-desktop` 产物）**：

- 设置项留空 → 行 `FAILED`，错误里的解释器路径是**载荷根**的 `static\python-venv\comfy-cli\Scripts\python.exe`，
  行上「建议」指向设置页那一项、不含 `pip install` / `python -m venv`。
- 在打包界面里「创作后端 → comfy-cli 解释器」填路径 → 保存 → 值落进载荷根 `data/app-settings.json`
  → 同一行改回 QUEUED 重试 → 宿主**没重启**跑完：日志里是设置里那台解释器的绝对路径 +
  `-m comfy_cli run --workflow …\static\temp\comfy-cli\wf-pkg3e2bmumh50es.json …`，库里
  `pkg3e2bmumh50es` = `SUCCEEDED` / `resultImages=/api/generated/…/img_0.png`，
  桌包 server `GET` 回 `200 image/png`、1,265,859 字节。
- 关窗回收：入口 + server + 宿主三个 node 全部消失；用户自己起的 ComfyUI 未被带走。
- 启动形态的一条硬约束：**cwd 必须是安装目录**。cwd 是壳推导项目根的候选之一，把 cwd 给成开发检出
  根，壳就会走 prebuilt 分支去起 `scripts/dev-launcher.mjs --mode prebuilt`，standalone 那条根本没跑
  ——「桌包设了 host 却没宿主」的一种成因，与 §5 那三条定性并列。

**遗留（不在本刀）**：桌包拓扑里 server 与宿主**两个进程都在跑 ComfyUI lifecycle**，且收口写失败被
`fireAndForget` 吞掉 —— 实测一次「领取失败 + `fail() 收口异常` ⇒ 行永久 RUNNING、并发上限 1 卡住
整条队列、reaper 每 30s 只 `checked` 不接管」。根因疑似 `SQLITE_BUSY`（drizzle 只回 `Failed query`、
cause 没落日志，故未定死）。记在 **ISSUE #1250**。
---

## 19. 5-A（成片监看的 boot 续跑扫描）——签字与落地记录

**签字四问**（动手前问的，四条都按推荐签；第一问先追问了「1 和 2 哪个好」，用实测答复后按 1 定案）：

| #   | 决定           | 签的口径                                                                                                                                                                                                                                               |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 5-A 走哪条形态 | **Next 侧起 boot 恢复扫描续跑**（ADR 那句「或 boot 扫描」）。方案 2（`watchFilm`+`composeFilm` 整体进宿主）的四条前置见下方「为什么不是宿主形态」，另开 issue 记全                                                                                     |
| 2   | 扫描捡哪些状态 | `GENERATING` **续跑**；`COMPOSING` **不续跑、大声判 FAILED 并给出口** —— `composeFilm` 一见 `COMPOSING` 就早退，那一格连界面上「重新合成」这个唯一出口都被自己的状态挡住；判成 `FAILED`（它允许重跑的状态）才把出口接回来，也不在开机时静默重跑 ffmpeg |
| 3   | 续跑的超时预算 | **沿用原预算（240 × 4s ≈ 16 分钟），从续跑那一刻起算**，不新增列、不动 schema；日志里写明这是续跑。真判死仍靠任务侧终态与回收器（#1184 / #1204 已收口）                                                                                                |
| 4   | 验收强度       | 单测 + 「启动点唯一」源形态判据 + **dev 与桌包两条端到端**（中途杀进程再起 → 续到镜头终态 → 真合成出 mp4）                                                                                                                                             |

**落法**（四条，都不新开第二条链）：

- 启动点 = `src/instrumentation.ts` 的 nodejs 分支里**唯一一处** `resumeStalledFilms()`，排在
  `startReaper` / `startDispatchLoop` **之后**（监看读的是任务行终态，排在领取循环之后才谈得上接得上）；
  Edge 分支里不许出现。与 reaper / dispatch 同族，判据钉在 `tests/film-resume-startup-point.test.ts`。
- 门槛 = `isSchemaReady()`（表还没建整轮跳过，与 `sweepOnce` 同口径；哨兵表是 `task`，而首启是一次应用
  整套 DDL，所以 `task` 在 ⇒ `filmProject` 也在）。扫描自己失败只 `logger.warn`，**不许把启动打死**。
- 去重 = `globalThis.filmWatchInFlight_v1` 的在飞表（`watchFilm` 入口判 + `finally` 释放）。
- 查询 = `filmRepository.listByStatus(statuses)`，`createdAt` 升序 = 先起先续；刻意不带 userId
  （这条语义是「本机这份库里还有哪些行该有人推进」）。

**跑端到端时实测到两处真实缺陷**（都在被复用的那个函数里，不在本刀范围外，一并修）：

1. **监看的计数顺序把影片钉死**。`watchLoop` 那一趟原先是 `if (!shot.taskId) { pending++; continue }`
   打头，于是**已终态但没有 taskId** 的镜头（逐镜提交时 `catch` 落的就是 `markFailed(shot.id)`，不带任务）
   被数成「还在等」⇒ `pending` 永不为 0 ⇒ 既不合成也不判失败，一路轮询到预算耗尽才落一句「生成超时」。
   现场：dev 里那部夹具影片停在 `progress=50` 不动。修法是把终态判断挪到前面，注释里写清「IDLE /
   提交前就崩的 QUEUED 照旧算等待」。回归：`「已终态但没有 taskId」的镜头不算等待，否则影片永不收口`
   （把顺序退回旧实现即红，实测核过）。
2. **预算文案与判据各写一份**。旧版注释写 `~16 min`、报错写「超过 16 分钟」，改一个不动另一个。
   收成 `WATCH_POLL_MS` / `WATCH_MAX_ITER` / `WATCH_BUDGET_MIN`，两条用户可见文案都插值同一个常量，
   并由判据用例数死（`${WATCH_BUDGET_MIN} 分钟` 恰好两处）。

**为什么不是「搬进宿主」（方案 2 的四条墙，实测过）**：① 宿主的运行时图从 `src/lib/comfyui/host-runtime.ts`
算起（esbuild 清单 307 个输入，只有 `src/server/db.ts` / `schema.ts` 两个例外），而
`tests/lib-server-imports.test.ts` 的 `REGISTERED` 现在是空的；② `src/lib/core/repository-film.ts:5` 自己写着
`import "server-only"` 且直引 `~/lib/db`，宿主只有 task 一张片的注入（`createHostRepo` 只产 `TaskRepoImpl`）
—— 这就是 §11 明写「独立议题、未落」的数据层双宿主；③ `composeFilm` 还拖着 `./compose-steps` 与
`workflow-run.server` / `llm/server`；④ 桌包里 server 与宿主**同父兄弟、关窗整树回收**（§17），搬过去
在装机形态**多不了一次关闭**，dev 里那一格由本刀的扫描补上。前置清单见 **ISSUE #1255**。

**验收记录（两条端到端都实跑）**

夹具 = 真 ffmpeg 出的两段 mp4 当镜头产物 + **克隆**一条真 SUCCEEDED 任务行（原行一字不动）给那个还没被投影过的镜头，
这样续跑循环要走完它自己的真实判决：读任务 → 翻镜头状态 → 从 `resultImages` 取视频路径 → 全终态后去合成。
造的两部影片正是要验的两种状态：`GENERATING`（一个镜头已终态、另一个挂着 QUEUED）与 `COMPOSING`。

| 拓扑                                                                                                                                           | 现场                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev（`pnpm dev`，端口族 3809）                                                                                                                 | 20:03:55 日志 `[film] 重启恢复扫描：续跑监看 1 部，合成中断判失败 1 部`；`e2e5a-gen-mummmbps` 行日志依次是「进程重启后续跑监看（本轮预算 16 分钟）」→「所有镜头完成，开始合成影片…」→「镜头 1/2 已就绪」「镜头 2/2 已就绪」→「🎬 影片合成完成」，库里落 `DONE` / `progress=100` / `finalVideo=/api/generated/films/e2e5a-gen-mummmbps.mp4`；`GET` 回 `200`，文件 95,956 字节，`ffprobe` 给 h264+aac、duration 4.023010s。`e2e5a-comp-mummmbps` 落 `FAILED` + `error=合成中断（进程在合成期间退出）`，行日志给的是「点『重新合成』可再来一次」 |
| 桌包 standalone（假安装目录 `%LOCALAPPDATA%\comfyapp-pkg-sim`，载荷 = 本次 `build-desktop` 产物，`COMFY_EXECUTOR=host`，**cwd 给成安装目录**） | 载荷内 `.next/server/chunks/src_server_film_*.js` 原字节带着这两条文案（**Next/Turbopack 的 chunk 不转义中文**，与 esbuild 那份宿主 bundle 相反 —— 见 §7.5 那条的补注）；内嵌 server 起在 4174，`/api/health` 回 `db:"up"`；`e2e5a-gen-mumoe46z` → `DONE` + `/api/generated/films/e2e5a-gen-mumoe46z.mp4`，`GET` 回 `200 video/mp4` 95,956 字节、`ftyp` 头；`e2e5a-comp-mumoe46z` → `FAILED`；扫描那一行在载荷的 `log/nextjs/standalone-server-stdout-*.log` 里；关窗后本载荷的 node 进程整树回收为 0                                         |

夹具（`e2e5a-*` 行与 `public/generated/films/**`）验完即删。dev 库在本刀前后都是 0 部影片，没有碰到既有数据。

**记账一条**：本刀 +136 行把 `orchestrator.ts` 从 898 行（离 R5 的 900 只差 2 行）推到 1034 行。
pre-commit 跑的是非 strict（R5 只提醒）、`check:all` 也不调这条检查，所以不阻塞本刀；但没有把超限文件顺手塞进
`scripts/.file-size-baseline.json`（它现在是 `total: 0`）—— 该谁推过线就记在谁头上，切法（合成 + 项目回写那半段下沉，
以及「只搬 composeFilm 不搬 syncFilmToProject 会成环」这个坑）记在 **ISSUE #1257**。

**这一刀顺带买到的两条判据**（都是端到端才暴露、单测写不出来也不会红的）：① 监看计数顺序把影片钉死在 `progress=50`（见上）；
② 用例的 `taskRepository` 桩**缺 `findExecutionProgressMany` 这个键**时，循环会在那一行 reject、
`resumeStalledFilms` 那边看起来「跑成功了」而影片一动不动 —— 补上这个键之后，夹具用例才真的能断到收口。

## 20. #1250（终态库写失败不许被咽掉）——签字、两处被实测推翻的前提、落地记录

**签字四问**（动手前问的，四条都按推荐签）：

| #   | 决定             | 签的口径                                                                                      |
| --- | ---------------- | --------------------------------------------------------------------------------------------- |
| 1   | 下一刀做哪条     | **#1250：收口写失败不许被吞**（Phase 5 之后的执行链最后一格静默失效）                          |
| 2   | 穷尽之后怎么办   | **有限次退避重试 + 归还槽位交给回收器接管** —— 前提是不再依赖「再写一行库」作为接管信号        |
| 3   | 并发写这条根因   | **本刀顺手给库连接设 `busy_timeout`**                                                          |
| 4   | 验收强度         | **单测/判据 + 桌包双进程写复演**                                                               |

这一刀的实际产出与签字时的心智模型有两处不同，两处都是**复演与量具**推翻的，不是读代码读出来的 ——
按第 4 问签的口径，这两处只能靠真进程看到。

### 被推翻的前提一：「归还槽位」不等于「回收器接管」

签第 2 问时的模型是：`releaseDispatchSlot()` 让 `isDispatchedHere()` 变 false ⇒ 回收器那句
「本进程没有足迹 ⇒ 真孤儿」（#1184 立下的）下一轮就接管。桌包复演跑出来的事实是：

- 22:50:41.621 那一行被领成 `RUNNING`；外部进程从这一刻起每 14s 按住一轮 WAL 写位；
- 22:50:46.815 宿主抛出终态写失败，stdout 里第一次出现了驱动错误码
  （`…（SQLite: SQLITE_BUSY / SQLITE_BUSY: database is locked / database is locked）`）——
  ① 「原因要看得见」这一半**成立**；
- 然后那一行在 `RUNNING` 上停了 **11 分半**，期间回收器扫了 **22 轮**，每轮只打一句
  `reaper(running): checked 1 stale RUNNING task(s) (older than 60s)`，一次动作都没有。

根因不在回收器，而在 `fail()` 自己：`writeTerminal` 抛出后，函数末尾那几行清理
（`s.executedWorkflow.delete(taskId)` 等）**再也没机会执行**，而 `reaper.ts:174` 的
`isTaskClaimedInProcess` 读的是**四样**（`pendingDispatch` / comfy-cli 子进程 /
`executedWorkflow` / `settled`）—— 只归还槽位，另外三样还替这一行主张「本进程仍在执行」。

修法因此不是「再加一条回收规则」，而是把清理收成一处：`runner-state.ts` 新增
`forgetTaskFootprint(taskId, promptId?)`（四样足迹 + 反查 `promptToTask`）与
`forgetTaskClaimEntirely(taskId)`（再加 `settled` / `finalized` 两把一次性锁 —— 写没落库时
这两个主张都是谎，留着会把回收器自己的 `claimTerminal` 挡死）。`complete()` / `fail()` 末尾
那两处手工 `delete` 与 `giveUp` 现在都走这同一个出口；`enqueue.ts` 的取消路径**没有**并进来，
它「只在确实持有槽位时才归还」的条件语义与这里不同，硬合会把那条判据洗掉。

用例侧也照这个改：`executor-write-retry.test.ts` 的穷尽那条不再只断言 `isDispatchedHere`
变 false，而是直接引回收器那句判据 `isTaskClaimedInProcess(state(), () => false, id)` 为 false
—— 只断言槽位的话，这条用例在旧实现下也是绿的，那就等于没写。

### 被推翻的前提二：`PRAGMA busy_timeout` 在 `@libsql/client` 上覆盖不到执行写的那条连接

签第 3 问时的做法是「把 PRAGMA 收成一份清单、四处站点都加 `busy_timeout = 2000`」。
复演读数对不上：桌包那一格 4 次终态重试挤在 **0.6 秒**里跑完，每次都是**秒抛** ——
如果预算真在，每次应该等满 2 秒。量具（`temp/measure-*.mjs`，两个进程 + 真驱动，
每档都重复可跑）给出的因果是：

| 形状                                       | 争用方读回的预算 | 结果                                   |
| ------------------------------------------ | ---------------- | -------------------------------------- |
| 不设（本刀之前的现状）                     | 驱动默认 `0`     | `SQLITE_BUSY`，**4ms**                 |
| 开机 `PRAGMA busy_timeout = 2000` 一处设好 | 读回 `2000`      | 单连接形状：等到 **1123ms** 后**写成功** |
| 同上，但池里另有一条连接被占用             | 读回 `2000`      | **11ms** 秒抛（= 没设）                |
| `createClient({ timeout: 2000 })`          | 建连接时设好     | **2221ms** 后抛（等满了）              |
| 同上，池里另有一条连接被占用               | —                | **2135ms** 后抛（照样覆盖得到）        |
| `createClient({ timeout: 500 })`、持锁 4s  | —                | **669ms** 后抛                         |

机制读法：`@libsql/client` 的 `file:` 客户端是**连接池**，`maxConnections = Math.max(1, config.concurrency)`
而 `concurrency` 未配时是 `undefined` ⇒ `NaN` ⇒「永远没到上限」⇒ 池随时新开一条
**没见过开机那条 PRAGMA** 的连接；`timeout` 则走 `new Database(path, { timeout })`，
由驱动在**建立每条连接**时设好。最后一行（预算 500 ⇒ 等 669ms 抛）是用来排除「那两秒是别的原因」的。

代价也跟着量了：libsql 的语句执行是**同步**的，所以等锁多少毫秒，本进程的事件循环就停摆多少毫秒 ——
等锁 2.2 秒期间，同进程 10ms 的心跳**一次都没跳**（本该约 220 次）。

于是本刀把这两族**分开**（这是签字口径的修正，不是加码）：

- `src/lib/sqlite-pragmas.ts` 的共用清单只留**库级**两条（`journal_mode` / `foreign_keys`）——
  它们设过就落进文件，PRAGMA 是正确形状；`busy_timeout` 从清单里**移除**，因为留在里面等于
  让「四处都设了」这句话继续是假的。判据把这条也钉住（清单里不许再出现 `busy_timeout`）。
- 等待预算改由 `createClient({ timeout: SQLITE_BUSY_TIMEOUT_MS })` 给，且**只给执行宿主**，
  值 **250ms**。给在宿主：它是为执行而生的进程，250ms 换掉「毫秒级瞬时锁也要走重试」值得。
  不给 Next：它还要响应界面，而秒抛 + `TERMINAL_DB_WRITE` 的 40/80/160 退避本来就是为
  「对手几十毫秒就散」设计的。两侧不对称是签字决定，所以由用例逐侧核对（Next 两处
  出现 `SQLITE_BUSY_TIMEOUT_MS` 即红）。
- 启动器那侧（`scripts/launcher-core/standalone-runtime-env.mjs`，非 TS 宿主、`node:sqlite`
  **单连接**）保留自己那条 `PRAGMA busy_timeout = 2000`：那一刻是首启建表，整个 schema 一次跑完，
  「等一等」比「启动失败」好，而且没有界面请求在等它。单连接是这里能用 PRAGMA 的前提。

`SQLITE_BUSY_TIMEOUT_MS` 只有 250ms ⇒ **稍长一点的锁必然走到穷尽路径**，也就是说「设了预算」
绝不能被当成「不必重试」。这条关系写成了用例（`250 < 一次真锁`），免得下一次有人把预算当防线删重试。

### 落法（五处，都不新开第二条链）

- `src/lib/sqlite-error.ts`（纯叶子）：沿 `cause` 链取 `code` / `message` 拼回一句可读文本
  （`describeSqliteWriteError`），以及「这一族等一等就有锁」的判定（`isSqliteBusyError`，
  只认 `SQLITE_BUSY` / `SQLITE_LOCKED` / `SQLITE_PROTOCOL` 与 `database is locked` 句式；
  认不出原因判不可重试 —— 不把 `no such table` 拖成四次同样的写入）。
- `retry-policy.ts`：`TERMINAL_DB_WRITE = 4 次 / 指数 40ms / 封顶 300ms`（累计等待 280ms）。
- `executor-write-retry.ts`：`writeTerminal(taskId, label, write)` 包住**状态那一次写**
  （`finalizeSuccess` / `finalizeFailure`），产物行与日志刷盘不在这一条上。
- `executor-finalize.ts`：两处调用点接 `writeTerminal`；末尾清理改走 `forgetTaskFootprint`。
- `runner-state.ts` / `host-runtime.ts` / 三处连接站点 + 启动器：上面两节说的足迹与预算。

### 验收记录

### 验收记录（桌包双进程写复演跑通；dev 那条被一个新发现的坏挡住，另开 issue）

载荷 = 本次 `build-desktop` 产物整树重放到假安装目录 `%LOCALAPPDATA%\comfyapp-pkg-sim`，
`COMFY_EXECUTOR=host`、**cwd 给成安装目录**（否则壳的 `resolve_project_root()` 会把检出根当项目根、
误走 prebuilt 那一支 —— §5 那行记过）。载荷侧先核过形状：
`scripts/executor-host.runtime.mjs` 里 `createClient({ url, timeout: SQLITE_BUSY_TIMEOUT_MS })`、
`SQLITE_BUSY_TIMEOUT_MS = 250`、`SQLITE_PRAGMAS` 只有两条、穷尽文案以 `\uXXXX` 转义形存在。
造行用「克隆一条已知能跑通的行 + 把 `comfyCliPython` 置空」⇒ 领取后 ~2–4.6s 必落终态，
抢锁窗口的位置因此可复现（真出图要几十秒，窗口能不能盖住终态写全看运气）。

| 阶段 | 现场（时间戳取自 `static/db.sqlite` 与 `static/log/services/executor-host-stdout-2026-09-30-09-11-56.log`） |
| --- | --- |
| 上一轮遗留行（**只归还槽位**那版代码留下的） | 本次启动后 stdout 在 `09:12:01` 与 `09:12:31` 各打一句 `reaper(running): checked 1 stale RUNNING task(s)`，行的 `finishedAt=09:12:31.103` ⇒ 两轮节拍（第一轮登记、第二轮判定）就是这两拍，`error=任务被领取后 37310s 仍未回传 prompt_id，且连续两轮都无人认领它（执行宿主可能已崩溃）— 请重新执行`。⇒ 回收器那句判据本身是好的，坏在**同进程内**足迹没摘 |
| 对照组（不抢锁） | `claimedAt 01:15:03.651` → `finishedAt 01:15:05.677` = **2.03s** 领取→终态，`FAILED` |
| 目标行（外部进程从 `RUNNING` 起每 4s 按住写位，共 6 周期 / 41.5s） | `09:15:09` 行日志 `warn 终态失败收口写库撞锁，按预算重试（最多 4 次）` → `09:15:11` `error 终态失败收口写库失败（已试 4 次）：Failed query: … host（SQLite: SQLITE_BUSY / SQLITE_BUSY: database is locked / database is locked）；本进程不再认领这一行，队列继续推进，未收口的行由回收器下一轮对账判定。` ⇒ **原因可见 + 4 次退避 + 穷尽留痕三条同场成立** |
| 穷尽之后 | 抢锁方自己散掉之后（窗口散掉于 09:15:11 + 4s 那一拍），`09:16:30` 回收器 `checked 2` 并给目标行登记 `warn 任务处于 RUNNING 但还没有 prompt_id 回传，本轮先登记；下一轮仍无人认领才判孤儿`；`09:17:01.113` 判 `FAILED`（**穷尽后 110s**：60s 年龄门槛 + 30s 两轮节拍 + 余量） |
| 队列有没有被卡住 | 见证行 `claimedAt 09:15:24.517` —— 目标行穷尽（09:15:11）后 **13 秒**就被领走，而不是等那一行收口才往前走 |
| 留痕落库的时机 | 目标行 `logs` 列在抢锁期间是 NULL（写库正是失败的那件事），到回收器接管那一次的 `persistLogs` 才把上面三行一起刷进去 —— 复演把这一格也读出来了，文档里因此不写「穷尽当场就能在行日志里看到」 |

**dev（inline 形态）那一条当时没跑完，本刀末尾补跑通了** —— 顺带把「Next 自己扣住写位」那句读数降级成**未复现**：

- v1 的编排自己在抢锁窗口里崩了（它自己的 INSERT 撞 `database is locked` 而没带 `busy_timeout`），
  当时看到的「窗口散掉之后领取循环仍每 2s 报 `Failed query: …`、直到杀掉 dev 整树才松开」因此**不能
  归给应用**；照同一形状复现两轮都没有再出现：v2（一段连续 20s 的长按）与 replay（照 v1 的
  4s 按 / 0.2s 放、10 周期 / 48.5s）都是**窗口一散当场恢复**，replay 之后连续 4 分钟零新增失败。
- 补跑通的读数（dev，端口族 3809，inline 形态；下面那条对照组是 v1 同拓扑里量到的，同一份代码同一台机器，只有编排崩没崩的差别）：对照组领取 → 终态 **8.6s**（真 comfy-cli 校验失败，
  用户可见文案是「工作流校验未通过（comfy-cli 对照服务端校验）…」）；目标行 `11:05:34` 领成
  `RUNNING` → `11:05:45` 同一秒里「写库撞锁，按预算重试」+「已试 4 次…本进程不再认领这一行」
  → `11:07:06` 回收器登记 → `11:07:37` 判 `FAILED`（**穷尽后 112s**，与桌包那条的 110s 同形）；
  见证行 `11:06:04` 已经跑完自己的终态 —— **两种宿主形状上这条链都闭合了**。
- 那次崩掉的编排还顺手暴露了第二格真缺陷，与本刀同批修：`describeSqliteWriteError` 原先把
  `LOG_DETAIL_MAX` 整份预算给 drizzle 的 head，而 head 连着 `params:` —— 一次校验失败会把整段
  模型清单塞进参数，实测 **655 字**那一行里 `（SQLite: SQLITE_BUSY…）` 被挤成省略号，
  「原因看得见」在长 head 下又失效。现在预算**先给原因、再给现场细节**（用例钉住）。
  剩下的 ISSUE #1262 只留一句可执行的下步：**下一次再撞「扣锁不放」，日志必须能说出是谁扣的**。

**这一刀的判据清单**（都跑过）：`sqlite-error.test.ts` 8 条、`executor-write-retry.test.ts` 4 条
（穷尽那条现在断言的是回收器那句 `isTaskClaimedInProcess`，不再是「槽位归还」）、
`sqlite-pragma-sites.test.ts` 7 条（含把「开机 PRAGMA 覆盖不到池里新开的连接 = 11ms 秒抛」与
「`timeout` 选项覆盖得到 = 等到并写成功」当场量出来的那两条）、`retry-policy.test.ts` +1 条。


## 21. #1262 第一步：把「谁扣的锁」变成可归因的现场（库写失败的原因在所有捕获点可见）

**为什么先做可见性而不是先修扣锁**：#1262 那次「窗口散掉之后还写不进去」的读数，唯一能拿到的
证据是一句 `领取队列任务失败：Failed query: update "task" set "status" = ? …` —— 分不清是
**别人扣着写锁**、**没这张表**、还是**连接自己坏了**，三种成因的处置完全相反。#1250 已经把
「终态那一次写」的原因落地了，但执行链上**其余**库写捕获点一直是瞎的；先把它修好，
这一格才谈得上定位（也是硬规则 4「失败路径必须有可读文案」在本仓的具体形态）。

**复现的两轮结果**（详见 §20 的 dev 那格）：v1 的现象在照原形状复现时**没有出现**，而 v1 的编排
自己当时就在窗口里崩过一次（它的 INSERT 没带 `busy_timeout`）⇒ 那句读数不足以归给应用。
issue 不关，改写成「等一次可归因的现场」，并把它需要的判据补齐。

**落法**（一处出口 + 逐位同形的换用，不新增第二套文案体系）：

- `src/lib/sqlite-error.ts` 加 `isSqliteFailure` 与 `sqliteAwareErrorText(error, action, fallback)`：
  是库失败 ⇒ `动作：原句（SQLite: CODE / cause 消息）`；是库失败但链上一个码都没有 ⇒
  额外**明说**「原因未取到」（空白会被读成「没有原因」，而真实情况是原因在链路里丢了）；
  不是库失败 ⇒ 原样交给 `errorText`（网络层翻译那些本领一条不丢）。参数与 `errorText`
  **逐位同形**，所以 15 处调用点只是换个函数名，动作前缀与语义一字不改。
- 换用的 15 处全是**库写失败**的捕获点：`executor-dispatch`（等待提示写入 / 领取 / 领取循环 /
  续跑 kick）4 处、`reaper` 两条 sweeper、`executor-continuation` 两条总线、`executor-cli`
  七处「收口异常」。**没换**的那几处刻意为之：`comfy-cli 启动失败`（子进程 spawn）、
  `自动启动失败`（生命周期）、`就绪探测失败`（网络）、`interrupt`（ComfyUI HTTP）——
  它们不是库写，换过去只是让通用文案绕一圈。
- `describeSqliteWriteError` 的预算顺序改成「先原因后 head」（上面 §20 里那 655 字的现场）。

**判据**：`sqlite-error.test.ts` +6 条（带码 / 没码要明说 / 非库失败走通用 / 「没表」也是库失败
但仍判不可重试 / 长 head 不挤掉原因 / 抛值是 string-null-undefined 不炸）；
`executor-dispatch.test.ts` +1 条**直接断言那句 warn 本身**带着 `SQLITE_BUSY`
—— 旧实现下这条必红（它只有 `Failed query` 头部），这才叫把可见性钉住而不是写着玩。

**留下的账**：#1262 仍开，判据已就位；真实现场出现时，先读那句 warn 的 `(SQLite: …)` 再决定
是「池里一条连接带着未提交事务回池」还是「外部持锁」。


## 22. #1257（`orchestrator.ts` 越线之后的下沉：合成那半段搬出去）——落地记录

这不是新决策，是 §19 末尾那笔记账的兑现：5-A 的 +136 行把 `src/server/film/orchestrator.ts`
从 898 推到 1034（越过规范 §12.6 的文件行数上限 900）。当时**没有**把它塞进
`scripts/.file-size-baseline.json`（基线 `total: 0` 保持），而是开 ISSUE #1257 记着
「谁推过线谁拆」—— 把超限文件登记进基线等于让判据从此对它永久失明。

**切法照 issue 里已经验过的那条**（两条走不通的路也写在里面，这次没再试）：

| 新文件 | 装什么 | 为什么是它 |
| --- | --- | --- |
| `src/server/film/film-log.ts` | `appendFilmLog` | 编排侧与合成侧都要往 `filmProject.logs` 追加行；它留在任何一侧，另一侧就得反向 import 它 |
| `src/server/film/compose-film.ts` | `isFFmpegAvailable` + `_ffmpegOk` 闩锁、`runFFmpeg`、`composeFilm`，**以及 `syncFilmToProject` + `FilmShotClip`** | 回写只被合成调用（出片之后才谈得上回写）。只搬 `composeFilm` 不搬回写 ⇒ 新模块反向引 `./orchestrator`、编排又引合成 ⇒ 环。`check-circular-deps` 判的是 AST 上的 import，`import type` 也不算安全 |
| `src/lib/film/film-status.ts` | `FilmStatus` / `ShotStatus` 一份定义 | 这两条联合原本在 `orchestrator.ts` 与 `src/components/studio/film-studio-config.ts` **各抄一份**（§12.12 的形态：两边都是同一组字面量，改一处另一处连编译期都不报错）。放 `src/lib` 是因为视图层与服务端都要用，而 lib 是两侧共同的地基（放 server 就会让 components 为了一行类型去引服务端，`eslint boundaries` 拦的就是那个）。config 侧改成 re-export，对外 API 一字不变 |

编排文件只留「剧本 → 分镜 → 建片 → 逐镜提交 → 监看」，**1034 → 707 行**（合成 341 行、行日志 20 行、状态族 21 行各自成文件）；方向变成单向一条链：
`orchestrator` → `compose-film` → `film-log` / `compose-steps`。

**搬法是脚本搬的，不是手抄的**（`temp/split-film-compose.cjs`，一次性）：三段合计 314 行、
含大量 ffmpeg 参数数组与 CJK 注释，手抄一次就可能把某个哨兵值（`code: -1` + `"timeout"`）
或某条注释改味，而那只在真跑 ffmpeg 时才暴露。脚本按行范围取段 + **每段校验必须含的锚点文本**，
锚不对直接退出；搬完用 `tsc` 追哪些 import 变成多余（`spawn` / `fs` / `path` / `sizeSpecDims` / `normalizeProductionProgress` /
`errorMessage` / `withTimeoutResult`，以及 `text-clamp` 与 `compose-steps` 两整行），
也追出我一开始误删的两格（`toSizeSpec` 编排侧读载荷时还要用；`FilmStatus` 编排侧只剩引用类型）。

**连带改到的调用点**（迁移目录「五查」里这一刀命中三条）：`film` router 两处
`await import("~/server/film/orchestrator")` 改指 `compose-film`；`orchestrator.test.ts`
的导入按归属拆成两行（`composeFilm` / `syncFilmToProject` 走新模块）；仓储桩不用复制 ——
它 mock 的是 `~/lib/core/repository` 那一层，合成侧从同一入口取，桩照旧生效。
**没改**的一处是刻意留的：`orchestrator` 不再 `export type FilmStatus / ShotStatus`，
先全仓 grep 确认没有跨文件消费者再动，别留一个「看起来在用其实没人引」的转发出口。

**门槛与门禁**：`src/server/film/**` 的实测 64/76.7/64/55.6（分母没变，同一批判决换文件住），
门槛保持 30/50/35/25 不升不降；`src/lib/film/**` 那格里 `film-status.ts` 是纯类型文件
（v8 记 0/0，目录聚合仍是 100），因此 100/90/100/90 不动。写这节时 `--strict` 只剩工坊线的
`workflow.ts`（944 行）超限 —— 那是别人的账，本刀不替它放宽判据；它由工坊线自己的
`23bc80da` 收掉，所以本 PR 合入后 `--strict` 是 **[structure] OK**（零超限）。循环依赖 0 组、
零消费导出 0、孪生对 0 对。

**顺手核的一句文档口径**（issue 里点的第二条）：指南 `feature-workshop-flow.md` 那条
「成片合成是纯客户端」在服务端管线（`render_film` 工具 + `composeFilm`）出现后已经说不全 ——
改成明写**两条路**：工坊内的时间线预览/导出确实是客户端，服务端的 `composeFilm` 真起 ffmpeg
出片并回写项目，两者互不替代。

---

## 23. #1255（把成片编排迁进执行宿主）——前提取到证据后被否掉，关单不搬

§11 结尾那句「Phase 5 之后再评估」在这里收口。ISSUE #1255 把要动哪些地基记全了（六格清单），
这次**逐格复核了一遍**，结论是不搬：不是「代价太大所以先放着」，而是**这一刀想买的那件事在桌包拓扑里
不成立**，而 dev 那一格 §19（5-A）已经补上。

### 否掉它的那两条实测

1. **桌包里 server 退 ⇒ 宿主被整树收走**，所以「编排在宿主里 ⇒ Next 死了还能继续出片」是假的。
   入口 `scripts/standalone-runtime.mjs` 把 server 与宿主作为**同父兄弟**各起一棵树，
   `server.on("exit")` 直接调 `close()`，`close()` 里对宿主那棵树调 `reapTree(host.pid)`
   （走 `scripts/reap-process.mjs`，硬规则 3）。§17 的「同生死」是这条代码路径的口径名，
   本次先把它读回代码确认，随后又跑了一次真机读数（见下面「补测的读数」那一节）。
2. **反向不对称，所以搬过去是加脆性不是减脆性**。同一份入口里宿主退出只打一行
   `host exited`，**不降级、不重启**（§17 的签字理由：降级会让已写成 host 归属的行没人领）。
   把影片推进交给宿主之后，宿主自己退出的那类故障（解释器没配、模块加载期退出等）会让界面照常活着、
   影片停在原地的同时**没有任何进程会继续推它**；今天的形态下「应用开着就一定活的那一个」是 Next。
3. dev 侧那一格：Turbopack 改服务端模块是热重载、不是进程死亡，真重启/崩溃之后的续跑由
   §19 的 `resumeStalledFilms` 负责（代价 = 一个重启间隔内不推进）。所以 §11 当初想要的
   「扛过一次热重启」也已经在手。

### 补测的读数（同日，把上面两条从代码路径变成现场）

第 1、2 条当时依据的是读代码，这次各跑了一次真机现场（载荷 = `comfyapp-pkg-sim`，
其中 `scripts/standalone-runtime.mjs` 与 `scripts/executor-host.mjs` 与 master `cmp` 逐字节相同）：

```
[standalone-runtime] boot pid=104948 server=128120 port=10077 appRoot=…\comfyapp-pkg-sim\static
[standalone-runtime] executor mode=host
[standalone-runtime] host pid=139224 out=…executor-host-stdout-2026-09-30-13-03-43.log …
—— 只杀 server 那一棵树（taskkill /PID 128120 /T /F，exit 0）——
[standalone-runtime] closing (server exited code=1 signal=null)
[standalone-runtime] reap pid=139224 taskkill /PID 139224 /T /F（exit 0）
```

之后入口、server、宿主三个 pid 全部不在，入口自己以 exit 1 退出 —— 第 1 条成立：
**server 一退，宿主就被整树收走**，所以「编排搬进宿主 ⇒ Next 死了还能继续出片」在安装包里拿不到。
（日志里没有 `reap pid=128120` 那一行是对的：`close()` 只在 child「还活着」时补刀，
server 已经是退出态 —— 那条判据的作用就是不让每条正常路径都留一行假的 `reap FAILED`。）

```
[standalone-runtime] host pid=130772 …
—— 只杀宿主那一棵树 ——
[standalone-runtime] host exited code=1 signal=null （server 继续在跑；任务会留在队列，…）
```

`grep -c "^\[standalone-runtime\] host pid="` = **1**（没有第二个宿主被拉起来），
入口 138180 与 server 123012 都还在，杀完之后 `/api/health` 仍回 `{"status":"ok","db":"up"}` ——
第 2 条成立：**宿主退 = 只留一行日志、不降级也不重启**，所以把影片推进交给宿主是加脆性。

**取数形状的两条说明（别再踩）**

- 上面两条读数**没有**走 `app.exe`，而是用载荷自己的 `node.exe` 直接起
  `static\scripts\standalone-runtime.mjs`（显式给 `PORT` 与 `COMFY_EXECUTOR`）。要判的两条都住在
  入口这一段（两棵树的父子关系与回收），壳只是入口的父进程、不参与这两条判决。
- 第一次想走壳时踩了一个**纯属工具层**的坑，别把它读成产品行为：用 `powershell -File <脚本>`
  （脚本里 `$env:COMFY_EXECUTOR='host'` 之后 `Start-Process app.exe -WorkingDirectory <安装目录>`）
  起的那一轮，入口日志是 `executor mode=inline` —— 那一轮跑的不是 host 拓扑，**不作数**。
  随后改用 `powershell -Command` 在命令行里内联设同一个变量再起同一个 `app.exe`，入口日志就是
  `executor mode=host` + `host pid=138568`：
  ```
  [standalone-runtime] schema ready tables=24
  [standalone-runtime] boot pid=125884 server=129932 port=4375 appRoot=…\comfyapp-pkg-sim\static
  [standalone-runtime] executor mode=host
  [standalone-runtime] host pid=138568 out=…executor-host-stdout-2026-09-30-13-16-57.log …
  ```
  ⇒ **桌包「壳继承会话 env ⇒ 入口判 host ⇒ 起宿主」这条链是通的**（指南 §3-D 那条常规给法照旧成立），
  上一版这里写的「那份 env 没到壳进程」**是把我的启动脚本当成产品行为读错了，已订正**；
  那个 `-File` 形态为什么不传**没有继续查**（工具层，不值得查）。
  顺带这一轮也补上了「读数是在直接起入口的拓扑上取的」那格保留：**走壳与不走壳，入口这一段的拓扑一致**
  （都是 entry → server 树 + host 树），所以上面两条读数对出厂形态同样成立。
- 仍然**没测**的一格：用户从图标双击（没有会话 env）时靠**系统环境变量**给开关 —— 那是指南 §3-D 的
  常规给法，本轮没有重测，别拿上面任何一条读数替它背书。

### 没做的事（逐格留档，别下一个人重算）

- `src/lib/core/repository-film.ts`（313 行、两个类）与 `src/lib/core/repository-production.ts`
  （120 行）仍是 `import "server-only"` + 直引 `~/lib/db` 的单例，没有改成
  `createTaskRepoImpl(db, { owner })` 那个可注入形态；宿主今天仍然只有 task 一张片
  （`host-runtime.ts` 的 `createHostRepo()` + 八条 seam，没有第 9、10 条）。
- `tests/lib-server-imports.test.ts` 的 `REGISTERED` 仍是**空清单**，本刀没有新增
  `src/lib/** → src/server/**` 这条越界边。
- `src/lib/db-schema-ready.ts` 的哨兵仍然只判 `task` 一张表。
- ffmpeg 子进程的回收归属没动：现在由 Next 起、随 Next 那棵树收；「杀宿主 → 无孤儿 ffmpeg」
  这条实测因此不需要做。
- 跨进程触发契约没动 —— 这条最要紧：§14 D1 刚把派发收敛成**一条 pull**，影片若搬过去就得再造
  一条「提交在 Next、推进在宿主」的通道，那是明确违 D1 的。

### §22（#1257）顺手把将来的成本降了一截，但那不是搬迁

`compose-film.ts`（341 行）+ `compose-steps.ts`（93 行，只 import `path` 与 `~/lib/path-display`、
`~/lib/number-format`）+ `film-log.ts`（20 行）已经从编排文件里切出来，与 Next 专属依赖
（`workflow-run.server` / `llm/server` / `enqueue` / `firstframe`，全留在编排侧）分开了。
将来若要搬，路比 issue 记的更短；但**这三件仍带 `server-only`、仍住 `src/server/**`**，
数据层那格一格没动，所以结构限制原样存在。

### 什么条件下重开这条

三条里任一条成立就值得重估，否则不要凭「ADR Phase 5 那行字面还没做」重开：

1. 出现「Next 必须能退出而影片继续」的**真需求**（例如把 server 侧做成可重载的界面层）。
2. 桌包拓扑改成宿主有**独立生命周期** —— 入口不再在 `server.on("exit")` 里收宿主，或宿主能被
   重新拉起（那要连带推翻 §17 的「不降级不重启」签字）。
3. 数据层双宿主因**别的原因**必须先做（例如宿主需要读 film 之外的第二张业务表）；那时影片侧的
   搬迁是顺路，而不是它自己立项的理由。

**决策**：ISSUE #1255 关成 `not_planned`，理由 = 上述第 1、2 条实测；§11 的「Phase 5 之后再评估」
到此为止，往后的口径以本节为准。

---

## 24. #1202（认节点类名）——落地记录，含一条被实测推翻的旧口径与一条被否掉的「正解」后半句

### 现场

`RunnerState.promptByTask` 只剩两个读者（`executor-ws.ts` 的 `executing` / `progress` 分支），
写方随 4-B3 删掉 `enqueue()` 一起消失 ⇒ 那一格恒空。后果是两格用户可见的东西长期退化：

- 日志里「▶ 节点 [3] 未知节点（?）」；
- `task.progressNode` 不带 `classType` / `label` —— 而 4-B2 之后状态栏「当前节点」读的就是
  `classType`、画布读 `label`（§14 D1 那条），所以这格空 = 状态栏在 host 执行时永远没有节点名。

历史库里的证据：两条 3-E2b 之后真跑成功的 raw 行，`progressNode` 都是 `NULL`。

### 改法（两条执行路径都要接，只接一条等于没修）

| 落点 | 改了什么 |
| --- | --- |
| `src/lib/comfyui/graph-node-class.ts`（新） | `classTypeForNode(graph, nodeId)`：API 形状走 `graph[id].class_type`，RAW（UI 原件）形状走 `nodes[].type`；`nodeLabel()` 也从 `executor-ws.ts` 搬进来（两条路共用一份中文名表，留两份就是 §12.12 的孪生对） |
| `raw-overrides.ts` | 新出口 `rawUiNodeType()`，**只做一件事**：让「WS/cli 帧的节点 id → 类名」与「画布覆盖注入找那个节点」共用 `resolveRawNode` 那一条下钻（含子图链 `76:67`）。两处各算各的迟早给出不同节点 |
| `executor-ws.ts` | 两个读者从 `promptByTask` 改读 `executedWorkflow`（提交那一刻真正交出去的图，画布覆盖已注入、纯 UI 节点已剔除，所以与帧里的 id 对得上） |
| `executor-cli-stream.ts` | **这才是 raw 任务的实际来源**：raw 进度走 comfy-cli 的 stdout，不走 WS。`progress` 事件把 `deps.patched` 那份图认出的类名一起透出；`executing` 那两行日志带上「中文名（ClassType）」 |
| `runner-state-shape.ts` / `runner-state.ts` / `enqueue.ts` | 删掉 `promptByTask`（字段 + 三处 delete + 两处用例清零），单例键随之 `comfyRunner_v2 → v3`（加/减字段都要升版号，`??=` 只认键名） |

### 被实测否掉的一条「正解」

issue 原文的正解是「两个读者改读 `executedWorkflow`，然后删掉 `promptByTask` **与 `Job.prompt`**」。
前半句照做；**后半句没做** —— `Job.prompt` 不是没主的字段，它是 `executor-cli.ts`
非 RAW 那条分支的**入参**（`applyApiOverrides(prompt, overrides)` → 收拾图 → 直接提交）。
删它等于把 API 提交形态一起删掉，那不是 #1202 的范围。字段留着，注释改成明写「当前两条入口都不带它，
但那条分支消费它」。

### 被实测推翻的一条旧口径

§13-3C（D1）与 §14（4-B2 那一格）都写着「**comfy-cli 那条事件源拿不到 `class_type`**，
所以类名为空 / `label` 缺省，与内存版旧行为一致，不是新缺口」。真机抓原文之后：

```
{"schema":"event/1","type":"executing","node":"76:67","title":"CLIP Text Encode (Positive Prompt)","class_type":"CLIPTextEncode",…}
{"schema":"event/1","type":"progress","node":"76:69","completed":1,"total":25,…}
```

⇒ 那句话**只对 `progress` 成立**：`executing` 是自带 `class_type` 与 `title` 的（而且那是 ComfyUI
展开子图之后的权威值，所以现在实现是「事件优先、图兜底」）；而 `progress` 也不真是「拿不到」，
只是当年没人去查那张就在 `deps.patched` 里的图。旧记录按当日的理解留着，从这里以本节为准。

### 读数（真出图三跑，副本库 + 独立宿主进程）

形态照本线一贯的复演套路（拷库 → 克隆一条历史成功的 raw 行 → `spawn(process.execPath, ["scripts/executor-host.mjs"])`
且 `DATABASE_URL` 指副本 → 只读观察 → `reap-process.mjs` 整树回收）。

1. **原样克隆那一跑：整轮被 ComfyUI 缓存**（11 个节点全是 `execution_cached`，没有 `executing` /
   `progress`）⇒ `progressNode` 仍为 `NULL`。**这一跑不作数**，但也顺手量出一个真的缺口：
   缓存轮次里我们完全不解析 `execution_cached` / `executed`，所以「这次跑的东西一个节点都没动」
   在界面上与「什么都没发生」长得一样 —— 另开一条记（见下）。
2. **打掉缓存那一跑**（把提示词换成带唯一标记的一句 ⇒ `CLIPTextEncode` 输入变了 ⇒ 真的采样）：
   `progressNode` 一路跟着刷新，最终
   `{"id":"76:69","value":25,"max":25,"classType":"KSampler","label":"采样去噪"}`
   —— 类名与中文名都在，而且 `76:69` 是**子图链 id**（顶层 wrapper 76 里的内部节点 69），
   说明委托给 `resolveRawNode` 那一条下钻在真数据上是通的。面板同时出现四行按节点日志：
   ```
   ▶ comfy-cli 节点 [76:67] 编码提示词（CLIPTextEncode） 开始执行
   ▶ comfy-cli 节点 [76:69] 采样去噪（KSampler） 开始执行
   ▶ comfy-cli 节点 [76:65] VAE 解码（VAEDecode） 开始执行
   ▶ comfy-cli 节点 [95] SaveImageAdvanced（SaveImageAdvanced） 开始执行
   ```
   最后一行是 `nodeLabel` 的兜底形态：表里没有的类名**原样回类名**，不编一个中文名。
3. **第三跑只为取事件原文**（`executing` / `progress` 各首例，就是上面那两行），用来判「类名到底
   该从事件取还是从图取」—— 这条决定实现形状，不猜。

### 判据

- `graph-node-class.test.ts` 4 条：API 形状 / RAW 形状 / 子图链 id / 两种形状同时命中时 API 优先 /
  载荷不可信（`null` / 字符串 / 数字 / 数组 / 空图）一律不抛且认不出。
- `executor-ws.test.ts` 新增 5 条：RAW 任务一帧 `progress` 落库时带 `classType` + 中文 `label`
  （#1202 原文明说「没有任何用例断言这件事」的那格）、API 形状同样带、
  图里没有这个节点时两者都不带但**进度帧照落**、还没有图时也不丢帧、`executing` 记下的
  `lastNodeByTask` 用同一份图。
- `executor-cli-stream.test.ts` 新增 3 条：`executing` 事件自带类名时以事件为准（图里故意给一个
  不同的类名）、`progress` 不带类名时按图认、事件与图都认不出时日志只报 id。
- **反向验过它真的会红**：把 `progress` 那一侧的取值临时改回「恒空」（等价于修前行为），
  两条正向断言立刻红、三条负向仍绿 —— 这条判据不是自证的空壳。

### 顺带留下的一条账（没做，另开 ISSUE #1278）

`execution_cached` / `executed` 两种 comfy-cli 事件目前**不解析**。全缓存轮次里它们是唯一的发生，
于是界面表现为「进度不动、也没有任何按节点行」，而 ComfyUI 其实已经把这单收完了。
要买的东西与 #1202 不同（那是「认不出类名」，这是「缓存轮次没有可见性」），所以没混进这一刀，登记为 ISSUE #1278。

---

## 25. #1164（comfy-cli 回传的中文乱码）——落地记录，含一条被实测否掉的「修法候选 1」

这条缺陷**先于本工作线存在**（3-C 的真机端到端复现时记下），落在本线的执行链上所以记在这里。

### 现场与根因

`[comfy-cli 原始]` 行内嵌的 prompt JSON 里中文是乱码，而我们自己拼的日志行中文正常。
根因在 **Python 那侧的默认编码**，不在 Node 的解码：中文 Windows 的 ANSI 代码页是 GBK/CP936，
Python 在非 ASCII locale 下 `sys.stdout` 与 `open()` 都跟着 locale 走。

用 comfy-cli 那份解释器（`python-venv/comfy-cli/Scripts/python.exe`）在本机量了三态：

| 注入 | `sys.stdout.encoding` | stdio 按 UTF-8(fatal) 解 | 读我们写的 UTF-8 工作流文件 |
| --- | --- | --- | --- |
| 什么都不给（今天的生产形态） | `gbk` | **解不动** ⇒ 面板乱码 | `UnicodeDecodeError`、exit 1 |
| 只给 `PYTHONIOENCODING=utf-8` | `utf-8` | 解得动、中文复原 | **仍然 `UnicodeDecodeError`**（`open()` 不看这个变量） |
| 给 `PYTHONUTF8=1` | `utf-8` | 解得动 | `MATCH=True`（UTF-8 模式管全局，含 `open()`） |

⇒ **issue 里「倾向候选 1（`PYTHONIOENCODING` 最小、跨平台安全）」这一手被实测否掉**：它只是半个修复，
而且留下的是更坏的那一半（显示好了，读文件照样崩）。落地给两个键：
`PYTHONUTF8=1` 管全局、`PYTHONIOENCODING=utf-8` 再显式钉死 stdio。

同一条口径仓里其实早就有 —— `lifecycle-launch.ts` 给 **ComfyUI 本体** 那份 env 里两个键都设了，
理由写得比这条 issue 更硬：中文 Windows 上自定义节点 `print` 一个 emoji（非 GBK 字符）会抛
`UnicodeEncodeError` 把进程直接打崩。本刀把 comfy-cli 这条链路对齐过去，不新造约定。

### A/B 真机读数（同一条工作流、各自打掉执行缓存、独立宿主进程指副本库）

种进去的提示词带一个唯一标记（`戴宇航员头盔的柴犬·before` / `·after`），判据就是
「这串中文在 comfy-cli 回传的 `rawCli` 里是否原样活着」：

| | 终态 | 标记在 `rawCli` 里活着 | 标记在我们自己的面板日志里活着 | U+FFFD |
| --- | --- | --- | --- | --- |
| 修前 | SUCCEEDED | **否** | 是 | **16** |
| 修后 | SUCCEEDED | 是 | 是 | 0 |

（两跑的终态都是 SUCCEEDED，所以这不是「任务失败」那一类可见故障 —— 是**取证现场被写坏**：
出图成功了，但 `rawCli` / `prompt_preview` 这些本该能复现「ComfyUI 到底收到了什么」的原文，
中文那一半是废字节。也正是这条让 #1250/#1262 那套「日志要能自证原因」的口径缺一块：
原文乱码时，看日志的人分不清是用户提示词本来就怪、还是我们转手时弄坏的。）

### 判据

`tests/comfy-cli-python-utf8.test.ts` 三条（先 `stripComments` 再匹配，用的是那条台账刚推广的共享件）：

1. comfy-cli 那份 spawn `env` 字面量里 `PYTHONUTF8` / `PYTHONIOENCODING` 都在
   （顺带钉住同块的 `PYTHONUNBUFFERED`，那是 #1184 的兄弟判决，别被后人改没）；
2. 两条管道都**显式** `setEncoding("utf-8")` —— 写侧锁了 UTF-8，读侧漂掉同样是乱码；
3. `lifecycle-launch.ts` 那份保持同一口径（防止有人把「ComfyUI 本体的那两个键」当历史包袱清掉）。

选择器上的一处自我订正：第一版用「含 `PYTHONUNBUFFERED` 的 env 块」定位，直接把 ComfyUI 那条链路
判成「找不到」（它那一份叫 `stdioEnv`、也没有 `PYTHONUNBUFFERED`）—— 改成按大括号配平扫
`env` / `stdioEnv` / `childEnv` 三种字面量、再挑装着 `PYTHON*` 键的那一个。
判据也做过变异验证：只删 `PYTHONUTF8` 留 `PYTHONIOENCODING`（正是那个「半个修复」）→ 第 1 条红。

### 为什么不做候选 2（Node 侧按代码页解）

那是**又造一处平台分叉**，而本仓的平台判据只许收在两处（AGENTS 硬规则 3 / launch-and-build §3.1–§3.3）。
何况候选 2 只救 stdio，救不了 Python 自己 `open()` 读文件那条崩路径 —— 上面那张表的第二行就是它。

---

## 26. #1182 方案 3（组 A 报错落在生成物上时当场点破）——只做定性，共写没解决

这条不是本线的缺陷，是**门槛层的一条误导**：Phase 4-A2 端到端验证时同目录起了第二个
`next dev` 实例，收进程按硬规则 3 整树 SIGKILL，之后 `git commit` 被组 A 拦下 —— 报的是
`.next/dev/types/validator.ts` 的两条语法错（TS1005 / TS1128），而那次改动里没有半个
`.next` 文件。launch-and-build §5 排障手册早有这一行，处置口径是「整目录移走」；
本刀把「先怀疑自己」这一步从人身上挪到机器上。

### 落的是什么、不是什么

落的是 issue 里三条候选的第 3 条：**只在「所有 `error TS` 行都落在 `.next/` 那一个目录段」时**
打印成因 + 处置命令。`scripts/check-tsc-artifact-hint.cjs` 由 `.githooks/pre-commit` 汇总段
在组 A 失败分支里调用，带 `|| true` 且自身恒退 0 —— 判决仍属于 tsc，这条不许变成第二种
失败形态，也不许把组 A 的红洗成绿。

它**不解决**共写。第 1 条（实例级 `distDir` 分叉）与第 2 条（收法改温和）都没做，ISSUE #1182
保持 open：前者要连带核 `outputFileTracing*` 与 `check-standalone-contents.cjs` 对 `.next`
路径的假设（AGENTS 硬规则 17/18），不是本刀的体量；后者弱于前者，崩溃/断电照样留半截。

### 一处「先验证再印给用户」的必要代价

提示里那句 `rm -rf .next/dev/types` 不是白来的：`next-env.d.ts` 明确
`import "./.next/dev/types/routes.d.ts"`，直觉上把目录删掉会把红从生成物搬到源码。实测**不搬**
（最小工程复现同样形态：缺生成目录时 tsc 对这行 side-effect import 不报错）。做法是先在真
`.next/dev/types` 移走的状态下跑一次全量 tsc（无新增红，只有当时那个 `.cjs` 自己的 `@ts-nocheck`
缺失误报），再用最小工程把「缺目录 + 那两行 import」单独复现一次。判据里留了一条正向用例
钉住处置命令的措辞，但**这条结论的机器化守卫是删目录后 tsc 不新增红这个动作本身** —— 若哪天
Next 改口径，提示里那条命令要跟着改，别只改判据。

### 误报口径（这条判据的全部价值所在）

- 掺进任何一个非 `.next` 文件（哪怕只有一条真类型错）→ 完全沉默，不许让人拿「删生成物」
  去交差；
- 一条 `error TS` 都没有（OOM、`tsconfig` 读不到、参数错）→ 沉默；
- `.nextify/` 这类同前缀目录不算生成物（认的是目录段，不是前缀）。

反向用例比正向更要紧：这条提示一旦在「真类型错」上出现一次，之后就没人信它了。

### 本地复演（不是照抄 issue 的字符串）

把真 `validator.ts` 的第 79 行截到 `type __IsExpected<Specific extends AppPageConfig`（复现
SIGKILL 落在写文件窗口那半行），`pnpm exec tsc --noEmit --incremental false` 给出
`.next/dev/types/validator.ts(79,51): error TS1005: '>' expected.`，判据 `artifactOnly=true`
且提示原样打印；把文件按 sha256 还原后 tsc 复绿。**单行也能点破**是这次补的一条用例 ——
现场是两行，但半截文件有几行报错取决于断在哪，判据不能要求凑够两条。

---

## 27. #1278（整轮命中执行缓存时没有按节点可见性）——落地记录，签字口径 (a)+(c)

#1202 复演时撞出来的另一条账（当时另开 issue，没混进那一刀）：同一份工作流第二次提交若整轮
命中 ComfyUI 的执行缓存，comfy-cli 一个 `executing` / `progress` 都不发，于是那 ~20s 里
界面只有「已提交」和收口两行 —— 状态栏「当前节点」空、日志里按节点行 0 条，而任务其实
**已经跑完了**。这条买的是那种轮次的可解释性，不是类名。

### 签字口径（先取证再签，签完才动代码）

- **(a) 按节点补日志行**：`execution_cached` 一行「≡ comfy-cli 节点 [76:69] 采样去噪（KSampler）
  命中缓存，跳过」。
- **(c) 全命中时再给一句汇总**：「≡ 本轮 11 个节点全部命中 ComfyUI 执行缓存（未重算，因此没有
  按节点进度）」。
- **(b) 被否**：让 `progressNode` 承载「最后一个被跳过的节点」。那一格在 4-B2 的契约里是
  「**当前**节点 + 步数」，而缓存轮没有「当前」—— 写进去等于让状态栏显示一个早已跑完的节点。
  宁缺不假。

### 三种形状的真机读数（同一张图、独立宿主进程、副本库）

| 轮次 | comfy-cli 事件 | 面板里的按节点行 | `progressNode` | 汇总行 |
| --- | --- | --- | --- | --- |
| 冷轮（改动前取证） | `executing`×11 + `progress`×25 | 11 行「▶ … 开始执行」 | `{"id":"76:69",…,"classType":"KSampler"}` | 无 |
| 整轮缓存 | `execution_cached`×11，**0 条** `executing`/`progress` | 11 行「≡ … 命中缓存，跳过」 | **NULL（刻意）** | 1 行「≡ 本轮 11 个节点全部命中…」 |
| 混合轮（只打掉一句提示词） | `execution_cached`×7 + `executing`×4 + `progress`×25，`converted.node_count=11` | 7 行「≡」+ 4 行「▶」 | KSampler 25/25 | **无（正确沉默）** |

`execution_cached` 与 `executing` 一样**自带** `class_type` 与 `title`（真机原文，别再按
§13-3C 那句「cli 拿不到类名」推理 —— 那句在 §24 已经被推翻过一次），所以名字不需要回查图；
而 `converted` 带 `node_count` ⇒ 「全部命中」这个判决有权威总数可用，不必自己数 UI 图。

### 实现落点（一处算法、三个动词）

`executing` / `execution_success` / `execution_cached` 三行里那段
`[id] 中文名（ClassType）` 收成本模块内的 `nodeTag()`：三行在面板里是同一格内容、只是动词不同，
各写一遍迟早给出不一致的名字（用例里钉了「同一个节点在两行里同名」）。
汇总行挂在 `envelope` 分支**收口之前**（那一刻才知道全不全），且要求
`cachedNodes === nodeCountTotal` —— 混合轮里缺的就是进度而不是定性，写「全部命中」就是假话。

### 复演那条「打掉缓存」的动作本身踩了个坑（值得记，别下一个人重踩）

第一版往 `execPayload` 的子图定义里追加标记，改了 2 个 `CLIPTextEncode`，**两轮照样全缓存**。
真图上根本不读那份值：提交的是「`execPayload` + `applyApiOverrides(params.workflowInputs)`」
现场合成的结果，override 会**覆盖**图里那格。改 `params.workflowInputs` 里那条 `text` 之后
才拿到混合轮。⇒ 以后要造「部分命中」的现场，动 override，不动 UI 图内层 widgets。

### 判据

`src/lib/comfyui/executor-cli-stream.test.ts` 新增 4 条（整文件 23→27 条，`src/lib/comfyui` 全目录
44 份文件 607 passed）：缓存行文案与「**不写** progressNode」（断言 `onProgress` 一次都没调）、
同名节点跨动词一致、全命中才给汇总且 `finish` 照旧、混合轮与缺 `converted` 两种情形都不给汇总。
变异验证：把汇总判据放宽成 `cachedNodes >= 0` 并把缓存行文案换成占位串 → **3 条红**（不是 1 条，
因为「沉默」与「文案」是两条独立断言），还原后全绿。

### 没做的事

- **本刀提交时写过一句「WS 那半也必须补（照 #1202 的教训，只接一条等于没修）」—— 那句被本机读数否掉了，
  订正在这里**。它当时是按 `protocol-adapter.classify()` 的代码形状推的：那一支确实不认
  `execution_cached`，会落到 `other` 丢掉。但同一批复演的 trace 给出的是**另一件事**：
  按 kind 计数 `cli`=80、`history`=1、**`ws`=0**（`WS 消息` / `WS 消息无归属任务` /
  `WS 消息非合法 JSON` 三个出口全 0），而派发就绪门控要求 WS 是 OPEN 的（门控过了才会提交）
  ⇒ 带 `prompt_id` 的执行帧（含 `execution_cached`）**根本没落到 `handleMessage`**。
  合理解释与 §13-3C 是同一件事的两面：ComfyUI 把执行事件只发给排队那个 client，而排队的是 comfy-cli
  自己那条连接。⇒ #1278 在 WS 侧**没有可修的对象**，不是「漏接了一帧」。
  **这条读数的边界要说清**：`handleMessage` 那四个 `trace("ws", …)` 出口里，只有「非合法 JSON」
  （278 行）在 `if (!promptId) return;` 这一跳**之前**，其余三条（无归属任务 292 / WS 消息 296 /
  执行错误 423）都在之后。所以 kind=`ws` 全 0 同时意味着「连一帧解析失败的原文都没来」，
  唯一覆盖不到的是「**合法 JSON 但不带 `prompt_id`**」那一类（`status` 就属于它）——
  能断言的是「带 `prompt_id` 的执行帧一条都没来」。
  这条读数顺带问出一个更该记账的问题（**executor-ws 那套按节点分支现在是否已零消费**），
  开成 ISSUE #1315，取证清单在那个 issue 里；结论拿到之前不动 `executor-ws.ts`。
- 缓存轮的「这一轮省了多少时间」没做（需要 ComfyUI 侧的耗时口径，本刀只有 `claimedAt`→`finishedAt`
  这一格，不足以拆出「重算 vs 取缓存」）。

---

## 28. #1315（`executor-ws` 的按节点分支是否已零消费）——取证结论与留下的口径

这条是 §27 末尾那次自我订正顺带问出来的（订正本身走 PR #1316）。结论已经拿到，且**不是**「修一个 bug」，
而是把一条通道的真实承载能力钉进文档 + 让它以后可被数出来。

### 取证分两步，缺第二步就得不到结论

**第 1 步：两种形态各数一轮 trace 的 kind 分布。**

| 形态 | 怎么起的 | 那一轮 | 新增 trace 按 kind |
| --- | --- | --- | --- |
| host | `scripts/executor-host.mjs` + 副本库（§27 那批复演） | 混合轮 | `cli`=80 / `history`=1 / **`ws`=0** |
| inline | 独立端口 `next dev -p 3999` + 副本库 + 子进程 env 给 `COMFY_EXECUTOR=inline`（进程 env 优先于 `.env` 那份 `host`） | 混合轮（`execution_cached`×7 + `executing`×4 + `progress`×25，SUCCEEDED，`progressNode` 落 KSampler） | `cli`=80 / `history`=1 / **`ws`=0** |

到这里只能得到一句**有限**的话：带 `prompt_id` 的执行帧没落到 `handleMessage`。分不开的是另一半——
「帧来了但不带 `prompt_id`」与「一条帧都没来」在 trace 里长得一模一样，因为当时四个
`trace("ws", …)` 出口里只有「非合法 JSON」在 `if (!promptId) return;` 之前，其余三个都在之后。

**第 2 步：把那一跳变成可观测的，再数一次**（这是 #1315 取证清单的第 2 步，不是可选装饰）。
补完之后同一套架子数出来：

```
kind=ws 35 条，全部走「不带 prompt_id」这一跳：
  status               ×4    dataKeys: ["status","sid"]
  kaytool.resources    ×16   dataKeys: ["cpu_percent","cpu_count","cpu_name","ram_total",…]
  dasiwa.system_monitor×15   dataKeys: ["cpu_percent","cpu_count","ram","swap","disks","gpus"]
```

⇒ **连接是活的、帧确实在来，但来的只有 `status` 与第三方自定义节点的遥测广播，一条执行帧都没有。**
合理解释与 §13-3C / §27 那句是同一件事：ComfyUI 把执行事件只发给**排队那个 client**，而自 4-B3
「唯一提交实现 = comfy-cli」之后，排队的从来不是本应用这条 WS。

### 结论与处置（走向 1，签字前不提删除）

1. `executor-ws` 的 `node-started` / `node-finished` / `progress` 三段与 `protocol-adapter` 的对应分类
   **今天是零消费的**。
2. **不删**。那是给「直连 `/prompt`」形态留的正确实现，帧哪天回来就得是对的；删掉等于把
   「回到那形态时静默丢现场」埋回去（与本线「不靠删除解决问题」的一贯取向一致）。
3. 面板里的**按节点现场只可能来自 `executor-cli-stream.ts`** 这一句，写进两个模块的头
   （`executor-ws.ts` 与 `protocol-adapter.ts`），并指明「在这条通道上补可见性类功能会测不出效果」——
   #1278 之所以在 WS 侧没有可修对象，正是这条。
4. 那一跳的留证**按类型只落第一帧**，并设类型数上限（32）。逐帧落盘的话一轮里三分之二是同一个类型的
   重复行、遥测约 1s 一条，长会话一小时就是几千行诊断噪声，而这个问题只需要「这类帧来过」这一个事实。
   判据三条分别钉住：留证存在、同类型不重复、新类型仍要落（预算不许退化成「只记第一条」）、集合有界。
   变异验证：拿掉两条预算 → **2 条红**（`got 2` / `got 40`），还原全绿。

### 为什么没有给「按节点行只来自 cli」加机器判据

写不出不误报的静态判据：它要断言的是「某类事件在运行期不会从某个来源到达」，属于外部服务行为，
不是仓库里的源码形状（同类先例见 AGENTS 硬规则 24 末尾——别再为「该不该通用」造启发式扫描器）。
所以这一条走**文档 + 可观测点**：模块头写明拓扑、那一跳留证可数，将来若执行帧真的开始到达，
`kind=ws` 的帧型分布会立刻把它暴露出来，而不是等面板少了一行才发现。

### 复演手法（下次要测 inline 形态照这个，别碰用户的实时链路）

副本库用 `vacuum into`（正被 dev server 开着的库直接 `cp` 会拷到 `-wal` 未合并的页）；
`DATABASE_URL` 与 `COMFY_EXECUTOR` 都走**子进程 env**（进程 env 优先于 `.env` 回读，见
`launcher-core/executor-mode.mjs`），这样 `.env` 里那句 `COMFY_EXECUTOR=host` 不影响本次取证，
也不往用户的 `db.sqlite` 与任务历史里写任何东西；`next dev` 用 `process.execPath` +
`createRequire().resolve("next/dist/bin/next")` 起（不经 pnpm 的 `.cmd` 壳，见 #1306 那条），
端口另起一个避免与用户实例共写 `.next`（#1182），跑完 `scripts/reap-process.mjs <pid> --force`
整树回收并清 `public/generated/<taskId>` 与 `temp/comfy-cli/wf-*.json`。
尺寸压到 512²（`workflowInputs` 的 `aspect_ratio` 换 `1:1 (Square)`、`megapixels` 给 0.25）省显存与时间。
