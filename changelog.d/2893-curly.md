## Changed

- oxlint `eslint/curly` 补齐全仓面（#2893）：29 处 / 11 份，单句体一律补上花括号
  （`src` 13 处：`series-generation.ts` 10、`SeriesOrganizer.tsx` 2、
  `use-series-organizer.ts` 1；`scripts` 11 处：`affected-launch-spawn.mjs` 3、
  `coverage-readout.mjs` 3、`affected-launch-segments.mjs` 2、
  `junit-readout-diag.mjs` 2、`run-affected-tests.mjs` 1；`tests` 5 处：
  `affected-launch-noise-reporter.test.ts` 3、`affected-launch-separation.test.ts` 1、
  `check-comment-headers.test.ts` 1）。
- 补花括号不改变控制流：单句体与 `{ 单句 }` 在 `if` / `else` / `for-of` 上是同一语义；
  `src` 侧经 oxfmt 排版，`scripts` / `tests` 侧手工排成多行，与周围写法一致。
  这批命中清完后该规则无豁免需要，`#2777` 接 CI 时不必再登记白名单。
