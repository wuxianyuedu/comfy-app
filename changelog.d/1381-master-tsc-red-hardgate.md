## Fixed

- **master 基线上的 25 条 `tsc` 报错收口**（`01d761ae` 引入，别线）。该提交的 message 自己
  写着「本容器无 node_modules，走不到 tsc / eslint / vitest」，而它经平台 squash 合并不跑
  本地钩子、`#623` 之后又无 CI 兜底 —— 于是直接落进 `master`。`tsc` / `lint` 属**硬闸类**
  （无基线可登记），从那一刻起拦住从 `master` 分出的每一个提交（本轮第一次 `git commit`
  就被 pre-commit 的 A 组拦下）。
- 根因是三处**类型声明与登记处漂开**，报错的文件都不是它引入的：
  `freshnessTrack` / `checkFreshnessLedger` 的 JSDoc 手抄了一份栏位清单（登记处后来加了
  `dirty` / `dirtyHow` / `graceMs` 三栏）；`parseLedgerFlag` 的收窄联合参数遇上退化数组；
  三处实现细节（松散元组当索引、`let = null` 的隐式 `any`、一处无人调用的导入）。
- 顺带订正 `tests/daily-tracks.test.ts` 里一条**测字符串**的断言：它盯的是
  `daily-run.mjs` 的 `writeFreshness`，而那个导入在该文件里**没有任何调用点**（另外三档
  各自直接导入）—— 改成断言它接的**是哪个共用内核**。
- 复算证据：干净 `origin/master` worktree 上同样 25 条；其父提交 `a9802d7c` 是 0 条。
