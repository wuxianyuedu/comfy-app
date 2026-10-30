## Fixed

- **`pnpm run docs`（= `node scripts/generate-api-docs.mjs`）不再把坏输入折成一个合法默认值
  然后照常往下跑（ISSUE #2740）**：
  原来 `--out` 后面没有值时，`value()` 写的是 `argv[++i] ?? ""` ⇒ `out` 成了**空串**，
  而 `path.resolve(ROOT, "")` **就是仓库根本身** ⇒ 下一步 typedoc 会以
  `--out <仓库根>` 被起起来，整站产物（本机实测 2844 份文件）写进根上 ——
  而根上那一份**不被 `.gitignore` 忽略**（名单里只有 `docs/api/`），屏幕上却一个字都没说。
  同一族的另外三条也一起有了出口：`--out` 后面跟的是**另一个旗标**（从前把 `--attempts`
  当成目录名吃掉）、`--attempts` 给非数字 / `0` / 带小数点（从前静默沿用默认 3，
  或把 `2.9` 按 2 跑）、不认的参数（从前完全静默）。

  **这正是这份入口当初被改造的那个病的复发**：它的文件头记着换掉裸 `typedoc` 的理由是
  「退出码 0 + 说生成了 + 产物一个没更新」—— 而输入层一直是同一个形状：
  接了一个用不了的值，往下跑，什么都没说。所以：

  - `parseArgs` 改成返回 `{opts, problems}`，**打印与退码只有一处**（`main`），
    退码新增一档：**2 = 用法错**（文件头的用法与退出码表同批改写）。
  - 「以 `-` 开头的下一格不算值」是骨架规则（它修掉的就是「旗标被当目录名吃掉」），
    代价是 `--attempts -1` 会交出**两条都成立的真话**（「没拿到值」+「`-1` 我不认」）——
    用例把这件事写在注释里并断言「≥2 且两句都在」，而不是把代码改成能收负数或把两句话压成一条。
    要写非常规值就用等号形式（`--attempts=-1` 那里恰好一条）。
  - 不认的参数交给**那份既有的**可行动话术 `rejectUnknownArgs`（`db:push` / `db:migrate`
    两个入口已经用它，`command/action/exits` 三件同形），不在这里重写一遍「它认什么」。
  - 再加一道 `main` 里的边界：**解析结果等于仓库根 ⇒ 拒**（显式 `--out .` 是同一后果的
    另一条来路；旗标语法上没毛病，所以这一格不归 `parseArgs` 判）。

- **同批起了「被直接执行才跑」的守卫**（本单的 #2 案，也是它能有用例的前提）：
  `main()` 原来挂在模块顶层，于是 `export` 出去的 `parseArgs` **一旦被 import 就付一次
  真 typedoc 全量生成** —— 这不是推测：本会话为了量旗标行为 import 了一次，
  屏幕上多出 `[OK] html generated: 2844 files`。代价劝退 ⇒ 那一格至今没有执行者，
  这正是它没人判的真因。现在照 `scripts/agent-film.mjs` 的现成写法
  （`process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`；
  `process.argv[1] &&` 那一格不是装饰 —— `node --input-type=module -e` 那种宿主里它是
  undefined，`pathToFileURL(undefined)` 当场抛），并守住
  `tests/script-main-guard.test.ts` 那条「不许手拼 `file://`」。
  **文件头那句「别 import 本文件」整体保留**：守卫解掉的是「一 import 就跑构建」这一层，
  另一层（被 import 的 `.mjs` 会跟着进 typedoc 的类型检查面、它身上的类型错误让 typedoc
  退 3）照旧成立 —— 那里补了一句写明别把它读成「现在可以 import 了」。

  凭据（五条）：
  ① 新用例 `tests/generate-api-docs-args.test.ts` **10 条全绿**，其中三格是本单的骨架：
  「缺值的 `--out` 不再折成空串」「显式 `--out .` ⇒ 退 2 且 stdout 里**没有**那句
  `[INFO] typedoc out:`（它打在真调 typedoc 之前 ⇒ 没出现就等于一次都没起过）」、
  以及**哨兵那条**：起子进程 `import` 这份模块，断言输出里有 `SENTINEL:function` 而
  **没有** `typedoc out`（它钉的是「为什么现在写得动用例」；用子进程而不是本文件里的
  dynamic import，是因为静态 import 早就把模块求值完了，在这里装 spy 只能证明「之后没跑」）；
  ② `tests/script-main-guard.test.ts` 3 条全绿（守卫形态没有走回手拼 `file://`）；
  ③ 脚本档判决面复算 = **面 215 / 存量 0 处 / 0 份文件**（本文件在面上，批 19 清完没长新格）；
  ④ 应用档 `pnpm exec tsc --noEmit` **EXIT=0、0 行报错**（新 `.ts` 用例落在主配置面上；
  第一版有 4 条：`.ts` 里写 JSDoc 型 cast 不生效 ⇒ 断言处 `unknown` 一路漂到赋值，
  加上一个未用的 import 与一个未用的接口名 —— 都按 `as` + `SAFETY` 注释的现成口径改掉了，
  `ExecFileSyncException` 这个类型名在本仓锁的 `@types/node` 里 grep 为 0 命中，
  所以接口就地声明并在注释里给出这句话的检索式）；
  ⑤ `pnpm exec eslint` 对两份文件零输出。
  ⚠️ 一条如实标注的边界：**改完之后没有真跑一次成功路径的 `pnpm run docs`**
  （那是 31s + 2844 份写盘；成功那一面的执行者是 `tests/check-docs-api.test.ts`
  与平台侧「API 文档生成与自检」那格，二者用的是同一份 `typedoc-run.mjs`）。
