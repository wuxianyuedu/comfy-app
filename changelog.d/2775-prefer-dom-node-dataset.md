## Changed

- oxlint `unicorn/prefer-dom-node-dataset` 全仓清零（#2775）：40 处 / 22 份。
  39 处由 fixer 自动改写（`getAttribute("data-x")` / `hasAttribute("data-x")` /
  `removeAttribute("data-x")` → `dataset.x` / `Object.hasOwn(dataset, "x")` /
  `delete dataset.x`），最后一处（`LogPanel.test.tsx` 的 `removeAttribute`）fixer
  不认泛型、手工补齐；fixer 留下的 14 处 `Element` 类型错误逐个补
  `querySelector<HTMLElement>` 泛型（`json-viewer.tsx` 的生产代码同样处理）。
- 1 处落台账禁用：`e2e/critical-flows.spec.ts` 的 Playwright `Locator` **没有**
  `dataset`，只能 `getAttribute`。
- `hasAttribute` → `Object.hasOwn(dataset, key)` 语义等价（属性在即为自有键，
  空串属性同样命中），改后同名用例全绿。
