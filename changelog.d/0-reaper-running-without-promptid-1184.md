## Fixed

- **「生成中」可以永久卡死的那条路（ISSUE #1184）**：`RUNNING` 且 `promptId` 为空的行**两条 sweeper 都不匹配** —— `listStaleQueued` 只认 `QUEUED`，`listStaleRunning` 又要求 `promptId IS NOT NULL`。于是执行宿主在这段窗口里崩溃/被硬杀后，那行没有任何回收兜底，界面一直显示「生成中」且没有可用出口（只能重启再碰运气）。现在：① 查询放开 `promptId` 条件，这类行一并交出来；② 判决侧按「本进程是否还认领它」（内存队列 / comfy-cli 句柄 / 已起步标记 / 已收口集合）决定不插手，③ 认领不到也要**连续两轮**（间隔 `REAPER_MS`，30s）都见到才判 `FAILED`，原因是「刚领取、还没 spawn comfy-cli」的行形状完全一样，单轮判定会误杀正常任务。同一 shard 只应有一个宿主（由 launcher 保证），这也是「本进程没有足迹 ⇒ 真孤儿」成立的前提。
- **comfy-cli 的事件成批迟到，进度条整轮停在 0%**：非 TTY 管道上 python 的 stdout 是块缓冲，`prompt_id` 与 progress 事件要到收尾才一次性落到 Node 侧（实测：整轮 `RUNNING` 期间 `promptId` 一直是 NULL，收尾那一刻才出现）。spawn 时注入 `PYTHONUNBUFFERED=1` 让它走行缓冲，事件实时到 —— 进度条与「当前节点」在 host/inline 两模式下都实时了，回收侧的「两轮观察」也因此有可信的时间窗。编码问题（`PYTHONIOENCODING`）仍按 ISSUE #1164 单独治理，不混进本刀。

## Added

- **reaper 的跨 HMR 全局状态升到 `__comfyReaper_v2`**：新增的「两轮观察」登记表挂在同一份 globalThis 状态上；模块级全局名带版本号是本仓既有做法 —— 字段变了却不改名，`??=` 不会给旧对象补字段，判据会在热重载后静默失效（`noPromptSeen` 变 `undefined`）。
