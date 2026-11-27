## Fixed

- **修复队列屏 E2E 三个用例在每日档稳定跑红（ISSUE #5153）**：`ad485409b` 把 `task.list` 从带 `refetchInterval` 的普通查询改成无限查询、并把定时轮询挪到 `task.summary`，位次也改为读服务端 `queuePosition`。spec 的桩仍按旧形状喂数据：缺 `queuePosition` 导致「第 undefined 位」，且批请求里 `task.list` 与无 handler 的 `task.summary` 同批而整条失效（真库空队列）。改为一次桩齐队列屏所有过程、桩行补 `queuePosition`、重读判据数真正轮询的 `task.summary`。
