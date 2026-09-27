## Fixed

- **进程输出转录逐条同步落盘（`src/lib/log/capture-streams.server.ts`）**：
  转录挂在 `process.stdout.write` 上，原先每条 chunk 都 `appendFileSync` ——
  open/write/close 三个系统调用乘上每一行输出，高频日志（pino、Turbopack 编译进度）
  下事件循环被大量小写入占满。现在攒进内存缓冲，满 64KB 或 1s 再一次落盘（单缓冲
  FIFO，顺序不变）；进程退出最多丢一份未满的缓冲，对面板转录这份用途可以接受。
