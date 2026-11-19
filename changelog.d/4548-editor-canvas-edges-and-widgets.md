## Fixed

- 工作流编辑器画布：非受控改造（#4536）漏传 `defaultEdges`，`rf.setEdges` 因
  `hasDefaultEdges` 为假被静默丢弃，画布上所有连线消失（#4548）。同批修复折叠态
  已连线 widget 输入没有 Handle 锚点导致边被丢的问题、有连线的 widget 行不再渲染
  过期的本地默认值、STRING 多行文本框在固定尺寸节点里被 flex 压扁、便签滚动条
  在浅底上看不清。
