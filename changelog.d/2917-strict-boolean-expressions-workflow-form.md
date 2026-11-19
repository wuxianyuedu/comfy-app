## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 9：
  `src/components/studio/workflow-form` 清零（50 处 / 13 份）**（ISSUE #2776 /
  #2917）：运行期表单一族 —— 组合控件（GroupedControls / DimensionControl /
  DimensionControlParts / AspectMegapixelControl / VideoControl /
  StyleSwitcher 的 `narrow` / `compact` 一族统一 `=== true`）、动态表单视图
  （DynamicWorkflowFormView：`mode` / `visibilityMode` 三态三重判、
  `uploadError` / `draggingKey` 显式判空）、业务 hook
  （use-dynamic-workflow-form：`fromKey` / `target` 的 `string | null` 显式判、
  `showHiddenInMode === true`、恒真对象防御 `Boolean(rect)`）、widget 行
  （WidgetControl：`entry.required === true` 一族、`unknown` 值 `Boolean(value)`
  五处、`previewUrl !== null && !== ""`；WidgetInputRow 的
  `entry.required === true` 五处）、端口行（WorkflowWirePortRows：
  `draggingKey` 三态守卫、isDragging / isDropTarget 链尾对象改
  `!== undefined` 让整条成 boolean）、节点部件（WorkflowNodeParts 的
  `hint`）与端点（WorkflowPortHandle 的 `nodeId === null || === ""`）。
  - 口径与前几批一致：可空布尔 → `=== true`；可空字符串按声明域显式比较；
    `unknown` 真值 → `Boolean(x)`；恒真对象防御 → `Boolean(x)`（`=== undefined`
    会被 TS2367 拒）；`a && b` 链尾对象改显式比较让整条成 boolean。
  - 一处收窄修正：`onDrop` 里 `!onReorder` 被报「恒真对象」（闭包创建前已有
    早退守卫），删除该冗余判，语义逐值等价。
  - 一处类型补判：`WorkflowWirePortRows` 的 `draggingKey` 实测为
    `string | null | undefined` 三态，首轮改写只判了 null / ""，全量 tsc
    抓到 `string | undefined` 赋 `string` 报错后补 `=== undefined` 守卫。
  - 实测口径说明：清单记 50 处，实测 50 处 / 13 份，处数一致，份数以实测
    为准。
  - 验证：`src/components/studio/workflow-form` 该规则复测 0 残留（改完后
    重拉复核）；`tsc --noEmit` 全量通过；该目录 11 份测试 84 用例全绿。
    eqeqeq 台账 0 新增、oxlint 禁用台账 0 处。
  - 剩余总量 638 处 / 237 份（components 369 / tests 142 / app 115 /
    config 9 / trpc 2 / tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
