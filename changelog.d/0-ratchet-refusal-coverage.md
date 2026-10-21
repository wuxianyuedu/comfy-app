## Fixed

- **`COVERED_LOCALLY` 那句「本地用例覆盖了拒涨」原先是一句没有执行者的声明**（台账 E5 那一族的
  登记形态）。这条判据（拒涨那句话必须给出**上涨态里可执行的下一步**）此前只住在
  `tests/ratchet-update-guards.test.ts` 的第 ⑥ 步，而 ⑥ 只跑 `RATCHETS` 那张表；被归进
  `COVERED_LOCALLY` 的四家（`check-form-field-wiring` / `check-dependency-audit` /
  `check-bundle-budget` / `check-tsc-diagnostic-executors`，沙箱造不出它们的输入面）
  各自的本地用例实测钉的都是**退出码 + 句子里的一个短语**
  （`toContain("拒绝把基线往上涨")` 那一形）—— 「那条出路是不是死路」这半边一个判据都没碰过。
  今天复算的口径：提到 `--update` 的判据脚本 26 份（`grep -l -- "--update" scripts/check-*.cjs | wc -l`），
  其中在 argv 读取处真出现这个旗标的是 7 份（同一处加 `grep -Ei "argv|args"`），
  「带写入通道」那个集合仍由 `discoveredBaselines()` 现算。
- **收法是一份实现，不是四家各写一遍正则**：抽成 `tests/helpers/ratchet-refusal.ts`
  （`ACTIONABLE_REFUSAL` + `expectActionableRefusal()`），⑥ 改成调用它，四家本地用例各调一次。
  扩到四家时照出**第四种自洽形状**：`check-bundle-budget.cjs` 的出路是「贴 before/after 读数 +
  评审确认后带 `--allow-increase` 重跑」，而原判据只认三种说法、把它判成红 —— 所以新分支带
  `--(?!update)`，认「另一个必须认账才敲得动的旗标」，**刻意不认把人推回 `--update` 的话**；
  同时把「不要用」那一支按实到措辞收成 `不要|不许|给`（`check-tsc-diagnostic-executors.cjs`
  写的是「这一步**不给 `--update`**」，按字面量收会误报）。
- **两条新判据把这次的收口本身钉住**：一条判「被 `COVERED_LOCALLY` 点名的那份文件里真有这句调用」
  （认符号名而不是认某句措辞 —— 否则折行或换说法就把自己判红），一条把当年那句死路话
  （「再跑 `node scripts/check-tsc-diagnostic-executors.cjs --update`」）钉成**否定式**期望，
  这样这一维以后每次扩形状都不可能顺手把原始现场放过去。
- 变异三刀，各打在对应的执行者上、打完逐字节还原：从一家本地用例里删掉那句调用 →
  接线判据红并点名那家；把 `check-bundle-budget.cjs` 的出路改成「请处理上述新增项」→
  那一家本地用例红；把第四个分支松成 `--[a-z][a-z-]*`（去掉 `带` 前缀与 `(?!update)`）→
  反例钉子红。
- 文档同步：11 章那张六步表的 ⑥ 一行改成四种形状 + 实现与判决面在哪；台账 E5 那条补上
  今天的复算口径与这三刀的落点。
