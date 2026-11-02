## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 7：`src/components/studio/canvas`
  清零（60 处 / 21 份）**（ISSUE #2776 / #2917）：画布渲染层全域 —— 节点卡片
  （WorkflowNode / WorkflowSubgraphNode / FlowNodeHeader / SubgraphHeader /
  PackageFooter / NodeFrost）、针脚与 widget 行（FlowNodePinRows /
  FlowNodeWidgetRows / SubgraphPinRows / SubgraphWidgetRow /
  SubgraphWidgetStackedString）、折叠锚点（FlowNodeCollapsedAnchors /
  SubgraphCollapsedAnchors）、边与选区（WorkflowEdge / CanvasArea /
  CanvasSettingsPanel），及纯派生层（flow-focus-endpoints /
  workflow-node-entries / workflow-node-palette / workflow-render-chain /
  hooks/use-related-edges-highlight）。
  - 口径与前几批一致：可空布尔 → `=== true`（`io?.ioEditMode`、
    `connectedOutputs?.has(n)`、`selected`、`item.divider` 一族）；
    可空字符串按声明域显式比较（`string | undefined` → `!== undefined && !== ""`、
    `string | null` → `!== null && !== ""`、三态 `string | null | undefined` →
    三重判）；`unknown` 真值守卫 → `typeof x !== "object" || x === null`
    （与 `!x || typeof x !== "object"` 逐值等价）。
  - 两处「`&&` 链整体类型含 undefined」的连带改写：filter 谓词里
    `m && …`（`m` 为 `Record` 索引访问的 `T | undefined`）会把整条链落成
    `boolean | undefined`，改为 `m !== undefined && …`；同理
    `!inInp?.isConnection` → `inInp?.isConnection !== true`（在
    `ioEditMode` / `inName` 改写后才暴露出来，复测复核时捕获 —— 正是
    「改完重拉防行号漂移」的那一类）。
  - 验证：`src/components/studio/canvas` 该规则复测 0 残留（改完后重拉
    复核）；`tsc --noEmit` 通过；该目录 9 份测试 80 用例全绿。
    eqeqeq 台账 0 新增、oxlint 禁用台账 0 处。
  - 实测口径说明：批前实测 canvas 恰为 60 处 / 21 份，与清单一致，无出入。
  - 剩余总量 741 处 / 262 份（components 472 / tests 142 / app 115 /
    config 9 / trpc 2 / tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
