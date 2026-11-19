## Changed

- **运行时 SQLite 驱动 `@libsql/client` → `node:sqlite`（ISSUE #3171，按 #2579 的四件条件逐条落地）**：
  三处连接站点（`src/server/db.ts`、`src/server/workshop/db.ts`、`src/lib/comfyui/host-runtime.ts`）
  改为 `DatabaseSync` + `drizzle-orm/sqlite-proxy`，适配层收在一个新叶子
  `src/lib/sqlite-driver.ts`（`prepare`/`setReturnArrays(true)` 的位置数组、`run`/`get`/`all` 四种回调形状、
  `StatementSync.close()`），业务调用点零改动。旧库文件直接可开：文件格式、schema、WAL 全部不变，
  `drizzle-kit push/migrate/studio` 仍走 `@libsql/client`（已降为 devDependencies），迁移路径不动。
  - **条件 1（事务显式 immediate）**：`repository-user.ts` 两处事务加 `{ behavior: "immediate" }`，
    `begin` 变成 `begin immediate`（`sqlite-proxy` 把 behavior 拼进 begin，单连接没有租约，必须一开始就拿写锁）。
    `repository.test.ts` 两条撞锁用例的断言同步钉到 `begin immediate`。
  - **条件 2（锁族字段）**：`sqlite-error.ts` 的 `collect()` 增读 `errcode`（5=BUSY、6=LOCKED）与 `errstr`，
    折回 `SQLITE_BUSY` / `SQLITE_LOCKED` 并把人话并进原因；node:sqlite 的 `code` 恒为 `ERR_SQLITE_ERROR`，
    不补这两个字段，有界重试与现场文案都认不出锁。新增两组用例锁住 errcode 5/6 与 errcode=1 的区分。
  - **条件 3（PRAGMA 站点）**：`SqlitePragmaTarget` 改为 `execute(sql)`（`DatabaseSync.exec` 原样吃字符串）；
    宿主侧等锁预算从 `createClient({ timeout: 250 })` 改成 `PRAGMA busy_timeout = 250`（单连接下覆盖每条语句，
    libsql `file:` 池上「开机 PRAGMA 只落在借到的那条连接」的坑随驱动退场），Next 侧仍不设预算。
  - **条件 4（减项）**：`build-executor-host.mjs` 的 `EXTERNAL_PACKAGES` 去掉 `@libsql/client` ×2；
    `build-desktop.mjs` 的 `mustResolve` 同步移除（否则 `--prod` 安装下构建误红）；应减少的产物清单由
    `check-standalone-contents.cjs` 随 manifest 自动跟随，无手改。`package.json` 把 `@libsql/client`
    移到 devDependencies（`pnpm install --lockfile-only`）。
  - **行为差异与兼容**：整数返回 `number`（与 libsql 同），BLOB 为 `Uint8Array`；`RETURNING` 可用；
    libsql 的 `rowsAffected` 在 proxy 结果里没有，workshop 两处 delete 改读 `changes`（drizzle 的
    `SqliteRemoteResult` 只声明 `rows`，代码里带 SAFETY 注释收窄）；`libsql://` 此前也未被
    `resolveDbPath` 支持（非 `file:` 串按本地路径处理），无行为变化；驱动错误改为同步抛出，
    经 drizzle 的 async 调用仍然是 rejection。
  - **验收读数**：`vitest run` 的 DB 相关 49 份用例 740/740 通过；`tsc --noEmit` 0 错；
    改动的 29 份文件 `oxlint --type-aware --deny-warnings` 0 错；`check:oxlint-zero-rules` 41 条全仓 0 命中；
    `format:check` 与 `format:reformat-guard` 绿（纯格式化文件 0）。真实读写冒烟（建库 → 写 → 读 →
    事务回滚 → 重开库读回）读数：`READ [[1,"kept"]]` / `AFTER_RB [[1,"kept"]]` / `REOPEN [[1,"kept"]]`。
