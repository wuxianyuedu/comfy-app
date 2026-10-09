## Fixed

- **新鲜度账的类型声明与判据追回实现**（#1553 合并残留，master 上 A 组 `tsc` 17 条 +
  C 组 1 条红的根因）：`daily` / `skipHow` / `skippedReason` 三栏随 #1553 并进主干的
  单门禁两档形状，但**声明与断言那一侧没同批跟过来**，于是同一件事在四处报红：

  · `scripts/visual-baselines.mjs`：`freshnessTrack` 的返回类型仍写着四栏、
    `freshnessRecord` 的 `@param` 漏 `skippedReason`、`checkFreshnessLedger` 的
    `scope` 类型漏 `now`（正文早就写了 `now`，字面量里没有）；
  · `scripts/visual-freshness-gate.mjs`：`now` / `daily` / `skipHow` 三处读数全部
    是上面那条返回类型的下游，修完即消；
  · `tests/e2e-run.test.ts`：「四个值各就各位」用 `toEqual` 比**整条登记**，
    等于顺手断言「形状刚好四栏」—— 新增两栏被报成抄错。改成只挑那四栏比，
    并**另立一条**判 `daily` / `skipHow` 这两栏真正的差异（两侧一起判，
    只有一侧变了就说明「同形」这句话已不成立）；`parseSkip` 那条用例里
    「`--skip` 后面什么都没有」从「往 argv 里塞 `undefined`」（真实 argv 里
    不存在这种元素）改成 `["--skip"]` 这一种真形状。

  顺带修掉 `scripts/shell-gate.mjs` 的 4 条：`findCargo()` 用
  `process.env.CARGO_HOME && path.join(...)` 拼候选、再 `.filter` 掉 `false`，
  数组类型因此是 `(string | false)[]`；`.mjs` 里写不了 `dir is string` 谓词
  （TS8010），tsc 也不从复合条件里推，于是下面整段都带着 `string | undefined`
  用。改成按条件 `if` 拼进 `string[]`，类型本身就是对的，不靠注解断言。

  `pnpm exec tsc --noEmit` 17 → **0**；`tests/e2e-run.test.ts` 19 → **20 条全绿**；
  受影响 10 份用例 **139 条全绿**。
