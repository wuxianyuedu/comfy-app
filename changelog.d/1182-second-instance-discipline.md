## Fixed

- 组 A 报「生成物语法错」时，`scripts/check-tsc-artifact-hint.cjs` 的**防复发那句改口**：
  #1311 那版建议「起第二实例时给它独立的 `.next`（`distDir` 按端口/实例分叉）」被实测否掉 ——
  Next 会把该实例目录**追加进受版本控制的 `tsconfig.json`** 的 `include`（半截 `validator.ts`
  照旧进组 A），并把全检出共享的 `next-env.d.ts` 的 import 改写到那个目录（目录被删后
  `skipLibCheck` 下**一声不响**，路由类型校验静默失效）。现在的话术是「别在同一目录双开
  `next dev`；要并行验证走 `git worktree`（§13.6.2）或复用已经在跑的实例」，并配一条用例钉住
  那句不该再出现的话。
- launch-and-build §5 那一行同时订正两处旧口径：`include` 的 `**/*.ts` **不进点开头目录**
  （生成物被检查纯粹因为两条显式 include，不是「`exclude` 少了 `.next`」）；以及 Windows 侧
  `reap-process.mjs` 不加 `--force` **并不更温和**（`windowsKillArgs()` 恒发 `/T /F`，
  `force` 只在 POSIX 分叉信号）。

## Changed

- ADR（P3 第 2 期设计）§26 新增 26.1 节：实例级 `distDir` 与「收法改温和」两条根治方向的
  实测读数与判死理由，ISSUE #1182 按「方案 3 已落 = 可见性收口」关闭。
