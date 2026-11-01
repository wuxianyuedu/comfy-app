## Changed

oxlint `typescript/no-unnecessary-template-expression` 全仓清零（#2775）：27 处 / 21 份，把只包一个表达式的模板字面量拆回表达式本身（`${x}` → `x`），与相邻的 `+` 拼接保持原样。

这批全在「字符串已经确定是 string，外面还套一层模板」的形态上：`${path.relative(a, b)}`、`${error.message}`、`${code ?? "unknown"}`，以及拼在一长串 `+` 里的最后一段。上下文都是模板嵌套或显式类型收窄过的地方，字符串结果逐字不变。

两处操作口径值得记下：

- **这条是类型感知规则**：单规则配置会把 `options` 清空、连带关掉预设的 `typeAware`，没有 `--type-aware` 时 oxlint 只报 `0 rules`（不是「已清零」）。判据要带这个旗标跑。
- fixer 会在 4 处留下多余括号（`(x).trim()`、`console.log((expr))`、`f(("a".repeat(64)))`），已手工收干净 —— 括号不影响语义，但会让人以为这里刻意加过什么。

整条规则至此全仓 0 命中（2415 份扫描，`--type-aware`）。
