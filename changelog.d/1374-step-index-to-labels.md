## Changed

- **文档不再用「第 N 步」引用提交门禁步骤，改用钩子日志里打印的标签**（ISSUE #1374，签字口径
  =「删序号、留标签」）。原因是这个编号体系**没有定义**：钩子早已是「组 0 + A/B/C/D 四个并行组」，
  而同一批文档混着两种口径（「branch-guard 算第 1 步」与「判据从第 1 条起算」）。
  立案时逐条实测的错位（基准 = `grep -n '^  run "' .githooks/pre-commit` 的行序，D 组共 26 条）：
  `check-title-bar-clearance.cjs` 写作「第 3 步」而它是第 4 条、`check-ui-logic-separation.cjs`
  写作「第 3 步」而实际第 5 条、`check-app-port-vectors.cjs` 写作「第 11 步」而实际第 8 条、
  `check-ui-primitives.cjs` 写作「第 12 步」而实际第 9 条、`check-overlay-z.cjs` 写作「第 27 步」
  而实际第 22 条、`render-doc-placeholders.cjs --check` 写作「第 26 步」而实际第 21 条；
  **另有三处（§12.17 / §18.8）把 C 组固定清单里的用例称作「pre-commit 第 23 步」——那里根本没有
  序号可言**。序号引用没有任何判据核，所以每给 D 组追加一步就整体错位一次：**表现不是红，
  是指到别的判据上**，比找不到更糟。
- 改写的 **33 行**（`git diff -U0 | grep "^-" | grep -c "第 [0-9]* 步"` 的读数）分布在 9 个文件：
  `docs/standards/12-*.md` 12、`13-*.md` 8、`16-*.md` 3、`AGENTS.md` 3、`launch-and-build.md` 2、
  `18-*.md` 2、`17-*.md` 1、`03-*.md` 1、`docs/README.md` 1；`docs/generated/**` 里 7 份同名产物
  由 `pnpm doc:render` 重渲染。
  **`changelog.d/**` 与 `CHANGELOG.md` 一个字没改** —— 那里还有 26 份碎片共 43 行写着旧序号，
  但碎片是当时那次变更的账本（§13.10.5），里面的序号是历史事实，回头改写等于伪造证据；
  这条边界由用例「历史碎片不被扫」钉（见 Verified）。
- §12.8「提交防线」那段原本按「第 1/2/3/4/5/12 步」顺述钩子，现改成按**标签**顺述，
  并写明钩子的组形状（A/B/C/D + 组 0）。同段顺手订正一句更老的假话：它写「该脚本带 `--strict`
  接入 `.githooks/pre-commit` 第 2 步——R5 由『只提醒』升级为棘轮」，而本地这一步**不带** `--strict`
  （标签里就写着「R5 只提醒」），带 `--strict` 的那半边随 `.cnb.yml` 删除后**当前无自动执行者**
  —— 与 §13.5.3 登记表和钩子里的 ⚠️ 标注对齐。
- §13.5「谁在跑什么」表里那 5 行「CI 第 N 步」改成按**职责**记（「全量单测 + 覆盖率那一步」等）：
  `.cnb.yml` 已随 ISSUE #623 删除，那些序号连主人都不在。
- `docs/reference-facts.md` §3.6 那句「守卫**不进** `.githooks/pre-commit`——与现有 `doc:check`
  同层『按需召唤』」是 #1371 之前的旧口径，已按现状改正（`doc:check` 现在就在 D 组），
  并新增 §3.7 记这条引用口径。

## Added

- `scripts/check-doc-references.cjs` 的 `checkGateStepIndexRefs()`（= `pnpm doc:check`，
  已在 pre-commit 的 D 组「文档引用与权威源一致」）：同一行既要出现 `第 N 步`（含 `第 27/28 步`
  这种 range 形态），也要出现 `pre-commit` / `.githooks` / `CI`，才报错。
  **有主人的过程序号**（§2.2 的第 5 步、`prepare-local-run.ps1` 的第 3 步）因此不受影响；
  描述这条口径本身的句子带纠正词（不写 / 别再 / 禁止 / 应写 / 一律 / 改成 / 序号 / 已删 / 历史）即豁免。
  遍历集合 = `AGENTS.md` + `docs/README.md` + `README.md` + `docs/reference-facts.md` + `SCOPED_DOCS`。
  前四份都不在 `SCOPED_DOCS` 里（AGENTS 无占位符、两份索引不在 `docs/standards|guides` 扫描面、
  登记表由 `ASCII_ONLY_FACT_DOCS` 而非 `SCOPED_DOCS` 读），而「哪条判据在哪跑」恰恰写在它们身上 ——
  与 `checkLedgerCommands` 同一手法显式并入。
