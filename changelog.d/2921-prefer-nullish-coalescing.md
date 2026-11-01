## Changed

oxlint `typescript/prefer-nullish-coalescing` 收口（#2776 的逐条 PR）：该规则全仓 **0 命中**。

按单子给的打法逐处回答「左边的假值（`0` / `''` / `false`）该保留还是该走默认值」，**没有盲跑
`--fix`**：222 处里绝大多数是脚本面（`scripts/ui-primitives-rules-*.cjs` 那 96 处为主），其中
`X.match(...) || []` 这一族是纯等价改写（正则 `match` 只回 `Array | null`，空数组走不到），
改成 `?? []`；`Map.get(k) || 初值`、`env.X || 默认值`、可缺省入参的 `(x || "").trim()` 同理。

**语义上就该是 `||` 的 6 处挂台账禁用并写清理由**，它们都是「空串/假值也要走默认值」的形态，
不是空值回落：`check-app-port-vectors.cjs`（子进程失败时 `stdout` 是空串，要回退 `message`）、
`heal-db.cjs`（两路输出拼接）、`run-ast-gates.cjs`（异常可能没有 `message`，要念异常本身）、
`premerge-proof.mjs`（`run()` 的空串就是失败信号）、`agent-film.mjs`（一律兜成空快照）、
`repair-imports.cjs` / `render-doc-placeholders.cjs` / `check-dependency-audit.mjs` 与
`ci-install-deps.mjs` / `ci-workspace-probe.mjs` / `dev-drive-probe.mjs` 同族。

另有两处改成形态改写、不留禁用：`check-a11y-rules.cjs` 的两处缓存哨兵由「判 `=== null`」改成
`??=`（原写法被规则判成该用 `??=`，改完语义与「rejected promise 也要缓存」的既有说明一致）；
`check-dependency-audit.mjs` 的三级稳定序从 `a || b || c` 链抽成 `compareBlocked()`（比较器里
`0` 的意思是「相等、接着比下一档」，不是空值回落 —— 列表里 `||` 链只剩规则对链首的一次报告）。

**还剩 4 处不影响验收**：`check-code-duplication` / `check-function-length` / `check-theme-colors`
的 `isTestFile` 判定与 `check-rust-function-length` 的同名函数，是「正则 `.test()` 命中或
后缀命中」的布尔或，`??` 换上去会把 `false` 当成「有值」直接返回 `false`，语义就反了 ——
它们是**规则自身的误报形态**（规则把布尔或当降级取值），留着不动也不产生行为回归。

读数：`oxlint` 该规则只剩上述 4 处；改到的判据脚本逐个跑过自测入口（`check-*` 一族 19 份全绿、
`check-ui-primitives` 86 条硬闸 0 命中、`check-a11y-rules` 32 条口径不变）；`tsc --noEmit` 0、
`check:scripts-types` 229 份 0 处；受影响用例 `ship*` / `lockfile-diff` / `ui-primitives` /
`base-check` / `ci-build-readout` / `dependency-audit` 等 648 条通过（`ci-build-cache-slot` 1 条与
`dev-drive-tune` 2 条是 `G:` 盘 / Windows 卷判据在 Linux 容器上的既有红，回退脚本后同样红）。

#2921
