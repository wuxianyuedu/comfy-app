## Added

- 覆盖率「实况 vs 登记值」的**只读**读数入口（`scripts/coverage-readout.mjs` + `pnpm coverage:readout`，
  `#2689`）。#2669 把整体/目录级覆盖率从「拦 CI」改成「只上报」后，撤掉判定的副作用是
  「撤了判定就没了读数」——「哪几维低于登记值、差多少」只能靠一次分钟级全量才看得见。
  这份读数**永久留在场**、且**只读不判红**：判红的执行者只有一处（`--enforce-coverage`，
  `scripts/full-suite-run.mjs` 的硬档 / `pnpm check:all` 的 `test` 条目，§13.5.4），读数入口不另开判红口子。
  - 登记处读的是 `vitest.config.ts` 的 `COVERAGE_THRESHOLDS`（149 条），与判据**共用同一份导入**——
    Node 26 默认类型擦除，纯 Node 的 `.mjs` 直接 `import()` 它即可，不引第二份解析、不抄正则
    （「纯 Node 不能 import .ts」那句已过时，#2540 同族）。
  - 三态：① 没报告（`coverage/coverage-summary.json` 不在盘）→ 告诉怎么产出 + provenance；
    ② 报告在但旧 → provenance 点名 mtime 与距现在多久；③ 报告新鲜 → 逐条登记项显示
    「实测 % / 登记值 / gap」，按 gap 降序，前 N 名最该治。复用 `scripts/check-format.cjs` 的
    `globToRegExp`（与 `tests/coverage-targets-exist.test.ts` 同一处口径）做 glob 匹配。
