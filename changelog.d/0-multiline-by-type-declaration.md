## Changed

- 多行文本框的判定改由**节点类型声明**驱动：STRING 输入是否渲染成 textarea，只看
  `/api/object_info` 里该节点该字段的 `{"multiline": true}`（如
  `PrimitiveStringMultiline` 的 `value`），不再按字段名 / 显示名猜 ——
  `prompt_width_of_thing` 这类单行输入不会再被升级成多行框，作者改过名的提示词框
  也不会因为名字里没有 `prompt` 而掉回单行。ComfyUI 读不到声明时只剩「当前值超过
  40 字符」这条数据判据（不是名字判据）。
- `object_info` 解析器 `createComboResolver` 更名为 `createObjectInfoResolvers`：
  同一次 fetch 既服务 COMBO 候选，也提供多行声明查询 `multilineForClassField`。
- 画布（`WorkflowNode` / `WorkflowSubgraphNode`）不再自己按名字重算多行，直接读
  服务端按声明盖章的 `raw_inputs[].multiline`；子图内部节点因为
  `buildSubgraphGraph` 是同步构建、读不到 `object_info`，由 `buildSubgraphDetail`
  在构建之后补盖一次声明。
