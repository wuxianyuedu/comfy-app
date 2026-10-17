## Fixed

- **「洞察 → 单元测试覆盖率」终于有数据了**（ISSUE #1990）：那一页此前永远是「无 / 无」，
  因为写它的上报在 #623 删旧版流水线时被一起拿走、#1959 按完整流程重建时没被带回来 ——
  于是「没人上报」与「平台坏了」在页面上长得一模一样。
  现在是一条后置的普通 step（`scripts/ci-coverage-report.mjs`）：有 `coverage/lcov.info`
  就交给 `cnb insight ut report`，没有就跳过并说一句为什么（`单元测试` 此刻是临时停用的，
  报告本来就不存在，判红等于让停用连带把整条流水线拦死）。阈值一个字不设 ——
  真正的门槛在 `vitest.config.ts` 的 `thresholds` 里，由 `单元测试` 那一档判。
  判据：`tests/ci-coverage-report.test.ts` + `tests/no-platform-ci-config.test.ts`
  新增一条「接回了上报链且没报告时不判红」。
