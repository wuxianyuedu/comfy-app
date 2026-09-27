## Changed

- **ComfyUI 执行的派发只有一条路径了**（P3 §5 第 2 期 · Phase 4-B3，ADR §14 D1 的第二刀）。此前 Next 侧走「提交方把任务推进进程内存队列 + 出队 / 3s 心跳」，host 侧走「按 `claimedBy` 从库里领行」——两条循环读两份真相。现在两个宿主共用 `src/lib/comfyui/executor-dispatch.ts` 那一条 pull：提交方只写库里那行（`QUEUED` + `claimedBy`）再踢一次领取，谁执行由归属分片决定。三点可见后果：
  - `RUNNING` 只剩一个意思——**真的在跑**。就绪门控放在领取**之前**：ComfyUI 没起来 / WS 没连上时行留在 `QUEUED`，等就绪的下一拍（最多 2s）才被领走，期间任务日志里有一行「⏳ 等待 ComfyUI WebSocket 连接就绪…」。
  - 底部状态栏那格的「排队数」终于会动了：以前行被领走（库里已是 `RUNNING`）之后还可能躺在内存队列里等槽，所以 `queued` 恒为 0。
  - 「谁负责起 ComfyUI」与「谁负责领任务」合并到同一处（原 `enqueue()` 里那句 `void connect()` 搬进领取循环的就绪分支）。
- **`MAX_CONCURRENCY` 的记账从计数器换成在飞集合**：`RunnerState.queue` + `active` 删除，代之以 `pendingDispatch: Set<string>`（领取时记、收口时还）。reaper 的进程内认领检查、并发槽位判据、取消路径的归还三处读同一份，不再各记各的。被回收器收口的行现在也会归还槽位——以前一条被回收的死任务能永久占住串行队列唯一的槽。
- **`executor-scheduler.ts` 与其调度契约用例整体删除**；`claimNextQueued` / `findExecJob` 补进 `TaskRepository` 的 delegate（Next 现在也是领取宿主）。续跑总线从一条回调扩成两条（新增 `announceToQueuedTasks`：通道层要广播「ComfyUI 正在自动启动 / 已就绪」，而知道谁在排队的只有调度层）。
- 启动点判据新增 `tests/dispatch-startup-points.test.ts`（Next 一处 `startDispatchLoop`、host 里出现它就是双循环、全仓调用点数恰为一）；行为判据搬进并扩到 `src/lib/comfyui/executor-dispatch.test.ts`（16 条，含「载荷缺失不留 RUNNING 僵尸」「重跑清收口锁与日志缓冲」「double-failure 不在坏库上自旋」）。
