# P3 §5 第 2 期：ComfyUI 执行器迁出 Next 进程（executor-host.mjs）

- 日期：2026-09-26
- 状态：**草案**（v1）—— 三个未决问题标注「需评审」，评审通过后升级为「已确认」进入实施期
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
const { configureExecutorCli } = await import("../src/lib/comfyui/executor-cli.ts");
const { configureExecutorFinalize } = await import("../src/lib/comfyui/executor-finalize.ts");
const { configureExecutorWs } = await import("../src/lib/comfyui/executor-ws.ts");
const { configureEnqueue } = await import("../src/lib/comfyui/enqueue.ts");
const { configureReaper } = await import("../src/lib/comfyui/reaper.ts");
const { configureTraceLogPath } = await import("../src/lib/comfyui/trace.ts");

const hostRepo = buildHostRepository(); // 用 node:sqlite 或 libsql 直连
const hostLog = buildHostLogger(); // 走 stderr + host 专属日志文件

configureRunner({ taskRepo: hostRepo, log: hostLog });
configureExecutorCli({ taskRepo: hostRepo, logger: hostLog, resolveComfyBase: hostResolveBase });
configureExecutorFinalize({ taskRepo: hostRepo, getView: hostGetView, runtimeLog: hostLog });
configureExecutorWs({ taskRepo: hostRepo });
configureEnqueue({ taskRepo: hostRepo });
configureReaper({ taskRepo: hostRepo });
configureTraceLogPath(process.env.COMFYAPP_HOST_TRACE ?? "log/comfyui/comfyui-trace-host.log");

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

| 风险 | 缓解 |
|---|---|
| Phase 3 切流量后 host 崩、任务停摆 | Q2 恢复扫描；UI 侧「updatedAt 陈旧 → 提示重启」；`COMFY_EXECUTOR=inline` 一键回退 |
| Phase 3 SSE 改轮询后浏览器压力 | 每 3s 一次、只拉增量、日志列尾窗口截断；对比 inline 期内存事件的成本，其实更低 |
| Phase 4 删旧路径太激进 | 分 4-A/4-B/4-C 三个独立 PR；每步都跑全量测试 + 手工回归 |
| 与 launcher 现有编排冲突 | §3 里 host 只是一个 `spawnInGroup` 子进程，不引入新的进程语义；沿用 `kill-process-tree` 唯一收口 |
| standalone 产物缺 host.mjs | Phase 2-D 白名单登记 + `check-standalone-contents.cjs` 真数产物 |

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

## 12. 评审记录

- 2026-09-26：v1 起草。Q1/Q2/Q3 + §10 五个未决点等待评审。
