## Changed

oxlint `unicorn/prefer-at` 全仓清零（#2775）：63 处 / 47 份，`arr[arr.length - 1]` / `arr.slice(-1)[0]` → `arr.at(-1)`。

逐条核对改动点全是普通数组 / 字符串取尾元素：`at(-1)` 与下标写法等价（空数组同为 `undefined`），原有的 `?.` / `!` / `??` 兜底保持不变。四处 `--fix` 结果破坏类型后手工收口：一处可选链被吃掉（`logs.at(-1)` → `logs?.at(-1)`，否则 tsc TS18048），三处 `NodeListOf<Element>` 上的 `.at()` 解析不出（`document.querySelectorAll` 结果先 `Array.from` 再取尾）。`tsc --noEmit` 与 eslint 均通过。
