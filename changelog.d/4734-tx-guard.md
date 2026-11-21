## Added

- **SQLite 事务隔离守卫：`db.transaction` 回调只允许 DB 语句级 await 成为机器保证**
  （ISSUE #4734）。drizzle 的 sqlite-proxy 事务不排队，原子性依赖「回调内只有微任务级
  await」的未成文不变式；一旦混入真实异步（fetch / 定时器 / LLM 调用），其它请求的
  语句会插进同一连接的未提交事务——读到未提交数据、被并进他人事务提交、或嵌套事务
  报错连坐回滚。现于驱动代理层记账事务的开/关窗口，并用 `AsyncLocalStorage` 给事务
  回调的整条 await 链打作用域：事务打开期间，不在该作用域上的语句一律当场抛错
  （响亮失败，不再静默串写）。`~/server/db` 与 `~/server/workshop/db` 两个实例均已
  包上；不变式写入 lib 层规范 §18.10.2；`tests/sqlite-tx-guard.test.ts` 为正反例判据。
