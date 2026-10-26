## Fixed

- **`check:deps-freshness` 的摘要行把「依赖还没装」念成「有漂移」**（ISSUE #2382）：
  未装过依赖的检出（新克隆 / 评审容器 / NPC 工作区）跑这一格，第一行读数是
  「有漂移」，而数据层（`installDrift.state = "no-install"`）说的分明是「压根没装」
  —— 硬规则 26 那句「node_modules 缺失只表示『还没装』」的机器版本。摘要行现在
  按 `installDrift.state` 分出第三态：唯一的事实是 `no-install` 时念
  「依赖还没装（出口：pnpm install）」，不与「有漂移」同形；远端真漂移在场时
  仍念「有漂移」（那半边是判据判出的）。退出码不变（仍是 1，都要动作）。
