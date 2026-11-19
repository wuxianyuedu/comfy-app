## Added

- 每日巡检 `scripts/ci-code-scanning-triage.mjs`：读 GitHub code scanning 的全量 open
  告警（分页取完才写），按 `rule.id` 聚合成 CNB issue（一规则一单，去重键取标题里的
  `code-scanning: <rule id>`）。告警消失不自动关单，只刷新正文 + 追加评论 +
  打 `code-scanning:cleared`。`.github/workflows/code-scanning-triage.yml` 每日
  北京时间 02:00（UTC 18:00）跑一次，也可手动触发。
