## Added

- **`test.todo` 的消费方判据（`scripts/check-test-todo.cjs`，进 pre-commit D 组）** ——
  ISSUE #1485 盘点 vitest 5 新能力时最后没归宿的四条里，只有它是**静默的**。
  实测（vitest 5.0.3）：`test.todo` 退出码 **0**、不进失败计数，而门禁链跑 vitest
  只看退出码（`run-affected-tests.mjs`，`stdio: "inherit"`，无 `--reporter=json`）——
  一条 todo 就是一份「这件事还没有人做」的声明，零成本且没有任何东西在读它。
  同批的 `tags` / `.only` / `expect.extend` 实测**都是响的**（各跑了对照），
  不配闸门：给一个自己会喊的东西再配文本闸门 = 用一条会静默失效的清单去守一条
  不会静默失效的事实（§12.18）。规范 §11.24。

## Fixed

- **`tests/gate-hint-targets-exist.test.ts` 的条件路径例外表随台账落库失效了，红在 `master` 上** ——
  上一轮（#1570）按 §11.21 / §11.22 把两份消费方台账**落库**（「零站点通过」要由
  「台账在、只是 `consumers` 为空」担保），而 `CONDITIONAL_PATHS` 里那两条
  （`scripts/.annotate-consumers.json` / `scripts/.task-meta-consumers.json`）
  **没有同批删掉** —— 那张表管的是「不存在才是正常状态」，台账一旦入库就成了真文件。
  表现正是本条用例第三问（`existsSync` 必须为 false）报的那句话：
  「该从条件路径例外表里删掉」。按 §13.6.2 在干净 `origin/master` 上复算过，
  同一条判据同一条红，不是本次引入。
- 表因此变成**空的**，而空是它当前唯一正确的状态 —— 所以那条用例里
  `expect(CONDITIONAL_PATHS.length).toBeGreaterThan(0)` **不能留**（会把「表空」判成故障），
  也不能就此跳过（那样「三问被整段删掉」与「表本来就是空的」读数完全一样）。
  改为新增一条负对照用例，把三条判定各反过来走一遍（拿真文件当假定例外项），
  证明机制还在拦 —— 而它拦的正是那两条台账触发过的形态。
  变异核过：把过期例外逐条恢复进表里，本条用例当场红。
