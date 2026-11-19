## Fixed

- **`scripts/ci-heavy-gates.mjs` 的三处 JSDoc 与实现脱钩**（ISSUE #3042）：平台那一跑的
  `类型检查` 报六条，本机所有既有入口（主 `tsconfig.json`、`tsconfig.scripts.json` 的棘轮、
  `check-scripts-typecheck.cjs`）都报 0 —— 这一格是硬闸，于是它拦住的是从它分出来的每一个提交。
  - `heavyGateArgv(argv, deps = {})`：缺省值让 TS 把整个形参推成 `{}`，`checkJs` 下
    `deps.cwd` / `deps.env` 是 TS2339。去掉缺省值、改成 `deps?.cwd` / `deps?.env` ——
    `resolveBaseRef()` 本来就自己回落到 `process.env` 与仓库根，行为不变。
  - 同一次订正里把读者面写清：判据本体、阈值、两条护栏一个字没改，改的只是类型口径。
