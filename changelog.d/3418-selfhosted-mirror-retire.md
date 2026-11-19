## Fixed

- **自托管「GitHub 镜像同步」推送格退役（ISSUE #3418 / #3378 后续指令）**：自托管节点到
  github.com 出网不稳、判断推送成功半天出不来且一红就把后续几格整片 skipped，按
  #3378 那条「别再因为判断推送是否成功而红」把推送与派发整个挪到平台池那条同名流水线
  （#3346 实验转正：摘 `--once` / `--readout`，恢复缺省重试档、退码生效）。
  自托管主列那格按既有「停用登记」形状退役：出 `COMFYAPP_CI_GATES`、进
  `COMFYAPP_CI_DISABLED_GATES`、`.gates` 原文按注释形态留着、`GATE_TIER_LEDGER` 进
  retired；`质量门禁` 的 `GITHUB_MIRROR_TOKEN` imports 一并撤掉。
  **承重锚不换**：GA 没跑起来 / 没送回结论 ⇒ `GA 回调结论回读` 站内回读撑到 45m 预算、
  超时即红（fail-closed），§13.6「PR 跑绿才合并」仍落在原生 `pull_request` build 上 ——
  这就是「后续流程走不通再红」。自托管机此后一台都不碰 github.com。
  逐笔对账：`COMFYAPP_CI_GATES` / 停用清单 / `GATE_TIER_LEDGER` /
  `tests/no-platform-ci-config.test.ts` 的钉面（锚点计数、正式出口形状、锁计数、
  停用登记、总账双向相等）/ `pr-gate.yml` 头注 / §13.5.33.2 + 生成态镜像 / 本碎片同批。
  `HOSTED_MIRROR_PROBE_BY` 有期限例外随转正退役（这条现在是唯一推送出口，不该再挂自毁日期）。
  流水线名带「（平台池）」后缀、stage 名仍是 `GitHub 镜像同步`（出勤入口按格名认，
  换机器不换名）；`--await-hosted` 与 `ci-mirror-hosted-await.mjs` 完整留盘供快速回退。
