## Changed

oxlint `eslint/prefer-object-has-own` 全仓清零（#2775）：10 处 / 7 份，`Object.prototype.hasOwnProperty.call(obj, key)` → `Object.hasOwn(obj, key)`。

两者是 ES2022 里的同一件事（`Object.hasOwn` 就是把这个调用收成内建，参数与 ToObject 语义一致），`tsconfig` 的 `lib` 已是 `ES2022`，仓内 `scripts/ci-run-tool.mjs` 等也已经在用。

fixer 收敛全部；两处产物写成 `! Object.hasOwn(…)`（`!` 后多一个空格），手工规范化。

整条规则 0 命中（2405 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 230 份（固定 91 + 受影响 139）本地两段都跑绿（91/91、139/139）。
