## Fixed

- **API 文档生成与自检不再让 typedoc 自己再跑一趟类型检查（ISSUE #2843）**：
  typedoc 默认在生成前会自己跑一遍完整 TS 类型检查，那与「产物写出来没有」无关，
  而结论与 PR 档的 `tsc --noEmit` 完全同源 —— 同一个类型错误被算了两遍。

  改动：

  1. `scripts/typedoc-run.mjs` 起 typedoc 的那一处固定带 `--skipErrorChecking`；
  2. 参数面收进导出的 `typedocArgs()`（此前只活在 `spawn` 那一行、用例够不到）；
  3. `tests/typedoc-run.test.ts` 新增两条断言：argv 含 `--skipErrorChecking`、
     且参数里没有任何关掉 warning 的旗标（`--logLevel` / `--treatWarningsAsErrors`）。

  实测（本机，暖态 / ReFS / 非并发，同一棵树，只改这一个旗标）：

  - 端到端 `node scripts/check-docs-api.cjs`：**111.7s → 33.6s**，两次 `EXIT=0`，
    产物读数一致（2859 份文件 / 391 个模块页）；
  - 同一份 `typedoc.json` 直接跑 typedoc 两轮对照（正反顺序排除缓存影响）：
    无旗标 58.1s / 83.3s，带旗标 29.5s / 26.8s。
  - **type error 不再由 typedoc 报**：合成样本里 `return value` 的类型错误在无旗标时
    是 `Found 1 errors and 0 warnings` / `EXIT=3`，带旗标后消失 —— 这一层由 PR 档的
    `tsc --noEmit` 唯一承担（本仓没有一处把 typedoc 的退 3 当作类型门禁）。
  - **warning 类照报**：往入口文件临时放一个坏 `{@link}`，带旗标时 typedoc 仍打
    `Failed to resolve link to …` 与 `Found 0 errors and 1 warnings`，判据照旧退 1。
