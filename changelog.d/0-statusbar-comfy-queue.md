## Added

- **底部状态栏新增一格：ComfyUI 排队 / 当前执行**（画布、工坊、工作流库都看得见）：
  - **前面还堵着几个** —— ComfyUI `/queue` 的口径（含**不是本应用提交**的任务：用户在原生界面排的队也在这里），加上本应用自己的排队数；
  - **当前这个跑了多久** —— `startedAt` 此前只在任务结束时被算成一句文本日志，现在实时显示 `mm:ss`（本地 1s tick，不靠 2s 轮询跳秒）；
  - **跑的是哪个工作流** —— `Task.workflowName`；
  - **哪个模型** —— 新出口 `primaryModelName`，从本次实际提交的图里认主模型。执行载荷有两条路，所以两种图形态都认（API 格式按 `inputs.ckpt_name` / `unet_name`；RAW 路径存的 UI 格式按节点类型 + `widgets_values[0]`），并且**分轮扫描** —— 否则图里靠前的 `UNETLoader` 会把主模型顶掉。

  数据由 `GET /api/comfy/queue` 三路聚合（执行器内存态 + DB + ComfyUI `/queue`，见 `src/lib/comfyui/queue-status.server.ts`）；状态栏那一格的 `title` 承载明细（进度 / 当前节点 / ComfyUI 队列）。ComfyUI 离线或完全空闲时不占位。
