## Added

- **P3 §5 Phase 4（删旧）四个决定签字，落 ADR §14**：D1 范围主线 = 先拆进程内依赖（`firstframe` 靠 emitter 的 done 事件、`queue-status` 读 Next 进程内存、`raw-cli` 面板、ComfyUI 懒拉起触发点这四处），再把两条派发循环收敛成一条 pull（不并成一刀）；D2 取消 = 统一收尾出口 + **条件性** interrupt（`/api/interrupt` 无 prompt 参数、是全局停，无条件发会把另一片正在跑的任务一起打断）；D3 reaper = 摘模块顶层自启、Next 侧走 `src/instrumentation.ts` 的 nodejs 分支、host 侧 boot 显式 start，并把「护栏原始动机」以更强形式保留（新增断言「instrumentation 里存在且仅存在一处 reaper 启动」）；D4 终态写入 CAS = 终态守卫全落 + 按 id 写路径带 `claimedBy`，其中 `cancel` 是**显式例外**（取消只活在 Next 进程，带归属条件等于把「取消 host 任务」堵死；跨归属的只有状态标记，kill 仍归 owner）。
- 同节记录签字前核实到的三个事实，其中两处是本线自己写错的：UI 取消路径不调 `interrupt`；host kill 之后被 `finalizeFailure` 把 `CANCELLED` 覆盖成 `FAILED`；`reaper.ts` 顶层自启让 host 也常驻 30s 循环（「一次性 Q2」名不副实）。

## Fixed

- **`docs/guide-executor-host.md` 的「取消」条目与代码对齐**：原文写「界面点取消 → Next 写 `CANCELLED` + POST `/interrupt`」，实际 `task.ts` 的取消只写 `status + finishedAt`，`interrupt()` 的唯一调用方 `enqueue.cancelTask` 在生产里没有界面调用方。现按现状改写，并列出两个已核实的缺陷（取消被覆盖成失败、ComfyUI 不中断仍出图）与治理归属（Phase 4 D2/D4）。「崩溃恢复」条目补明 host 侧除 boot 首扫外仍常驻扫描。
- **ADR「回收与心跳」一节的三处设想与现状之差**加注：`reaper-decisions.ts` 从未拆出（判决仍在 `reaper.ts`）；stale 判据读 `createdAt` 而非 `updatedAt`，且「touch `updatedAt` 心跳」从未落地；Phase 3 期间「Next 侧不再跑 reaper」未生效，两进程各跑常驻循环、互斥靠 `ownedBy()` 分片而非 env 开关。
