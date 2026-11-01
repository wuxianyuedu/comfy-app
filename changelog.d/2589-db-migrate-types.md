## Fixed

- **脚本档清账批 21：`scripts/db-migrate.mjs` 4 格清零，账从 8 处 / 2 份降到 4 处 / 1 份**
  （ISSUE #2589 / 规范 §13.5.14.1）：这一份是 `pnpm db:migrate`（把 `drizzle/*.sql` 应用进库）的入口，
  与批 18 那份 `db-push.mjs` 是同一条链上的姊妹件 —— 所以这一批**照它已经落地的判法写**，
  不另立第二种口径。

  清掉的 4 格：

  - `fail()` 的 `@returns {never}`（批 12 / 批 18 同一条：这一句之后没有「继续跑」这条路，
    少了 `never` 就会在调用点长出一族假判空）。
  - `countUserTables()` 里 `.get()` 的取值。这一处的修法**不是** `row?.c ?? 0`：
    那会把「驱动/连接不对」降成「库里有 0 张表」，而这两件事正是这个入口下游要分开的
    （`afterTables <= 0` 那一支的话术要靠 `run.error` / `started` 才分得开是哪种故障）。
    照原行为写 `if (!row) return -1;` —— 今天 `row` 是 undefined 时 `row.c` 会抛出去、
    被外面那个 `catch` 折成 -1，所以这是**让类型说出实现本来就在做的事**，不是让实现迁就默认值。
  - `appliedMigrations()` 里同形的两处：`exists` 判空、以及
    `db.prepare(…).get().c` 那一格把 `.get()` 的结果先取进局部变量再判
    （原来是链式一行，取不到就直接抛、被 `catch` 折成 -1；现在写在类型上也还是 -1）。
    这里的 `0` 与 `-1` 是两种事实：**0 = 账本表在、里面一条迁移都没跑过**，
    `-1 = 读不到**这个数**` —— 折成一个就没了回头路。

- **一处「看着像缺陷、当场核过不是」的负结果**（写下来是为了让下一个人不必再查一遍）：
  这个文件的失败话术里也有 `${run.error.code ?? "UNKNOWN"}）：${run.error.message ?? ""}`
  这一串，形状与 ISSUE #2724 报的那两处逐字相同，一度读成「#2735 的清点漏了这第三处消费点」。
  核了产出者才分得开：这里 `run` 来自 `runPnpmSync`（`scripts/launcher-core/shell.mjs:257-258`
  声明 `error: NodeJS.ErrnoException | null`），**读 `.code` / `.message` 正是那份声明的形状**；
  而 #2724 那两处的问题是「内核声明收 `typeof runPnpmSync`、调用点实际注入的却是
  `spawnSettled`（`error` 是一根字符串）」—— 那个注入缝在本文件里没有。
  ⇒ 同一行代码在两个文件里一个是缺陷、一个不是，**差别在谁生产那个值，不在那一行长什么样**。

  凭据（四条）：
  ① `tests/db-migrate-equivalence.test.ts` **7 条** + `tests/db-migrate-noninteractive.test.ts`
  **10 条** = 合跑 **17 条全绿**（各跑与合跑都是 EXIT=0）—— 后者含「判定依据是库里的真事实（表数 + 账本），不是
  drizzle-kit 的退出码」与「绝对临时库 + 真 `drizzle/` → 迁移真的落地」两条，
  即这两支函数在**真 sqlite** 上被走过（成功那一支）；
  ② ⚠️ **`-1` 那一支没有用例**：它是「`.get()` 取不到」这条结构性不可达的守卫，
  本批只保证它与原行为同形（原来抛出、被 `catch` 折成 -1），没有为它新造夹具；
  ③ 棘轮 `--update` 后复算 = **面 215 / 存量 4 / 1 份**（只剩 `git-dir-literal-scan.mjs` 4 格），
  本批零残留新格；
  ④ `node --check` 通过；`pnpm exec eslint` 对该文件零输出。
