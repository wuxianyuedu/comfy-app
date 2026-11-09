## Changed

- **ESLint 退役残留批次 2 · 失效 disable 存量清零**：按 `--report-unused-disable-directives` 的判定摘除 923 条未压住任何诊断的 `oxlint-disable` 指令（399 个文件，含 `pagination.tsx` 的文件级成对 disable/enable 与 `scripts/.a11y-rule-ledger.json` 对应的就地豁免条目）；全库读数 923 warnings → 0，`pnpm lint` 仍 0/0。
- **顺带把「已清零规则集」改成真清零**：删掉的指令里有 246 处是 `check-oxlint-zero-rules` 探针（把 41 条已清零规则抬到 error）依赖的台账禁用，删后暴露 156 处 `== null` / `!= null`、85 处箭头简洁体 `void` 与 5 处零散形态。本批按语义等价改写：`== null` → `(x === null || x === undefined)`、`() => void promise()` → `() => { void promise(); }`（`void` 落到 `allowAsStatement` 放行的语句位，`no-floating-promises` 仍被满足），探针在零豁免下仍 0 命中。
- **`unused-imports` 去 jsPlugin 化完成可行性判定，结论「不摘」**：该包是 `oxlint-config-awesomeness@4.7.1` 的 peerDependency，实测摘掉 devDependency 后 lockfile 只少 3 行、包仍由 peer 装回；对拍显示 `no-unused-vars` 与 jsPlugin 的 import 命中集合完全重叠，但原生规则无 `--fix` 删 import 能力。等上游给开关或 oxlint 原生规则补等价 fix；预设 / oxlint 升版、`pnpm lint --fix` 行为变化时复审。
