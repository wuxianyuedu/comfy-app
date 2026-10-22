## Changed

- **生产构建那一格的输出里，哪些提示是「预期内」的有了对照表** —— 这一格的日志每次都带着
  几句 Next.js 的提示（`useTypeScriptCli` 的 experiment 行、`Skipping validation of types`、
  遥测提示），它们既不是红也不是警告，却让读的人反复停下来问「这是不是坏了」；而
  「这一格红了怎么看」此前没有一份对照表，读的人只能自己猜，猜错的方向往往是「去查产物」。
  落成：规范 §13.5.23 下新增一节，把这些提示分成两组 ——
  **A 组「已定性为预期内」**（`useTypeScriptCli` 是 `next.config.js` 钉死的 experiment、
  `Skipping validation of types` 是 `typescript.ignoreBuildErrors: true` 的后果，而类型正确性
  由独立的 `tsc --noEmit` 那一格保证、Next 16 的匿名遥测提示）；
  **B 组「已知但待决」**（remote build cache 的 `No build cache found`、Better Auth 的
  `Base URL is not set`、traced files 的 ENOENT —— 这三条**不许**被说成「预期」，它们正是
  ISSUE #2158 第 4/5/6 条待决的那三件，而「把没查过的说成没问题」正是这份表最容易变成的东西）。
  口径取自 `cnb-723-1k5h25hkt` 那一跑的原始 runner 日志。
  （ISSUE #2158）
