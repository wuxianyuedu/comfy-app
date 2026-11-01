## Changed

- **平台两格的固定清单里，三条耗时最长的工具自检临时停用**（ISSUE #2948）：
  `tests/eslint-gate-canary.test.ts`（平台实测 635.3s）、`tests/base-check.test.ts`（209.0s）、
  `tests/check-bundle-budget.test.ts`（174.0s）合计约 17 分钟，占掉 `固定结构用例` 那一格
  45m 预算的大半。停用的形态是**新台账** `scripts/suspended-gate-tests.mjs`：
  名字仍留在 `FIXED_STRUCTURAL_TESTS` 里，只是 `fixed` 段与全量档
  （`--full` / `每日单元测试`）的收集面剔掉它们 —— **不是**从清单里删掉（删 = 那三条
  零执行者，本地钩子也没了）。每一条都登记「谁还在跑它」（本地钩子组 C）与恢复条件，
  剔了哪几条由 `[suspended]` 那行逐条打在日志上（停用不改变任何判据，它在读数上只剩这一行）。

  两处连带口径：全量档剔了就不**记账**（绿了只说明「剩下的那些绿了」，拿它刷整档凭证
  比不刷更坏 —— 与 `isWholeTrackRun` 拦「透传参数」同一条理由），`shouldRecord` 因此多一个
  `exclude` 入参；三条的耗时读数（平台墙钟 vs 入库台账 `scripts/.test-file-timing.json`）
  由新用例 `tests/suspended-gate-tests.test.ts` 钉住「名字还在清单里 + 每条都有本地执行者」。
