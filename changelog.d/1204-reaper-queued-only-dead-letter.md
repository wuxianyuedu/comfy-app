## Fixed

- **排队中的任务不再被白判失败**（P3 §5 第 2 期 · Phase 4-B4，ISSUE #1204，ADR §14 D1 判据对齐）。`reapStaleQueuedTasks` 的候选集从「本片归属 + `QUEUED` 超过 30s + 无 `promptId`」换成「**不属于任何已知归属片** + 超过 30s + 无 `promptId`」。前一条判据生于 push 模型：那时「`QUEUED` 且无 `promptId`」有两种相反的含义——没人管了（该判死），以及 raw 路径已经把任务交给 comfy-cli、而它在 POST 给 ComfyUI 之前不把行翻 `RUNNING`（健康在飞）。4-B3 之后后者不存在了：提交方只写库里那行，领取是单语句原子翻 `RUNNING`，唯一提交实现是 comfy-cli。于是「`QUEUED` 且无 `promptId`」只剩一个意思——**还没被领**（等槽 / 等本片宿主起来 / 等 ComfyUI 就绪），归领取循环负责。
  - 直接受害形态：**宿主重启留下的遗留排队行**。回收器的 boot 首扫排在领取循环第一拍之前发起（第一拍最早 1.5s、还要过 WebSocket 就绪门控），所以年龄过了 30s 的遗留行**永远**被首扫判成「任务卡在队列超过 Ns…请重新执行」，而同一批 boot 诊断数出的却是 `hostShardQueued=1`（同一行完全可领）。实测对照（副本库 + 真 ComfyUI，同一份两行脚本、间隔 48s）：改动前新宿主 boot 后 1.4s 打出 `marked 1 stale QUEUED task(s) as FAILED`；改动后宿主日志零条 QUEUED 判死，遗留行在 `inject-ok` 后 3.8s 被领回并跑到 `SUCCEEDED`（用时 7.7s、`rawCli` 17 行、产物落库 1 行）。
  - 一并确认没被带坏：宿主崩溃留下的 `RUNNING` 行仍由 RUNNING 对账那条 sweeper 收口（同一批实测里两轮对账在 117s 判失败，ISSUE #1184 的两轮守卫不变）。

## Changed

- **`listStaleQueued(cutoff, take, owner)` 改名成 `listStaleUnownedQueued(cutoff, take)`**，归属谓词从 `ownedBy(owner)` 换成它的补集，并在投影里带出 `claimedBy`——判死原因现在说的是「这个归属值没有任何宿主会领，请核对 `COMFY_EXECUTOR` 配置」，而不是让用户白跑一次重跑（重跑写回的仍是同一个没人领的值）。host 的 boot 诊断 `q2-scan hostShardQueued=` 改数「本片有几行在排队」（原先数的是 stale 行，与新判据对不上）。
- **灰度期的可见后果（要接受的取舍）**：`COMFY_EXECUTOR=host` 却没有经 launcher 起宿主时，任务不再在 30s 后报错，而是**一直留在队列**、状态栏排队数上涨，行上只有「⏳ 等待 ComfyUI WebSocket 连接就绪…」一句解释。判据改看 launcher 控制台与 `log/services/executor-host.log` 的 `mode=runtime`（`docs/guide-executor-host.md` 的警告块与 launch-and-build §5 两行排障对照都按此更新）。那句「⏳」目前会被领取时的日志缓冲重开抹掉，另记 ISSUE #1206。
