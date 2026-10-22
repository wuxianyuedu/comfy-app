## Added

- **`pnpm ship` 现在管得到分支的两头（ISSUE #2143）**：开头那一格原本只会打印一句
  「先 `git checkout -b feat/<描述>`」然后退 1，于是脚本在「人还没有分支」的时刻是旁观者，
  第一次跑的屏幕输出全部作废；结尾那一格原本明说「远端分支没删（那不在本脚本的动作面里）」，
  合并之后那条分支的名字与提交就一直留着。现在：
  `--branch <名字>` 在 `master` / 游离 HEAD 上把分支建出来再往下走（已在同名分支上是幂等、
  名字撞了已存在的 ref 就退 2 而不是覆盖、当前在**另一条**分支上直接停 —— 它不在分支之间
  搬工作树），**名字只能人给**，脚本不从 issue 号或提交信息里造（名字是判断，猜错会让这条
  变更顶着另一个身份进评审与后续引用）；`--clean-branch` 只删**这一次跑的那一条**分支，
  且只跟在**验真的合并**之后（`is_merged` + 碎片在主干顶端），远端与本地各问一次事实 ——
  `git ls-remote --heads` / `git show-ref --verify`，`push --delete` 与 `branch -D` 的退码
  都不算结论，回读本身没跑起来落 2 而不是「已删」。
  本地用 `-D` 的理由是形状：本仓 PR 走 squash，本地那笔永远不是主干那笔的祖先，
  `-d` 的祖先判据恒假（现场六条已合并分支全部被 `git merge-base --is-ancestor` 判否），
  写成 `-d` 等于把这条能力做成"永远不生效"——所以删之前把那笔 sha 打出来当恢复线。
  判断落在 `scripts/ship-core.mjs` 的 `decideCreateBranch` / `decideCleanBranch`（纯函数，
  与 `decideCloseIssue` 同一形状），效应落在 `ship-platform.mjs` 的 `cleanBranch`，
  编排入口只接线。阶段表补 `close-issue` / `clean-branch` 两格，两者都归进「不能单跑」那一族。
  回归见 `tests/ship.test.ts`：两个 decide 的分态与四条负控制、`cleanBranch` 的
  「回执退 0 但回读仍在 ⇒ 红」「回读没跑起来 ⇒ 2」「未验真 ⇒ 一次伸手都不伸」、
  计划⇄执行的两条旗标门，以及 dry-run 不碰 `git checkout -b` / `git branch -D`。
