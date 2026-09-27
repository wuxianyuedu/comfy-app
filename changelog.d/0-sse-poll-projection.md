## Fixed

- **SSE 轮询用全行查询、且连接死亡后空转（`src/app/api/tasks/[id]/stream/route.ts`）**：
  - 轮询从 `findById` 换成新的 `taskRepository.findSseSnapshot` 轻量投影 —— 原先
    `workflowSnapshot`（整份工作流 JSON）与 `logs`（全量日志）单行可达数 MB，
    每条连接各挂一个轮询、每 3s 一次全行查询只为读状态和进度；间隔同时放宽到 5s
    （执行器事件通道仍然是即时的，这条只是兜底）。
  - 连接死亡（`controller.enqueue` 抛错）现在会触发 `cleanup()`：abort 事件未必能
    触发（反向代理缓冲、keep-alive 提前断开都会让 `req.signal` 不亮），这是
    「订阅与定时器残留」的最后一条漏网路径 —— emitter 回调与轮询两条路都补上了。
