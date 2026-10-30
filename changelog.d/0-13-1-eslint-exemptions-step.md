## Fixed

- **§13.1 清单补回 `check-eslint-exemptions.cjs` 那一步**（不是本 PR 引入的红）：
  `pnpm doc:check` 在 `origin/master` @ `fa73d1f8` 上就已经红 ——
  `node scripts/base-check.mjs "node scripts/check-doc-references.cjs"` 的结论是
  `baseline-red（本检出 1，origin/master @ fa73d1f8 1）`，两边逐字同一条：
  「`.githooks/pre-commit` 这一步真的在跑 `node scripts/check-eslint-exemptions.cjs`，但
  §13.1 清单里没有这条」。钩子在 #2607 第 3 条加了那一步、§13.5.31 写了它的口径，
  而 §13.1 那份「手跑全套的唯一入口」漏了一行 ⇒ 照着清单跑的人以为它不存在。
  顺手收掉（判据一字未改，只补文档那一行 + 同批镜像）：`tests/check-doc-references.test.ts`
  64 条恢复全绿。
