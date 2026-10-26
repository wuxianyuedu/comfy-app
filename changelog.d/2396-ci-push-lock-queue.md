## Fixed

- `push` 档那把类锁（`.lock-push`）改成 `cancel-in-progress: false` —— 同 key 上**排队**
  而不是终止旧的一跑（ISSUE #2396）。`master 合并复核` 判的是「落到 master 的这**一笔**
  是不是 PR 合并形态」，一个提交一个结论；被终止的那一跑 `status: cancel`、那一格
  `skipped`，界面上看起来就是「前一个挂了」，而那笔提交**从此没有读数**。
  现场两对（间隔都在 12 秒内）：`cnb-9qi-1k5qojle1` / `cnb-qta-1k5ptts6m` 被判 `cancel`，
  prepare 里原文互印证（`The current pipeline is terminated` ⇄
  `the ongoing pipeline is terminated: cnb-9qi-…`）。整条只有 20~35 秒、大头是全量 clone
  的 Prepare ⇒ 「互斥省时间」在这里没有收益，只剩「销毁读数」这一条代价。
- 判据同批改：`lockClassViolations()` 的 **R2** 从「必须 `cancel-in-progress: true`」
  改成「必须**显式写了**这一行」（`null` = 漏写，与有意排队是两件事），并新增 **R6**
  判 `key: push` 那把必须是 `false`。反向复算两种坏形状都有用例（写回 `true` /
  删掉 `daily` 那把的那一行）。
- `daily` 与 `oneshot-*` 那几档**一字未动**：同一台机上不要同时压两遍那几格重档，
  终止在那里仍是想要的语义。
