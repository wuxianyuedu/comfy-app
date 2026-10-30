## Fixed

- **合并态那两条「本地兜底」用例不再继承平台旗标**（ISSUE #2795）。平台给每个 stage 进程
  都注入 `CNB_PULL_REQUEST_TARGET_SHA`，而它们要判的正是「**没有**平台旗标时走 merge-base」，
  实现却是 `repo.run(["--staged"])` —— 环境原样继承过去，被测判据读到那个基线、去 diff 一个
  临时夹具仓库里不存在的提交，fail-closed 退 2。后果自 `224a5a3d` 起是**每个 PR 的「受影响
  用例」恒红**（`tests/check-format.test.ts` 在固定清单里，没有 PR 能合）。现在这三处把输入
  显式声明成「不设它」（`NO_PLATFORM_TARGET`，`gate-repo.run()` 的 `undefined` 语义）。
  被测判据一字未动：拿不到基线就退 2 是 fail-closed 的正确形状，错的是夹具没把输入说清楚。
- 复现口径：`CNB_PULL_REQUEST_TARGET_SHA=<master-tip> pnpm exec vitest run tests/check-format.test.ts`
  —— 修前 2 failed / 32 passed，修后 34 passed；不设该变量时两态都是 34 passed。
