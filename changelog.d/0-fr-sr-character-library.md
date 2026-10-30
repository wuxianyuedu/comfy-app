## Added

- FR-SR 切片 2（#2508）：系列角色库实体化。新增 `series` router 角色分支（`characters` / `createCharacter` / `updateCharacter` / `deleteCharacter` / `episodeCharacters` / `linkCharacter` / `unlinkCharacter` / `promoteFromProduction` / `injectToProduction`），落地「跨集复用：引用而非拷贝」。项目主页 `SeriesOrganizer` 挂载 `SeriesCharacterLibrary` 面板：`useSeriesOrganizer` 逻辑层消费全部新 procedure，支持角色增改删、本集关联，以及与 `production.characters` 的双向同步（提升：项目角色按 name 幂等并入系列库并关联本集；注入：本集关联角色按 name 合并回项目，同名覆盖、不同名追加）。
