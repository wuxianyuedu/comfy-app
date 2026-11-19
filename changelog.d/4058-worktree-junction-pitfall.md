## Changed

- worktree 纪律补一条（ISSUE #4058 现场）：worktree 里**不许放指向主检出的
  junction / symlink**（尤其 `node_modules`）—— `git worktree remove` 的删除会沿链接
  递归进目标，把主检出的依赖整棵删空（实测 `ls node_modules` = 0 项、
  `vitest` / `oxlint` / `tsc` 全部 `Command not found`，只能
  `pnpm install --frozen-lockfile` 重装）。共享依赖每树自装或用 pnpm 自身机制；
  删 worktree 前先拆链；后续若有 worktree 清理工具，判据必须「先拆链、再删树」。
  落点：§13.6.2 的并行 worktree 落点口径段 + AGENTS 硬规则 30。
