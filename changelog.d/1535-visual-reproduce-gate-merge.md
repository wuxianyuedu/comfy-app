## Fixed

- **`visual-reproduce-gate.mjs` 在合并提交里读不到「被合进来那侧带进来的基线」**，
  把一条**合法的合并提交**判成「上一批忘了抹账」而永久拦死（ISSUE #1535 解冲突现场）。
  `git diff --cached --name-only` 在合并态下报的是相对**第一父（HEAD）**的整份差 ——
  由对方分支带进本次合并的基线 PNG 一个字都不出现，于是判决读到的形状是
  「一张基线都没动，却留着 `scripts/.visual-reproduce-ledger.json`」。
  新增 `withMergeHeadBaselines()` 补全这一格：合并态下**与第二父也不同**的基线
  同样算法定改动（非合并态原样返回，判决面一行不放宽）。
  判据与 `shell-gate.mjs` 的 `dropAdoptedShellInputs` 同族，不复写第二份「合并态下谁算改动」。

## Tests

- `tests/visual-reproduce-gate.test.ts` 补 4 条：非合并态恒等、合并态补全、
  与第二父相同的基线**不**补进来（不放松）、以及 `rev-parse` 口径在 worktree 下也成立
  （`.git` 是文件时拼路径会静默落空）。变异验证：把补全去掉后第 2 条当场红。
