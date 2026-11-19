## Fixed

**双远端镜像四件小修**：

- 回读格查询方式修正：dispatch 触发的 run 其 `head_sha` 落默认分支 HEAD，
  `?head_sha=` 过滤恒得零条（PR #3080 实测）。主路径改按
  `event=repository_dispatch` 拉触发表，pr-gate.yml 新增 `run-name`（内含
  payload 的 PR 号与 head_sha），回读用 `display_title` 认领本跑。checks 兜底
  路径保留并标注「需 workflow 主动建 check 才有效」（本批不实现）。
- heavy-gates 注入 `CNB_COMMIT`：镜像脚本派发 payload 新增 `cnb_commit`
  字段（payload 原有的 `head_sha` 是合成 merge，不是源分支 head），GitHub 侧
  同名映射，让「格式化提交与行为改动分离」判据在 GitHub 侧能判起来。
  只做 GitHub 侧映射，不改 CNB 侧语义；缺席照旧退「没判」。
- daily.yml 的 ESLint step 加 step 级 `NODE_OPTIONS: --max-old-space-size=4096`
  （runner 7GB RAM，V8 默认上限约 2GB 曾 OOM），不动全局 env。
- `.githooks/pre-commit` 注释「D(60 个判据脚本)」更正为 61：083b1d2e0（#3016）
  新增 oxlint 清零规则集闸时未同步注释，非多余步骤。
