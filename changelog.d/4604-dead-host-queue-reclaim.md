## Fixed

- **宿主死亡后，host 片排队行有了用户可见出口（#4604）**：`COMFY_EXECUTOR=host`
  下宿主起不来（缺 tsx、库不可达）或运行中崩溃后，`claimedBy='host'` 的 QUEUED 行
  永久停在队列——inline 不领、reaper 死信判据按 #1204 刻意放过合法归属，队列面板
  只剩「⏳ 等待 ComfyUI WebSocket 连接就绪」的旧提示，误导用户反复重启 ComfyUI。
  现在宿主每 5s 写心跳文件（`log/current/services/executor-host-heartbeat.json`，
  `{t, bootId}`，`COMFYAPP_HOST_HEARTBEAT` 可覆盖），Next 侧 reaper 新增第三条
  sweeper 按心跳判活：心跳停止 / 缺失即代宿主把本片排队行落 `FAILED`（原因
  「执行宿主已退出」并指向宿主日志），任务能被看见地重跑；心跳新鲜 = 健康等待，
  不碰（#1204 的「本片排队行归领取循环管」口径不变，判死的只剩确认无活宿主那批）。
  仓储侧新增 `listStaleQueued`（按片捞候选）与 `finalizeHostQueuedFailure`
  （归属例外第二处，守卫只认 QUEUED+host）。规范 §5 对照表与宿主指南已同步。
