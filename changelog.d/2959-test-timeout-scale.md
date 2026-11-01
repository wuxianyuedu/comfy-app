## Changed

- **判据预算临时放宽走乘数，不再逐个改字面量**（ISSUE #2959，业主口径见 #2948）：
  `vitest.config.ts` 新增 `resolveTimeoutBudget()`，读流水线级 env `COMFY_TEST_TIMEOUT_SCALE`
  同比例放大 `testTimeout` / `hookTimeout`。**缺省 1 ⇒ 算出来的就是 `30_000` / `45_000`**，
  配置解析结果与放宽前逐字相同；上限 3 倍，非法值 / 超限落回 1 并在日志里说一句。
  `.cnb.yml` 的 `.common.env` 置了 `2`（60s / 90s），**删掉那一行即恢复**
  （`vitest.config.ts` 一个字都不用改）。

  边界（这一次刻意**没有**跟着改的四处，都在文档里写清了理由）：`.cnb.yml` 的
  `timeout: 45m` 那几格（卡死护栏，且 `受影响用例` 实测掐在 54.0 分钟、
  声明 `45m` 本就不承重）、`full-suite-run.mjs` 的 30m 墙钟、Playwright 的
  `timeout: 60_000`（红线用例钉着，且 E2E 剩下的那条红是 perf 预算，抬它治不了）。

  判据：`tests/test-config-inheritance.test.ts` 新增四格 —— 缺省等于原值 /
  两条预算同比例 / 非法值落回 1 且说出口 / `.cnb.yml` 里这个键只有一行且值是「置着」的形态。
