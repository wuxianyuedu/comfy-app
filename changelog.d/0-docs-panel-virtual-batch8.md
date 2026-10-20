## Fixed

- **面板行高那一族「抄第二份数字」的地方，全部改成指常量**（`LOG_ROW_SINGLE` 从 27
  改到 28 那一次，`e2e/critical-flows.spec.ts:799` 自己就记着「这里正是漏改的那一处 ——
  用例报期望 54000、实际 56000，读起来像虚拟化坏了，其实只是算式过期」；而那份漏改
  只被修了一半，剩下的抄本还在原地）：
  - `docs/standards/07-日志系统.md` §7.28.2 写「`LOG_ROW_SINGLE = 27px` = 13px 字号 +
    `leading-snug` + `py-1` + 1px 下边框」、§7.28.4 的 e2e 行写「总高 = `2000 × 27px`」
    —— 两处都不再出现像素数，改成点常量名 + 留下那次漏改当理由；
  - `docs/standards/02-性能规范.md` 的落地实例行写「不换行 27px / 每多一行 +18px」，
    **两个数都过期**（现在是 `LOG_ROW_LINE` 那一档，也不等于 18）；
  - `src/components/studio/logs/log-virtual.ts` 的 `LOG_SCROLL_MAX` 头注「2000 行 ×
    27px ≈ 54,000px」、`src/lib/page-window.ts` 的 `LOG_MODAL_MAX_ROWS` 头注
    「300 行 × 27px」、`LogPanel.test.tsx` 那条视口用例的注释「单行 27px」——
    三处注释改成指常量（行为一字未动）。
- **§7.28.2 那句「高度是可枚举的两种形态」少了一档**：`log-virtual.ts` 现在导出
  `LOG_ROW_SINGLE` / `LOG_ROW_LINE` / `LOG_ROW_EXPANDED` 三档（展开档交给 `JsonViewer`，
  它自带工具栏与内部滚动，于是树的展开不改变**行**高 —— 这正是「不必测 DOM」成立的前提）。
  同时补上 `estimateRowHeight` / `countLines` 那一层：估行数用的宽度是**正文列**
  （总宽减 `LOG_MESSAGE_OVERHEAD`），拿整面板宽会把多行消息**低估**、正文被
  `overflow-hidden` 裁掉（用户读到的就是「超出边框看不全」）。
- **§7.29.1 那条「两个模块随之删除」有一半不成立**：`log-run-sessions.ts` 确实没回来，
  但 `log-run-packs.ts` / `log-run-packs.server.ts` **在场**且是 ④「跨包」这一层的判据与
  IO —— 同节 §7.29.3 本来就点名它俩（#1550 落判据、#1587 接线）。也就是说这一节自己
  和自己的身体冲突，读者照 §7.29.1 去找代码会一无所获。改成「切分判据删了没回来；
  跨包那两个是 ④ 新落的，消费方从 ② 换成 ④，不是残留」。
- **§7.22.3 把测试夹具的页大小写成了产品值**：原文两处「取 200 条」，而生产档的
  `pageSize` 就是 `LOG_PAGE_SIZE`（2000），200 是 `LogPanel.test.tsx` 里
  `useSmallPage()` 那一档。改成「取一页（`pageSize`）」并点名出处。
- **§7.17.5 一个指错的内部锚点**：「第 1 页的窗口锚定…见 §7.22.2」——§7.22.2 是下拉弹层
  对齐，锚定窗口在 §7.22.3。这类 `§NN.M.M` 交叉引用**没有任何判据会红**
  （`check-doc-references.cjs` 的 C2 只核 AGENTS.md 里的锚点）。
- **§7.29.2 补两条界面上限的口径**：正文窗口上限是**字节**（`MAX_TEXT_BYTES`），而下拉
  列出的次数（`MAX_FILES`）与跨包扫描先看几个包（`MAX_PACKS`）是两个不同的上界、
  最终列表由前者裁 —— 原文只字未提，而「再老的翻不到」是用户会问的行为。
- 复算：`pnpm doc:check` 退 0、`pnpm doc:render` 后 07 / 02 两份生成物与源同批
  （其余 29 份零漂移）、`doc:render --check` ✓、两章 markdown 表格逐行按列数复量一致；
  `pnpm exec eslint` 三份被改注释的文件退 0；
  `LogPanel.test.tsx` + `log-virtual.test.ts` 61 条全绿（改的是注释，跑一遍证明没碰到行为）。
