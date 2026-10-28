## Fixed

- **远端模型「整份同步」的读、删、写三条语句收进同一个事务**（ISSUE #2586，P1）：
  `src/lib/core/repository-user.ts` 的 `replaceAll` 此前先 `delete` 未给出的条目、
  再批量 upsert 新清单，两条各一次往返、**不在一个事务里** —— 第二条失败时第一条已提交，
  表现是「用户整份远端模型配置消失」，而那些密钥是加密落库的，删掉就找不回来。
  现在三条语句（含那份用于继承 `apiKey` / `workshopAdapters` 的读）都在
  `await db.transaction(async (tx) => …)` 内：运行时这一侧走 `drizzle-orm/libsql`
  → `client.transaction()`，默认 mode `write` ⇒ `BEGIN IMMEDIATE` 且整条事务绑在池里同一条连接
  （规范 §7.6 那条「开机 PRAGMA 只覆盖当时借到的那条连接」的坑顺带避开）。
  **读也搬进事务**是这条单的要害之一：留在外面就还留着交叠窗口，「只包两条写」是单子明文不许的形态。
- **测试宿主换成接得住 async 事务回调的那一份**：`tests/helpers/test-db.ts` 的 drizzle 层
  从 `drizzle-orm/better-sqlite3` 改成 `drizzle-orm/sqlite-proxy`，宿主仍是同一个
  better-sqlite3 实例。原因是后者把事务回调直接交给 better-sqlite3 的 `transaction()`，
  而它不等 promise ⇒ 生产里的 async 事务回调会在第一个 await 之前就 COMMIT，
  **原子性静默失效、账面全绿**（规范 §6.1 记的就是这一格）。换完之后
  `SQLiteRemoteSession.transaction` 是 `await transaction(tx)`，`begin/commit/rollback`
  也走同一个回调 ⇒ 同一份生产代码在测试宿主上拿到的是真事务。
  同步门面一行未动：`$reset` / `$tables` / 六个 `seed*` 本来就打裸实例
  （实测调用点 217 + 75 + 38 处），所以这一格不需要把它们改异步 —— 那正是 #2555
  评估里被当成迁移成本的「高估那一半」。
- **撞锁重试的循环体收成一处**（新增 `src/lib/sqlite-busy-retry.ts`）：同一段八行循环
  此前在 `sqlite-pragmas.ts` 与 `comfyui/executor-write-retry.ts` 各写一遍，
  `replaceAll` 是第三处。抽的是三处逐字相同的那一半（认锁族码、按具名策略退避、
  穷尽或不可重试就原样抛出），**不是** `retryAsync` 那种把域逻辑塞进回调的通用件 ——
  `retry-policy.ts` 文件头反对的正是后者；两处既有站点各自的日志与「摘足迹」善后
  仍留在调用处，由 `onBusy` / `onGiveUp` 两个回调承担。
  新增具名预算 `SETTINGS_DB_WRITE`（3 次、基数 40ms、封顶 200ms）：`BEGIN IMMEDIATE`
  撞锁是**立刻**抛 `SQLITE_BUSY`（Next 侧刻意不给 `createClient({ timeout })`），
  所以等锁预算只能落在重试这一层。
- 用例（本仓第一处事务站点，没有现成锚点，三条都自带反证）：`$sqlTrace` 判
  `begin → select → delete → insert → commit` 整段顺序；语句钩子
  `armStatementFailure` 造「第二条写失败」⇒ 断言已删的行与密钥都还在、且非锁族错误
  只撞一次；造 `begin` 撞锁 ⇒ 按预算重试后一次落定。变异自证：把事务外壳摘掉
  （executor 仍传 `db`、代码形状不变）这三条**全部红**。
