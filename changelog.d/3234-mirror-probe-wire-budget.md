## Fixed

- CI（`GitHub 镜像同步` / `GitHub master 镜像`）：**「起码试 3–5 分钟」现在真的从第一跳开始算**。#3197 把 240s 墙钟预算只挂在第二跳 `git push`，探活 `git ls-remote` 仍是 `PROBE_MAX_ATTEMPTS = 3` + 5s/10s 退避的旧口径；而探活一败就 `return CODE.NO_FACT` 短路掉整格，于是 4 分钟预算一秒都没机会花。PR #3223 现场撞上 `Recv failure: Connection was reset`（每次约 0.3s 就败），探活 3 次 / 约 16s 交账、整格 `duration: 23s`，读起来仍是「才试两下就失败」。
- 探活与 wire 推送现在**共用一份 240s 墙钟预算**（`PUSH_RETRY_BUDGET_MS`，由新增的 `scripts/ci-mirror-wire-budget.mjs` 在探活前起算）：两跳各自把 `wireBudget()` 的**当前剩余量**交给 `runGitWithRetry` 的 `budgetMs`，那个函数从自己被调用的时刻接着扣，等效共享同一个 deadline，而不是各领 4 分钟叠成两倍窗口。探活上限同放到 10 次、吃同一条 5s→50s 退避阶梯（累计 230s ≈ 3.8min）；`gitTimeoutFor` 把有预算的**重试**裁到剩余量，探活首刀仍吃 30s 单跳上限，慢但正常的那一读不会被掐死。认证 / 权限 / 仓库不存在三族照旧一次交账。
- `io.now` 透传给 `runGitWithRetry`（PR / master 两档共四跳）：预算起点与重试窗口用同一口时钟，注入面不再分裂；生产上缺省仍是 `Date.now`。整格最坏墙钟从「探活 105s + 推送 240s + LFS 首刀 240s = 585s」降到「探活+推送共用 240s + LFS 首刀 240s = 480s」，`.cnb.yml` 两格 10m 外框反而更宽裕；LFS 第二跳的 60s 独立预算、首刀不裁、主路径与 `--object-id` 回退共用预算都不变。

## Changed

- 常量与注释同步：`ci-mirror-retry-policy.mjs` 的 `PROBE_MAX_ATTEMPTS` 3→10，探活 / LFS 两处旧最坏账注释改成共用预算口径；`.cnb.yml` 三处注释、两份执行面的文件头第 8 条与入口超时说明同步改写。`ci-github-mirror-push.mjs` 停在 **899 行**，仍在 §12.6 R5 的 900 行硬闸内（`check-infra-file-size` 判据是 `lines > 900`）；预算这层拆成独立纯函数模块，没往主文件里加逻辑。
- 用例（`tests/ci-github-mirror-push.test.ts`，89→93 条）：`createWireBudget` 的一个起点 / 剩余量 / 不为负；探活瞬时 egress 吃满共用预算（首刀不裁、第二刀裁到 30s、最后一刀只剩 10s、累计 230s ≥ 3min）；探活花掉 100s 后推送只吃剩余量（第 7 刀被收口，不跑满 10 次）；master 档与 PR 档同读数；旧「连挂 3 次 / 探活仍是 3 次」断言改成真耗尽上限，`probeWorst` 不再把两跳预算相加。
- 判决面：定向 93 passed；全库 `pnpm run lint` 0 warning / 0 error；`pnpm run check:premerge` 各段全绿（含「已清零 oxlint 规则集 41 条 0 命中」与「脚本档类型检查」）；`check-format --staged` 0 命中；`check-infra-file-size` 375 份 / 超 900 行 0 个。**反向验证两刀**：① 摘掉两档探活的 `budgetMs: wireBudget()` ⇒ PR / master 两条新增用例同时红（`expected undefined to deeply equal { timeout: 30000 }`）；② 让推送改回各领一份 `240_000` ⇒「共享 deadline」用例红（`expected 10 to be less than 10`）。恢复修复版后 93 条全绿。
