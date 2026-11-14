## Fixed

- **run 执行引擎补上 per-project 在飞互斥**（ISSUE #3829）：`run.start / resume / approve`
  三处都会 fire-and-forget 拉起推进循环，双击、断线重试、或相邻两跳重叠时，此前会
  **并行推进两条循环** —— 同一 stage 的动作各执行一遍（LLM 调用翻倍），成片一步更是
  各建一部影片（`execFilm` 的 `filmStartedAt` 防重是先读后判，挡不住并发）。
  现在 `advanceRunLoop` 按 `userId:projectId` 收敛：已在飞的直接复用同一条 promise，
  同一项目同时至多一条循环；并发回归用例钉住「动作只执行一遍」。
