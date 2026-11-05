## Fixed

- **push 档的锁补 `wait: true`：合并后紧跟的那次 push（删源分支触发）不再被判 `error`**（ISSUE #3207）。
  `cancel-in-progress: false`（#2396）只摘掉了「终止旧的一跑」，而官方
  `grammar.md#pipeline-lock` 里「锁被占用时是否等待」是另一个键 `wait`，**缺省 `false`** ——
  两个默认值叠起来的语义是「既不终止、也不等」，于是两跑重叠时**后到那一跑**在 Prepare 里
  直接落 `Pipeline init error: The lock (moon-read/comfy-app-t3-push) is occupied and the
  current process is terminated.`。现场是同一分钟内的一对：`cnb-310-1k6m7jap1`（16:10:17Z，
  110274ms，6 格全绿）与 `cnb-o1g-1k6m7jj8q`（16:10:26Z，405ms，`status: error`、6 格全
  `skipped`）。最常见的产生方式不是人手连推，而是**合并后紧跟一次删源分支** ——
  `branch.delete` 用默认分支的代码与配置再跑一次 push，没人会去补跑它。
- 判据随之扩成两条，都在 `tests/no-platform-ci-config.test.ts` 的 **R6**：`key: push` 那把必须
  `cancel-in-progress: false` **且** `wait: true`。反向复算补两种坏形状（摘掉 `wait: true`、
  写成 `wait: false` —— 与漏写同义），现役配置一条都不被抓。
- 口径与现场逐拍读数写进 `docs/standards/13-提交与-code-review.md` §13.5.3.10 新增小节；
  `.lock-push` 锚点的注释同步（那里是唯一定义处，其余只留指路）。
