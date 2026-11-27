## Added

- 剧集协同工作流（#5208）：新增项目活动流（`GET /api/activity` + `production` 保存事件 + 「最近活动」面板），
  镜头胶片带复用已有 `shot.review` 显示「评审通过 N 镜」，不新增状态类型与 DB 列。
- 合并 master 的 #5147 冲突处理（窄写入 + `updatedAt` 版本凭据 + 专用同步 hook），与多检出共享 DB 的
  口径一致；本项目原写的重复 CAS 接线已移除，避免两套判据分叉。
