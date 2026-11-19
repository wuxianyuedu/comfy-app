## Fixed

- **自定义节点解析无中止保护 + 控制台全量重渲（#4470）**：
  ① 解析主链路的 `fetchWithTimeout` 不传 signal、`readNdjson` 循环不判活，中途离开
  页面后流仍读到服务端结束、继续写 logs 并触发收尾请求。现在把流消费抽成模块级
  `consumeParseStream`，AbortSignal 贯穿 fetch 与每一拍：判活、中止时 `reader.cancel()`
  关流、不再回调任何 sink；`runParse` 每次新建 controller、卸载时 effect abort，超时
  预算显式放宽到 120s（大包解析不再被 15s 默认超时误杀），中止不当「解析失败」写回。
  ② 解析控制台 `logs.map` 每来一行就把最多 2000 行 div 全量 reconcile，大包解析
  可感知卡顿。现在日志行带稳定递增 `id`、拆成 `memo` 行组件，尾部窗口滚动时已有行
  命中 memo 只渲染新行；`data-log-row` 标记与错误行样式保留（自动滚动定位不回归）。
