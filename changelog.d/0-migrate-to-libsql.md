## Changed

- **`better-sqlite3` → `@libsql/client`（生产运行时改异步驱动）**：
  `src/server/db.ts`、`src/server/workshop/db.ts`、`scripts/heal-db.cjs`
  三个入口从 better-sqlite3 的同步 API 换成 `@libsql/client` + `drizzle-orm/libsql`
  的异步 API。同一份 SQLite 文件（`file:./db.sqlite`）、同一份 schema、
  同样两条 pragma（`journal_mode = WAL` / `foreign_keys = ON`）；模块顶层
  `await client.execute(...)` 让首次查询前一定就位，`server-only` 保证不落
  客户端图。
  **动因**：MEMORY 的性能诊断把 `workflow.list`（fs.readdirSync + 递归
  statSync + 逐行 parse rawJson）与「同步驱动 → 慢 SQL 会钉住整个 Next
  server 事件循环」列为并列的 P0-9 病灶。worker_threads 方案要在 worker
  边界重造 RPC/序列化，事务/游标语义都得重新对齐；libsql 是更小的改动面 ——
  只换驱动、不改 schema、不动 drizzle API 形状。**测试基建保留
  better-sqlite3（转 devDependency）**：`tests/helpers/test-db.ts` 依赖同步
  `.prepare().all()/.get()/.run()` 做内存库 seed 与 `$tables` 同步断言，
  换异步会牵动 ~57 个测试文件、且测试环境本就没有事件循环阻塞问题；
  `tests/helpers/trpc.ts` 的 `TestDb` 类型改指 `LibSQLDatabase<typeof schema>`
  （drizzle 两个适配器都继承 `SQLiteDatabase`，运行时结构兼容、经 `as unknown as`
  桥接）。
  **顺手清理**：`src/server/workshop/repository.ts` 与
  `src/server/workshop/draft-repository.ts` 里 `deleteSession` / `deleteDraft`
  返回的 `result.changes`（better-sqlite3 `RunResult` 字段）改为
  `result.rowsAffected`（libsql `ResultSet` 对应字段）。
