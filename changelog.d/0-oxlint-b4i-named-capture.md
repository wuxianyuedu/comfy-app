## Changed

- `eslint/prefer-named-capture-group` 存量再清 20 份 / 77 处：48 处改为命名组并把消费点同步为
  `groups?.<name>`，29 处改为非捕获组（组值无人读）。
- 判决面 `oxlint.parity.config.mjs` 删掉这 20 份路径行；台账 B4 行更新为
  「子批1–9：285 份 / 912 处已清」。
- `tests/strip-comments-single-source.test.ts` 的护栏判据补认命名组形态 `(?<lead>^|...)`：
  原来只认 `(^` 字面量，改名后会把带护栏的写法误判成「裸的全局去行尾注释」。判据未放宽，只是补形态。

Refs #3181
