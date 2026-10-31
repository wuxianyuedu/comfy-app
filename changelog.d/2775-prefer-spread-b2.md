## Changed

oxlint `unicorn/prefer-spread` 全仓清零（#2775）：76 处 / 48 份，`Array.from(x)` / `arr.slice()` / `arr.concat(y)` → 展开语法。本批 70 处 / 42 份（库层中枢 6 份的 6 处见上一批）。

手改 9 处 fixer 不动的 `arr.concat(x)`：`use-workshop-agent` 的两条上限裁剪、`render-lock-diff`、`check-file-structure`、`single-logger-channel`（两处目录拼接）。fixer 产物里 5 处被 `unicorn/no-useless-spread` 判为多余展开的就地化简：`for…of` 直接迭代 `map.keys()` / `FileList` / `styleSheets`，`filter()` 结果本就新数组，`[el, ...el.children]` 不必再包一层。

平台「受影响用例」格抓到一处夹具不全：三份用例的 `FileList` 假体只有 `length` + 下标（无 `Symbol.iterator`），生产侧改成 `for…of` / 展开后它们抛 `files is not iterable`。真实 `FileList` 本就可迭代，所以修在夹具侧——新增 `tests/helpers/fake-file-list.ts` 统一构造可迭代假体，`use-material-library` 与 `file-picker` 的用例改用它（`file-picker` 的 `[...call[1]]` 断言随之恢复）。

语义核对：`[...querySelectorAll(...)]` / `[...map.values()]` / `[...new Set(...)]` 在 ES2022 lib 下都可迭代、浅拷贝且同序；`[...prev.slice(-N), msg]` 与 `prev.slice(-N).concat(msg)` 等价。整条规则至此全仓 0 命中（2404 份扫描）。`tsc --noEmit`、eslint 通过；本批受影响用例闭包按平台同一条判决链本地复跑 106 份 / 1635 条全绿。
