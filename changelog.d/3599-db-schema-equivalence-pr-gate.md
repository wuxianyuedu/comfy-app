## Added

- **「schema⇄迁移等价」进 PR 档**（#3599，业主拍板口径「进pr档」；裁决与逐条读数见规范
  §13.5.40）。
  版本化迁移（`drizzle/`）与 `src/server/db/schema.ts` 必须是同一份形状：漂开了**不报错**，
  只在某处业务写入时炸 —— #3565 的现场是 migrate 侧少一张表 / 十列 / 一个索引，在 master
  上活了两周，暴露通道只剩次日 01:37 的全量单测（增量面随 #3052 撤到每日档之后）。
  这一类红是**确定性**的（结论只由这份树决定，与机器负载无关），按 §13.5.30 的三条门槛
  逐条评过 ⇒ L1，进 PR 档。

  判据本体一字未改：`tests/db-migrate-equivalence.test.ts`（表集合 / 逐表逐列四维 /
  索引集合，外加「同一行数据按名取回逐字段一致」与「迁移幂等」两条自证）—— 它是这件事的
  **唯一**判据，平台侧沿用它，不另写第二份。单子提过的「轻量形态」（journal 顶端 snapshot
  与 schema 的表集合 diff）**不采用**：它盖不住 #3565 那次真正漂掉的十列与那个索引。

  执行者是 GA `.github/workflows/pr-gate.yml` 的 `typecheck-db-format` job 里那一步
  （`node scripts/ci-run-tool.mjs vitest run tests/db-migrate-equivalence.test.ts`）——
  落在**已经装好依赖**的那一格里，不新增一次 `pnpm install`、不新增一个 job ⇒ PR 关键路径
  不变。实测读数：本机 7 条全绿 / 墙钟 87s（首跑，drizzle-kit 冷）/ 53s（暖态），用例本身
  ~50s —— 低于 §13.5.30 那条参照（全仓 ESLint 121s 那一量级属 L2）；GA 冷 runner 的真实读数
  以平台那一跑为准。

  登记三处同批：`.cnb.yml` 的 `COMFYAPP_CI_GATES` 加名、`COMFYAPP_CI_GATES_ELSEWHERE` 登记
  入口路径、`GATE_TIER_LEDGER` 的 PR 段加同名条目（档位 L1）。**判据面补一处**：
  `scripts/check-gate-name-executors.mjs` 的执行面从三处补到四处 —— 增的是「GA PR 门禁
  workflow 的 `run:` 行」：PR 主列的代码判据全在 GA 侧（CNB 的 PR 档自 #3378 起只剩
  「站内回读结论 + 红了立案」两件纯 API 动作），而另三处执行面一处都不在 GA ⇒ 指向 GA step
  的入口路径会被误判成「没有执行者」。补上之后，这一格「执行者没了」当场红。
