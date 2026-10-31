## Changed

- **`@typescript-eslint/consistent-type-definitions`（`["error","type"]`）全仓清零（883 处 / 506 份）**：`interface` 声明机械改写为 `type X = { … }`，零行为变更；碰到的 506 份 `src/**` 与 `.storybook/**` 按 `oxfmt` 收口（谁碰谁迁）。
- **顺序取向**：本批排在 `sort-interfaces` 之后（先排成员，再改声明形态），并在本批内**重跑一次 `perfectionist/sort-object-types`** —— 改写后的对象字面量由它兜底，实测 0 处新增。
- 读数（2026-10-31）：该规则 0 命中（`src` + `.storybook` 1715 份）；`perfectionist/sort-object-types` 重跑后 0；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；506 份 `eslint --max-warnings 0` 0；用例交给平台「受影响用例」格（本地不跑该档，见 §13.5.25）。
