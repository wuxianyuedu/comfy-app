## Fixed

- **startFilm 记账补偿的取消失败不再被吞**（#4254）：镜头记账失败时补偿取消
  任务，但取消本身失败（DB 忙 / 执行侧异常）此前被 `.catch(() => undefined)`
  静默吞掉——镜头已标 FAILED，任务行仍是 QUEUED、会被派发照常执行，日志却
  写着「已补偿取消任务」。现在失败记 warn + 影片日志（error），提示到
  ComfyUI 侧手动中断。
