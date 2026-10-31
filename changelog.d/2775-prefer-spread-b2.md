## Changed

oxlint `unicorn/prefer-spread` 全仓清零（#2775）：76 处 / 48 份，`Array.from(x)` / `arr.slice()` / `arr.concat(y)` → 展开语法。本批 70 处 / 42 份（库层中枢 6 份的 6 处见上一批）。

手改 9 处 fixer 不动的 `arr.concat(x)`：`use-workshop-agent` 的两条上限裁剪、`render-lock-diff`、`check-file-structure`、`single-logger-channel`（两处目录拼接）。fixer 产物里 5 处被 `unicorn/no-useless-spread` 判为多余展开的就地化简：`for…of` 直接迭代 `map.keys()` / `FileList` / `styleSheets`，`filter()` 结果本就新数组，`[el, ...el.children]` 不必再包一层。`file-picker.test.tsx` 的 `[...call[1]]` 撞上夹具是类数组（`{...files, length, item}`、无 `Symbol.iterator`），改为按 length / 下标断言。

语义核对：`[...querySelectorAll(...)]` / `[...map.values()]` / `[...new Set(...)]` 在 ES2022 lib 下都可迭代、浅拷贝且同序；`[...prev.slice(-N), msg]` 与 `prev.slice(-N).concat(msg)` 等价。整条规则至此全仓 0 命中（2404 份扫描）。`tsc --noEmit`、eslint 与改动的 17 份用例（207 条）通过。
