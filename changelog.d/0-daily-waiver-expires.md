## Fixed

- **「每天首次自证」那一档的两条出路里，豁免永不过期**（`scripts/visual-baselines.mjs` 的 `checkFreshnessLedger`）：`skippedReason` / `dirtyReason` 只要措辞可用就**完全不比日期**，于是一条理由一旦写下就替未来每一天作证 —— 而这不是「设计如此」：写入侧 `writeSkipRecord` 把 `verifiedAt` 戳成「此刻」，`--skip` 的用法原文写着「**今天**不跑，记一条写明理由的豁免」，`e2e-run.mjs` 的文件头还写着「豁免不是绕过：它留下的是一条能被复核的事实」。本机实测的现场：`scripts/.e2e-freshness.json` 挂着一条 2026-10-08 的豁免，此后 e2e 那 80 条 spec（含 29 条 `@critical`）**一次都没被自动跑过**，而这一档天天报绿 —— 正是那条注释自己点名要防的形态（「这一档三个月没跑」与「这三个月每次都说不跑」在账面上长得一模一样）。
  改法是把已有口径接上判据，而不是新造一种红：**一条豁免只替它写在的那一天作证**（复用 `isSameLocalDay`，与「当天凭证」同一个日界、同一个函数）。过期之后把这一档**交回它自己的 `freshnessVerdict`** —— 于是 `dirty` / `graceMs` 继续说话：「两天前跑绿过、今天没动输入面」仍然放行，只有「今天确实要凭证」的那一刻才拦。若做成「过期即红」，就等于把 #1282 收掉的「改了就当天跑」推回「每天一次仪式」。红话里点明**那个日期是那次回答的时刻、不是跑绿的凭证**，否则「上一次跑绿在 X」会被读成 X 那天真跑过。

## Tests

- `tests/daily-tracks.test.ts` 补三条边界，一条只判一件事：昨天的豁免 → 红且话术点名「是豁免不是凭证」；今天的豁免 → 仍放行（这一档不许变成必须跑）；过期豁免 + 吃输入面的那档 → 在宽限内**放行**，而同一条账加上 `dirtySince`（今天动过 `src/`）→ **拦**。第三条与前一条是一对：它们合起来才说明「过期」是「交回原口径」而不是「一律红」。
- 夹具里那两个时刻改为**从 `SAME_DAY` 推算**（-48h）而不是写死日历日：判据比的是 `isSameLocalDay`（本地日），而写死的 `"2026-10-08T23:30:00.000Z"` 在 UTC+8 上落成本地 10-09 07:30 —— 那就是「今天」，「昨天的豁免」这条会因为换台机器而结论翻转（本仓库的老对手：判据与机器绑定、在别处测不出来）。
- **判据一落地就照出的真红**：`tests/e2e-run.test.ts` 那条「仓库里这条账能通过自己的判决」当场红，报的就是本机 `.e2e-freshness.json` 那条过期豁免 —— 它是这批唯一「新判据在存量数据上第一次被执行」的证据，也说明这一格此前的绿确实是空的。

## Changed

- 规范 §11.8 的「每日自证」一节补上这条口径（含立案数据与「过期不是新红」的取舍），台账 E3″ 记下 e2e 执行者这一格的当前状态。
- **`check-tsc-diagnostic-executors.cjs` 的「声明新增」红话给出一条做不到的出路**（`scripts/check-tsc-diagnostic-executors.cjs` + `tests/tsc-diagnostic-executors.test.ts`）：上涨那一支写着「再跑 `node scripts/check-tsc-diagnostic-executors.cjs --update`（= 把基线收紧到 N）」，而同一个脚本的 `--update` 对上涨是 `exit 2` 拒绝写入 —— 照红话跑一遍只会再吃一次红，「谁在敲这条声明」一次都没被回答。这句话术还被用例**钉着**（`expect(output).toContain("--update")`，标题写着「给出收紧基线的出口」）：假保险的第二种形态 —— 断言把错误行为锁成了期望。现在出口写成人的动作（读完 §11.8 与 reader、确认后**手工**改那一行），并显式说明为什么这一步不给旗标；测试改为断「指令的形状」而不是字面量 `--update`（新红话里那句「这一步不给 `--update`」是在**否认**这条出路，`not.toContain("--update")` 会把这句否认本身判成违规）。
- 本批在 `scripts/visual-baselines.mjs` 里新增的 3 处声明（豁免分支的三个 `const`）按上述流程**手工登记**（`.tsc-diagnostic-executors.json` 的 `visual-baseline-freshness.baseline` 83 → 86），执行者仍是 `tests/daily-tracks.test.ts`（C 组固定清单）、读者仍是 `scripts/visual-freshness-gate.mjs`。
- **`dirtyReason` 是一句可以被当天驳倒的事实声明**（同一判据的第二刀）：`dirtySince` 就是这一档输入面今天的第一个提交，两者同时成立时那句「这次改动不吃这一档」不成立 —— 存量现场是 `scripts/.full-suite-freshness.json` 里一条写着「本 PR 只接三档每日自证的机制（scripts/ + tests/ + docs），未动 src/」的账，而 `full` 档的输入面正是 `["src/", "tests/"]`。旧判据从不拿事实去核它，于是整档当天免跑，而账面上一切正常。`skippedReason` **不**受这条反驳（它陈述的是决定，只受日期过期约束）：把两者一起反驳等于堵死「今天故意不跑」，会逼人去写那句更容易被驳倒的话。两条新用例是一对：同日 `dirtyReason` + 今天动过输入面 ⇒ 红且出路指向 `--skip`；同日 `skippedReason` + 同样动过输入面 ⇒ 仍放行。变异：把反驳条件短路 → 只有第一条红。

## Known issues

- 这批第一次把 `pnpm test:e2e` 当量具用了一遍（80 条 / 9.9 分钟）：**44 条撞 60s 超时、36 条通过**，而失败集中在 `critical-flows` / `appearance-steps` 这些等页面渲染的用例上 —— 这台机器当时被同机并行会话与本批的门禁复算占到 88–97% CPU。所以这个比例**量的是机器，不是应用**，不能作为「e2e 坏了」的结论，也不能拿来记凭证：跑红时 `e2e-run.mjs` 正确地**没有**写账（只有绿才记）。台账侧写了一条今天日期、写明上述理由的豁免（`scripts/.e2e-freshness.json` 的 `skippedReason`）—— 这正是新判据要的形状：它明天就过期，届时要么真跑一次，要么再写一条当天的理由，而不能靠一条旧账一直绿。顺带 E3″ 的两格内容决定也记清了：**这一档需要一个真执行者**（要么把 `--grep @critical` 接进每日档并承认它要十分钟量级，要么按 §13.5.4 登记「谁在什么时机跑」），以及**没有真登录态**（`critical-flows.spec.ts` 明写「不假装认证成功」，登录后视图全靠 `stubBackend` / `stubTrpc` / 直接种 `localStorage`，没有 `storageState`、没有 setup project）。
