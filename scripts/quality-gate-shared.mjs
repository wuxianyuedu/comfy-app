#!/usr/bin/env node
/**
 * quality-gate-shared.mjs — 质量门禁的**共享常量**（规范 11.12）
 *
 * 已知基线失败清单只有一处来源：先前它写在 `scripts/quality-gate.ps1` 里，
 * `scripts/run-tests.ps1` 用正则去解析那份 PowerShell 源码。两份实现（PowerShell
 * 与 Node）都要读同一份清单时，从 `.ps1` 源码里解析就等于把「另一门语言的文件」
 * 当成数据源 —— 改一次缩进/写法就会让解析静默返回空数组（排除项悄悄失效，
 * 红/绿不再可归因）。因此清单搬到本模块（纯数据、零依赖），两侧都 import。
 *
 * 登记的判据与代价（规范 11.12）：只放「确证与本次改动无关的历史基线失败」，
 * **每一条都要写明归属与谁来修**；修好就立刻删（留着 = 永久静默跳过，退化不会再
 * 被发现）。粒度是**文件**，所以一条红会连同一文件里其他断言一起放行 —— 这是这套
 * 机制已知的粗糙处，登记前先确认那条门禁在别处还有没有更强的执行者（下面每条都注了）。
 *
 * 当前清单为空。更早一次清空的是 4 个文件（`tests/check-file-structure.test.ts`、
 * `tests/dev-launcher-toolchain-gate.test.ts`、`tests/dev-launcher-downstream-exit.test.ts`、
 * `tests/turbopack-tracing-excludes.test.ts`）逐个串行复跑全部为绿：前两个的根因由
 * #1168（陈旧壳判据措辞与用例回正 + splash 三副本同步）与 `11f302e7`（四类根因分治）
 * 修掉，第四个的产物侧断言在无 `.next/standalone` 时按既有设计自行跳过。它们
 * 修好之后一直留在这份清单里 —— 粒度是**文件**，于是门禁回归套件与三条线的用例
 * 被整批从增量层摘掉（比红更糟：红会挡住提交，静默跳过什么都不会说）。
 * （同批被摘的 `tests/theme-token-single-source.test.ts` 已由该线自己删登记，本刀不重复。）
 * 最近一次登记与删除见下方 `KNOWN_FAILED_FILES` 的注释（ISSUE #1282）。
 *
 * 再要登记前先做两件事：① 按规范 §13.6.2 复算 master 基线（`git worktree add
 * ../.wt-base-check cnb/master` 后在干净基线上跑同一条判据），确证是别线的红、
 * 不是本次改动引入；② 想清楚那条门禁在别处有没有更强的执行者（粒度是文件，
 * 一条红会连同一文件里其它断言一起放行）。修好后**立刻删**，别让它长期静默。
 * ⚠️ 这条纪律现在**不再只靠人记得**：`scripts/check-known-failed-stale.mjs`（pre-commit
 * D 组）会判两头 —— 登记项必须指向真实文件（否则排除项永远匹配不到），且必须真的
 * 还红着（全绿即判「登记已过期」并要求删除）。规范 §11.12 第 3、4 条。
 */
/**
 * @type {string[]}
 *
 * 空数组（终态）。上一次登记是 `tests/theme-dark-token-cascade.test.ts`
 * （2026-10-05 登记 → ISSUE #1282 处置后删除），它留下的教训值得单独写在这，
 * 因为**登记时写的那条理由本身就是错的**：
 *
 * 登记词写的是「`.bg-card` 那条规则没出现在固定输入源的产物里」，据此判定「不是
 * 『断言依赖的类没被固定住』那一类，而是 globals.css 侧 utility 生成路径变了」。
 * 复算后发现两头都反了：产物里 `.bg-card { background-color: var(--color-card) }`
 * 一直在（`PINNED_UTILITY_CLASSES` 也一直点着它），真因是**判据自己的白名单漏了
 * 第三种拼法** —— 正则写的是 `var\(--(card|color-surface)\)`，而 `--color-card`
 * 成为项目 token 唯一事实来源之后，utility 编出的就是 `var(--color-card)`。
 * 于是这条断言**在它被写下的那天起就不是「性质」而是「拼法的枚举」**，枚举漏了
 * 第三种；而白名单漏项与业务回归长得一模一样（都是 `toMatch` 红），所以没有人
 * 能从那句报错里读出「这是判据自己的问题」。
 *
 * 这与上面「第一个被删的 `theme-token-single-source.test.ts`」是同一味药：
 * **登记理由必须是复算过的事实，不能是「看起来像的原因」** —— 理由写错的例外项
 * 比没有例外项更糟，它会让下一个人照着一个假根因去修，同时静默放行整个文件的
 * 其它断言。粒度是文件，本次登记期间该文件另外 17 条已绿的断言一并被摘掉，
 * 而它们在别处没有更强的执行者（已知的粗糙处）。
 *
 * 处置（ISSUE #1282）：判据改成断言**性质**（取值来自 `var()` + 那颗变量两态
 * 解得出非空值），不再枚举拼法；「登记过期」本身也升成了判据，见
 * `scripts/check-known-failed-stale.mjs`（pre-commit D 组）与规范 §11.12。
 */
export const KNOWN_FAILED_FILES = [];
