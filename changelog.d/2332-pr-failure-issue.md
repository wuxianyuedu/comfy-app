## Added

**PR 那一跑红了，现在会自己说一声（ISSUE #2332）**。这是本仓第一条「红 ⇒ 看得见」的执行者，
落点是 `.cnb.yml` 的 `PR 失败立案` 一格（`scripts/ci-pr-failure-issue.mjs`）。

- 补的是什么：`pull_request` 一天跑得最多，而它的红**没有任何通知** —— 平台没有「构建结束 →
  主动打你」的通用回调（`cnb event get-events` 只能主动拉、也不含 build 事件），于是知道它的
  只有当场盯着 `pnpm ship` 的人与事后翻列表的人。其余时候「红了」=「没发生」。
- 为什么不是挂 IM 推送插件：这条件路径上**没有 Docker**（头注第 1 条，带 `image:` 的 stage
  70ms 就红 `Runner does not enable Docker`），插件镜像还默认要出网 ⇒ 那一档在本仓今天没有
  执行者。落点改选**PR 评论区**：进列表、有未读、能 @ 人，不要新凭据。
- 落点按「有没有人能收」分两档：`CNB_PULL_REQUEST_IID`（或 `eventUrl` 里的 `/pulls/<iid>`）
  认得出 ⇒ 评论在那张 PR 下（一条诉求一张单）；认不出 ⇒ 按格名去重建单（前缀
  `ci(pr): PR 档红在「<格名>」`，同一格再次红只追加读数）。
- 这一格是本文件**唯一**用 `run: always()` 的格：它判的是「这一跑红了」，写在中间会被前面
  那一格的红一起 `skipped` —— 而那正是它要治的形状。同时不带 `ifModify`（它判状态不判文本），
  带 `--no-block`（自己坏掉不该变成一条红，但失败时照打红话与手工出口，由用例钉住不许静默）。
- 判决链一个字都没重写：定性 = `ci-build-readout.mjs` 的 `classifyBuildOutcome()`（与
  `pnpm ship --diagnose`、每日档同一份），取数 = 它的 `fetchBuildList()` +
  `check-daily-attendance.mjs` 的 `fetchBuildDetails()`，写单 = `ship-issue-new.mjs`。
- 同批收掉两处重复实现（§12.12）：`fetchBuildDetails()` 从「取 + 挑」里拆出「取」（两个消费点
  要挑的东西不同），`appendReading` 那条「写评论 + 回读认 marker」收成
  `ship-issue-new.mjs` 的 `runAppendIssueComment()` 一份（每日档与新那一格共用）。
- 判别用例：`tests/ci-pr-failure-issue.test.ts`（21 条，含「落点选错」「不许静默」「这一格必须
  排最后」三组），以及新格的 `timeout: 5m` 与 `.gates` 末尾位置由它们逐字钉住。
