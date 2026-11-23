## Fixed
- `tests/check-bundle-budget.test.ts` 的「src/ 侧其后一次提交都没有」用例在 Linux/CI 上偶发红（#4848）：`--update` 写下的 `generatedAt` 与夹具 seed 提交同日，`git log --since 今天 00:00` 把 seed 算成 1 次主干提交，与断言的 0 矛盾。把该夹具的基线日期推到 seed 之后一天，让「基线修订号不可达 → 按日期归因」这条合法分支稳定落到 0；判据本体 `check-bundle-budget.cjs` 与断言口径都不放宽。本地 Windows 上该套件按既有约定整块跳过，由平台侧跑绿验真。
