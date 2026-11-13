## Fixed

- **GA 桌包档（`package-desktop.yml`）红时没有自动立案格，「桌包失败立案」判的还是退役前的 CNB 上一跑**（#2874）。桌包档的执行面早已迁到 GA（`fn 284` 那类 `crontab: 0 3 * * *` 的自托管 runner 已退役），GA schedule 失败时该跑没人知道 ⇒ 镜像仓红在「没人想起来去问」的那一天等于没发生。

  改法：把 GA 每日镜像档现役的 `daily-failure-issue` 下游 job 对位迁入桌包档 —— `needs: package` + `if: failure()` + `continue-on-error: true`，默认只读自身 jobs、把红格名归一后按标题去重写一张 CNB 单（同名追加读数，不新开号）。沿用 `scripts/ci-ga-daily-failure-issue.mjs` —— 把「标题前缀 / handle / workflow 名」三枚参数化成 `GA_FAILURE_ISSUE_PREFIX` / `GA_FAILURE_ISSUE_HANDLE` / `GA_FAILURE_ISSUE_WORKFLOW`，env 缺省 = 每日档，行为与现役测试逐字一致（`tests/ci-ga-daily-failure-issue.test.ts` 24 条全绿）。

  顺带：`package-desktop.yml` 顶层 `permissions` 补 `actions: read`（失败立案要读 `/actions/runs/{id}/jobs`）。
