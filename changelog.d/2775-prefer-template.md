## Changed

- **`eslint/prefer-template` 全仓清零（68 处 / 48 份）**：字符串拼接机械改写为模板字面量，零行为变更；碰到的 48 份 `src/**` 按 `oxfmt` 收口（谁碰谁迁）。
- 读数（2026-10-31）：该规则 0 命中（`src` + `.storybook`，1715 份）；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；48 份 `eslint --max-warnings 0` 0。
