## Changed

- **R5（`src/**` 超 900 行）从棘轮翻成硬闸**（ISSUE #1811 的 R5 项，最后一项）：
  `scripts/check-file-structure.cjs` 删掉 `--update` / `--strict` 两个旗标与
  `scripts/.file-size-baseline.json`，超限文件直接进 `problems`、命中即退 1。
  存量已清零（基础设施层 5 份 + `dev-launcher.mjs` 各自拆到位），棘轮的两个动作都无事
  可做，留下的却是一条「手改那份 JSON 就能把新超限文件登记成已知存量」的通道 ——
  那正是硬闸类本来没有的中间态（§13.6.2 的两类对照）。pre-commit 的 D 组这一步随之
  从 `check-file-structure.cjs --strict` 收成不带 flag。

## Removed

- **R5 那套 `baselineRev`「按格式时代同口径重数」的机制连同它的两个陷阱一起下线**
  （ISSUE #637 / #653）：`R5_RULE_VERSION`、`headRev()`、`linesAtRev()`、
  `BASELINE_REV_USABLE` 全部删除。它存在只为让「基线那一刻的行数」与「今天的行数」
  在同一个格式口径下可比（全库 prettier 治理会让一字未改的文件凭空多出几十行）；
  **没有基线就没有两个格式时代要拉平**，判据退化成一句「这份文件现在是不是超过 900 行」
  —— 也就不需要修订号、不需要「修订号不可达」那一支。两次事故的口径与「留给下一个做
  按行数记账棘轮的人」两条教训留在规范 §12.13.3。

## Added

- `tests/check-file-structure.test.ts` 的 R5 一组换成硬闸形态（一份超限即退 1、按行数降序报、
  测试文件与 `.d.ts` 不进扫描面），并补**两条否定式**：`--update` 这个出口已经不存在
  （既不落盘 JSON、也不放宽判定）、基线文件在场也不影响判定 —— 翻闸的正确性有一半是
  否定式的，而否定式没有任何正面判据会盯。
- `tests/doc-check-hook-wiring.test.ts` 的 R5 一组同步：钩子里那一步逐字不带 flag
  （加回 `--strict` 即红）、`.file-size-baseline.json` 不存在。
