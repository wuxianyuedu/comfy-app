## Fixed

- `src/lib/production/**` 的四个覆盖率维度（登记值 95、只升不降）按实测补测试回到门槛之上：
  函数维 90.83% → 98.33%、行 94.63% → 98.49%、分支 93.61% → 96.31%、语句 94.76% → 98.53%，
  `每日单元测试` 那一格不再红在 `ERROR: Coverage for functions (93.33%) does not meet
  "src/lib/production/**" threshold (95%)` 上。门槛数字一个没动 —— 登记值高于现实该补的是测试，
  不是把数字往下挪（§18.6 / ISSUE #2733）。
- 补的是真行为：`run-client` 的六个评审 / 人工侧 wrapper（`reviewShotImage` /
  `setHumanVerdict` / `setHumanRating` / `setScriptHumanVerdict` / `fetchReviewCalibration` /
  `autoselectShot`）、`pushProduction` 的写路径（此前只有读路径有用例）、
  `shot-writeback` 两处 `fireAndForget` 静默兜底与 production 侧三条静默出口、
  `inheritDerivedFields` 的垃圾记录索引分支、校准读数「有判定无维度分不进样本」、
  维度分宽容解析的四种脏形状。
