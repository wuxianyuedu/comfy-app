## Changed

- **`ci-github-mirror-push.mjs` 按职责再拆一刀，退回 900 行硬闸闸沿之下**（ISSUE #4315）。
  #4300 那批之后该文件正好压在 900 行（infra-size 闸的「临近拆分提醒」点名）。拆法与
  #3106 / #3146 / #3346 同一纪律：`runGitWithRetry` / `realRunGit` / `realSleep` / `gitEnv`
  迁入 `ci-mirror-retry-policy.mjs`（重试执行器与它执行的预算 / 阶梯同住一份），
  `explainRemoteProbeFailure` 迁入 `ci-mirror-failure-report.mjs`（与它的判据
  `isEgressFailure` 同住一份）；主文件原样转出，用例与调用方的导入面一个字不改。
  拆后主文件 755 行（原 900），retry-policy 329 行、failure-report 452 行，均在闸内。
