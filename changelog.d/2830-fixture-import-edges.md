## Fixed

- **「受影响用例」把夹具字符串里的 import 当成真依赖，两份重档自测被无关提交拉进来**
  （ISSUE #2830）。说明符提取原先是正则扫全文，门禁自测里「源码样例」这种字符串也
  算成 import 边 —— `tests/check-ui-primitives.test.ts` 一份就多出 671 条
  （682 → 11），`tests/check-format.test.ts` 的分类表则把真路径写成样例。现在改由
  TypeScript 预处理扫描器（`ts.preProcessFile`）取说明符（字符串 / 模板串 / 注释里
  那段不算），`vi.mock` / `jest.mock` 与 `export * as ns from` 各补一条剥注释后的
  正则；两份自测里的**纯样例路径**一并改成 `fixture-*` 不存在的路径，按精确路径登记
  在豁免表里的那几份保持真实。全库 2351 份 / 17.2MB 实测 2.3s → 3.6s。
