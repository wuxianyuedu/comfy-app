## Fixed

- **`db-push-core` 的注入点契约改成内核实际读的最小面**（ISSUE #2724）：`run?:` 原声明
  `typeof runPnpmSync`（要求注入者伪造 `status` / `command` / `args` 四个内核从不读的
  字段），合法注入者 `spawnSettled` 在类型上不合格（脚本档 `TS2322` 一格故留）。
  契约改成结构形 `RunOutcome`（`{status, stdout, stderr, error}`，`error` 允许
  ErrnoException **或**串）—— 两份现成实现都满足。
- **「起 pnpm 失败（…）」的原因翻译收成一份**：`describeSpawnFailure()`（串用串、
  对象取 `.code`、都没有才 UNKNOWN）—— 此前串形状读 `.code` 双双兜底成 `UNKNOWN`，
  命令压根没起来的原因被丢掉（#576 的形态）。两个消费点（`db-push.mjs` / 
  `db-schema-state.mjs`）同批改用。回归：两种 error 形状的注入档用例各一条，
  断言渲染行出现 `ENOENT` 且无 `UNKNOWN`。
