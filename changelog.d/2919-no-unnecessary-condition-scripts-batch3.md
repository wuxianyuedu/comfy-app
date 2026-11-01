## Changed

- **`typescript/no-unnecessary-condition` 逐处取证：`scripts/**` 第 3 批 11 份 / 35 处**（ISSUE #2919）。
  这批的格位分布 A 19 / B 13 / C 0 / D 3 ——**B 格（真多余）第一次成规模**，
  前两批加起来只有 2 处。

  三类的读数值得单独记：

  - **恒真的兜底**：`ProbeReport` 把 `volume` / `capabilities` / `pnpm` / `git` / `cache` /
    `defender` / `indexMarking` 都声明成必填（探针永远返回对象，读不到就写在字段里），
    于是 `report.volume ?? {}` 一族全是恒真。`?? []` 更要紧：它把「探针忘了给这一格」
    悄悄读成「空数组」。
  - **恒假的收窄**：`ts.isElementAccessExpression` 的 `argumentExpression` 在类型上必填，
    而 `a!`（不带下标）正是 `check-non-null-assertions.cjs` 要放行的形态；
    `parseLedger` 真的会回 `null`，但 JSDoc 没写 `| null` —— 补声明，判空原地保留。
  - **改一处就救回一个隐患**：`check-bundle-budget.cjs` 的
    `TOTALS_ENFORCED || ARGS.has("--enforce-totals")` 在常量是 `false` 时前半句恒假；
    而恢复那天把常量改成 `true`，同一个表达式会**短路掉命令行开关**（`--enforce-totals`
    是恢复前的自查入口）⇒ 改成 `Boolean(TOTALS_ENFORCED) || …`。

  另有一条规矩被这一批逼出来并写进代码注释：**规则与 `tsc` 在同一行上给相反答案时归 tsc**
  —— `dev-drive-levers.mjs` 的 `usage.state === "idle"` 既不能写 `=== "idle"`
  也不能写 `!== "busy" && !== "unknown"`（前者被 `tsc` 判 TS2367，后者是规则的
  「恒真」命中），只剩「直接落成语句」一条路。

  台账 `docs/audits/2026-11-01-no-unnecessary-condition-ledger.md` 同批填格，
  剩余 `scripts/**` 约 230 处未取证。
