## Changed

oxlint `unicorn/prefer-string-replace-all` 全仓清零（#2775）：316 处 / 165 份，`.replace(/…/g, x)` → `.replaceAll(…)`。改动面撑出「受影响用例」格的墙钟预算（411 份 × 3.6s ≈ 24.7 分钟 > 剩余 18.9 分钟），按规范 §13.5.8.2「拆小」分 4 批落地，本条记录整条规则的收官口径。

语义逐条核对：被替换的 316 处全部是**带 `g` 标志的正则**（含 `PARTIAL_SGR_RE` / `NON_SGR_RE` 等具名常量），`replaceAll` 与全局 `replace` 的匹配 / `$` 替换语义一致；`--fix` 把无元字符的定长模式进一步写成字符串（如 `replace(/\\/g, "/")` → `replaceAll("\\", "/")`），同样是「全部替换」。不带 `g` 的 `replace`（如 `replace(/^\.\//, "")`）一律保留原样。fixer 新引入的 107 处单引号模式串已按仓库约定改为双引号。`tsc --noEmit`、eslint 与相关 10 份用例（264 条）均通过。
