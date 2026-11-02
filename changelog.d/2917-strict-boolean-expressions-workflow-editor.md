## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 8：
  `src/components/studio/workflow-editor` 清零（53 处 / 12 份）**（ISSUE #2776 /
  #2917）：工作流编辑器全域 —— 参数卡（WorkflowParamCard）、顶栏
  （WorkflowEditorTopbar，含 `disabled={!Boolean(detail)}` 恒真对象防御）、
  存储面板（WorkflowStores）、节点与画布（WorkflowEditorNodes /
  WorkflowEditorCanvas，含 `sourceId === null || sourceId === ""` 与
  assignedRole 三重判提 `const role`）、详情加载 hook
  （use-workflow-detail-loader 13 处，subgraphUid 6 处统一
  `!== undefined && !== ""`、`error?: string` 显式判）、派生层
  （workflow-editor-derived）、子图视口（subgraph-viewport）、节点构建
  （workflow-editor-build-nodes）、视口适配（use-workflow-viewport-fit）、
  持久化（use-workflow-persistence）及 FitOnOpen.test。
  - 口径与前几批一致：可空布尔 → `=== true`；可空字符串按声明域显式比较
    （`string | undefined` → `!== undefined && !== ""`，三态
    `string | null | undefined` → 三重判）；恒真对象防御 → `Boolean(x)`。
  - 教训：同文件同字符串多处时缩进层级不同会导致 replace_all 漏改
    （map 回调里 4 空格缩进的一份未被 6 空格的替换覆盖），复测复核时
    捕获 —— 「改完重拉防行号漂移」有效。
  - 验证：`src/components/studio/workflow-editor` 该规则复测 0 残留（改完后
    重拉两轮复核）；该目录 13 份测试 145 用例全绿。eqeqeq 台账 0 新增、
    oxlint 禁用台账 0 处。
  - 剩余总量见 `log/tools/sbe-remaining-2026-11-02.md`。
