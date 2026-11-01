## Changed

- oxlint `typescript/no-confusing-void-expression` 第 2 批：`src/app/**` 清零
  （117 处 / 24 份，ISSUE #2918）。形态与第 1 批一致：

  - 箭头简写 → 块体：`(v) => c.patchSettings({…})` / `() => onCopy()` 这类一律换块体；
  - `(next) => !next && d.closeDialog()` → `(next) => { if (!next) d.closeDialog(); }`
    （`&&` 短路写法在块体里没有藏身之处，语义等价）；
  - 两处 `ReadableStream` 的 `send = (ev) => controller.enqueue(...)` 换块体
    （`enqueue` 的返回值是 `void`，没有调用方读它）。

  验证：单规则复扫 `src/app/**` 0 命中；`tsc` / `eslint` / `oxfmt` 通过；
  改动面受影响用例 4 份 124 条全绿。
