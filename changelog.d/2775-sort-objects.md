## Changed

- **`perfectionist/sort-objects`（预设同款两段选项）全仓清零（14140 处 / 1319 份）**：机械排序对象字面量的键，零行为变更；碰到的 1319 份 `src/**` / `.storybook/**` 按 `oxfmt` 收口（谁碰谁迁）。
- **行为面安全读数**：含 spread 分隔的对象**不被跨越排序**（实测 `{ z: 1, ...base, a: 2 }` 原样不动；`{ ...created, nodes, edges }` 只排 spread 之后的键）；改写面 additions 与 deletions 逐行相等（16176/16176），无内容增删、无 `eslint-disable` 被摘。
- 读数（2026-10-31）：该规则 0 命中（`src` + `.storybook`，1715 份）；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；1319 份 `eslint --max-warnings 0` 0；用例交给平台「受影响用例」格（本地不跑该档，见 §13.5.25）。
