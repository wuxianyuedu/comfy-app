## Changed

- **B2 子批 1：41 份 / 110 处 `no-await-in-loop` 转逐行理由**。这些循环里的 await
  都是顺序依赖（e2e 逐轮断言、脚本按步编排、用例桩状态、接口轮询/分页），并行化会改
  可见顺序与失败归因，逐处留一行理由。
- 同步删掉这 41 份的**文件级**豁免（新代码重新受判），台账标「保留（逐行理由）」。
- 补挂 #3169 新增文件的既有存量：`scripts/session-report.mjs` B4×4 / B5×1、
  `tests/session-report.test.ts` B5×1。
