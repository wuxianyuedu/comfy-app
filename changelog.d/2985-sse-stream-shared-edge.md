## Fixed

- `/api/comfy/liveness` 与 `/api/comfy/queue/events` 两条 SSE 通道抽共享传输边缘
  `src/app/api/sse-stream.ts`（帧头 / `: hb` 心跳 / 关闭收尾）。此前两份各抄一整份，
  逐行重合 90%，触发 §12.12 跨文件重复块硬闸（PR #2985 的 CI 红格）。
  两份路由现在只留各自的差异：连上时先发什么帧、订阅哪个信号源。
