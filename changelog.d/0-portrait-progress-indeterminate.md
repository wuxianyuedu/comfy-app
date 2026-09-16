## Changed

- **定妆照进度条的语义与通道能力对齐**：`PortraitSession.progress` 由 `number` 改为 `number | null`，`null` 表示「该通道不提供进度」（远端 API 是一次性请求）。此前远端通道复用 `0`，界面据此渲染出一条 4% 宽、看起来卡住的确定性进度条；现在远端显示脉动条（不确定态），本机 ComfyUI 任务仍按 0~100 的实测进度填充。第三方调用方若读 `progress` 做数值运算，需先判 `null`。
- **定妆照的状态与错误提示带上无障碍角色**（`role="status"` / `role="alert"`），屏幕阅读器能播报生成结果与失败原因。
