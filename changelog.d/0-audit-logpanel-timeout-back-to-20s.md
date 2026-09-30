## Fixed

- **`LogPanel.test.tsx` 的超时档回到 20s**：`master` 侧曾把这一档从 20s 抬到 120s，
  理由（见 `changelog.d/0-log-panel-test-timeout-budget.md`）是那对 2000+ 行夹具在
  覆盖率档下贴地。本分支把分页族改用**小页夹具**（`useSmallPage`）之后，2000 行满页
  的渲染成本已不存在——20s 是现役最重用例实测的 ~3 倍，仍是天花板而非目标。
  与 `master` 的冲突按「取小页夹具 + 20s」解决。
