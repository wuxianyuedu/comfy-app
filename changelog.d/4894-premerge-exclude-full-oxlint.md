## Changed
- 本地 pre-push 的合并前复算批不再收全仓 oxlint 全量档（#4894）：平台 `ci-heavy-gates.mjs` 读同一份钩子注册表已判同一件事（GA PR 档在场且绿），本地本检出 + 快照两侧各 42–146s 的重复判定只推高复算墙钟。摘的是复算批不是判据——钩子步骤行、D 组登记与 `quality-gate` 的 `oxlintZeroRules` 全部保留，手工 `pnpm check:all` 与显式点名的 `base-check <label>` 仍可诊断；唯一登记面 `PLATFORM_ONLY_IN_BASE`，`tests/base-check.test.ts` 双向核对，同步更新规范 §13.5.32 / §13.6.2.1。
