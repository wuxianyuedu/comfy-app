## Changed

**任务日志落库从「整包防抖重写」改为按 `(taskId, seq)` 增量追加**（ISSUE #4605）。
旧形态每 200ms 把最多 5000 行的 `task.logs` JSON 列整列重写一次（单列 MB 级），同时
SSE 每 3s/连接整列读回 —— 单连接 SQLite 上持续制造写放大与 MB 级序列化，是
SQLITE_BUSY 竞争（与进度写、reaper 写）的主要消耗源之一。

- 新增 `taskLog` 表（`(taskId, seq)` 复合主键，行形状与 `LogEntry` 一致，任务删除级联清理），
  迁移 `drizzle/0007_curved_kitty_pryde.sql`。
- `runner-state.log()` 为每行分配**每任务单调递增**的 `seq`（重跑清场删行不回退计数，
  SSE 游标跨轮次稳定）；防抖/看门狗定时器改走 `flushLogsDelta`——只把「游标之后」的
  增量行 `appendLogs` 进表，单次写入与防抖窗口内的增量成正比，不再随日志总量增长。
- 收口点（成功 / 失败 / 取消 / reaper 回收）的 `persistLogs` 语义升级为「补齐增量 +
  `task.logs` 列整包写一次」：列仍是完整记录的权威面（历史查看、旧任务回放读它），
  每轮只写一次，不再每 200ms 重写。
- SSE 轮询的日志源改为 `readLogsSince(taskId, 游标)` 尾段读取；`findSseSnapshot`
  投影摘除 `logs` 大列（与 `workflowSnapshot` 同等对待）。回放链 = 内存 → `taskLog`
  增量表 → 旧列（迁移前任务兜底），游标按 seq 记，先回放后落库的行不重发。
- 重跑清场：任务再次领取时 `resetLogsForRerun` 删掉上一轮增量行（与内存缓冲的
  「领取重开」同口径，重跑不混上一轮的尾巴）。
- 行数上限与内存视图同窗（5000 行，增量表按每千行一次的节奏裁剪）；用例同批覆盖
  增量追加 / 游标尾段 / 裁剪 / 重跑清场 / SSE 回放与增量不重发（impl 56 条、
  runner-state 12 条、stream 路由 4 条等）。
