## Changed

- `typescript/no-unnecessary-condition` 逐处取证第一批（#2919）：`scripts/**` 的 9 份 / 20 处
  按规范 §5.10 的 A/C/D 三格落位 —— 主体是把「声明比运行时窄」的 JSDoc 补回可空
  （`spawnSync` 出参、junit 解析产物、superjson 回包、JSON 向量输入），而不是删防御。
  一处 `??` 在规则侧救不到（`spawnSync` 出参），落账一行并写明理由。
- 新增取证台账 `docs/audits/2026-11-01-no-unnecessary-condition-ledger.md`（971 处逐行，
  已填 20 行）与规范 §5.10 的四种去向口径。
