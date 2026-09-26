## Fixed

- **成片与训练任务的日志列无上限（`src/lib/core/repository-film.ts` / `repository-lora.ts`）**：
  `logs` 是 JSON 列，`appendLog` 每打一条日志都要把整个数组读出来、再整列写回去 ——
  无上限时这条路的成本随条数线性变贵（成片监看每 4s 打一次进度日志）。两处现在都按
  尾部窗口 500 行截断（走 `~/lib/page-window` 的 `tailWindow`，不另写 `slice(-n)`）。
