## Added

- **FR-SR 实体化·容器层（#2508，切片 1）**：新增 `series` / `season` / `episode`
  三张表与 `episode.projectId` 外链，落地「系列 → 季 → 集 → 创作链路」层级
  （FR-SR-01/02）。约束来自本仓迁移机制（`db:push` 走 `drizzle-kit push --force`，
  schema 注释明令「纯新增表、不动既有表」），故本变更**只增不改**，零数据风险。
- 新增 tRPC `series` router：系列 / 季 / 集 的 list/create/update/delete +
  项目挂载（`assignProject` / `byProject`），全部带跨用户归属校验（FORBIDDEN）。
- 项目主页新增「系列 / 季 / 集」组织者面板（`SeriesOrganizer`），可把当前项目归入某集；
  该面板消费 `series.*` 全部分支，满足 `tests/trpc-surface-executors.test.ts`
  的「每条 procedure 都要有执行者 + 消费方」判据。
- `character` 实体表与 `episode_character` 关联表随本变更一并落 schema（FR-SR-03 的
  系列角色库，router + UI + 与 `production.characters` 双向同步在切片 2）。
