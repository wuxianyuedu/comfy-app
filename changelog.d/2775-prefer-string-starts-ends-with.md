## Changed

oxlint `unicorn/prefer-string-starts-ends-with` 全仓清零：12 处 / 8 份。

`/^prefix/.test(x)` → `x.startsWith("prefix")`、`/suffix$/.test(x)` → `x.endsWith("suffix")`，两边都是「固定字面量锚定」的形态，语义等价。`scripts/check-file-structure.cjs` 那处把转义过的 `^\/\* …` 手写成 `startsWith("/* …")`（正则里要转义的字符在字符串里不转义）。

fixer 在 `.cjs` 里产单引号，已按本仓双引号口径改回；`.cjs` 不在 oxfmt 的判据面内，这一改是手工补的。

#2775
