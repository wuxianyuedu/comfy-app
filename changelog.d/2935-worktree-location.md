## Fixed

- 并行 worktree 落点定口径：一律落仓内 `.worktrees/`（已入 `.gitignore`）或系统临时目录，**禁止落 `.git/` 下** —— Vite/vitest 的 `server.fs.deny` 默认含 `**/.git/**`，落进去的检出里 DOM 档用例在模块加载期就被 deny（报错是 "Cannot find module" 族、指不到真实原因）。AGENTS 新增硬规则 30，规范 §13.6.2 补落点口径，契约判据 `tests/worktree-location.test.ts` 扫全仓 `worktree add` 调用点守着（正/负控在场，既有系统临时目录实现不误红）。
