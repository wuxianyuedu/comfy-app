## Changed

- oxlint `unicorn/text-encoding-identifier-case` 补齐全仓面（#2892）：23 处 / 11 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次落在 `tests/**`、`scripts/**`、`e2e/**`：
  `readFileSync` / `toString` / `appendFileSync` 的编码参数 `utf-8` → `utf8`
  （Node 的等价别名，解码结果不变）。
  `tests/ci-console-encoding.test.ts` 有一条不是编码参数，而是「探针话术里印了
  UTF-8 字样」的断言：改成正则 `/UTF-8/` —— 若照 fixer 改成 `"utf8"`，同一文件里
  的编码参数会让这条断言假绿。
