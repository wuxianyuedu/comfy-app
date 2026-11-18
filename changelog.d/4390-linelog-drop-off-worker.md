## Fixed

- **LineLog 收尾不再阻塞 tokio worker**（#4390）：输出泵任务结束时 drop
  `LineLog` 会在 async 上下文里做阻塞 `send(Close)` + `join`（等写线程写完
  ≤1024 行积压，磁盘慢时秒级）。改为 `try_send` + 把 join 挪进一次性守护线程：
  调用方立即返回，尾巴落盘变为尽力而为（积压有界）。
