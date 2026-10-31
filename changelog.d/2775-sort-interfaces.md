## Changed

- **`perfectionist/sort-interfaces` 全仓清零（2206 处 / 482 份）**：机械排序 `interface` 成员，预设同款配置（`error`、无额外选项），两轮 `oxlint --fix` 收敛到 0，零行为变更；碰到的 454 份 `src/**` 按 `oxfmt` 收口（谁碰谁迁）。
- **顺序取向**：`interface` 排序先于 `consistent-type-definitions`（后者把 `interface` 改成 `type`），避免同一批成员被排两次。
- 读数（2026-10-31）：该规则 0 命中；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；482 份 `eslint --max-warnings 0` 0；6 份读源码/契约用例 175 条通过。
