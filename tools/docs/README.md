# tools/docs/ — 文档工具入口（双击用）

| 入口 | 用途 | 逻辑 |
|---|---|---|
| `generate-docs.ps1` | 一键生成原文文档：先 `pnpm doc:check` 校验编辑文档与权威源一致，再 `pnpm doc:render` 把占位符替换成真实值写入 `docs/generated/` | `scripts/generate-docs.ps1` |
| `generate-api-docs.ps1` | 一键重生成 TypeDoc 产物 `docs/api/**`（= `pnpm run docs`）：跑 typedoc，并按产物判成败（退出 0 却没写的失败会重试，全失败退非零） | `scripts/generate-api-docs.mjs`（跑 + 验 + 重试在 `scripts/typedoc-run.mjs`） |

**为什么先 check 再 render**：只有编辑文档与权威源一致时，生成的「原文」才有意义——
否则读到的是一份看起来权威、实际已过期的数值副本（ISSUE #242）。

非 Windows 平台用 `pnpm doc:gen`（同一套两步，跨平台实现在 `scripts/generate-docs.mjs`）。

**API 文档（`docs/api/**`）是另一条**：TypeDoc 产物，跨平台入口是 `pnpm run docs`
（`scripts/generate-api-docs.mjs`），Windows 双击用 `generate-api-docs.ps1`。
⚠️ **它不再进 git**（ISSUE #2231，`.gitignore` 的 `docs/api/`）—— 生成出来的那份
只在本机；平台侧那一格「API 文档生成与自检」自己生成一份自己用（`pnpm docs:check`
生成 + 自检），**没有「一并提交」这回事**。
