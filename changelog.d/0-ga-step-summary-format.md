## Changed

- **CI（GA Job Summary 版式收口，摘要只有一个写入者）**：`vitest.config.ts` 显式钉
  `reporters: ["default"]`，关掉 vitest 5 在 `GITHUB_ACTIONS=true` 下自动追加的
  `github-actions` reporter —— 它此前**每个 vitest 进程各往 `$GITHUB_STEP_SUMMARY` 写一份**
  `## Vitest Test Report`（用例级计数表），一次 job 跑几个 vitest 进程摘要里就有几段，
  数字还互相矛盾（实测 3 passes 与 1 pass 并排），且都压在真正的判据结论前面。
  本仓的摘要自此只有一个写入者：`scripts/ci-step-verdict.mjs`（「这一格判没判、红在哪」，
  比 reporter 的用例计数更贴近读者要回答的那一问）。代价写在明处：失败用例的逐条
  `::error::` 注解随之消失，主进程侧按退出码的那一条仍在，用例明细本来就在日志里。
  正面判据 `tests/vitest-gha-summary.test.ts`：带 `GITHUB_ACTIONS=true` 与真
  `$GITHUB_STEP_SUMMARY` 起子进程跑一次，摘要里不许出现 `Vitest Test Report`（反向实测：
  配置改回去它就红；子进程命令行**不许**传 `--reporter`，会整个覆盖配置让这条永远绿）。
  `reporters` 按仓库判据登记进 `tests/test-config-inheritance.test.ts` 的
  `SHARED_EXPECTATIONS`（两档都要这份钉法，逐档断言随表自动跟上）——
  「新增根级项先回答它是不是共享项」那条判据正拦的是这个。
- **CI（`ci-step-verdict.mjs` 摘要版式）**：标题带三态图标（✅ 通过 / ⚠️ 没判 —— 刻意
  不是 ❌，它不是红也不是通过 / ❌ 红）；「命中行」只在红或没判时给（通过的格不再印一行
  `ok`）；「末尾 15 行」只在命中行之外还有真实内容时出现（此前无条件输出，输出短时与
  「命中行」逐字相同，同一段话说两遍）；新增 `renderJobSummary()` 与 `--summary-title`：
  多格给一行结论 + 总览表，一格只给一行结论 + 正文（一张只有一行的表没有信息量），
  空数组给空串。契约用例 `tests/ci-step-verdict.test.ts` 8 → 17 条。
