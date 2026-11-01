## Changed

- oxlint `typescript/consistent-type-definitions` 补齐全仓面（#2892）：65 处 / 36 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次残留全部在 `tests/**`、`e2e/**` 与
  `scripts/lockfile/lock-diff.d.mts`。按预设选项 `["type"]` 把对象形状的
  `interface` 改写为 `type X = { … }`；全部为纯对象形状（无 `extends`、无声明合并），
  类型语义不变。`.d.mts` 不在预设的 `**/*.d.ts` 豁免面内，故一并改写。
