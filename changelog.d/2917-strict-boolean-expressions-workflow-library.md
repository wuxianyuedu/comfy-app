## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 6：`src/components/studio/workflow-library`
  清零（97 处 / 31 份）**（ISSUE #2776 / #2917）：工作流库全域 —— 视图
  （WorkflowLibrary / WorkflowLibraryList / WorkflowLibraryCanvas /
  WorkflowCanvasNodePreview / WorkflowRunLogButton / WorkflowRunLogModal /
  WorkflowRunRawCliModal / WorkflowPreviewRunFeedback / ParamOwnerTag /
  WorkflowParamCardColumn / WorkflowOutputParamCardColumn）、sections
  （DetailHeader / EncapsulationTestForm / WorkshopEncapsulationPanel）、
  CustomNodesSettings（SettingsParts / NodePreviewCard / NodesTab 与其 hooks）、
  hooks（use-param-wiring / use-output-wiring / use-library-wire-flow /
  use-workflow-actions / use-workflow-import / use-workflow-library /
  use-workflow-library-detail / use-workflow-run-resume 及用例）与三个
  config/param-cards 纯派生层。
  - 口径与前几批一致：可空布尔 → `=== true`；可空字符串按声明域显式比较
    （`string | undefined` → `=== undefined || === ""`、`string | null` →
    `=== null || === ""`、三态 `string | null | undefined` → 三重判）；
    `unknown` / `any` 真值 → `typeof x === "object" && x !== null` 或
    `Boolean(...)`；恒真对象防御（tRPC 返回的 `tpl`、`data.settings`）→
    `Boolean(...)` 保运行期防御；对象/数组上的 `|| []` / `|| {}` → `?? []` /
    `?? {}`（声明域内恒真，逐值等价）。
  - 两处连带修正（判空改写牵出的真问题，同批修）：
    `libraryConnectionRefusal` 的把手守卫补上 `=== undefined`（原 `!sourceHandle`
    同时挡 undefined，改写漏掉会让 TS2538 冒头）；NodesTab 的
    `saved.parsedAt` 补 `!== null`（三态判全）。两份源码形状断言用例
    （`WorkflowLibraryLayout.test.tsx` 的 `editingId` 挂载闸门、
    `WorkflowCanvasNodePreview.wiring.test.tsx` 的 `deriveLibraryEdges` 实参）
    同步更新为改写后的形态。
  - 验证：`src/components/studio/workflow-library` 该规则复测 0 残留；
    `tsc --noEmit` 通过；该目录 25 份测试 311 用例全绿。eqeqeq 台账 0 新增、
    oxlint 禁用台账 0 处。
  - 核账：上一轮剩余清单的 `src/server 98/24` 是基线旧值（基线扫描早于
    批 3 server 清零）混入表头，实测 server 0 残留、无回潮；台账
    `log/tools/sbe-remaining-2026-11-02.md` 表头与勾稽已修正并同步剔除
    已清零目录。
  - 剩余总量 801 处 / 283 份（components 532 / tests 142 / app 115 /
    config 9 / trpc 2 / tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
