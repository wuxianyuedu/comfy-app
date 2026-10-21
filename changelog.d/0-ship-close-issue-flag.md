## Added

- **`pnpm ship --merge --close-issue`：合上之后把落地那一行点名的单子置为 `closed`。**
  （`scripts/ship.mjs` 的阶段 7 / `ship-platform.mjs#closeIssues` /
  `ship-core.mjs#decideCloseIssue`，由 #2070 那一轮的追问引出。）

  只把**机械那一半**交给编排层：号来自 squash 那一行的**标题本体**（不是拼完 PR 号之后
  的整行 —— 本仓 PR 号与 issue 号共用一套编号，喂整行会去关一张别人正在用的单子，
  `tests/ship.test.ts` 里那条负控制钉的就是这一格），动作是
  `update-issue --state closed --state-reason completed`，然后走一次**独立的**
  `get-issue` 回读，把 `state` / `state_reason` / `closed_at` 三件原值打出来 ——
  与合并那一格同一条纪律：回执只是半个结论。幂等：对一张已经关着的单子再跑一次，
  回读仍是第一次关它的那个时刻，不会改坏状态、也不会谎报。

  三条边界，方向都是「宁可没做，不可做了还谎称做了」：

  - **显式**才做（`--close-issue`）。关单是把状态写到别人也看得见、且不会自动回退的
    地方，与合并同一档，所以同一个口径；不给就这一格根本不存在。
  - **只跟在验真的合并之后**（`is_merged` + 碎片在主干顶端那一双重读之后）。误把它带在
    轮询那一跳、或合并被拒的那一次上 ⇒ 那一格落 **2 并说明**，且 `cnb` **一次都不碰**。
    静默跳过会落出「全绿到终态」，而那一格根本没动过 —— 这正是本仓反复在修的那一族。
  - **不写 issue 的内容**。那条「已落地 + 读数 + 因果」的记录评论是判断，与提交信息
    同一档；生成出来的那句话必然只是一句「它说它做了」。

  `--dry-run` 的计划里这两条也在（`planCommands` 与真执行面逐条对账那条判据当场把
  这件事要求了出来：新增 `cnb issues …` 调用而计划里没有 ⇒ 那条对账直接红）。
  `cnb issues update-issue` 同时进 `WRITE_SHAPES` —— dry-run 一条都不许碰它。
