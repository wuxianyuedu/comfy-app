## Fixed

- **平台侧 `ESLint 零警告` 与本地那份 `lint` 口径不一致，20m 预算被全仓扫描吃满**
  （ISSUE #2022 的收尾；现场 `cnb-hpl-1k5a0s6ss`）：那一格写的是 `eslint .`，
  而本仓的扫描范围**唯一出处**是 `package.json` 的 `lint` 脚本（`eslint src tests scripts e2e tools
.storybook *.config.{js,mjs,cjs,ts} --cache --cache-strategy content`，白名单口径见
  `eslint.config.js` 顶部那节）。两处口径差的两半都在现场量得出来：
  - `eslint .` 比 `lint` 多扫 `docs/**`（含这次 PR 改的 4 份 `.md`）与仓库里其它
    `.ts/.js` 面；少掉 `--cache` ⇒ 每个文件都按类型感知规则**从头算**一遍；
  - 同一跑里 `类型检查` 77.3s、`重档静态判据`（本地串行实测 50 条约 125s）都不超 2 分钟，
    而 20m 全程**零输出** ⇒ 不是「规则报错」，是这一步始终没跑完。
    两处同名却不同口径，本身就是那个已经在 `scripts/quality-gate.mjs` / `.githooks/pre-commit`
    里写明「不在这里再抄一遍目录清单」的漂移 —— 平台侧漏了同一个约定。
    修法是把那一格收回 `pnpm run lint`（判据一字未动：`--max-warnings 0` 仍在脚本里），
    于是四个调用点共用同一份命令。`eslint.config.js` 顶部那节同步补上这两个调用点。

- **`eslint --cache` 在这条路径上是恒定失效**（同一次读数的推论）：缓存键含
  `eslint.config.js` 的绝对路径，而平台每个作业都是新目录（`工作区复用读数` 已把形态定成
  ①）⇒ 路径每跑都换。这一点刻意**不**去「修」：让它热起来要常驻工作区，
  而那件事的前提是 `工作区出处` 那套判据先成立（见 `scripts/ci-workspace-provenance.mjs`
  头注）。本 PR 只把口径收敛，把「冷跑 = 全量」这件事写进那一格的注释。

- **那一格随后撤到每日档**（`每日 ESLint 零警告`，30m 预算）：只要能留在 PR 上，它就是一次
  全仓冷跑，而它是这台机上仅有的几档「起一堆子进程」的格子之一 —— 并行 PR 下墙钟读数不可信
  （§13.5.21），这是 `每日生产构建` / `每日单元测试` 用过的同一条理由。判据一字未改，
  `PR_MOVED_TO_DAILY` 接住它（PR 清单里不许再有、每日清单里必须有一格、那一格点的仍是
  `pnpm run lint`）。`prettier 格式` / `类型检查` / 一批 `check-*.cjs` 仍留在 PR 上 ——
  撤的只有这一格。
