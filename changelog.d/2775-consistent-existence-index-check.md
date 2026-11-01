## Changed

oxlint `unicorn/consistent-existence-index-check` 全仓清零：111 处 / 71 份。

`indexOf(x) >= 0` / `indexOf(x) > -1` 统一改成 `indexOf(x) !== -1`（反向的 `< 0` / `<= -1` 改成 `=== -1`）。两者对 `indexOf` 的返回值完全等价（只在 `-1` 与 `>= 0` 两个区间取值），逐行配对审计 109 对新增/删除行，只差比较符写法，零行为变更。

#2775
