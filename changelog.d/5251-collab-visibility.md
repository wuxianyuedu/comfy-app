## Added

- 协同工作流可见性增强（#5251）：项目「最近活动」显示来源 handle（启动器从既有 handle 取值链算出后注入应用级
  `COMFYAPP_ACTIVITY_SOURCE`，`COMFYAPP_DEV_HANDLE` 本身仍不进运行期 / 客户端），并走 `useInterval` 每 30s
  轮询 + 回前台补跑；镜头胶片带每帧用 `Badge` 显示「已评审」（复用 `shot.review`，不新增状态类型）；
  服务端被别的检出更新时显示常驻提示，用户可显式「采纳服务端内容」或忽略，不自动覆盖本机编辑。
  同批补 API / hook / 视图行为用例；UI 改动附真实截图回帖。
