## Fixed

- **启动编排在「回收 → 清缓存 → 起服务」之间补上有界同步点（#4333）**：
  新增 `waitForPortsFree`（`scripts/launcher-core/port-reap.mjs`），初始启动与
  自愈重启（`restartDevForReason`）都在回收之后、清 `.next` / spawn 之前等待
  端口释放（默认预算 10s）。旧进程未死透时清缓存会 EBUSY、旧 server 还占口
  会让新 Next 顺延 +1 而就绪探测只探原端口（180 秒假超时）——两条失败路径
  都从源头收掉；清缓存失败也不再炸成退出 1，记可行动错误后带现有缓存继续。
