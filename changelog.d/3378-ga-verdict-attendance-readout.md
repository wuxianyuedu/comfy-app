## Changed

- **GA 回调骨架的接线口径修正 + 回调腿出勤对账（ISSUE #3378）**：更正上一版「刻意休眠 / 配好 secret 之前不会自己送结论」的措辞 —— `pr-gate.yml` 收尾 job 带 `if: always()`、无开关，`CNB_TRIGGER_TOKEN`（GitHub 仓库侧 Actions secret）在场时每次 GA run 收尾都会发回调；「回调腿发没发」改为 `pnpm ga-verdict:attendance`（`scripts/ci-ga-verdict-attendance.mjs`）做只读对账，只念 CNB 侧 `api_trigger_ga_verdict` 事件的 build 出勤，0 出勤不等于 GA 判红（GA run console 不在这枚令牌读权内）。把「被 cancel 的占位会否仍写终态」那格探针补成实测闭合：cancel 不落成拉红聚合的终态，`cancel-in-progress: true` 锁方案成立，不需要 `stop-build` 或单写者。**仍不接承重主列**：`质量门禁` 判决链一字未动、PR 事件上不自动起占位，转正（起占位 + §13.5.33 判决链退场）仍是单独一次决定。
