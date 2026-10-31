## Changed

- oxlint `unicorn/prefer-number-properties` 全仓清零：54 处 / 20 份（#2775）。
  `parseInt` / `parseFloat` / `NaN` 改走 `Number.*`（48 处，由 `--fix` 收敛）；
  `isNaN` 6 处手工改成 `Number.isNaN` —— 实参都是 `parseInt` / `parseFloat` 的结果
  （已是 number），两版在这几处同判，没有「字符串被隐式转成 NaN」的语义变化。
