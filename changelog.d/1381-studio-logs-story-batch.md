## Added

- **`studio/logs/` 的日志面板一族补齐 story（第五层注入：工作流运行）**：新增
  `.storybook/workflow-run-sources.tsx`，story 用 `parameters.runScene` 声明「哪一次
  运行」，注入层经**真 action**（`registerWorkflowRun` / `appendWorkflowRunLog` /
  `failWorkflowRun`）把那条链路落板 —— `TaskLogTimeline` 吃的 `logs` 在真机上是
  `workflow-run-store` 按 SSE 帧累积的，手捏数组会跳过 `(t, msg)` 去重与 `MAX_LOGS`
  截尾，而画布上的计数与截尾口正按这两条算。
- `VirtualLogList` / `OriginSelect` / `TaskLogTimeline` / `LogPanelFooter` /
  `DiagnosticsButton` 各补 story（`studio/logs` 5 份 → 10 份），全仓故事 123 → 128 份
  / 22 条变体，逐条在无头 Chromium 里核对（22/22 渲染、0 console 错误）。
- 新增 `duplicatedOrigins` store 场景：同一批原文同时喂给 `launcher` 与 `壳侧编排`，
  把「按身份去重后只落一份、来源是第一个到的那个」这条口径摆到画布上。

## Fixed

- **失败运行的时间线在画布上与整条链路差九个多小时**：`failWorkflowRun()` 补的 error
  行用它自己的 `Date.now()`（生产口径），而场景第一版把步骤锚在写死的日期上。改成
  按「此刻回推」算起点，整条链路连失败行落在同一分钟里（实测抓到，判据钉住）。

## Tests

- `tests/storybook-workflow-run-sources.test.ts`（6 条，进固定清单），变异八向全拦下。
  写它的过程中两条断言自己先假绿过（`toContain` 被 import 行 / 子串匹配满足），
  现在统一走 `callsIn()`（剥注释 + 排除 import 行 + 括号配对）。
