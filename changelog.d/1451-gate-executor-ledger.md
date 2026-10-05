## Fixed

- **「判据在场、但没有执行者」这件事现在有机器判据了**（ISSUE #1451 要求 2 / 规范 §13.5.12）。
  立案现场：`scripts/check-comment-language.cjs` 头部自称「供 `.githooks/pre-commit` 调用」、
  §12.4.6 也写着它在钩子里报红，而 `grep -c comment-language .githooks/pre-commit` 一直是 0，
  CI 又随 ISSUE #623 删除 —— **一条基线为 0 的硬闸一个执行者都没有，而文档说它在执行**。
  这类事故比漏报更难发现：漏报只是判据不响，「自称在跑」会让所有人以为有人在守。
  - 新增 `scripts/check-gate-executors.cjs`，接进 D 组「判据执行者台账」。三向强制：
    ① **判定型**（有 `process.exit`）无执行者 ⇒ 红，除非登记在
    `scripts/.gate-executor-ledger.json` 的按需召唤台账（含「为什么不能进钩子」+「谁按需跑」）；
    ② **报告型**（0 处 `process.exit`）自称「供 pre-commit 调用」⇒ 红（恒 `exit(0)` 的东西
    按定义不该有判定者，那句承诺必然是假的）；③ 台账双向拦（登记了却其实有执行者 ⇒ 红，
    登记了不存在的脚本 ⇒ 红）。
  - 「报告档按定义不判失败」与「判定档没有执行者」被显式分成两件事 —— 以前混在一句
    「没有自动执行者」里，于是「把报告档接进钩子」这种改法（等于接一个恒 `exit(0)`）看起来也对。
  - 执行者口径只认**直接调用**（钩子 / `quality-gate.mjs` / `package.json` / `build-desktop.mjs` /
    `standalone-private-inputs.mjs` / `tests/**`），不做跨文件传递闭包推断 —— 闭包会误报一片、
    也会随重构静默失效。`tests/**` 算执行者：本仓库多条判据的唯一执行者就是契约测试。

- **顺手修掉一处存量硬闸误报**：`check-comment-language.cjs` 把参数名恰为英文虚词的
  JSDoc 结构行判成「英文说明句」—— `@param {string} from` / `to` / `@param {Date} at`
  剥掉类型块后只剩 `from` / `to` / `at`，而它们都在虚词表里。实测全仓 3 处，全在
  `scripts/launcher-core/run.mjs`，而该文件是 `d39ee178`（#1326）带进来的 —— 那时这条判据
  **还没有执行者**（正是 #1451 立案的现场），于是它一路绿到判据被接进钩子，然后拦住
  从 master 分出的每一个提交。修法 = 判据先剥掉「`@tag` + 类型块 + **参数名**」三段
  再判虚词；反向锚点用例守着「参数名是虚词、后面真有英文说明」仍被拦。
  判据语义有变，`RULE_VERSION` 3 → 4、基线重记（仍是 0）。

## Changed

- **`report-ts-duplicate-keys.mjs` 收成判定档 `check-ts-duplicate-keys.cjs`**，接进 D 组
  「TS 重复属性判定」。它判的是「命令行全绿、编辑器标红」那一族（项目钉的 `typescript6` 对
  「对象字面量里属性重复」不报，编辑器 TS 服务报 `ts(2783)`），判据只能落在源码形态上 ——
  正是该有判定档的地方。**实测量产为 0**（1027 文件 0 处），故按**硬闸**落、不走棘轮；
  `--with-tests` 不进判定档（测试里的重复多半是有意夹具）。
- **`tw4-canonical-report.mjs` / `tw4-spacing-canonical.mjs` 各带一个棘轮判定档 `--check`**
  （ISSUE #1451 要求 2）。两者都起 Tailwind 引擎、单次约 6s，判的是「CSS 等价改写」而非
  正确性，故**仍不进钩子** —— 但 03 章那句「新增一批视图文件后按需跑一次」此前**没有任何
  东西在守**（实测教训：storybook 那批一次性带进 96 处 `w-[30rem]`，直到手工跑才浮出来）。
  现在按需跑变成**有判据的**：基线 `scripts/.tw4-canonical-baseline.json` /
  `scripts/.tw4-spacing-baseline.json` 都 `total: 0` 起步（只许新增就红），红了就 `--write`
  落盘 + `--update` 收紧；两者登记在按需召唤台账里。**顺带清掉 7 处 story 文件里的
  canonical 存量**（`w-[32rem]`→`w-lg` 等）与 2 处 spacing 存量（`h-40 w-40`→`size-40`）。
  另修掉 `tw4-spacing-canonical.mjs` 在「被删 token 位于串首」时留下前导空格的缺陷
  （`" size-40"` → `"size-40"`）。
- 测试文件里的 3 处 canonical 候选**全留**（`ViewContainer.test.tsx` 的 `max-w-[50rem]` 是
  「className 里另写 max-w-* 不盖掉档位」那条负样本的本体；`log-panel-layers.test.ts` 的
  `z-[200]` 是「解析器不认任意值」的断言样本）—— 逐处判过，不是「默认不改」。

## Tests

- `tests/gate-executors.test.ts`（进固定清单）：用临时工作区造三个方向各一次现场 ——
  判定型无执行者红 / 报告型自称在跑红 / 台账双向（登记了却有执行者 + 孤儿条目）红；
  外加 D 组那两步的在位判据与旧报告档名的孤儿检查。
- `tests/tw4-canonical-ratchet.test.ts`（进固定清单）：两份棘轮基线的形状（`total` 与按文件的账
  一致、必须为 0）、`--check` 判定档在位（不许被改成只提醒）、`--update` 语义、台账登记。
  为什么不真跑 `--check`：6s×2 而这条每次提交都执行，守的是静态事实，读文本足够。

## Docs

- 规范新增 §13.5.12「判据 ⇄ 执行者的双向判据」：两类形态的区分、三向判据、执行者口径、
  当前台账，以及「别为了让 `--check` 变绿去放宽基线」。
- §13.5.3 表补两行（canonical 棘轮 / `report-ts-duplicate-keys` 的处置）；§13.5.4 记下
  「canonical 候选 → `@` 跑」这一行随 #1451 摘掉、换成棘轮判据。
- 03 章「spacing canonical」段：把「按需跑一次」的人为提醒换成棘轮判据（含两条 `--check` 命令）。
- §13.1 的 `✅` 命令全表补两步（那份表由 `doc:check` 双向核与钩子一致）；
  `docs/guides/DEV-QUERIES.md` 的旧报告档名更新；`docs/generated/**` 重渲染。
