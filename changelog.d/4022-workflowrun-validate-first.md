## Fixed

- **工作流运行链路改为「先校验、后建行」（#4022）**：`workflow-run.server.ts`
  此前先 `createQueued` 落库、后 `hasExecutableWorkflow` 校验（与 generate 路由
  顺序相反）——空 rawJson 的工作流会先留下一条 QUEUED 任务行，调用方拿到 throw
  时还没走到 markQueued 挂镜头，orchestrator 的 cancelTask 补偿覆盖不到这一段，
  任务成孤儿（仅 reaper 兜底），多耗一次派发。现在校验提前到建行之前，与
  generate 路由同序。一致性（双写）审计 #3890 的 P3 项。
