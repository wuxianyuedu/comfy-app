## Fixed

#2919 那批删 `??` 之后，`scripts/` 三份没过 `oxfmt` —— 平台这一格上一跑是 `skipped`
（前一格红，后面 20 多格全跳过），它的红一次也没在 CI 上露过面：

- `affected-tests.mjs` —— 新增的两行块注释把随后的 `for` 顶到了注释栏（缩进少两格）；
  另 `attributeAffected` 的嵌套三元缺括号。
- `check-tracked-secrets.cjs` / `spawn-shell-scan.mjs` —— 各一处续行与断行形态。

判据一字未改，只是把 `oxfmt` 的既有要求补上。

#2954
