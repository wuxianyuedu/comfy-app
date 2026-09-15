# tools/docs/ — 文档工具入口（双击用）

| 入口 | 用途 | 逻辑 |
|---|---|---|
| `generate-docs.ps1` | 一键生成原文文档：先 `pnpm doc:check` 校验编辑文档与权威源一致，再 `pnpm doc:render` 把占位符替换成真实值写入 `docs/generated/` | `scripts/generate-docs.ps1` |

**为什么先 check 再 render**：只有编辑文档与权威源一致时，生成的「原文」才有意义——
否则读到的是一份看起来权威、实际已过期的数值副本（ISSUE #242）。

非 Windows 平台用 `pnpm doc:gen`（同一套两步，跨平台实现在 `scripts/generate-docs.mjs`）。
