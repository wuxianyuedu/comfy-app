## Changed

画布子图封装节点（WorkflowSubgraphNode）的 widget 值显示样式优化，对齐 ComfyUI 节点的参数槽版式：参数值改为带背景框的「凹陷井」（深底 + 细描边，与 ComfyUI widget 槽一致），文本统一左对齐；widget 区改为两栏 grid——标签列按**最长的参数名**撑出（`max-content`），所有行的值框共享同一起点坐标；值框有固定最小宽度（64px）并随节点余宽伸展。STRING 多行堆叠行不受影响（跨两列、定尺寸节点下继续铺满剩余高度）。
