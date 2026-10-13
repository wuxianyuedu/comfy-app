## Added

- **`context7` MCP：查第三方库「本仓锁定的那个大版本」的官方文档**（ISSUE #1850）。本仓依赖走在很新的线上（Next 16 / React 19 / drizzle 0.45 / tRPC 11 / better-auth 1.7 / Tauri 2），模型的训练数据大概率滞后，最典型的失败形态是「代码写得很像对的、`tsc` 也许还能过，但用的是上一个版本的用法」。新增的第三个 MCP 按 libraryId + 主题返回**版本特定**的文档与代码示例。
  - 声明进 `.mcp.json`，走 `pnpm dlx @upstash/context7-mcp@4.3.0`（AGENTS 硬规则 1：只用 pnpm，不写 `npx`）；版本钉在那一处。
  - **边界收在 project Skill 里**（`.qoder/skills/version-docs/SKILL.md`，本主题的唯一出处）：它**治「库的 API 漂移」，不治「依赖的版本漂移」**——后者本仓已有三层判据（`check-deps-freshness.mjs` ①②③ + 解析层探针），别合并（§13.5.13 的立案现场同形）；它给的永远是「库的官方文档」，**不是「本仓的约定」**，与本仓规范冲突时以本仓为准。
  - 与本仓另两个 MCP 同一条红线：**门禁判据只在 `scripts/check-*.cjs` 与 `.githooks/pre-commit`**，MCP 输出不构成「这条判据过了」的依据。
  - 它是三个 MCP 里唯一需要外网的（`codegraph` / `zvec-grep` 纯本地）；取不到文档时如实说「没查到」，**不要凭记忆补一个看起来合理的答案**——那正是本 Skill 要治的病。
