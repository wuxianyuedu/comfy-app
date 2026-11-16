## Added

- 新增 `pnpm ship:wait`（`scripts/ship/wait-for-ship.mjs`）：轮询 `ship --result` 的结构化落盘读数直到 ship 出终态——短间隔 + 明确终止条件 + 总上限（超限退 4），坏消息（红 / 没结论）立即返回，替代「即兴 sleep + 按行号截输出」的等待方式（#4118）
- 新增 PreToolUse 钩子 `scripts/agent-hooks/sleep-guard.mjs`：拦下单条 ≥60s 的 sleep 命令并把出口指向 `pnpm ship:wait` / 只读回读口；<60s 短退避放行，入参解析失败 fail-open（#4118，AGENTS 硬规则 32）
