## Fixed

**Dependabot 告警巡检在 GA 上 403：内置 GITHUB_TOKEN 缺 `vulnerability-alerts: read`**

内置 `GITHUB_TOKEN` 的权限按族划分：`security-events: read` 只覆盖 code scanning，
Dependabot alerts 要 `vulnerability-alerts: read`（官方 workflow 权限表：
"For Dependabot alerts, use the `vulnerability-alerts` permission"）。交付时把细粒度
PAT 的「Security events 三合一」经验推到 GITHUB_TOKEN 上，结果首跑
`第 1 页: 403`、退出码 2、一次都没写——同族 code scanning 巡检（`security-events: read`）
同期连绿，正好把两枚权限的边界量了出来。

- `dependabot-triage.yml` 的 `permissions:` 块改为 `vulnerability-alerts: read`
- 同步改正巡检脚本的权限说明与 403 诊断话术（点名两枚权限互不覆盖，细粒度 PAT 才是一项三合一）
- 用例钉住 workflow 权限形状与 403 话术，防止改回去
