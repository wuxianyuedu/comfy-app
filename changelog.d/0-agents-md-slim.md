## Changed

- **AGENTS.md 结构梳理：事故叙事下沉 standards，AGENTS 只留硬约束与路由**（Better Harness
  就绪度评审 F1/F2 的根因项）：337 行的 AGENTS.md 里，23 条硬规则有 12 条承载了与
  `docs/standards/` 高度重合的事故复盘叙事（launch-and-build §2.1/§3/§5/§7/§8/§9.5/§9.6、
  12 §12.11–§12.14、18 §18.3/§18.4、13 §13.6.1 全部预验证覆盖），双源同步是规范改了
  AGENTS.md 忘同步（就是 F1 CI 表述漂移那一条）的结构性诱因。本次把「快速排障」6 段场景
  压成一段指针路由，规则 3 / 6 / 11 / 12 / 16 / 17 / 18 / 19 / 20 / 21 / 22 / 23 逐条压成
  「一句红线 + 一句判据 + 指向 standards 具体章节」，其他规则、必读、范围表、维护约定保持
  不变。目标体量从 337 行降到 ~190 行。**动手前先跑了一次跨文件事实覆盖率核查**，发现并
  顺带修了三处：（1）§18.2 尾注的示例路径 `src/lib/workflow-io-types.ts` 与 AGENTS 上一 PR
  的同类漂移一致，真实路径是 `src/lib/workflow/workflow-io-types.ts`，同步修 standards；
  （2）§5 排障手册的「模块级副作用先判就绪」那行只描述了行为、未点导出函数名，补齐
  `isSchemaReady()`；（3）§5「`.env` 三项非空 → `env-preflight.mjs`」那行漏登记同族的第二条
  预检 `scripts/db-schema-state.mjs`（哨兵表预检），补上。**顺带删掉规则 12 里的一处事实错误**：
  原写「`.sh` 会被 R7 拦下」，但 `check-file-structure.cjs:171` 的 pattern
  `/\.(bat|cmd|vbs)$/i` 实际不覆盖 `.sh`，`.sh` 事实上无任何门禁——该断言既无 standards
  背书、又与实现不符，从 AGENTS.md 中直接删除（不移植到 standards，因为不真）。
