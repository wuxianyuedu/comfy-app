## Changed

- **渲染期重复序列化与索引重建收口（ISSUE #5227 D 档）**：历史详情的原始 JSON 文本、请求/响应读数的 body 与 excerpt 序列化改为按数据引用 `useMemo` 缓存，避免生成秒表每 500ms 重渲时反复 stringify；折叠节点 `rawInputs` 索引、系列组织者`季进度索引`、属性多选的 `value` Set 都改为按依赖缓存，消除每次渲染的无谓重建。D1/D2 此前已有 `useMemo`、D12~D14 已由 #5240 用逐项比较替代 `JSON.stringify`，本轮不重复改动。