- `tests/check-doc-references.test.ts` 新增一组（9 条）：判据已接入 `main()`、扫描面存量 = 0
  （带「解析到 >20 份文档」的防空转断言）、种一条会红且点名行号与标签形态的改法、
  AGENTS.md 与 `docs/reference-facts.md` 两份「不在 SCOPED_DOCS 里」的覆盖面各自有探针打到、
  纠正词豁免、过程序号不误伤、`changelog.d` 不被扫、「量具自己没坏」。

## Fixed

- **同族第三处「假判据」**：`tests/check-doc-references.test.ts` 里四份「已接入 main 流程」的用例
  此前写的是 `expect(mainBody).toContain("checkX()")` —— 把那一行前面加 `// ` 注掉之后**它仍然绿**
  （注释行里也含同一段字面量），也就是「接入判据」自己是个假判据。现收成 `isCalledInMain()`：
  要求那是一行独立语句（行首只有缩进、行尾是分号），并补一条「量具自己没坏」的对照用例
  （同形状的 wired / muted 两段源码，前者判真、后者判假）。这与 §13.5.8 末尾那条
  「在场判据要解析、不要 `toContain`」是同一条纪律的第二个载体。
- §13.5.8 里「`tests/affected-tests.test.ts` 钉住（17 条）」→ 20 条（#1372 已改，本轮无回退）。

## Verified

- **先证明判据不是死的**：在已登记文档末尾种一行「该判据在 `.githooks/pre-commit` 第 99 步。」
  ⇒ 真实退出码 1，原文
  `[doc:check] ✗ [docs/guides/DEV-QUERIES.md:103] 用「第 99 步」引用门禁步骤 —— …请改写为标签形态…`；
  还原后 0（`git status` 该文件干净）。
- **先量存量再挂闸**：改写完成后扫描面上「序号 + 门禁同行」的真引用 = 0，`doc:check` 绿。
  残留 3 行是**描述本条口径自身**的句子（各带「序号」纠正词，按设计豁免），
  由用例「扫描面上每条这类行都必须带纠正词」逐行核；另有过程序号 26 行
  （`docs/guides/sync-after-pull.md`、`launch-and-build.md`、§13、登记表的举例行）——
  判据的「同行必须出现门禁关键词」把它们天然排除。
- **判据会抓到自己**：新写的 §13.5.10 / §3.7 正文里那句举「§2.2 第 5 步」作例子的句子
  **第一次跑就红了**（同一物理行同时含 `pre-commit` 与 `第 5 步`），把例子挪到不含门禁
  关键词的那一行之后才绿。这既是有效性证据，也暴露了一条边界：**豁免是按物理行的关键词，
  不是按句子语义** —— 同一个意思换行排版就会从豁免变成命中（口径已写进 §13.5.10）。
- **变异（两种都要红）**：① 把 `main()` 里那行调用删掉 ⇒ 「已接入 main」+ 两条种桩用例同时红；
  ② 保留那行、前面加 `// ` 注掉 ⇒ **修复前一条都不红**（就是这条洞本身），修复后红 3 条
  （`已接入 main 流程` + 两条种桩）。还原后 38 条全过（本组 9 + 原有 29）。
- `pnpm doc:render` + `render --check`（30 份一致）+ `doc:check` 绿；
  `pnpm check`（eslint 零警告 + `tsc --noEmit`）过；prettier 只点名本次改的文件。
- 端到端：本条提交经过 pre-commit 的 D 组「文档引用与权威源一致」执行本判据
  （输出里 `── check: 文档引用与权威源一致`）。
