## Fixed

- **`lock.cancel-in-progress` 的默认 key 在 PR 上退化成「全仓共用一把锁」**（ISSUE #1981）：
  平台默认 key 是 `分支名-流水线名`，而 `pull_request` 事件下 `CNB_BRANCH` 取的是**目标分支名**
  （官方 `build-in-env.md` §CNB_BRANCH：「合并类事件 → 目标分支名」）—— 于是「分支名」这一半
  在所有 PR 上恒等于 `master`，`cancel-in-progress: true` 实际是「**全仓只留最新那一跑**」：
  任意两条并行 PR 互相掐停（现场：PR #1980 掐掉了 #1982 那条）。代价不是「慢」，
  是**白跑一整条**，而且被掐的那条连失败原因都不会留下。
  修法不是关掉 `cancel-in-progress`（那会退回 #1961 那条「几条全量流水线挤一台机、
  三条一起冻结」），而是把 key 写出来：`.cnb.yml` 的 `.common.lock` 现在显式声明
  `key: pr-$CNB_PULL_REQUEST_IID` —— PR 上 ⇒ `pr-<PR 编号>`（每个 PR 互不相同，同一 PR 里
  连推几个提交仍落回同一把锁），`push` 上 ⇒ `pr-`（该变量在非合并类事件上无值，而这一档
  只有一条流水线，「一条就够」）。依据两条都在官方文档里：`lock.key` 在 `build/env.md`
  「支持变量替换的属性」表中被点名支持变量替换；`CNB_PULL_REQUEST_IID` 见 `build-in-env.md`。
  **刻意不用** `CNB_BRANCH`（正是它会退化成目标分支），也**不用** `CNB_PULL_REQUEST_ID`
  （跨仓全局 ID，粒度比这里需要的粗）。

## Added

- **上面这件事现在有判据**（同一 ISSUE）：`tests/no-platform-ci-config.test.ts` 新增
  `pipelineLockKeyTemplate()`（摘 `.cnb.yml` 里那份 key 原文，没写 ⇒ 判红）与
  `resolveLockKey()`（把变量**真代进去**算平台会得到的 key —— 只看原文判不出「两条 PR
  会不会撞」）。三条断言：只能用白名单里的变量、两条不同 PR 的 key 必须不同、同一 PR 的
  key 必须相同。**反向复算实测过两种红形态**：删掉 `key` 那一行 ⇒ 判据点名「全仓所有 PR
  共用一把锁」；换回按目标分支的 `$CNB_BRANCH-质量门禁` ⇒ 白名单那条当场点名。
  口径与「为什么不按事件写两份 lock」的取舍写进规范 §13.5.3.9。
