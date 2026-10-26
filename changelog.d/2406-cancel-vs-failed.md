## Fixed

- 「被取消」与「真失败」在读数上分不开的第二半（ISSUE #2406 / #2220）：`classifyBuildOutcome()`
  此前**只收 `stage-N` 那几格**，而 prepare 期就被另一条流水线抢走锁的那一跑里
  `stage-0` 是 `skipped`、`Prepare` 是平台自带格 ⇒ `failed` / `cancelled` 两个集合都空，
  一路落到构建级 `error`，判成「真失败」。
  现场（`cnb-9qi-1k5qojle1` / `cnb-qta-1k5ptts6m`，`push` 档两条连着被终止）：
  构建级 `error`、流水线 `cancel`、`Prepare` 报 `error`、下面那格根本没跑 ——
  看板上与「构建坏了」长得一样，而它一个字都没验证过。
- `prepare` 进「工作格」口径（`end` / `beforeEnd` / `debugDetection` 仍不认）：它是
  「一格都没跑到」时**唯一**的证人。
- 新增 `cancelledCause()`：从**平台原话**认出「被顶掉 / 人为终止 / 抢锁」，与「真失败」
  分开念，并把「抢走锁的是哪一跑」读出来（`cnb-jpf-1k5qok15v` 那种）。判据只有两条，
  都在平台原始读数里：格状态 `cancel` 一族，以及 `error` 那句原话的形状
  （`… got lock: …` / `has been manually terminated` —— 真失败写的是判据自己的退出码）。
- ⚠️ 原话住在 `get-build-stage -v` 的 `data.error` 里，**不在** `get-build-status` 的
  `stages[]` 上（实测那一层只有 `status/duration/name/id`）⇒ 新增 `enrichStageErrors()`：
  分类之前只对**非绿非 skipped** 的那几格补取原话（上限三格），不改入参。
- 消费口一个都不另立判定：`pnpm ship --diagnose`、`pnpm ship` 的轮询那一行、
  `ci-build-readout.mjs` 自己的 CLI 都念「被终止 + 谁抢的锁 + 平台原话」；
  `ci-pr-failure-issue.mjs` / `ci-daily-failure-issue.mjs` 因此不再把「被取消」写成红字
  （那两处原本就有 `cancelled ⇒ 不立案`，缺的只是判对）。
  退码不变：被取消仍是 `2`（没有结论），不是 `1`。
- 真机复算八跑（`prepare` 被顶掉 ×2、`prepare` 真失败、`受影响用例` 真失败、
  `Install dependencies` 被顶掉、人为终止、`覆盖率上报` 被顶掉、绿）逐条对上，
  且反向样本（真失败那一条原话）仍然判 `failed`。
