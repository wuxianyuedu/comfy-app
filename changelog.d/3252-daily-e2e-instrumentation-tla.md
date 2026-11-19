## Fixed

- **每日档 `全量E2E` 的 `next start` 不再在 instrumentation hook 里抛 `Class extends value undefined`（ISSUE #3252）**：
  根因是 `src/server/db.ts` / `src/server/workshop/db.ts` 顶层的 `await applySqlitePragmas(...)`——
  带顶层 await 的模块被 Turbopack 编成 async module，而 `db` 经 `repository-base` 是全部
  `class X extends DrizzleRepository` 的基类来源；async module 下子类的 `extends` 会抢在基类
  导出注册前求值，拿到 `undefined`。第 6 步 `db-push` 建表后，instrumentation 的 `resumeStalledFilms()`
  不再被 `isSchemaReady()` 短路、真正加载 film/repository 图时才触发，webServer 因此 180s 超时。
  修法：PRAGMA 初始化收进 `~/lib/sqlite-pragmas` 的新共用出口 `gateProxyWithPragmas(handle)`，
  把初始化 promise gate 在 drizzle 的 `RemoteCallback`（本就返回 Promise）里——模块同步导出，
  每条查询仍在 PRAGMA 就位（含 #1282 撞锁有界重试）之后才跑，语义一字不减。
  `tests/sqlite-pragma-sites.test.ts` 新增一条形状判据钉住「Next 两处 db 模块不许顶层 await」，防回潮。
