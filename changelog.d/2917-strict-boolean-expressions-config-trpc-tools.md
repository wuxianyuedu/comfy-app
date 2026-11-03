## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 20（收尾）：
  `src/config` / `src/trpc` / `tools` 零星 12 处 / 4 份清零，
  全仓归零（1115 → 0）**（ISSUE #2776 / #2917）：
  `config/custom-nodes.ts` 9 处（`colorFor` 分类双判、manifest 外部 JSON 的
  null 条目防御改 `Boolean(n)` 中转变量、`required`/`outputNode`/
  `frontend_only` 可空布尔 `=== true`、包名双判、`res.json()` 的 `unknown`
  先正向收窄再 `Boolean` 中转）、`trpc/base-url.ts` 与 `trpc/link.ts`
  各 1 处（`VERCEL_URL` 双判、`withLogger !== true`）、
  `tools/workshop-mcp-http.ts` 1 处（`req.url?.startsWith(…) === true`）。
  - 验证：全仓 `pnpm exec oxlint --format json` 复扫
    `typescript/strict-boolean-expressions` **0 残留**，其余规则计数与基线持平
    （无新增 `eqeqeq`、无新增禁用指令）；全量 `tsc --noEmit` 绿、
    `vitest run tests` 绿。台账
    `log/tools/sbe-remaining-2026-11-02.md` 勾稽链闭合（1115 → 0）。
