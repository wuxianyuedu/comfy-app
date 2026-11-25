## Changed

- **子图封装节点：已连线的暴露参数不再显示（不会生效的）默认数值**（#5051）：
  `SubgraphWidgetRow` 对 `isConnection` / `isBoundary` 的槽位只渲染左侧端口点 + 标签，
  值格（图片缩略图 / COMBO 只读下拉 / 文本井）一并隐藏 —— 连线传入的值在运行期会
  覆盖封装内部默认值，界面上不再摆出「不会生效的数值」；未连线槽位照旧显示。
  STRING 堆叠块不受影响（`stackedStringRow` 本就把已连线槽位排除，走普通行后同样
  隐藏值格）。回归用例：`WorkflowSubgraphNode.test.tsx` 新增连线/未连线对照断言。
