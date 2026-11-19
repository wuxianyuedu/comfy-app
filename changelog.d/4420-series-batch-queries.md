## Fixed

- 整季生成：进度聚合与批量入队的「集镜头清单」改一趟批查（`production` 一次
  IN 取回 + 任务表一次按 `projectId IN` 取回后内存分组），不再每集各发 2 条
  查询——集与集之间本无顺序依赖。逐镜入队保持 `createQueuedForShotIfNoActive`
  的逐镜原子守卫不变（合并成整批事务会改变锁语义与失败粒度，刻意不做）。
  （#4420）
