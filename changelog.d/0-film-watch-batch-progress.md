## Fixed

- **成片监看的 N+1 与无条件回写（`src/server/film/orchestrator.ts`）**：`watchFilm`
  每 4s 一轮、最多 240 轮（约 16 分钟），轮内对每个在跑的镜头各发一次
  `findExecutionProgress` + 一次 `updateFromTask`，一轮就是 2N 次往返（N = 镜头数），
  跑满是上万次查询。现在先结清「不用再问库」的镜头（没有 taskId 的 / 已终态的），
  剩下的走新增的 `taskRepository.findExecutionProgressMany` 一次性批量取进度（一轮
  一条 `IN`）；回写只在「状态或进度真的变了」时才发 —— 原先每轮都把一模一样的值
  UPDATE 一遍。
