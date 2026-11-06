## Fixed

- push 档（master 合并复核）补 `endStages` 失败立案格（ISSUE #2842）：`ci-pr-failure-issue.mjs --no-block --lane push`，与 PR / 桌包那两格逐字同族（同一份读写链、不抄第二份）。此前 push 档只引 `*common` 没有 `endStages`——红了不立单、PR 看不见、每日档也不跑，#2607 那一批漏登记 §13.1 一格后 master 上的 `doc:check` 红了 ≈20 分钟才被一次性探针撞见。去重键跟着 `--lane push` ⇒ 标题 `ci(push): push 档红在「…」`，与 PR / 桌包两族互不相混。`.push-fail-stage` 锚点 + push 流水线 `<<: [*common, *push_fail_stage]` 接线；`LANE_PREFIX` 补 push 前缀。
