## Added

- 新增「风格实验室」屏（工坊之前的一屏）：记录并浏览「风格 × 角色特征」的文生图试验，为后续角色卡生成喂料。含试验的创建、列表（`N 风格 × M 特征 = K 格` 与完成度）、软删（写 `deletedAt`，出过的图仍在历史里）。
- 新增数据表 `styleExperiment` / `styleExperimentCell`：试验本体与格子各自成表，格子只以 `taskId` 引用既有 `task` / `taskImage`，不复制图片数据。
- 新增 `src/lib/style-lab/`：与 React 无关的类型与纯派生（组合数、笛卡尔展开、串行预算档位），风格与角色特征词表从 `src/lib/workshop/character-options.ts` 转入、不复制第二份。
- 新增 tRPC 过程 `styleLab.list` / `detail` / `create` / `softDelete`；创建时按 `deriveEncapsulationStatus()` 拒绝尚未完成 IO 适配的工作流。

## Notes

- 批量扇出（一次跑完整张矩阵）**不在本批**：界面把那枚按钮显式禁用并写明「下一批开放」，不假装能跑。单卡串行（`MAX_CONCURRENCY = 1`）下的预算档位与分批策略随下一批一起落。
