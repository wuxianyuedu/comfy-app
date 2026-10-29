## Fixed

- **脚本档清账批 18：`scripts/db-push.mjs` 8 格清掉 7 格，账从 27 处 / 5 份降到 20 处 / 5 份
  （ISSUE #2589 / 规范 §13.5.14.1；剩的 1 格是 **ISSUE #2724** 的落点，故意留在账上）**：
  这一份是 `pnpm db:push`（把 drizzle schema 同步进库）的入口。

  清掉的 7 格：`fail()` 的 `@returns {never}`（同一出口在别处一写就少一整族假判空，批 12 那条口径）、
  `countUserTables()` 里 `.get()` 的取值、`run:` 注入点那两个参数的**契约形**（见下）。

  **`.get()` 那一格是本批最值得记的一处**：直觉的修法是 `Number(row?.c ?? 0)`，
  但那是**把「取不到」降成「库里有 0 张表」**——而这个函数唯一的下游就是按「0」去报
  「drizzle-kit 没建表」，两种事实在它那里长成一个样。所以照**原行为**写：
  `if (!row) return -1;`（今天 `.get()` 给 `undefined` 会抛、被外面那个大 `catch` 折成 -1），
  也就是「让类型说出实现本来就在做的事」，不是「让实现迁就一个更宽的默认值」。

  **剩那一格不能靠兜底压**（这才是它值得单列的原因）：内核 `pushSchema` 的注入点声明成
  `run?: typeof runPnpmSync`，于是本文件传进去的 `spawnSettled`（返回
  `{status, stdout, stderr, error: string | null}`）在类型上不合格，报 `TS2322`。
  顺着这条读实现，读出一个真缺陷并立案 **ISSUE #2724（P2）**：

  - 内核实际只读三件 —— `first.stdout` / `first.stderr`（`db-push-core.mjs:210-211`）与
    `first.error`（`:215` / `:221`；第二跑同形 `:271-278`）；**`status`、`ok`、`command`、`args`
    从不被读**。把契约写成「某个具体实现的全部字段」，等于要求每个注入者伪造四个没人读的字段。
  - 后果不是编译期噪声：两个消费点按被声明的那种形状读 ——
    `db-push.mjs:174-175` 与 `db-schema-state.mjs:456-457` 都写
    `${result.error?.code ?? "UNKNOWN"}）：${result.error?.message ?? ""}`。
    而 `spawnSettled` 给的 `error` 是一根 **字符串**（`"ENOENT"` 这种），
    `.code` / `.message` 双双 `undefined` ⇒ 屏幕上成了
    **`起 pnpm 失败（UNKNOWN）：`** —— 原因被丢掉，恰好违背内核自己在注释里立的规矩
    （ISSUE #576：命令没起来必须与跑完但非零分开报，只报退出码等于没说原因）。
  - 所以这一格留着的价值大于清掉它：**它是这个缺陷在账上的证人**。#2724 的期望是
    三件同批（契约改成结构面 + 一份 `describeSpawnFailure()` 让两种形状都说得清 + 两格能红的用例），
    做完时这一格应当**自然消失**，届时按棘轮口径复算确认它掉了（不是 `--update` 顺手抹平）。

  凭据（三条，含一条如实标注的边界）：
  ① `tests/db-push-noninteractive.test.ts` 串行 = **11 条全绿** —— 它这一族是
  **真起子进程**跑 `pnpm db:push` 的（不是 mock），所以注入点、话术分支与退出码都被实际走查过；
  ② ⚠️ **`pnpm db:push` 本身这一轮没有手工跑**：它会改本机库的 schema，不属于「顺手能验」的量级，
  真机面由 ① 那 11 条承担；
  ③ `node --check` 通过、`pnpm exec eslint` 对该文件零输出；棘轮 `--update` 后复算 =
  面 215 / 存量 **20** / **5** 份 —— 其中 `db-push.mjs` 剩 `TS2322×1`（= #2724），
  除此之外本批零残留新格。
