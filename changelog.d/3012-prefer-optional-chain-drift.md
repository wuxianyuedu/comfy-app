## Fixed

- 已清零规则 `typescript/prefer-optional-chain` 的 1 处漂移回到全仓 0（#3012）：
  `scripts/check-theme-colors.cjs` 的 `inScope` 写成
  `scope !== null && cl !== null && cl.names.has(scope)`，第二个判空是死的 ——
  `scopes` 只由 `cl ? scopeResolver(text) : null` 得到，`scope !== null` 已蕴含 `cl !== null`。
  该行由 #3006（`typescript/no-unnecessary-condition` 取证第 3 批）重写带入，
  晚于 #3001 的规则清零，属于「清零之后另一批重写又带回同类命中」（根因归 #2777）。
  收敛成 `scope !== null && cl?.names.has(scope)`，`?.` 的 `undefined` 分支走不到
  （`inScope` 只被包在 `cl !== null &&` 的 `if` 里消费），运行行为不变。
  全仓复算（2417 份、不传路径参数）：该规则 0 命中。
