## Fixed

- **脚本档清账批 17：`scripts/check-pnpm-available.mjs` 9 格清零，账从 36 处 / 6 份降到
  27 处 / 5 份（ISSUE #2589 / 规范 §13.5.14.1）**：这份是 `pnpm check:toolchain` 的**薄壳**
  （判据全在 `scripts/launcher-core/` 与 `node-engines.mjs`，这里只管打印与退出码）。
  9 格里最要紧的一格不是「补个注解」，而是**一条已经写好的话术永远不会被念**：

  `collectDependencyFloors()` 给的是可分辨联合 `{ok:true, floors, resolvedCount} | {ok:false, reason}`
  （5 条失败路各带一句 `reason`，逐条行号见新单），而壳层写成
  `collectDependencyFloors(root).floors ?? []` —— 类型上报
  `TS2339 Property 'floors' does not exist on type '… | {ok:false; reason:string}'`，
  也就是**代码在一条它没处理的支上取字段**。把它窄成
  `floorCollection.ok ? floorCollection.floors : []` 之后（**行为一字未动**），
  顺出来的因果是：内核 `describeNodeAgainstFloor`（`node-engines.mjs:356-363`）对采集失败
  **本来有正确出口** —— 产出 `{ok:false, kind:"unparsable", reason}`；而本文件下面**恰好有一条
  处理 `kind === "unparsable"` 的 WARN 话术**。壳层把失败折成 `[]`（一个非 `undefined` 的值）
  ⇒ 内核那句 `if (!floors)` 不成立 ⇒ 传播被跳过 ⇒ **那条 WARN 对「依赖侧没采到」这个输入
  结构上不可达**。已立案 **ISSUE #2722**（P2）：修法是把这一格交回内核
  （失败时传 `undefined`），不是新写一条话术。原地留了一句注释指向它。

  其余 8 格按既有口径：旗标缺值 / 下标读取在**产生端**收（`--deps-root` 那一处取进局部再判）；
  `say` / `sameVersion` 的形参按**调用点真正喂的东西**收（`sameVersion` 两个入参都可能是
  `null`/`undefined`，所以声明成可空而不是在使用点上判）；版本目录比较那圈逐段
  `?? 0`（与它上面 `.map(… || 0)` 同一个默认值，不是新逻辑）；`violated?.join()` 同理。

  **第八次「补类型不是纯减法」**：`say` 的 `message` 收成 `string` 之后，
  `if (result.repaired || result.tip) say("[INFO]", result.tip)` 现出 `TS2345`
  （`tip` 是 `string | null`）—— 这一格的真相不是「少个判空」：条件成立而 `tip` 为 `null` 时，
  今天的行为是把字面词 `null` 当一行提示打出去（`[INFO] null`）。条件改成只看 `tip`
  （**有 tip 才念**，`repaired` 本身在这不带来任何可读信息）。这一处**是本轮唯一一处输出形状的变化**，
  且只发生在「`repaired` 为真而 `tip` 为空」这一格 —— 按本仓口径如实写在这里，不藏进「零行为变化」。

  凭据（三条都跑了）：
  ① 两份相关用例串行 = **2 份文件 / 149 条通过、13 条按档跳过**
  （`tests/ci-toolchain-selfcheck.test.ts` + `tests/dev-launcher-toolchain-gate.test.ts`），
  其中直接盖到本次改动的两格是：
  「check:toolchain 在低版本 Node 下 WARN 并点名坏的是哪一档，但退出码仍 0」与
  「当前 Node 合规时打 OK 行（这句是上面那格的对照组）」—— 正是 `floors` / `violated` 那两行的正反两支；
  ② 真机 `pnpm check:toolchain` 全跑一遍：`EXIT=0`，逐行照旧
  （`[OK] pnpm 可用：12.4.1`、`[INFO] 选中的 pnpm：…`、`经 JS 入口执行：…`、
  `[OK] 版本与 package.json 的 packageManager 一致（pnpm@12.4.1）`、
  `[OK] Node 26.12.1 在声明范围内（engines.node = >=26.12.1）`、
  `[OK] node_modules 已装 …`）；
  ③ `node --check` 通过、`pnpm exec eslint` 对该文件零输出；棘轮 `--update` 后复算 =
  面 215 / 存量 **27** / **5** 份（本批零残留新格，也没有借 `--update` 登记任何新增）。
