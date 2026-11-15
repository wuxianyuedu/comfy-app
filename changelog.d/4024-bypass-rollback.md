## Fixed

- **工作流编辑器的乐观更新失败回滚（#4024）**：分组 bypass 切换与 IO 排序此前
  经 `patchWorkflowSilently` 静默吞错——PATCH 失败后内存 override / 顺序与落库值
  会话内分歧（刷新才回正）。现在 `patchWorkflowSilently` 支持可选 `onFailure`，
  两个调用点失败时回滚本地状态（bypass 撤掉 override 回落 detail 值、IO 顺序
  还原到拖拽前），不打断交互。一致性（双写）审计 #3890 的 P3 项。
