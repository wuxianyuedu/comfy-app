## Fixed

- **`COMFY_EXECUTOR=host` 下「文生视频」的第一跳必坏**（P3 §5 第 2 期 · Phase 4-B1，ADR §14 D1 摘掉的第一个进程内依赖）：`firstframe.ts` 靠订阅进程内 `EventEmitter` 的 `done` 帧等首帧，而执行的是另一个进程时这一帧永远不会到——表现是挂满 5 分钟超时后整条失败，日志里一句解释都没有。现在改读库里那一行（`findExecutionProgress` 的窄投影补 `error` 列，失败原因由此从「首帧生成失败」回到 ComfyUI 写的那句人话），等待节拍与次数收进 `~/lib/retry-policy` 的具名策略 `FIRST_FRAME_WAIT`（固定 2s × 150，包络仍是执行链那句 5min），与 `/api/tasks/[id]/stream` 的轮询同源。行为回归见 `src/lib/comfyui/firstframe.test.ts`。
