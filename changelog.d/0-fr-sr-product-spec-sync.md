## Changed

- 产品文档同步（#2508 落地后）：`docs/product/feature-specs.md` §15 系列与剧集结构（FR-SR）补上系列角色库的现状 —— 容器层（#2477）之外新增「系列角色库已实现（#2508）」（`character` / `episode_character` 两表 + 系列角色库 router + `SeriesCharacterLibrary` 面板 + 与 `production.characters` 的双向同步）；FR-SR-01 的「角色引用」由待办改为已落地；FR-SR-03 状态由「计划中」改为「部分实现」，并标出验收 ①（改角色时提示「被 N 集引用」）与 ②（反向查询「该角色被哪些集用了」）待做（#2801），③（引用而非拷贝）已达标。
