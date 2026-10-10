## Fixed

- **PR #1628（`fix/1625-a11y-gate-cold-load`）与 `master` 的冲突已解，两侧那笔改造合成一处。** 冲突文件是 `scripts/check-a11y-rules.cjs` 与 `tests/a11y-rules-gate.test.ts` —— 两边**都在治同一件事**（a11y 门禁自测对 `eslint.config.js` 求值的成本），只是从两头下手：
  - **PR 侧（#1623）**：把判决拆成可导入的 `judge({ ledger, report })`（返回退出码），12 条用例改成进程内判、配置只求值一次，夹具从真台账派生改成 `tests/fixtures/a11y-rule-ledger.sample.json`，并补了三份覆盖面用例（`check-a11y-rules` / 覆盖度账本 / 导出面）。
  - **`master` 侧（d7fa56e3）**：把配置的四张表收成 `configFacts()` 的**每进程一次**单飞缓存，`judge(ledger)` 返回 `{ problems, summary, effective }`，真跑 CLI 只剩接线形状那两条并各登记 120s 预算，另加收集期暖机。
  - **合并取法**：PR 侧的**边界**（`judge(ledger)` 显式台账对象、bin 形态自己 `readLedger`、`main()` 翻退出码、`VERIFIED_SURFACES` 与导出面）+ `master` 侧的**内核**（`configFacts()` 单飞、`registeredDialectRules(ledger)` 收显式台账）。两侧是互补的：显式入参把「用例以为在判夹具、其实在判真库」堵死，单飞缓存把四张表的求值次数从 4 收到 1。
  - **同步修正的三处**（合并时暴露，不是任一侧单独的错）：`registeredDialectRules` 的入参形状（此前带的是路径、新边界给的是台账对象 —— 不改会让 ① 那一向把已登记的方言误报成「档位与官方不一致」）；`.tsc-diagnostic-executors.json` 的 `a11y-rule-switch` 条目补回 `readLedger` 这一面；覆盖度账本里 `loadEslintConfig` 一行等四个面的「谁在用」从「a11y-rules-gate」更正到真正的执行者 `tests/check-a11y-rules.test.ts`（并新增「那一栏点名的用例文件要真实存在」这一格）。
  - **验收**：`node scripts/check-a11y-rules.cjs` 退 0；四份相关用例 **43 passed**；`tsc` / `eslint` / `prettier` 全绿；`check-tsc-diagnostic-executors` / `check-test-concurrency` / `doc:check` 零增量。
