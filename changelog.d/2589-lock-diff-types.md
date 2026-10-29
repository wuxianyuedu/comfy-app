## Fixed

- **脚本档清账批 4：`scripts/lockfile/lock-diff.mjs` 33 格一次清完，账从 259 处 / 19 份降到
  226 处 / 18 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是「依赖哪里不一致」那件答案的
  解析与对比层（`check-deps-freshness` / `launcher-core/worktree.mjs` / `lockfile/diff-cli.mjs`
  三个消费点都走它），此前从没被类型检查过。22 格 `TS7006` 是各函数形参没写 JSDoc，
  剩下 11 格按 #2589 那条口径**逐条判读**，判出来的东西比补类型值钱：

  - **`diffLockfiles` 的 `@returns` 与实际返回的对象是两份答案**（`TS2739` + `TS2339`）。
    它声明的是 `{sectionDiffs, importerDiffs, packageDiffs}` —— 这三个名字在本文件里
    **一个都不存在**；而同一份文件顶部第 77-85 行早就写着一份**如实**的 `LockDiff`
    typedef（`duplicates` / `settings` / `overrides` / `importers` / `packages` / `snapshots`）。
    修法不是新造类型，是**让函数指向它自己文件里那一份权威声明**。
  - **`result.raw = { old: a, new: b }` 是零消费字段，删掉**（`TS2339` 报的就是它）。
    当场数过：三个 `diffLockfiles` 调用点（`check-deps-freshness.mjs:394`、
    `launcher-core/worktree.mjs:319`、`lockfile/diff-cli.mjs:54`）与渲染层
    `render-lock-diff.mjs`（逐字段读 `lockfileVersion`/`settings`/`overrides`/`importers`/
    `packages`/`snapshots`/`duplicates`）**没有任何一处读 `.raw`**。
    反面那条路（把 `raw` 补进 `LockDiff` 声明里）想过并否掉：它让每次 diff 都攥着
    **两份完整解析树**而无人取用 —— 那是「为假想的第二次需要付的钱」那一类（硬规则 24）。
  - **`out.get(name)[m[1]] = unquote(m[2])`**（`TS2538` 那一格）是拿一个 `string` 去索引
    `{specifier, version}`：收窄成正则那两个分支各自赋一次，行为逐字不变。
  - **`for (const [sectionName, key] of [["packages","packages"], ["snapshots","snapshots"]])`
    里那两个名字逐字相同**（`TS2538` 第二格的来路）：这一圈没有参数化任何东西，
    只是让索引键变成 `string | undefined`。展开成两行显式赋值，读起来直接对上字段名。

  批 1 那条「补类型不是纯减法」这次是**提前用的**：`Map.get()` 与正则捕获组在
  `noUncheckedIndexedAccess` / `strictNullChecks` 下都是「可能 `undefined`」，
  所以 `splitTopSections` / `splitTopKeys` / `flatEntries` / `parseDependencyTable`
  的落点在改的同一步里就收窄好（解构默认值 + 一次 `bucket` 取回再判），
  跑完判据**没有冒出新格**（259 → 226 = 正好本文件的 33 格）。

  行为恒等两层证明，不是口头：① 该模块的契约用例 `tests/lockfile-diff.test.ts` 连
  消费者 `deps-freshness-gate` / `ci-install-deps` 共 **67 条绿**；
  ② 端到端拿一份**真有差异**的旧 lockfile（`53bc34bb` 那版，16686 行 vs 现在 16994 行）
  跑 `node scripts/lockfile/diff-cli.mjs --installed …`，HEAD 那一版与本版各跑一次，
  **25 行输出逐字相同**（`[直接依赖] devDependencies（.）共 1 项变化` /
  `[解析结果 packages] 新增 33 项 / 删除 0 项` 那一批），退码同为 1；
  仓库当前那份与安装态那份本来就实质一致，那一跑的输出也两边相同。
  `oxfmt --check` 对这份文件 **HEAD 版就报脏**（它不在格式门禁的扫描面上），
  所以本笔**没有**跑格式化器，只保证自己新增的行不越宽 —— 一跑就是整片重排别人的漂移。
