## Changed
- 本地 pre-push 合并前复算批不再收 B 组整条全仓 lint（#4904），平台 `ESLint 零警告` 格成为唯一执行者：判据仍是同一份 `pnpm run lint`、同一扫描面，覆盖面不丢。诊断显示 B 组单次 246–609s，其中约 90% 的规则执行时间花在 `eslint-plugin-boundaries`（按 `boundaries/elements` 元素表为每个文件构建整棵项目依赖图；src 面去掉它 309s→28s，命令行 `-A` 只压诊断不省时间）；type-aware 的 TS 程序构建是另一笔约 122–153s 的固定成本。登记在 `PLATFORM_ONLY_IN_BASE`，`tests/base-check.test.ts` 双向核对，同步更新规范 §13.5.25 / §13.5.32。
