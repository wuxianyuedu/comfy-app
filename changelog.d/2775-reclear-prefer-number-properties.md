## Changed

- oxlint `unicorn/prefer-number-properties` 补齐全仓面（#2892）：8 处 / 5 份。
  上一轮「全仓清零」只覆盖了 `src/**`，本次全是 `scripts/**` 与 `e2e/**`
  的 `NaN` / `parseFloat` → `Number.NaN` / `Number.parseFloat`，取值与行为不变。
