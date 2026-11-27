## Added

- 剧集协同工作流（#5208）：工坊自动保存带服务端 `updatedAt` 基准，版本冲突时给可行动提示而非静默覆盖；
  新增项目活动流（`GET /api/activity` + `auditLog` 的 `project_content_saved` 事件 + 「最近活动」面板）；
  镜头胶片带复用已有 `shot.review` 显示「评审通过 N 镜」，不新增状态类型与 DB 列。
  保存基准与写穿逻辑抽成 `useWorkshopServerRevision`，主 hook 不过 400 行硬闸。同批补 API / hook / 视图行为用例。
