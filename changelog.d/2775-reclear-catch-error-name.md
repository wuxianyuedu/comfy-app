## Changed

- oxlint `unicorn/catch-error-name` 补齐全仓面（#2892）：127 处 / 85 份。
  上一轮「全仓清零」只覆盖 `src/**`，本次残留全部在 `scripts/**`（86 处）、
  `tests/**`（38 处）、`e2e/**` 与 `tools/**`。`catch (e)` / `catch (err)`
  统一改名为 `error`，同一作用域已有 `error` 时才用 `error_`
  （`scripts/standalone-link-repair.mjs` 一处，紧跟其后的
  `const { ok, error } = rebuild(...)` 是冲突来源）。
- `tests/app-port-vectors-timeout-classification.test.ts` 有一条「钉源码文本」的断言把
  catch 绑定的名字也钉死了（`/if \(isTimeoutLike\(e\)\)/`），改名后当场红。
  改为 `/if \(isTimeoutLike\(\w+\)\)/`：判的是「catch 里按形态分流」这条语义，
  不判绑定名 —— 钉名字会让任何等价的改名假红。
