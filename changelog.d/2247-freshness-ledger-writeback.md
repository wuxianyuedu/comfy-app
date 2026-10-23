## Changed

- **新鲜度账回写机器自有分支 `ci/freshness-ledger`（ISSUE #2247）**：此前每日档跑绿只把账写在一次性检出里、随工作区丢弃，仓库里三份 JSON 永远停在最后一次本地跑（开发者自己分支、可能带未合并改动），于是读数如实显示「前台才跑过」、平台每日跑绿不进账。

  **判据一个字没改，多的是回写 + 回看两条链**（照 #1979 同口径）：

  - `scripts/freshness-ledger-sync.mjs`（从 `freshness-ledger.mjs` 拆出，守 `scripts/**` 900 行硬闸）：新增 `pushFreshnessLedger`（跑法脚本跑绿后把三份账一并推上 `ci/freshness-ledger`，commit 带 `[ci skip]`、只推 `ci/*` 分支，不触发流水线、不推动 PR head）与 `readBranchLedger`（`git show <本地已 fetch 的 ref>:<rel>`，**零网络请求**）。
  - `scripts/freshness-gate.mjs` 的 `readFreshnessLedger` 改为**机器账权威**：机器分支有这份账即以它裁决，缺失才回退工作树；本地那份即便 `verifiedAt` 更新也不采用（本地可能在自己分支、带未合并改动，与机器跑的不一定是同一份，不能替 master 作证）。
  - 三处跑法脚本（`artifact-run` / `full-suite-run` / `e2e-run`）记账点各加一次 `pushFreshnessLedger`；回写仅在 CNB 平台身份（`CNB_BUILD_USER_NICKNAME` 一组）在场时真正推，**本地 / `build:tracked` / PR 流水线一律 no-op 绝不误推**。
  - `.cnb.yml` 每日档 stage 正文**一字未改**：回写放行靠 CNB 平台身份信号而非 stage env，因此「每日档 == 单跑口正文」这一钉死判据不受影响（`tests/no-platform-ci-config.test.ts` 仍绿）。

## Added

- `tests/freshness-ledger-backend.test.ts`：钉「机器账权威 / 机器缺失退工作树 / 回写本地 no-op 守卫」三条判据；`tests/no-platform-ci-config` + `daily-tracks` + `e2e-run` 钉死判据同步 149/149 绿。
