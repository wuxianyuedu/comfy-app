## Changed

- **基础设施层 900 行以上的存量从 5 份拆到 1 份**（ISSUE #1811，「逐步把棘轮改成硬闸」这一批）。`scripts/check-infra-file-size.cjs` 的基线 `total` 随之从 5 收到 **1**：

| 文件 | 拆前 | 拆后 | 拆法 |
| --- | --- | --- | --- |
| `check-ui-primitives.cjs` | 4528 | 804 | 声明层拆出 6 份（`RULES` 按 P 编号区间切四片 + 扫描面/豁免 + 按文件豁免表） |
| `dev-launcher.mjs` | 1540 | 953 | 预检 / 端口回收 / 桌面壳 / 依赖与下游 / 杂项各成 `launcher-core/*.mjs`，主文件只留同名薄包装与 `run()` 编排 |
| `base-check.mjs` | 1382 | 648 | git 与 ref / 钩子解析 / 判决三层拆出，导入面 22 个导出**逐字不变** |
| `check-file-structure.cjs` | 1213 | 813 | 常量与清单表收进 `file-structure-rules.cjs` |
| `check-theme-colors.cjs` | 901 | 652 | `EXEMPT_TABLES` 收进 `theme-color-exemptions.cjs` |

- **剩下的那一份是启动编排本体**：`scripts/dev-launcher.mjs` 953 行，其中 `run()` 约 490 行（规范 §1–§3 的「全平台唯一编排者」）。拆它属于结构性重构、该有独立设计与回滚路径，**不在「拆文件」这一批里**。因此这一档**仍是棘轮**，不翻硬闸 —— 翻闸前提是基线为 0，与 §12.12 / §12.13 同一口径。

## Fixed

- **`copyGateDeps` 覆盖不到「拆出来的嵌套依赖」**：用例夹具（`check-theme-colors.test.ts`）此前只把主脚本拷进临时仓库，脚本一拆就 `MODULE_NOT_FOUND`，而那条红看着像「判据坏了」。这类夹具改用共享件 `copyGateDeps` 沿 `require("./x.cjs")` 递归补齐。

## Tests

- 读源码断言的用例（`cross-platform-launcher.test.ts` / `dev-launcher-toolchain-gate.test.ts` / `shell-gate.test.ts` / `dev-launcher-dependency-sync.test.ts` / `check-ui-primitives.test.ts` / `check-theme-colors.test.ts`）改指**实现所在的那一份**，并把「主文件 + 拆出的几份」拼成一份链路源码再断言 —— 只读主文件时 `indexOf` 会落空、`slice` 拿到空串，`not.toContain` 一类断言**静默变成空转**。
- `check-ui-primitives.test.ts` 的 `demoteToRatchet` / 分档自检两处改指声明层（`ui-primitives-scope.cjs` 与 `ui-primitives-rules-p67-p86.cjs`）。

## Docs

- 规范 §12.6「R5 的姊妹档」与 §12.13 文件行数那一档：记明五份的拆法、基线收敛到 1 份的现状、以及剩下那一份为什么**不在这一批里**（编排本体，另立设计）；§18.5 同步一句。
