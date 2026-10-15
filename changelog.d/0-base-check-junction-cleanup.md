## Fixed

- **复算工具会把调用者正在干活的那棵树删穿**（`scripts/base-check.mjs` 的快照收尾）。
  它把本检出的依赖树以 **junction** 链进临时快照 —— 方向是 `<快照>/node_modules` → **本检出**，
  而收尾原本是两条 `git worktree remove --force` + `fs.rmSync(…, {recursive:true})`。
  **Windows 上 `git worktree remove --force` 会穿 junction 走进目标逐个删**，于是
  「清掉一个临时快照」变成「清掉你的 `node_modules`」。现场读数（夹具实测，
  `tests/base-check-snapshot-link.test.ts` 第①向）：一次 `git worktree remove --force` 之后，
  主树的 `node_modules/.bin` 与根上的受版本控制文件一起没了。
  它在真实工作流里的表现完全指不到工具本身：下一次 `pnpm test:e2e` 打
  `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL / Command "next" not found`，
  随后 `Timed out waiting 180000ms from config.webServer` ⇒ 全量档记成 `exit 1`、
  **一条用例都没跑**，红的形状与「应用坏了」逐字同形（本检出一次会话内中招三次，
  每次都先当成环境问题重装才继续）。
- **修法**：`finally` 里**先 `unlinkDependencies(link)` 再 `git worktree remove`** ——
  `fs.rmSync(link, {recursive:false, force:true})` 对 reparse point 只摘那一个点、
  不碰目标（同一夹具的第②向判的就是这个）。摘完若链接仍在原地就**跳过 worktree 清理**并打印
  路径让人手工删：宁可留一个临时目录（系统临时区，重启即清），也不拿销毁工作树换一次复算的整洁。
- **顺带修掉同一条链上的第二个错**：事后复算（单命令档）**拿哪条当基线**。旧口径首选
  `@{u}`，而推送过的 PR 分支上 `@{u}` 就是自己那条线 —— 人复算前往往刚把 `origin/master`
  合进来，那批改动不在基线那一侧，于是**主干自带的红被判成 `yours`**（极端形态：合并还没推，
  `@{u}` 逐字等于 `HEAD`，等于自己跟自己比）。现在**主干与 `HEAD` 不同就取主干**，
  只有两者同义时才退回 `@{u}`；并且报告**必须说出口取了哪条**
  （`[base-check] 基线取的是主干 \`origin/master\`…`）—— 一份写着 `up/<自己的分支>` 的输出
  读起来像「与主干比过」，而它一个字都没比。口径同步写进 §13.6.2 第 1 步。

## 刻意没做的事（写清楚，别当成已完成）

- **没有**把 `linkDependencies` 换成「复制一份依赖树」或 `NODE_PATH` 之类的替代方案：
  本仓库的 `node_modules` 是 GB 量级、复制每次复算都要付一遍，而 pnpm 自己就靠链接工作。
  问题从来不是「链」，是**收尾的顺序**。
- **没有**把「穿 junction 删」这件事 skip 掉来让测试变绿：第①向断言的是**伤害确实发生**，
  将来 git 若修成穿链接不删，那条会红并明确要求回来订正注释与碎片（见测试里那句话）。
  按平台分档的先例是 `scripts/.runtime-budget-baseline.json`；第①向只在 win32 判危害本体，
  POSIX 上断言「不受损」而不是不判。
- **没有**动 `--base`（合并前批量档）的基线选择：它早就只认「要并进去的那条」，
  本次是把**事后复算那一档**对齐到同一个语义上。

## 验证

- `tests/base-check-snapshot-link.test.ts`（新增 4 条）：①不摘就删 ⇒ 目标被删穿（win32 实测）；
  ②先摘再删 ⇒ 两边都活着 + 链接只剩 reparse point；③`unlinkDependencies(null)` 不抛；
  ④生产 `finally` 的顺序断言。
- `tests/base-check.test.ts` 新增两条：PR 分支合过主干 ⇒ 基线取主干**且在真实输出里点名取了哪条**；
  主干与 `HEAD` 同义时才退回 `@{u}`。该文件改后 **59 passed**，两份文件合计 **63 passed**
  （本机同时压着 4 个检出的 vitest 时测得）。
  归属那一向**刻意不走建快照那条慢路**：夹具（比 `makeRepo()` 多一次 push + 一次 merge）
  配上快照两侧各跑一遍判据，实测单条 **49s** 把 30s 预算吃光；改判「选哪条基线 + 有没有说出口」
  后同机复测 **27.3s**。这里**没有抬预算**，只是把代价挪走 —— 判决本身另有 `judge()` 单测与
  `markerOnBase` 那条 CLI 用例在判，不该为同一个结论把链条付两遍。
- 端到端在本检出上跑过：造一次真的走快照的复算（本检出侧红 ⇒ 才建 worktree），
  `node_modules/.bin` 计数 **63 → 63**、`next` 垫片在、`git worktree list` 无残留。
  修之前同一条路径就是删穿它的那一次。
- `node --check` 三份改动文件通过。
