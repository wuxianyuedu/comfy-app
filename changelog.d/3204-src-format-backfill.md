## Changed

全库档 `check-format` 在 `src/**` 的 69 份 oxfmt 存量一次性补齐（纯格式化，ISSUE #3204）。

- 基线：HEAD `e214ea393` 上 `node scripts/check-format.cjs --report` ⇒ 69 份未过，全部在 `src/**`
  （`src/lib` 53、`src/components` 13、`src/app` 1、`src/trpc` 1、`src/env.js` 1）。
- 为什么没被带走：`--changed` / `--staged` 两档只判改动面，存量文件没被再碰就不进任何判决面。
- 验证：逐份 AST + 注释原文与改动前一致（69/69，0 处真实代码改动）；`check-reformat-only` 判纯格式化。
- 与 #3196 的区别：那一单是增量档漏判（`scripts/**`、`tests/**`，已随 #3194 修复），本单是全库档的
  `src/**` 存量；不碰 #2710 的另一批存量，不改配置、不新增 lint 禁用。
