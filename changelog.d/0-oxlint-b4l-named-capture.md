## Changed

- `eslint/prefer-named-capture-group` 子批 12 收尾 8 份 / 28 处：17 处改命名组（消费点同步
  `groups?.<name>`），11 处改非捕获组（组值无人读）；`scripts/session-report.mjs` 的挂账读数
  已过期（实测 0 处），这次一并删行。
- **B4 清零**：`eslint/prefer-named-capture-group` 的全部文件级豁免（台账 332 份 / 1094 处）
  已从判决面整块删除，该规则对全仓新代码即时生效。
- 台账 B4 行状态改「已清（子批1–12）」。

Refs #3181
