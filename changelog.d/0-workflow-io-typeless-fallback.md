## Changed

- 工作流参数表单：弱类型（ComfyUI 离线保存 → `workflowIO` 无 `type`）的回退推断收紧，
  避免「ComfyUI 启动与否导致出图结果不一致」。

### 改动要点

- `inferControlFromName` 的回退判据与分组判据（`isDimWidth` / `isDimHeight` /
  `isDimMegapixels` / `isDimMultiple` / `isDimAspect`）**共用同一张名字表**，中文标签
  （宽度 / 高度 / 比例 / 纵横 / 倍数 / 倍率）也能被控件推断认出——修掉「DimensionControl
  消失」回归的中文侧（分组认得出、控件认不出 → 组合选择器条件不满足 → 不出现）。
- `defaultInputValues` 对**推断出来的数值控件**不再造默认值（`numericBounds().min` 不再
  下发）：`type` 缺失时只交给图内默认值 / 用户填写，不再静默下发一个猜出的数字。声明了
  `INT` / `FLOAT` 的条目照旧给默认值，行为不变。
- 新增 `controlInferred` 标记：下游（播种 / 分组 / 渲染）据此区分「声明的类型」与「推出来
  的控件」，便于断言与排查。
- `enrichWorkflowIO` 把存档里的 `type` / `defaultValue` / `options` 当兜底基线——富化链路
  （rawJson / object_info）查不到该节点时不退化成 `*`，离线下次打开仍带真控件。新增
  `persistEnrichedWorkflowIO`：保存 IO 映射时用图内字面量把缺失的 `type` / `defaultValue`
  **固化**进库（离线可用，不依赖 object_info）。

### 影响范围

- 仅作用于「类型缺失」的条目；声明了类型的条目行为零变化。
- 已上线工作流的既有 IO 映射不受影响；新保存的条目会带上固化后的类型。
