## Fixed

- 「声明落后于实现」这一类 `tsc` 红有了执行者（ISSUE #1591）。立案现场：`master` 最近一次
  `tsc` 红是 **19 条**，逐条扒下来没有一行是行为改动 —— 共同根因只有一个是「**代码长出新形状，
  写形状的那句话没跟着长**」（`FRESHNESS_TRACKS` 长出 `daily` / `skipHow`、
  `freshnessRecord` 接上 `skippedReason`、`checkFreshnessLedger` 接上 `now`，而三处 JSDoc
  还停在旧的四栏形状）。判据本来是现成的（`tsc --noEmit`），缺的是「**什么时候被敲**」：
  本地钩子只保护「启用了钩子且没 `--no-verify`」的那一次提交，平台侧 squash 合并**不跑**钩子，
  `#623` 之后**已无 CI 兜底** —— 于是那一批在干净仓库上长久**全绿**，正是 §11.23 那一族的形态
  （声明写得对、没有人读）。
- 新增 `scripts/check-tsc-diagnostic-executors.cjs` + 台账
  `scripts/.tsc-diagnostic-executors.json`（pre-commit D 组「类型层声明 ⇄ 执行者（tsc 判决面）」）。
  **它不跑第二遍 `tsc`** —— 合并前那一跳归 §13.6.2 的 `pnpm check:base:batch`（§12.18 明令
  避免第二轮子）；它判的是**那条判据自己的执行者**：每条登记项的执行者在场、与
  `scripts/.declaration-readers.json` **逐行同源**、**声明行计数零增量**（新写一处 JSDoc /
  类型注解就红，直到你回答「它谁在执行」）。判据自己不许静默降级（台账读不出 / 空表 /
  对侧读不到 ⇒ 判失败，不是「没有站点要查」）；`--update` **拒绝写入上涨**。
- 契约测试 `tests/tsc-diagnostic-executors.test.ts`（19 条，进 C 组固定清单）：
  该拦的（涨了 / 落点扫不到声明 / 关键词没了 / 姊妹索引缺 id / 两处 reader 不一致 / 字段不全 /
  缺 baseline / id 重复 / 台账读不出 / 空表 / 对侧读不到 / `--update` 涨）与该放的
  （降了只提示 / 声明行识别不吃夹具字符串 / 真仓判绿）每一档各一条执行者。
- 规范：新增 §13.5.14（口径 + 三条设计取舍 + 刻意不做的三件事）、§11.23.3 的索引表补两行、
  §13.1 清单补一条；`scripts/.declaration-readers.json` 同步登记
  `type-level-declaration-executors` 与 `tsc-diagnostic-shape` 两条载体。
