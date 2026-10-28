## Changed

- **规范新增 §6.1「SQLite 驱动这一族的三条事实，与 better-sqlite3 → `node:sqlite` 这次评估」**
  （ISSUE #2555，评估类单子按「先评估再动手、本单不预设立场」办）：三条读数全部本机实测 ——
  ① 运行时驱动是 `@libsql/client`（`src/server/db.ts` 头写着「Why libsql (was better-sqlite3)」，
  而 `tests/db-backup-wiring.test.ts:180` 断言运行时源码不许出现 `better-sqlite3`，它只剩
  `tests/helpers/test-db.ts` 一处真实 import）；② 删掉它**收不掉** EPERM 那一族 —— 探针显示
  dev server 进程里 mmap 的是 `@libsql/win32-x64-msvc/index.node`（8,875,520 B），而 better-sqlite3
  那份 win32-x64 prebuild 只有 1,989,632 B 且只被测试 worker 载入；③ 「Node 升级触发重编」不成立
  —— v13 随包附带 `prebuilds/`、`allowBuilds` 已是显式 `false`，install 阶段没有可跑的构建脚本。
  **结论：不迁**（收益只剩测试基建少一个 dev 依赖，成本是 `drizzle-orm@0.45.4` 没有 `node:sqlite`
  驱动 ⇒ 要把同步测试宿主换成异步 `sqlite-proxy`，而 `src/lib/core/repository-user.ts:264` 记着
  同步宿主上 async 事务回调会在 continuation 前 COMMIT、原子性静默失效）。
- **同批订正三处把人带偏的旧举例**（这张 P2 单正是被它们带向错误前提的，这就是登记的价值）：
  `AGENTS.md` 硬规则 9 的「better-sqlite3 等原生模块被进程锁定」改成运行时真正 mmap 的那一件
  （`@libsql/win32-x64-msvc/index.node`）；`launch-and-build.md` §3.2 那句同形括号、§5 排障表里
  「任何 pnpm 命令连锁失败：better-sqlite3 `EPERM rename …node`」那一格一并改对；
  `docs/guides/sync-after-pull.md` 把 `better-sqlite3` 当 `allowBuilds`「显式批准」例子的地方
  改成「显式**拒绝**」的例子（并注明为什么）。`docs/generated/` 镜像同批重生成。
- **另立 ISSUE #2579 接替真正该问的那一格**：运行时主驱动 `@libsql/client` → `node:sqlite`。
  成本与收益都在那一张单上（8.5 MB 原生件、§7.3 那批非本平台变体的拷贝告警、宿主 external 三件），
  而 `node:sqlite` 在本仓的可用性从来不是问题（`src/lib/db-schema-ready.ts` 与
  `scripts/db-backup-core.mjs` 已在生产路径上用着）。那张单写明了必须逐条重验的语义清单
  （连接池 PRAGMA 覆盖、`createClient({timeout})` 的等锁预算、驱动错误码与 `TERMINAL_DB_WRITE`、
  drizzle-kit 那一侧、原子领取的单语句 `RETURNING`）与两件不许做的事。
