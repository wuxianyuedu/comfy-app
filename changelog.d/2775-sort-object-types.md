## Changed

- **`perfectionist/sort-object-types` 全仓清零（1916 处 / 624 份）**：机械排序对象类型字面量的成员，预设同款配置（`error`、无额外选项），两轮 `oxlint --fix` 收敛（1916 → 694 → 0），零行为变更；碰到的 478 份 `src/**` 与 6 份 `.storybook/**` 按 `oxfmt` 收口（谁碰谁迁，其中 47 份原先就带格式漂移）。
- **插件规则的单规则临时配置要保留预设**：`-c` 会整体替掉 `oxlint.config.ts`，插件名随之消失（`Plugin 'perfectionist' not found`）。写法是 `.git/oxlint-one-rule.mjs` —— `{ ...awesomeness, categories 五项全 off, rules: { 该规则: error } }`；`.json` 单规则配置只对 eslint 核心规则（`curly` / `array-type` 那批）成立。
- 读数：全预设 `oxlint` 下该规则 0 命中；`tsc --noEmit` 0；`check:scripts-types` 判决面 222 份 / 存量 0 处；624 份 `eslint --max-warnings 0` 0；6 份读源码/契约用例 175 条通过。
