# ComfyUI 执行器独立宿主（COMFY_EXECUTOR）使用指南

> 一句话：把「驱动 ComfyUI 跑生成任务」的那条执行链从 Next 进程里搬出来，放进一个
> 由启动编排器（`scripts/dev-launcher.mjs`）管理的独立 Node 进程（executor-host）。
> 设计依据与分阶段状态见
> [P3 §5 ADR](superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md)（§13 实施增补）。

## 它解决什么

内联（inline）模式下执行器活在 Next 进程里，与 web server **同生共死**：

- dev 热重启 / 手动重启 → 在跑的生成任务中断（内存队列没了、comfy-cli 变孤儿、
  DB 行卡 RUNNING），界面显示「生成中」但实际无人推进；
- 执行链的长任务与请求处理抢同一个事件循环。

host 模式下任务状态全部经 SQLite 交换（进度 / 日志 / 终态由执行方写库，界面走
≤3s 短轮询读库），于是：

1. **重启 Next 不打断生成**——任务在 host 进程里继续跑；
2. **崩溃可恢复**——host 挂了，下次启动按 Q2 语义扫表对账收孤儿（不永久卡「生成中」）；
3. 为后续把 film 等长流程编排也搬出 Next（Phase 5）打好地基。

## 怎么开（dev，当前唯一支持的场景）

1. 设开关（二选一，两种给法都生效）：
   - shell：`$env:COMFY_EXECUTOR = "host"`（POSIX 用 `export`）；
   - `.env`：追加一行 `COMFY_EXECUTOR=host`。
2. **必须走 launcher 入口**：`node scripts/dev-launcher.mjs`，或双击
   `tools/start/start-web.ps1` / `start-tauri.ps1`。

> ⚠️ **`pnpm dev` 不会拉起 host。** 它是裸 Next 链路（只解析端口 + 起 dev
> server），没有编排步骤——这种起法下任务行会被标成 host 归属，但没有任何进程
> 来领，任务停在队列里等回收器判失败。这是灰度期最容易踩的坑。

3. 确认起来了（两处证据）：
   - launcher 控制台：`executor-host 已启动（PID …，COMFY_EXECUTOR=host 灰度中…）`；
   - `log/services/executor-host.log` 尾部：`mode=runtime` →
     `runtime inject-ok seams=…` → `runtime q2-scan hostShardQueued=…`。
4. 正常用工坊 / 工作流库点「运行」即可；界面观感与 inline 一致（进度 / 日志 /
   产物经 DB 短轮询送达，粒度 ≤3s）。

**回退**：把 `COMFY_EXECUTOR` 删掉或改回 `inline`，重启 launcher——行为与灰度前
逐字相同。

## 桌面包（app.exe / 预构建壳）：暂不支持

桌面壳的编排链本身已经通了（壳会拉起 `dev-launcher --mode prebuilt`，同一处
步骤拉 host），但 **standalone 产物今天不含 host 的运行前提**：

- host 动态加载的是 `src/lib/**` 的**源码态**执行链（reaper / enqueue /
  executor-* 等），Next 构建只把它们编译进 `.next/server` 分块，原始 TS 不进产物；
- TS 运行时 `tsx`（及其 esbuild 二进制）是 devDependency，同样不在产物里。

因此桌面包里设 `COMFY_EXECUTOR=host` 的表现是：host 启动即大声失败
（`runtime boot FAILED`，exit 1，见 `log/services/executor-host-stderr-*.log`），
任务不会入库执行、也不会误跑。产物化支持是独立立项（ISSUE #1169，范围见 ADR §13
的 3-E：闭包计算 + 拷贝进产物 + `check-standalone-contents` 真数产物验证 + 壳环境实测）。

## 日志与状态去哪看

