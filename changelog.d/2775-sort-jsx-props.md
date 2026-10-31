## Changed

- **`perfectionist/sort-jsx-props` 全仓清零（4946 处 / 510 份）**：机械排序 JSX 属性，预设同款配置（`error`、无额外选项），零行为变更；碰到的 505 份 `src/**` 与 3 份 `.storybook/**` 按 `oxfmt` 收口（谁碰谁迁）。
- **收敛读数**：全仓两轮 `--fix` 后仍剩 8 处，集中在 `WorkflowCanvasNodePreview.tsx`（多层嵌套 JSX + 多行属性值），对该文件单独再跑一次即清零 —— 大文件的单文件复跑应进每批收尾步骤。
- 读数（2026-10-31）：该规则 0 命中；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；510 份 `eslint --max-warnings 0` 0；7 份契约 / 渲染用例 178 条通过。
