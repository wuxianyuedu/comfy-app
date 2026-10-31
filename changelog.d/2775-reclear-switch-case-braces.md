## Changed

- oxlint `unicorn/switch-case-braces` 补齐全仓面（#2892）：51 处 / 7 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次残留全部在脚本与测试夹具
  （`scripts/**` 6 份 + `tests/helpers/test-db.ts`）。按规则给每个带语句的
  `case` / `default` 子句加块级花括号，作用域与 fallthrough 语义不变。
