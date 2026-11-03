## Changed

**`awesomeness/no-novel-comments` tests / src/server / e2e 片处置（#2924 包 A2）**：
三目录实测 **1540 处 / 437 份 → 0 处**，走**按子域逐个登记的目录级例外**（`oxlint.config.ts` 的 `overrides`）。

- 依据是抽样：锁定基线 `d7dac532`，按 16 个子域分层抽 110 条逐条判读 ——
  复述型 **0 条（0%）**、why/约束 73%、模块头与测试意图 25%、JSDoc 类型 2%。
  测试文件里说明「在测什么、为什么这么断言」的注释按 why 计，mock 桩里的防御性说明同样保留。
- 逐层读数：`tests` 根 1155 / helpers 109 / integration 1 / stubs 1；`e2e` 根 90 / support 72；
  `src/server` api 44 / lib 14 / film 13 / workshop 10 / agent 8 / db 7 / better-auth 6 /
  根文件 5 / mcp 3 / auth 2。
- 例外按子域登记（16 条 glob，每条注明该层抽样数与复述数），**不写 `tests/**` / `src/server/**` / `e2e/**` 三条大 glob**；
  新增子域不自动继承 —— 先抽样再登记。
- 删除 **0 处**：1540 处里没有复述型，长注释原样保留。
- 未触碰移交包目录（`src/components/**`、`src/app/**`、`src/lib/**`、`scripts/**`）与 `oxlint.parity.config.mjs`。
