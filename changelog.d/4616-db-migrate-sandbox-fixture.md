## Fixed

- **db-migrate 用例不再挪动真仓库 `drizzle/` 目录（#4616）**：旧夹具为造「前提不成立」把被 git
  跟踪的 `drizzle/` 整体 rename 成 `drizzle.test-bak-<pid>`，恢复只挂在 afterEach —— 进程死在恢复前
  就永久丢目录（实测留过 15 个 `D` 与孤儿备份、拖红三组用例），Windows 上目录 rename 又常被句柄
  占用判 EPERM。现改为 `scripts/db/db-migrate.mjs` 新增 `COMFY_DB_MIGRATIONS_DIR` 测试指路覆盖口
  （相对路径按仓库根解析；生产链路不设它、行为不变），用例把迁移目录指到临时沙箱（目录在、无
  `.sql`，比「目录不在」更严一格），真目录全程只读，并在用例里断言真目录与无孤儿。
- **跨文件独占锁随之退役**：删 `tests/helpers/repo-drizzle-lock.ts` 与两个 db-migrate 测试文件的
  取锁/放锁逻辑 —— 它只为「挪走 vs 在场」的冲突而生，挪走这条路没了。
- **固定结构兜底（#4616 期望③）**：`tests/check-file-structure.test.ts` 新增两条 —— 仓库根不许
  出现 `drizzle.test-bak-*` 孤儿备份；被 git 跟踪的 `drizzle/` 迁移文件必须真的在工作树里。
