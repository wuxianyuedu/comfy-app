## Fixed

- **`/api/custom-nodes` 的解析 / 探测 Python 子进程补上看门狗与断开回收（#4004）**：
  此前 discover / parse 两条 `spawn` 链没有任何超时，`ReadableStream` 也没有 `cancel`
  与 abort 接线——解析进程卡住（大目录 / 文件系统抖动）时 ndjson 流永久挂着、前端
  对话框永久转圈，用户中途关掉对话框子进程也不被回收（残留进程锁着 manifest / report
  文件）。现在两条链共用 `createStreamChildGuard`：600s 看门狗到点、`req.signal`
  abort、流被取消任一触发都按硬规则 3 走 `killProcessTree` 杀整棵树并发错误帧收尾；
  正常结束拆表。可终止性审计 #3889 的 P2 项。
