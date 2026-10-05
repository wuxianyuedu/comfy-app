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
 * 当前清单为空。本次清空登记的 4 个文件（`tests/check-file-structure.test.ts`、
 * `tests/dev-launcher-toolchain-gate.test.ts`、`tests/dev-launcher-downstream-exit.test.ts`、
 * `tests/turbopack-tracing-excludes.test.ts`）逐个串行复跑全部为绿：前两个的根因由
 * #1168（陈旧壳判据措辞与用例回正 + splash 三副本同步）与 `11f302e7`（四类根因分治）
 * 修掉，第四个的产物侧断言在无 `.next/standalone` 时按既有设计自行跳过。它们
 * 修好之后一直留在这份清单里 —— 粒度是**文件**，于是门禁回归套件与三条线的用例
 * 被整批从增量层摘掉（比红更糟：红会挡住提交，静默跳过什么都不会说）。
 * （同批被摘的 `tests/theme-token-single-source.test.ts` 已由该线自己删登记，本刀不重复。）
 *
 * 再要登记前先做两件事：① 按规范 §13.6.2 复算 master 基线（`git worktree add
 * ../.wt-base-check cnb/master` 后在干净基线上跑同一条判据），确证是别线的红、
 * 不是本次改动引入；② 想清楚那条门禁在别处有没有更强的执行者（粒度是文件，
 * 一条红会连同一文件里其它断言一起放行）。修好后**立刻删**，别让它长期静默。
 */
/**
 * @type {string[]}
 *
 * `tests/theme-dark-token-cascade.test.ts`（2026-10-05 登记，基线红）：
 * `bg-card/bg-popover/border-border 编成 var() 取值` 那一条在**干净 master 基线**
 * 上就红（`git worktree add ../.wt-base-check origin/master` 复算，同一条判据同一条红，
 * 见规范 §13.6.2）。形态是 `.bg-card` 那条规则没出现在固定输入源的产物里 ——
 * 而 `PINNED_UTILITY_CLASSES` 里明明点着 `bg-card`，所以不是「断言依赖的类没被固定住」
 * 那一类，是 `globals.css` 侧 utility 生成路径变了（`--card` 与 `--color-surface` 的
 * 转发关系被改过）。
 *
 * 归属与处置：该判据归**主题 token 线**（ISSUE #609 / #1336 那一族），本次改动
 * （`it.each` → `test.for`）与它无关 —— 登记只为让本线能提交，**修好立刻删**。
 * 粒度是文件，所以这条红会连同该文件里另外 17 条已经绿了的断言一起放行（本文件
 * 的那 17 条在别处没有更强的执行者，属已知的粗糙处）。
 */
export const KNOWN_FAILED_FILES = ["tests/theme-dark-token-cascade.test.ts"];

