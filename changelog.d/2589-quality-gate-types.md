## Fixed

- **脚本档清账批 14：`scripts/quality-gate.mjs` 11 格清零，账从 66 处 / 9 份降到 55 处 / 8 份
  （ISSUE #2589 / 规范 §13.5.14.1）**：这一份是门禁档位的调度器（`pnpm check:all` 的执行者）。
  4 格 `TS7053` 全指向同一件事：`GATES` 是十个条目的字面量，而取它用的是一个
  **来自 argv 的 string** —— 在字面量类型上按 string 索引，取到的类型是 `any`，
  于是 `GATES[k].run !== false`、`GATES[k].label` 这些**从来没被判过**。
  建 `Gate`（当场数过：十个条目的键只有 `label` / `args` / `run` 三个，没有第四个）
  并把表收成 `Record<string, Gate>` 之后，取回的类型如实成了 `Gate | undefined`
  —— 于是**批 13 那条口径在这里第二次用得上**：

  `main()` 早就有一句「未知门禁 ⇒ 退 2」的存在性判据，而 `runGate(pnpm, key)` 自己又按
  `string` 索引一次，拿回 `Gate | undefined` 并在 6 个使用点上炸（8 格新账）。
  修法不是在这里补 `!`，而是**把解出来的那份交给执行者**：`main` 里把校验循环改成
  「先解一次成 `plan`（`Array<{key, gate}>`）」，`runGate(pnpm, key, gate)` 收参数 ——
  话术、返回码 2、以及「先全量校验再跑依赖预检」的顺序都没变，只是**判据与类型看到同一份事实**。
  同理 `defaultKeys` 从 `Object.keys(GATES).filter(k => GATES[k].run !== false)` 改成
  `Object.entries(GATES).filter(([, gate]) => …)`：遍历表本身，而不是「取键再按键取回」。

  另外 3 处按既有口径：`invocation(…)` 从打平成数组改成回 `{command, args}`
  （打平之后 `const [command, ...]` 首项在类型上是 `string | undefined`，而 `spawnSync` 首参要
  `string` —— 这一格是 `gate.args` 有类型之后现形的）；`gate.args[0]` 那三处按索引取改成
  解构一次（原来 `?? ""` 只喂了正则、`path.basename(…)` 那处并没有被它保护，而空串本来
  也匹配不上 `\.(?:c|m)?js$`，所以覆盖面逐字相同）；`result.error.code` 收成一次
  `NodeJS.ErrnoException` 局部判型。

  **顺手撞出一张新单（ISSUE #2709，P2）**：我要取「未知门禁」那一格的读数，敲的是
  `--mode=nope`（等号形式），结果它**不报错、也不按名跑那一档，而是静默把整套默认档跑完**
  —— 包括 `vitest --coverage`，10 分钟被我停掉时已输出 1209 行。根因是
  `parseArgs` 只找 `argv[i] === "--mode"`：等号形式落不进任何分支，`mode` 保持初值 `"all"`。
  对照组同时刻成立：`--mode nope` ⇒ 退 2 + 念出可选档名；`--mode depsFreshness` ⇒ 退 0 只跑一档。
  修法与先例都在仓里（#2096 `db-migrate` 拒绝未知入参），**本笔不动取数**，只立案。

  凭据（四条都跑了）：
  ① 三份用例串行 = **28 条全绿**（`tests/quality-gate-fail-paths.test.ts`、
  `tests/commit-gate-tier.test.ts`、`tests/quality-gate-ps-precheck.test.ts`）；
  ② 真机两支各走一遍：脚本支 `--mode depsFreshness` → `[ok] Dependency freshness …` +
  `[ok] 一键门禁（1 档全绿）`、`EXIT=0`；未知档名 `--mode nope` → `EXIT=2` 且念得出可选清单
  （正是被这次参数改动经手的那两格）；
  ③ pnpm 支的凭据来自上面那次误跑的**前半段**（同一条被改过的 `invocation` 路径）：
  `>>> …node.exe …pnpm.mjs typecheck` → `[ok] Typecheck (tsc --noEmit)（通过）`、
  `>>> …pnpm.mjs run lint` → `[ok] ESLint zero error / zero warning（通过）` ——
  命令行回显与判决行都对得上，只是那次多跑了我没打算跑的档（已另立 #2709）；
  ④ `node --check` 通过、`pnpm exec eslint` 零输出；棘轮 `--update` 后复算 = 面 214 /
  存量 **55** / **8** 份（本批零残留新格，没有借 `--update` 登记任何新增）。
