## Added

- **Dependabot alerts 自动提单，与 code scanning 同一套巡检口径**（ISSUE #4168）。
  GitHub 镜像仓的 Dependabot 每天在盯依赖，告警躺在 `security/dependabot` 里 ——
  那是另一套账号的页面，CNB issue 这个日常入口看不到它；「有告警」与「有人去修」
  之间没有交接。新增每日巡检（GA `dependabot-triage.yml`，北京 03:00，与 02:00 的
  code scanning 巡检错峰）把 open 告警按**依赖**聚合成 CNB 单：
  - **一包一单**：按 `ecosystem/name` 聚合（同一包的多条 advisory 是同一个修法：
    升到首个修复版），去重键是标题里的 `dependabot: <ecosystem>/<name>`；严重度
    映射优先级（critical P0 / high P1 / medium P2 / low P3）。
  - **三态动作**与 code scanning 那族逐条同源：新建 / 刷新正文（告警集变了才写，
    正文不带巡检时刻、不天天刷）/ 告警消失标注 `dependabot:cleared`（不自动关单，
    留给人确认）；失败即零写入；建单后补标签 + 独立回读。
  - **实现复用**：CNB 侧读写与 GitHub 侧通用 GET（重试 / 失败分类）直接复用
    `ci-code-scanning-triage-platform.mjs` 的既有出口；本族只带 Dependabot 独有的
    分页读取与归一（`ci-dependabot-triage-platform.mjs`）、纯函数层
    （`ci-dependabot-triage-model.mjs`）与编排（`ci-dependabot-triage.mjs`）。
  - 回归：`tests/ci-dependabot-triage.test.ts` 20 条（去重键含 scoped 包名 / 聚合
    与三动作计划 / 正文模板与防刷 / 失败姿态零写入 / 建单标签回读与已清零跳过）。
