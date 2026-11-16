## Added

- **预算账陈旧度触发器补上 GA 那个执行者**（ISSUE #2639）：#2783 落地的触发器挂在 CNB 侧
  `ci-daily-failure-issue.mjs` 上，而 2026-11-10 起每日生产构建整体迁 GA（#3504 / #3515）、
  失败立案随之挪到 `ci-ga-daily-failure-issue.mjs` —— 判据链一个字没动，换的只是平台，
  于是每日档的预算账触发器一度没有执行者。现在 GA 失败立案同样在正文里念「该有人出面了」：
  判定层（判决行解析 / 陈旧度与连续天数门限 / 升级那一节）抽在 `ci-bundle-escalation-core.mjs`
  （纯判定、零本仓依赖，GA `daily-failure-issue` job 不装 `node_modules` 也加载得起），
  CNB 与 GA 两侧的取数链各留一半（CNB 走 cnb CLI；GA 走 workflow_runs 列表 → 失败 job →
  job 日志，全 HTTP），门限仍在数值账（`scripts/gates/.gate-thresholds.json`）只此一份。
  每天的判法按「Daily (mirror) 的 completed runs」回看（`schedule` 与 `workflow_dispatch`
  都算每日那一跑），当前跑复用立案那一跳已取到的正文，不发第二遍日志请求；
  顶层 `success` ⇒ 连续在这里断、其余结论（`cancelled` 等）⇒ 「读不出」，与 CNB 侧同一口径。
