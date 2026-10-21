## Changed

- **覆盖率门槛那一档重新自证了一次**（`scripts/.full-suite-freshness.json` 的 `verifiedAt` 前进到
  本轮），因为今天日内那笔绿账记在 13:38，而它**不含** A14 那批（`src/lib/process/python-run.ts`
  新模块 + 路由三条链改吃判据）。这一档的执行者是「改过 `src/` 与 `tests/` 就要当天自证」，
  不是「想起来才跑」—— 账本单槽位、只有绿了才记，所以红的时候这一格根本不会动。
- 结论：整档绿，覆盖率门槛没有因为新增那份内核而跌破（内核自己被 `python-run.test.ts` 跑到 100%，
  `src/app/api/custom-nodes/route.ts` 实测 statements 93.96%）。复算入口就是记账那条命令：
  `node scripts/full-suite-run.mjs`（它跑的是 `pnpm run test:coverage`，含门槛判定）。
