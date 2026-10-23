## Fixed

- **「钩子注册表总数」判据重新进固定清单（#2135）**：`tests/commit-gate-tier.test.ts` 用 `readFileSync` 读
  `.githooks/pre-commit` 文本、没有 import 依赖，此前没登记进 `FIXED_STRUCTURAL_TESTS`，于是「往钩子加一步」
  的那条 PR 选不中它，条数漂移（#2135 的冻结）只能落在其余每一条 PR 上、主干被冻。现把它登记进固定清单，并倚靠
  `affected-tests.mjs` 已有的 `.githooks/**` wide 兜底（改钩子 → `withFixed("all")` 跑全固定清单）—— 加一步的
  那条 PR 自己就跑这份测试、当场抓到条数不符，红在改钩子那一条上，不再全员冻结。测试自身的常数已与当前注册表对齐
  （55 = D0 17 + D 38；验证：`scripts/base-check/hook-steps.mjs` 的 `readHookSteps()`）。
