## Fixed

- 已清零规则的 10 处漂移回到全仓 0（#3037，机械线 #2775 的第 3 期漂移）：
  `unicorn/numeric-separators-style` 3 处（`tests/affected-launch-separation.test.ts` 里
  低于 10000 的数字带了分隔符：`8_300` / `1_800` ×2）、
  `perfectionist/sort-object-types` 7 处（`tests/ci-github-mirror-push.test.ts` 的
  `harness` 入参类型与 `calls` / `body` 两处内联类型成员未按字母序）。
  这批命中由本仓最近落地的 CI 改动（#2978 镜像推送、#3030 耗时台账）新增的用例带出 ——
  同一形态已是第三次（#2981 → `prefer-template`、#3006 → #3012 `prefer-optional-chain`、
  #2917/#3001/#2991 → #3015 `no-negated-condition` + `no-unnecessary-template-expression`），
  根因仍是「清零之后没有守门」那一格（归 #2777）。
  两条规则各由单规则配置 `--fix` 收敛（`sort-object-types` 第二遍才到 0），
  只动数字字面量与类型成员的声明顺序，类型形状与运行时行为不变。
  复扫（2421 份、不传路径参数）：两条规则各 0 命中；39 条已清零规则集（`--type-aware`）
  由本批前的 10 处回到 0。
