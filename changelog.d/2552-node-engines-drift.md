## Fixed

**`engines.node` 收紧到 `>=26.12.1` 之后，`NODE_ENGINES` 与对账判据两侧都跟着改**（ISSUE #2552）。

- 现场：`pnpm exec vitest run tests/ci-toolchain-selfcheck.test.ts` 在 master 上是红的
  （`expected '>=26.12.1' to contain '22.22.2'`）—— 声明那一侧由 `c01f6987`（#2531 / #2532）改，
  判据那一侧（`scripts/ci-toolchain-selfcheck.mjs` 的 `NODE_ENGINES`）与对账那一侧（用例）没跟着动；
- 代价不是「一条用例红」：那是流水线第一步「这台机的 node 在不在允许范围内」的**唯一判据**，
  在它脱钩期间 Node `26.12.0` / `24.20.0` 会被放过，而版本不对这一族的故障从来不报错，
  只让某几条用例以奇怪的方式红；
- 现在 `NODE_ENGINES` 是与声明同一口径的一个区间 `[{ min: [26, 12, 1], max: null }]`，
  用例那三条期望同步（范围之内的过 / 范围之外的拦补上 `26.12.0` / 与 `package.json` 对账）；
- 仍然是**手写**边界而不是引入语义版本解析依赖 —— 这一格要在「一台什么都还没装好的机器」
  上跑得起来，这也是当初刻意不去解析那条区间的原因。
