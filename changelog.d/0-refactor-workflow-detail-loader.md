## Fixed

Refactor `useWorkflowDetailLoader` (workflow editor subgraph navigation):
- 修复嵌套子图宿主链双重前缀：原本 `pushSubgraphStack` 把已拼接的完整链再拼到
  prev 上，导致第 2 层存成 `4:4:5` 而非 `4:5`，与 comfy-cli 展开后的真实节点 id
  错位，子图内所有拖拽坐标退回原始值。现调用方直接传完整链、只追加。
- 把退出子图的重拉逻辑移出 state updater，避免 React StrictMode 双调用 updater
  时重复发请求；改用 `stackRef` 镜像在 updater 外读取最新栈。
- `forceReload` 的 `sessionStorage.clear()` 收敛到本应用 `wfdetail:*` 命名空间，
  不再清空整个 origin 的 sessionStorage。
- 抽取 `readCache` / `writeCache` / `purgeStaleCache` / `clearWorkflowCache` /
  `applyDetailState` / `commitDetail` 辅助函数，消除三处重复的 set-state 块，
  缩短 `fetchDetail`；`withTimeout` 收尾清理定时器避免泄漏。
- 删除注释里的版本变更流水（历史流水），符合规则 #12。
