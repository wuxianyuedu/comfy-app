## Fixed

- `tests/check-reformat-only.test.ts` 的 T3（「汇总分母取 landed」）把 `CNB_COMMIT` 只写进 `process.env`，而 `gate-repo` 起子进程用 `gitSandboxEnv()` 会按 `SANDBOX_STRIPPED_ENV_KEYS` 把继承来的 `CNB_COMMIT` 剥掉 —— 子进程读到空串，`check-reformat-only.cjs` 的汇总分母退回区间起点，断言「汇总分母取目标分支那一侧」必然失败（ISSUE #3218，master 既存缺陷）。修法只改用例：把 `CNB_COMMIT` 走 `repo.run(…, { env: { CNB_COMMIT: branchTip } })`（override 在剥离之后落），并删掉无效的 `process.env` 保存/恢复；判据脚本、配置与 lint 禁用一律未动。
