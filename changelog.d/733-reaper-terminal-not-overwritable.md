## Fixed

- **已经收口的任务不再被「迟到的进度 / prompt_id / 完成帧」打回在跑状态**（ISSUE #733）：任务被判终态（reaper 回收孤儿、用户取消等）之后，执行链里仍可能有在途的异步写入到达，此前它们**无条件 UPDATE**，会把 DB 行从 `SUCCEEDED` / `FAILED` / `CANCELLED` **改回 `RUNNING`** 并覆盖进度，表现是「卡片永远停在『生成中…』，没有任何失败出口」，只能刷新页面 —— 而 `finishedAt` 还在，status 与它自相矛盾。现在三道防线一起收口：
  - `taskRepository.updateProgress` / `markRunning` 改为**只在非终态行生效**的 compare-and-set，并返回「是否真的更新了」；执行器（WS `progress` 帧、comfy-cli 的 `prompt_id` 回传）拿到 `false` 即丢弃这次回写并落一条可读日志，不再改写终态。
  - 执行日志面板收到 SSE 的 `done` / `error` 帧后，**不再把帧当成结论**：帧只作触发器，终态与失败原因一律回 DB 取权威值（帧里没有 `status` 时也不再被误落成「失败」）。失败原因只在 DB 结论确为失败态时补进错误日志行。
  - 终态判据收口到 `src/lib/task-state.ts` 一处（执行器、SSE 关流、仓储 SQL 条件、面板分支共用），不再各写一份字面量。
- 回归测试：`src/lib/core/repository-task-finalize-guard.test.ts`（真 SQL，三种终态各自的进度 / prompt_id 回写均被丢弃）、`src/lib/task-state.test.ts`。
