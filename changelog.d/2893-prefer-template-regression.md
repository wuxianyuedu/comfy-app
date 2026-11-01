## Fixed

- 回退 `typescript/no-unnecessary-template-expression` 的 fixer 带入的 18 处
  `eslint/prefer-template` 回归（#2893）：它把 `${expr}` 从模板里解包成
  `"字面" + expr` 的拼接，恰好造出上一条已清零规则的新命中（13 份文件：
  `e2e/` 2 份、`scripts/` 7 份、`tests/` 4 份）。改成手写模板表达式
  （长表达式按 `${` 换行展开，不搬运 fixer 的行尾空格与插值内注释），
  输出字符串逐段等价、无行为变化。全仓复算（2415 份、不传路径参数）：
  `eslint/prefer-template` 与 `typescript/no-unnecessary-template-expression`
  均 0 命中；改动文件 `tsc --noEmit` 与 `eslint --max-warnings 0` 均干净。
