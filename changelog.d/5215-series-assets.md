## Added
- 系列级跨集资产实体化（ISSUE #5215，借鉴 Toonflow / NovelVids 的可复用资产）：新增 `seriesAsset`（风格锚 / 场景 / 镜头模板，带版本号与引用计数）与 `episode_asset` 引用表及迁移；router 提供 CRUD、按种类列表、集引用/解引用与「被哪些集引用」反向查询，跨系列引用拒绝、被引用资产禁止删除、正文变更版本递增。引用而非拷贝，既有 JSON 列保留供逐项迁移。补 3 条 router 行为用例，产品 FR-SR-03 与结构层总览同步更新；8 条新 procedure 按 E3′ 登记为「跨集资产面板待接」欠账（判据未放宽，上限上调已在 PRODUCTION-GAPS 记账）。
