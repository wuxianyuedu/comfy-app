## Fixed

- **工坊 MCP 桥写 production 改为按列比对合并，跨进程并发不再整列覆盖**（ISSUE #4730）：
  MCP（独立进程）「load 快照 → 慢 IO → 整包写回」的路径会把加载时的旧快照整列写回
  production——AI 跑管线期间用户在界面改稿会被静默回滚；`content-write-lock.ts`
  自述的「跨进程靠字段级 patch / 版本 CAS」与实现不符。
  - `updateState` 新增**变更基线**入参（会话加载时的快照）：写 production 前逐列
    与基线比对，只写会话真正改过的列；shots 改过时按 shotId 与当前 production
    叠加合并（界面新增的镜头保留、会话改过的镜头按锁内后写生效）。
  - 行存在性检查移入 immediate 事务内：会话在慢 IO 期间被删时，在途变更不再把
    旧快照写进 production。
  - 回归测试：界面并发改的剧本列保留、shots 按 id 合并、无变化跳过写、会话被删不写。
