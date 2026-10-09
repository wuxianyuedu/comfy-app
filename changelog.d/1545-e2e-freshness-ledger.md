## Added

- **「全量 e2e」也有了有主的新鲜度账：`pnpm test:e2e` 跑绿即记一笔**（ISSUE #1545 / #1547）。
  立案现场是「**像素档的触发条件恰好嵌套在全量 e2e 里**」这件事先前没人说出来：
  `playwright.config.ts` 的 `testMatch` 把 `*.visual.spec.ts` 与普通 spec 收进**同一次**
  `playwright test`，而 `pnpm check:visual` 只跑 `e2e/visual` 那半边。于是「像素档红了」有两条
  到达路径，两条此前都没有账 —— 实测的形态是 linux 档基线过期**两天**没被发现
  （`#1327` 改了导航顺序、基线未同批重录），而**没有任何东西守 `pnpm test:e2e` 上一次是绿的**；
  那次是靠人手动把这条入口跑了一遍才发现的（`#1545` 的 PR 描述里点名的就是这件事）。
  - `pnpm test:e2e` 改走 `scripts/e2e-run.mjs`：跑一次 `playwright test`，**绿了**把这一档
    （谁 / 什么时候 / 按哪条命令）记进 `scripts/.e2e-freshness.json`；红了不记、`--dry-run` 不记
    —— 账上记的是「上一次真跑绿」这个**状态**，不是「我跑过」这个**动作**。
  - 与像素档**同形而不同键**（`FRESHNESS_TRACKS`）：像素档是 `scripts/.visual-baseline-freshness.json`
    的 `linux`、本档是 `scripts/.e2e-freshness.json` 的 `e2e`。记录多一栏 `trackedBy`，
    写清这条是**哪一个跑法**证出来的 —— 两条账同形之后新长出来的静默失效面正是「抄混」，
    而抄混之后账面上完全正常（日期合法、人名合法、命令是一条真命令）。
  - 读写实现收成**一份**（`scripts/visual-baselines.mjs` 的 `readFreshnessLedgerAt` /
    `writeFreshness` / `freshnessRecord`）：两条跑法脚本只留「怎么算口径 / 什么时候不记」，
    不然一边把坏 JSON 当成空账（判红、话术正确）、另一边静默少守一条（§12.12）。

## Changed

- **`scripts/visual-freshness-gate.mjs` 现在判两份账**（像素档 + 全量 e2e），命令与钩子里那一步
  的名字不变（语义没变 —— 它判的一直是「这一档上次被实证跑绿是什么时候」）。两条账的日期因此
  出现在**每一次提交**的输出里，「这一档上次真跑绿是什么时候」从此是被**看见**的读数，
  而不是靠人记得问。D 组的标签改成「每档都有主（新鲜度账：像素档 + 全量 e2e）」。
- 新鲜度记录的形状由「按平台」改成「按档」（`platform` → `key`，并新增 `trackedBy`）：
  像素那一档的「档」是平台（`linux`），e2e 那一档的「档」不是平台。已入库的那条记录同批迁移。

## Docs

- 规范 11 §11.8：补上「同一条账也守着全量 e2e」那一节（含两账对照表、`trackedBy` 的作用、
  以及为什么这两档都不在钩子里跑）。§13.5.4 的按需表新增「全量 E2E」一行，并说清它与
  「像素回归」那一行的关系（前者是后者的超集）。§13.5.12 记下「两条同形的账必须能被分开」
  这条纪律。launch-and-build §9.5 的跨平台动作对照表登记 `scripts/e2e-run.mjs ⇄ pnpm test:e2e`。

## Tests

- `tests/e2e-run.test.ts`（13 条）：记账语义两条边界（红了不记 / `--dry-run` 不记）、
  两条账四个值各就各位且**不共用文件**、`trackedBy` 抄混当场判红、未登记的档名抛而不是回落、
  仓库当前那条账能过自己的判决、以及两处接线在位（`package.json` 的 `test:e2e` 真的走这条通道、
  钩子那一步的 `cmd` 逐字相等且标签说清它判两档）。进 `FIXED_STRUCTURAL_TESTS`。
- `tests/visual-freshness-gate.test.ts` 补一条：**读接口只差一个 `kind`，接错的表现是
  「两档共用一条日期」** —— 它正是两条账同形之后最容易接错的一处。