| 通道           | 位置                                                          | 内容                                                                        |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| host 编排日志  | `log/services/executor-host.log`                              | boot / 心跳 / `claim-dispatched` / `cancel-reaped` / boot FAILED            |
| host pino 通道 | `log/services/executor-host-{stdout,stderr}-<启动时间戳>.log` | 执行链内部日志（含 reaper / 进度回写）                                      |
| 执行 trace     | `log/comfyui/comfyui-trace-host.log`                          | cli 事件 / WS 事件 / history 对账（与 inline 的 trace 分文件，不互串）      |
| 任务真相       | `db.sqlite` 的 `task` 行                                      | `claimedBy`（归属）、`status/progress/progressNode`、`logs`、`resultImages` |

## 行为语义速查

- **归属分片**：`task.claimedBy='host'` 的行只被 host 领取与回收；inline（含历史
  NULL 行）只被 Next 侧处理——两进程并存不会互抢、不会互误杀（判据单一定义在
  `repository-task-impl.ts` 的 `ownedBy()`）。
- **取消**（Phase 4-A3 起的语义，ADR §14 D2）：界面点取消走执行侧那份统一出口
  `enqueue.cancelTask` —— 落一行「用户取消任务」进执行日志、把行标成 `CANCELLED`、
  清理本进程记账与并发槽。**中断（`POST /api/interrupt`）只由握着该任务在飞子进程的
  那一侧发**：inline 在 `cancelTask` 里发，host 在自己的 tick kill 之后发
  （`reconcileCancelled`，日志 `cancel-reaped … interrupt=sent`）。跨进程之所以这样分：
  `/api/interrupt` 是**全局停**、不带 prompt 参数，而 ComfyUI 实例两宿主共享，
  谁都能发就等于谁都能误停对方的在飞任务。
  为什么判据不是「问 ComfyUI 谁在跑」：实测 comfy-cli 提交的 prompt 在整轮执行期间
  **不出现在** `/queue` 的 `queue_running`，用它当依据会退化成「永远不中断」
  （详见 ISSUE #1184）。
- **进度 / 日志**：执行方（host 或 inline）写库，界面统一走 SSE→DB 短轮询
  （≤3s + 200ms 落库防抖）。曾经「host 任务实时日志静默」的空窗已由 Phase 3-C
  收口，两模式同一契约。
- **崩溃恢复**：host 被杀 → 在飞 comfy-cli 随进程组整树回收（launcher 语义）；
  遗留 RUNNING 行由 reaper 对账收口。reaper 的启动点是**两处显式调用**（Phase 4-A2
  起，不再靠模块加载自启）：Next 侧 = `src/instrumentation.ts` 的 nodejs 分支，
  host 侧 = `scripts/executor-host.mjs` 注入链之后的 `startReaper()`；起表即首扫
  就是 Q2 对账，之后两进程各自按 30s 常驻扫自己那一片（分片判据见上）。
  dev 下 Turbopack 会**懒编译** instrumentation，实测 `✓ Ready` 之后约 40s 才跑完
  首扫——冷启动后短暂看到遗留行还在 `QUEUED`/`RUNNING` 属正常，不是没接上。
  「已被领取、但 `prompt_id` 还没回传」的 `RUNNING` 行同样在回收范围内
  （ISSUE #1184）：这类行连续两轮（≈30~60s）都无人认领才判失败——单轮判定会误杀
  刚领取、还没 spawn comfy-cli 的正常任务。前提是**同一 shard 只跑一个宿主**
  （由 launcher 保证），这也是「本进程没有足迹 ⇒ 真孤儿」成立的依据。

## 已知观察项（灰度期）

1. **ComfyUI 懒拉起竞态**：ComfyUI 未运行时，host 与 Next 两侧的执行入口都可能
   触发「查进程表 → 探测端口 → 懒拉起」；同机同实例下概率很低，灰度观察中。
2. **`[comfy-cli 原始]` 行内 prompt 字段乱码**：python stdout 管道编码问题，
   先于 host 线存在，独立 ISSUE #1164 治理（修向 `PYTHONIOENCODING=utf-8`）。
3. host 模式下的产物下载 / 封面链路复用 Next 的 `/api/generated` 静态映射，
   桌面包立项（ISSUE #1169）时需一并核对壳内静态目录的可写性。
