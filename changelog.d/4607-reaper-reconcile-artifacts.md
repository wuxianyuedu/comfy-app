## Fixed

- **reaper 对账判 SUCCEEDED 时恢复产物，不再「成功但无产物只能整镜重来」（#4607）**：
  dev/桌包重启期间在 ComfyUI 跑完的任务，此前由 reaper 对账恢复时只写
  SUCCEEDED 状态、不拉产物（不写 resultImages、不建 TaskImage 行、不下载
  二进制），工坊恢复侧只能提示「任务已完成但没有产出文件，请重新生成」。
  现在对账判成功时委托 executor 的完成入口（complete → 拉 /history →
  下载产物 → finalizeSuccessWithImages 同事务写产物行）把产物从 ComfyUI
  输出目录拿回来；恢复下载失败则任务落 FAILED 并带真实原因，不再挂一个
  无产物的 SUCCEEDED。FAILED 判决路径不变。
