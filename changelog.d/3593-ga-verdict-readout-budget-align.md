## Fixed

- **GA 结论回读的预算对齐 GA 自己的最坏路径**（ISSUE #3593）。
  CNB「GA 回调结论回读」的缺省轮询预算原为 45m，而 GA `pr-gate.yml` 最重的
  `heavy-gates` job 顶层预算是 60m、收尾回调 job 再要 5m —— GA 正常跑满被
  cancel 后才由 `if: always()` 发回调时，回读格先到点判「没判过」（code 2，
  fail-closed 红），红的是「没等到」不是 GA 判了红（现场：PR #3588 第一跑，
  回调比回读预算晚约 2 分钟才到）。修法：
  - 脚本 `DEFAULT_BUDGET_MS` 45m → **70m**（60 + 5 + 5m 余量）；
  - `.cnb.yml` 该 stage 的外框 `timeout` 60m → **75m**（包住脚本预算 + 进程开销；
    不然平台在 60m 整掐断，仍旧先死）；
  - 「没判过」的两条出口（state 未终态 / status 缺席）都念出**已等墙钟 / 预算**，
    `--json` 读数补 `waitedMs` —— 「GA 还在预算里跑」与「GA 压根没起跑」不再共用
    一句无声的缺席；
  - 不变式进用例：`ci-ga-verdict-readout.test.ts` 现算 `pr-gate.yml` 的 job 预算，
    钉「回读预算 ≥ 最重 job + 回调 + 5m」；`no-platform-ci-config.test.ts` 钉
    stage 外框包得住脚本预算 —— 以后抬 GA 的 job 预算而不抬回读，当场红。
  - fail-closed 口径不变：没终态仍判红，承重锚仍是 `pull_request` build 的退码。
