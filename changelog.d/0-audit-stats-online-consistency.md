## Fixed

- **顶栏显存格与队列格的「ComfyUI 是否在线」口径统一**（`src/app/api/comfy/stats/route.ts`、
  `src/components/studio/hooks/use-comfy-stats.ts`）：`/api/comfy/stats` 此前只认 HTTP
  探测，ComfyUI 跑图 GPU 满载时 `/system_stats` 连续超时会把「正在生成」闪报成
  「未运行，显存/内存暂不可用」。现在路由在 HTTP 失败时回落进程级快照
  （与 `/api/comfy/queue` 同一口径），payload 增加 `processAlive`；前端把
  「进程活着但没应答」按在线处理——保留旧数据、置 stale，不计入离线计数。
