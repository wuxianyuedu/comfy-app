## Added

- SQLite 运行时驱动评估结论回写（ISSUE #2579）：`@libsql/client` → `node:sqlite` **换，按四件条件落地**（§6.1 新增结论块，全部探针 + 真构建实测）。语义面逐条站得住：原子领取单语句在 `sqlite-proxy` 下成立、事务是真 COMMIT/ROLLBACK、等锁预算有等价机制且单连接形状下 §7.6 的池坑消失、同步阻塞量级可接受且 libsql `file:` 同为同步执行。收益量出来：standalone 层 9,198 KB / 桌包层 9,397 KB 的 `@libsql` 家族（单 `.node` 8,875,520 B）结构性消失、EPERM 族（硬规则 9）与 §7.3 变体告警族无对象、`@libsql/client` 降级 devDependencies（drizzle-kit 三条链保留）。四件迁移改件：事务 `behavior: "immediate"`、锁码取数面补 `errcode/errstr`、PRAGMA 站点 `exec` 适配、宿主 external 与产物清单减项。主干本单只落结论不落迁移；AGENTS 硬规则 9 与 §5 的 better-sqlite3 旧举例改指 §6.1 结论。
