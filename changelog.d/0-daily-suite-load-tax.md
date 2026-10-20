## Added

- **每日全量那一跑现在有第二份榜：分文件「装载税」**（`scripts/full-suite-run.mjs` 的
  `parseJunitPhaseCosts` / `suitePhaseTax`）。动机是 vitest 收尾自报的相位分解三次读数一致
  （`tests 46–51%`、`setup 23–24%`、`environment 13–14%`、`import 12–13%`，见
  `cnb-b0l-1k59op66t` 2442.43s / `cnb-r0d-1k5a0348r` 2729.89s / 本地 1609.51s）——
  也就是这个 stage **只有一半时间在跑断言**，而那四个百分数没有名字：不说哪几份在交税，
  就没法决定该治谁、还是只能切片绕开。
- 榜末尾带一行**对账**：本档墙钟 vs Σ文件总时长，并明写差额（并发摊薄 + globalSetup /
  覆盖率报告）**不摊到任何一份文件上**。这行对账当场证伪了做这份榜的人的一个判断：
  原以为「另一半时间在每份文件的装载里、可以从文件级找出来」，实测
  `Σ文件总时长 2793.6s = 断言 2724.0s + 69.6s` —— junit 的 `<testsuite time>` 基本等于
  Σ`<testcase time>`，**vitest 报的那约一半不在每文件账上**。所以这份榜读的是
  「哪几份在自己的钩子里干活」（三份占 90%：`db-migrate-equivalence` 30.6s /
  `docs-candidate-hygiene` 21.4s / `tailwind-source-roots` 10.3s），话术里写死了它
  **不回答**「那 50% 归谁」—— 拿它当整笔税的分解读会得出方向相反的结论。
- 判据：`tests/daily-tracks.test.ts` 加 6 格（税 = 总 − Σ用例、按税降序而不是按总时长、
  **税为负照实打不夹 0**、夹具没有 `<testcase>` 时退化成「税 = 总时长」而不是报「没有」、
  明细行数受 `limit` 约束（平台单格日志 102400 字节上限）、对账行只在给墙钟时出现）。
