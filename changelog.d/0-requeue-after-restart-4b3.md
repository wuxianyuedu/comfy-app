## Fixed

- **dev server / host 重启后留在 `QUEUED` 的任务，30s 内会被新宿主领回继续执行**（P3 §5 第 2 期 · Phase 4-B3，ADR §14 D1 第二刀）。以前这类行只有 host 那条领取循环会救：Next 侧的执行入口读的是进程内存队列，冷重启把队列清空后就再没人领它们。现在两宿主都按 `claimedBy` 从库里领行，实测由另一个 pid 把遗留行领回并跑到 `SUCCEEDED`（`claimedAt` 由新宿主写）。**窗口只有 30s**：年龄跨过回收器 `STALE_MS` 的排队行仍会被 boot 首扫当场判成「任务卡在队列超过 Ns…请重新执行」——首扫在 `startReaper()` 里当场发起、早于领取循环第一拍（≥1.5s 且要等 WebSocket 就绪）。那条死信规则针对的形状已随本刀消失，判决语义的收口另记 ISSUE #1204。
- **一条被回收的死任务能永久占住串行队列唯一的槽**：`MAX_CONCURRENCY=1` 时，reaper 把某行判成孤儿并收口后，原来的活跃计数器不会回落（收口路径不在执行链里），此后所有任务都卡在「永远 QUEUED 0%」。改成在飞集合记账后，三条回收路径（QUEUED 孤儿 / RUNNING 无 promptId / RUNNING 对账）都会归还槽位。
