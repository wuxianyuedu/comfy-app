### Fixed

- GA pr-gate.yml 5 个 job 均补上 `if: failure()` 的 `actions/upload-artifact@v7` step，失败时自动上传 `coverage/` + `test-results/` 目录到 artifact（`if-no-files-found: ignore`），7 天保留。artifact 命名 `pr-gate-${pr_number}-${job_name}`，与 CI 失败 run 一对一对应。
  - 覆盖 static-gates / typecheck-db-format / fixed-structural-tests / affected-tests / heavy-gates 全部 5 格。
  - CNB 侧判决回读不动；ship --gh-logs 仍是主通道，artifact 是离线兜底。
