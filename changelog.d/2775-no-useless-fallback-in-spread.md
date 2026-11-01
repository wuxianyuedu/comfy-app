## Changed

oxlint `unicorn/no-useless-fallback-in-spread` 全仓清零：25 处 / 17 份。

对象字面量里的 `...(x ?? {})` / `...(x || {})` 改成 `...x`：对象展开对 `null` / `undefined` 是空操作，`{}` 兜底不改变结果。`scripts/launcher-core/run.mjs` 那处保留了 JSDoc 类型断言（`meta.pids` 在 `Record<string, unknown>` 下是 `unknown`，去掉断言会 TS2698），只去掉 `?? {}`。

#2775
