## Fixed

- `pnpm ship --clean-branch` 的本地删除段被 git 拒掉时（最常见的一形：分支被某个 worktree
  检出占用 —— 本仓常态是并行 worktree 检出，硬规则 30），旧读数只有一句「本地那一半没删掉
  （exit 1）」，不说为什么、也不给怎么手工收（#3617）。
  现在把 git 的 stderr 原话归因（`ship-core.mjs` 的 `classifyBranchDeleteRefusal`，
  只读 stderr 里的占用路径原话，不猜）：**当前检出**占着 ⇒ 出口是
  `git checkout --detach <恢复线 sha>` 然后 `git branch -D <分支>`；**别的 worktree** 占着
  ⇒ 指到那个路径（`used by worktree at '…'`），到那边切走或收掉后再删；认不出的形状照实
  念 stderr + `git worktree list` 的一般出口。退码不变 —— 诚实红是对的，缺的是归因与出口。
