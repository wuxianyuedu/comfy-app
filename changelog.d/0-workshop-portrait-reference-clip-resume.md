## Added

- **定妆照正式接入镜头生图（参考图断链接通）**：流程口径里「定妆照是后续分镜图
  的参考图基准」此前从未实现。新增 `preparePortraitReferences`
  （`src/lib/workshop/generation-client.ts`）：按镜头的角色出场序收集已选定妆照，
  上传进 ComfyUI 输入目录换文件名后随 `referenceImages` 下发，落到工作流作者
  连给参考图口的行上；工作流没连参考图口时经既有 unmatched 提示告知。
  单张上传失败不拖垮生成（计入失败数并提示），同一张定妆照会话内只上传一次
  （批量生成不再为同一张图反复落盘）。覆盖分镜批量（控制器 `buildShotInput`）
  与镜头生图页两条本地通道路径。

## Fixed

- **视频任务刷新后失联**：`Shot` 新增 `clipTaskId`（随草稿持久化，DTO 整体
  透传无需迁移），VideoStudio 本地生成时落盘；重挂载恢复按 task 表真值处理
  （已成功回写 `clipUrl`、已失败收尾、在跑才重订阅 SSE），与生图任务的恢复
  同一机制、同一归属核对（`clipTaskId` 已换不覆盖新任务）。视频片段从此不再
  永远停在「生成中」。
