## Changed

#2777：eslint 侧最后三条**限制类策略**迁到 oxlint jsPlugin，`lint:policy` 由 16 条降为 14 条
（eslint 本体与依赖仍保留，只做规则迁移）。

- `no-restricted-syntax`（store selector 里现拼对象 / 现造新数组，ISSUE #1780）→
  `oxlint.parity.config.mjs` 的 `eslint-js/no-restricted-syntax`（条目原样，含 `STORE_SELECTOR_HOOKS`）。
- `no-restricted-syntax`（router 只许抛 `TRPCError`，台账 E8）→ 同一条规则，
  `src/server/api/routers/**/*.ts` 且 `excludeFiles` 仍排除 `*.test.ts`。
- `no-restricted-imports`（`src/components` / `src/features` 禁直连 `drizzle-orm`）→
  `eslint-js/no-restricted-imports`，`patterns` 与文案逐字沿用。
- 三条的诊断文案一字未改；`eslint.config.js` 不再保留 selector / 清单常量，`STORE_SELECTOR_HOOKS`
  的唯一出处回到 `oxlint.parity.config.mjs`（`oxlint.config.ts` 同源一份，用例逐字核）。
- 新增对拍用例 `tests/oxlint-policy-rules.test.ts`：从真判决配置取条目 → 现生成最小探针配置 →
  **真跑 oxlint CLI**，断言正反样本命中与文案逐字一致；并核 eslint 侧规则名集合恰为 14 条、
  不再含 `no-restricted-*`。`tests/router-error-envelope.test.ts` / `tests/store-selector-shape.test.ts`
  的配置读取面同步改到 `oxlint.parity.config.mjs`。

验证：`pnpm lint`（两档）、`pnpm lint:policy`、`tsc --noEmit`、相关 vitest、`pnpm check:premerge` 全绿；
三条规则在全仓（`lint:oxlint` 判决口径）0 命中。
