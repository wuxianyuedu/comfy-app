## Fixed

- **队列与运行：「ComfyUI 未运行」误报与整页消失**（`src/lib/comfyui/queue-status.server.ts`、
  `src/components/studio/queue/**`）：ComfyUI 跑图 GPU 满载时 `/queue` 会连续超时，
  只认 HTTP 的在线判定把「正在生成」闪报成「未运行」，且离线时整页列表被空态替换。
  现在服务端 HTTP 没读到时回落进程级快照（`status.ts` 的 `getComfyRuntimeSnapshot`，
  不依赖 ComfyUI 的 HTTP 响应能力）；前端离线且有任务时只显示一条 warning 横幅
  （「未连接，连接后自动接上」+ 启动出口），三段列表照常铺开——数据来自本地库，
  离线也拿得到；离线且一条任务都没有才退回整页空态。页头「待执行」在离线时退回
  库里的 RUNNING + QUEUED 行数，不再与列表自相矛盾地显示 0。

## Added

- **队列页行内「执行日志」弹窗**（`src/components/studio/queue/QueueTaskLogModal.tsx`、
  `queue/hooks/use-task-log-stream.ts`）：「队列与运行」的每一行（含跑动中卡片）
  新增「日志」入口，按 taskId 直连 `/api/tasks/:id/stream`——在跑的实时跟、
  排队的看着它开跑、已结束的历史任务打开即回放完整日志；带级别筛选 / 自动滚动 /
  加宽 / 取消 /「查看完整输出」。时间线主体（筛选页签 + 虚拟列表 + 底栏计数）从
  `WorkflowRunLogModal` 抽成共享的 `logs/TaskLogTimeline`，工作流库执行日志弹窗
  同批改为消费它，不再各抄一份。
