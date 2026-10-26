## Fixed

**每日那一跑不再因为「上一格留下的暂存区」假红，而回写失败终于说得出原因**（ISSUE #2344）。

- **红的是什么**：`cnb-gbi-1k5onb9hv` / `cnb-42l-1k5q0ctkt` 两跑里
  `tests/known-failed-stale.test.ts` 那两条「暂存集为空 ⇒ 这一条没判」的用例报
  `expected true to be false`，而**同一份树在本地隔离复跑全绿**。当场读数：那两条写的是
  `resolveFace([])` —— 它读的是「**此刻这个仓库的索引**」，于是用例判的其实是
  「这台机器现在有没有人 stage 过东西」。平台上那份索引被上一格 `每日新鲜度账`
  回写失败留下的两份**入库账本**（`scripts/.artifact-freshness.json`、
  `scripts/.e2e-freshness.json`）填着 ⇒ 前提被别人的事故决定。
- **用例侧**：这一族改成**显式交清单**（`--staged` 后面不带名字 = 空清单）或经
  `resolveFace(argv, { readStaged })` 注入 —— 与 `runGate({ staged, selfTest })` 同一个取舍：
  判决面的输入必须可由调用方交进来，不然「造得出那个现场」就只能在真仓库里污染一台机器。
  并补一条**量具那一半**的用例（注入「脏索引」与「空索引」两种形状各钉一次），
  否则下一个人把它改回 `resolveFace([])` 时没有任何东西会红。断言一律带消息位（#2287 那一族）。
- **回写侧两件事**（`scripts/freshness-ledger-sync.mjs`）：① `add-failed` / `commit-failed`
  这两个出口把 git 的**原文**带进 reason（三个跑法脚本 `${freshPush.reason}` 那行自动念出来）——
  过去只有一枚词，「commit 为什么失败」在整跑日志里**不存在**；② `add` 已成而 `commit` 失败时
  **把那几份账本从暂存区撤回**，撤回本身失败也照念。`push-failed` 那一支**刻意不撤**：
  提交已落地、索引是干净的，再撤就是把成功的改动重新 stage 成待提交。
- **一句被实测推翻的话，连同它的三处复述一起订正**：「空索引那一档只出现在平台上，
  **而平台上没有暂存区**」是错的 —— 平台上有索引，而且它可以非空。
  `scripts/known-failed-selftest-gate.mjs`、`scripts/check-doc-mirror-pairing.cjs`（reason 原文）
  与 `scripts/ci-heavy-gates.mjs` / `tests/ci-heavy-gates.test.ts` 的叙述同批改写；
  「平台拿不到本次改动面」这句仍然成立（那正是 `--base` 的理由），它推不出「索引永远空」。
- 规范：§13.5.4 补「回写失败要做两件事」那一格，§13.5.5 补「同一句里还有半句也是错的」那一格；
  `docs/generated/**` 同批重生成。判据：`tests/known-failed-stale.test.ts`、
  `tests/freshness-ledger-backend.test.ts`（注入 `run`，一次 git 都不真跑）。
