## Added

- 新增 `pnpm report:session --range <A>..<B>`（`scripts/session-report.mjs`，ISSUE #3165）：一次开发批次的**汇报骨架**一条命令出——五节规范格式（做了什么 / 验证读数 / 开发总结 / 经验与可复用 / 待处理提单），事实段机器填（区间内提交逐条带 sha / PR 号 / 变更面；验证批逐条**计时 + 退码**，红的步骤点名并完整转述输出末尾，不冒充「全过」），判断三节留人填的骨架；待办给出可直接粘贴的 `pnpm ship --new-issue` 命令形状，立案动作归 ship、工具不写平台。「本次」的边界由 `--range` 显式给（区间解析复用 `reformat-scan-core` 的 `parseRange`）；`--steps-file` 可换验证批。登记面：读账面工具不是判据也不是档（GATES / 按需档不收），发现面在 §12.20 标本段与动词本身。
