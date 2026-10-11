## Fixed

- **e2e 新鲜度账上那条豁免不是凭证，且合并时被误留**（ISSUE #1727）。`scripts/.e2e-freshness.json` 的 `e2e` 一档此前带着 `skippedReason`（一条「今天为什么不跑全量 e2e」的豁免），而 `4ce9e871`（#1730 的合并）提交信息里写明「取本分支侧的实跑账、豁免已被替换」，实际落地的文件却是 `master` 侧那版 —— `git show 4ce9e871:scripts/.e2e-freshness.json` 与上一版 `ac8a3a57` **逐字节相同**（`verifiedAt` 仍是 `04:50:07.166Z`、`skippedReason` 在场）。判据在 `scripts/freshness-ledger.mjs`：`writeFreshness()` 整块替换 `ledger[key]`，新对象里**没有** `skippedReason` 这一栏；`writeSkipRecord()` 才写它。所以「豁免在场」⇒ 这一档当天只是「有人回答过为什么不跑」，**不是**「跑绿过」。
  - 后果落在下一个改 `src/**` 的人身上：他会看到今天已有记录而不再跑 e2e，而 #1730 的修法其实一次都没在**合并后的 master**上被执行过。
  - 本次在合并后的 master（`e381c34f`）上真跑了全量：**76 passed（1.5m）**，由 `pnpm test:e2e` 落一笔实跑账替换那条豁免 —— 文件里不再有 `skippedReason`，`verifiedAt` 是本次的读数。
  - 记一个环境前提（不是「跑不了」，是**没配好**）：`db.sqlite` 不存在时 `/api/health` 返 503、队列/导航等屏整片 `element(s) not found`，首跑会红 12 条。`pnpm db:push` 建好表后同一份代码 76 条全绿 —— 与 AGENTS 硬规则 26 同一条口径：别把「环境没配」当结论。另：本容器 `CI=true` 会让 Playwright 走 `pnpm start`（要求先生产构建），跑 dev 那条链得 `env -u CI node scripts/e2e-run.mjs`。
