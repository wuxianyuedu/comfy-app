## Fixed

- **`COMFY_EXECUTOR=host` 走 launcher 链路不再一次起两个执行器宿主**（ISSUE #3830）：
  `dev-launcher`（编排 6.5 步）与它拉起的 dev server（`dev.mjs`）此前**先后都会**执行
  `maybeSpawnExecutorHost` —— 双宿主各自起领取循环与 reaper，进程内单并发语义被打破
  （两个工作流并发提交到同一 ComfyUI），心跳/日志按不同 runTimestamp 分叉成两份。
  修法与 `COMFYAPP_SKIP_SCHEMA_SYNC` 同构：编排器起过自己那份后，经
  `COMFYAPP_SKIP_EXECUTOR_HOST=1` 通知 `dev.mjs` 跳过它那份；判决逻辑不变，只是不重复拉起。
