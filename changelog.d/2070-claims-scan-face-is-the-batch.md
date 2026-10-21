## Fixed

- **`check-commit-claims` 本地那一格只审最近一次提交 ⇒ 批次里较早那笔的假声明没人看**
  （`scripts/premerge-check.mjs` 的 `claims` 段，ISSUE #2070）。

  现场（`ad81a912`，本仓自己的历史）：提交信息写着「master 新增的 §13.5.13 / §13.6.3
  两节与各处插记照旧保留」，而那句话在它自己的树里不成立 ——
  `git grep -c "13.5.13" ad81a912` 全树只命中 `changelog.d/1569-deps-freshness-gate.md`
  一份，`docs/standards/13` / `AGENTS.md` / `.githooks/pre-commit` 里都没有。判据当时报了它。

  但本单的**核心前提在动手时被查实是半错的**，这条要留档：

  · 「批次面没有执行者」不成立 —— `resolveMergeBatch` 的**第二个来源**
  （`base-check/chained-steps.mjs`）早就把 `check-commit-claims.mjs --range <base>..HEAD`
  收进 `base` 段那一批。实测展开（拿一个领先 3 笔的分叉点当基线）：
  `argv = [node, scripts/check-commit-claims.mjs, --range, HEAD~3..HEAD]`。

  · 真的漏在两处：① `--light` 会把那条筛掉（`localTierLabels()` 那 14 条里没有 chained
  的标签 —— 实测「没有含『声明』的本地档」），`--skip-base` / `--only=claims` 同理不覆盖；
  ② `premerge-check.mjs` 自己那格 `claims` 是裸 `script` + `args: []`，而该脚本不带参数时
  **只审 HEAD**（本机复跑：`186736d3 没有可机械核对的声明 / 1 次提交的声明都与事实一致`）。
  于是「合并后永久沉默」的真实成因不是没有第二个执行者，而是**单点那一档永远不会再
  看着它** —— 声明若长在较早那笔上，推送那一刻审的是最新一笔。

  修法：`claims` 段改成与 `mergeLoss` 同一个锚点、交 `<分叉点>..HEAD`。判据本体一字未改。
  **同一次跑里不判两遍**：先看 `base` 段**实际跑过**的那批脚本（`scriptsInCommands`），
  跑过就在读数里写「已在 base 段判过」并跳过；按筛过的批算、不按整批算 ——
  后者会把「light 档其实没跑」免成「跑过了」，那是假绿的新住处。

- **带锚点那两格在「取不到分叉点」时被折成绿**（同上，`premerge-check.mjs`）。

  `resolveLossBaseline()`（本批改名 `resolveForkBaseline()`，现在两格共用）回
  `{ok:false, 原因}` 时，编排那一层写的是 `code: 0` —— 函数契约一直是对的
  （`tests/premerge-check.test.ts` 那条「算不出锚点时退 2 并说明」判的就是它），
  坏在接线：「没读到」在总读数里是**绿**。现在两格共用一个折算点 `anchorMissed`
  并记 **2 + 说明**。这一改动不会新增拦截：同一次跑里 `base` 段遇到同一个情况本来就记 2，
  而 `combineCodes` 是「2 压过 1」。

- **`区间里没有提交`被报成「取不到要审的提交」并退 2**（`scripts/check-commit-claims.mjs`）。

  `分叉点 == HEAD`（刚 fetch 完、这一批还没带东西）是合并前的常见一态，旧写法把它说成
  「判据跑不了」。现在：`resolveCommits` 区分 `null`（spec 跑不动 ⇒ 2）与 `[]`
  （0 笔 ⇒ 打「无可审，**不是判过**」并退 0）。两种读数不许混（§13.6.2）。

## Added

- **平台 PR 那一格 `提交声明核对`**（`.cnb.yml`，同单 #2070 的「第二个执行者」那一半）。
  跑的是 `node scripts/premerge-check.mjs --only=claims` —— **同一个入口**，
  不是第二份实现（配置里只放调用，逻辑一条都不写，#1959 那条纪律）。
  平台上「要并进去的那条」取自 `CNB_PULL_REQUEST_TARGET_SHA`：这台节点只 fetch 协商后的
  单 ref（`refs/heads` 零条 —— 读数在 `工作区复用读数` 那格），所以 `origin/master`
  这个引用名未必在场；`ci-affected-tests.mjs` 取改动面用的是同一个来源，两格认同一个。
  拿到 sha 之后**仍然算 `merge-base`**，不拿尖端充数；sha 不在对象库里就退回引用那一套，
  取不到则照实说「没跑起来」。

  代价（本机实测）：没有声明的提交只值一次 `git log`，**30 笔 14 秒**；贵的是真带声明的
  那几笔（单条约 49 秒，每一节要 `ls-tree` + 逐份 `git show`），一条 PR 通常 0~1 笔，
  墙钟给 10 分钟兜那一头。

判据：`tests/check-commit-claims.test.ts` 的 ①b 那组（同一夹具里「较早那笔说谎」——
只审 HEAD 漏过 / 审区间抓到 / `--json` 的 `commits` 必须是 2，防「拿到区间却只审顶端」）；
`tests/premerge-check.test.ts` 新增四条（段表取数形状、`--only=claims` 真跑且不把空区间
报成判据坏了、锚点来自 env 的那个 sha 且仍走 `merge-base`、去重按实际跑过的那批算）。
变异复算：把 `anchorMissed` 的 2 改回 0、把 `claims` 段改回 `args: []`，对应那两条当场红。
