## Fixed

- **`pnpm db:migrate` 在 push 管的检出上不再把「账本空、结构已收敛」误报成「迁移没应用全、别直接起应用」**（ISSUE #3665，`scripts/db-migrate.mjs`）。

  历史上由 `pnpm db:push` 管结构的既有检出里，`__drizzle_migrations` 账本恒为空（push 不写账），而库结构早已与当前 `schema.ts` 收敛；启动链路走 schema 摘要 + push，也不读迁移账本。但 `db:migrate` 的账本断言把「`drizzle/` 有 N 份、账本记了 0 份」一律判成迁移中途停下，给出「库里现在的结构可能是半途状态，**别直接起应用**」的硬话术 —— 对这类检出既不成立也误导。

  现在当账本为 0 且 `probeSchemaFresh` 判定 schema 已收敛（指纹相符）时，按读数返回并明确说明：本检出的库由 `pnpm db:push` 管理（迁移账本为空、结构已收敛，可直接起应用），迁移账本只对生产 / 崭新库有意义。若账本不一致且结构**并未**收敛，仍保留原有硬话术。
