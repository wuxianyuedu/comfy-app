## Fixed

- **product 文档对齐 uiKit 页签档位的现行事实**（#5024）：#5003 随 PR 调整了
  `sidebar-tab-defaults.json`（uiKit / models 独立改共享，模型适配 / 测试模型 /
  模式契约共享改独立），但 product 文档里仍写着「uiKit 出厂独立标签页、切走不关」
  （#3798 的旧验收）。按产品结论「页签行为可配置、按配置来」，在
  `overview.md`（全局项表 / 瞬时页签默认集 / 页签行为判据两处）与
  `feature-specs.md`（FR-WS-09 / FR-WS-10）补上「#5003 起反转、以配置为准」的
  结论，验收记录与现行行为重新对上；e2e 已由 #5023 对齐现行档。
