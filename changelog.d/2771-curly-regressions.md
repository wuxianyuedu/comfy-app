## Fixed

- **`curly` 在后落地代码上的 57 处回归清零**：`#2784` 落地 curly 批之后合入的 8 份文件又长出不带花括号的单语句体（`series.ts` 的角色库实体化、`ci-daily-bundle-escalation.mjs`、`use-series-organizer.ts`、`SeriesCharacterLibrary.tsx` 与 3 份用例）。按单规则配置 `oxlint -c node_modules/.oxlint-one-rule.json --fix` 清零（`categories.correctness=off` + `curly: error`），零行为变更；碰到的 4 份 `src/**` 按 `printWidth: 100` 收口（谁碰谁迁）。
- 读数：该规则在这 8 份上 `0 warnings / 0 errors`；`tsc --noEmit` 0；相关 4 份用例 105 条通过；`eslint` 0。
