## Fixed

#2919 那批 `??` 删除后，`scripts/` 三份没走 `oxfmt`，`oxfmt 格式` 那一格会红：

- `affected-tests.mjs` —— 新增的两处块注释把 `for` 顶到了注释栏，缩进错两个空格；
  另 `attributeAffected` 的嵌套三元被格式化成缺括号的形状。
- `check-tracked-secrets.cjs` / `spawn-shell-scan.mjs` —— 各一处换行与续行形态不合 `oxfmt`。

判据（`pnpm exec oxfmt --check`）与修法都是既有的，没有新增规则、也没有改判据。
上一跑里这一格是 `skipped`（前一格红），所以它的红没有在 CI 上露过面。

#2954
