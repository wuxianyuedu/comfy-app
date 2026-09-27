## Added

- **批量生成改有界并发**：镜头生图 / 视频生成 / 分镜批量三个循环此前
  「await 一条到底再提交下一条」——本地 ComfyUI 本来就按队列连续吃任务，
  串行等于在「上一条落定 → 提交下一条」之间空转。新增 `runWithConcurrency`
  （`src/lib/async-pool.ts`，带上限的任务池唯一出口）并以
  `WORKSHOP_BATCH_CONCURRENCY = 2` 接入三处：本地通道「一条在跑、一条排队
  预热」，API 通道保守不试探远端限流。控制器 `generating` 改为在途计数
  （布尔会被先结束的那条并发链提前复位）。
