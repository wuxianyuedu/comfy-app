## Fixed

- **`tests/premerge-check.test.ts` 起子进程时不再裸继承环境**：这一份用例每一段都在
  **真检出**上敲 git，而继承来的 `GIT_DIR` / `GIT_INDEX_FILE` 一族（git 导给它自己起的
  钩子）与平台那一跑的 `CNB_PULL_REQUEST_TARGET_SHA` / `CNB_COMMIT` /
  `CNB_PULL_REQUEST_MERGE_SHA`（ISSUE #2787）都会把「分叉点是哪一条」问成另一个问题 ——
  本机问的是 `origin/master` 的分叉点，平台上问的是那一跑的 sha。
- 改法：`run()` 与四处临时仓库的 git 调用一律过 `gitSandboxEnv()`（唯一一份清单，
  §12.18）；把那一族当**被测输入**的用例显式 `run([...], { … })` 传。`tests/setup.ts`
  那一道只在 worker 启动时剥一次，夹具自己起的子进程不该指望上游清理过
  （同 `gate-repo.ts` 那句「共享夹具要自带隔离」）。
- 判据一个字没动：`scripts/premerge-check.mjs` / `scripts/check-commit-claims.mjs` 原样保留。
