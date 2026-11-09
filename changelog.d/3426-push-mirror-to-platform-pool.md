## Fixed

- **push 档镜像出口挪到平台池（ISSUE #3426 / #3378 后续指令）**：PR 出口（#3418）已治的
  「自托管节点到 github.com 出网不稳」在 push 侧仍在 —— `GitHub master 镜像` 格还挂在
  `master 合并复核` 主列、带 `--readout`（退码恒 0），推不出去被折成绿，只能靠日志回读补
  立案 + 每日跨仓漂移判据事后兜。按 PR 出口同形落地：镜像格出
  `COMFYAPP_CI_PUSH_GATES` / `.push-stages` / `GATE_TIER_LEDGER`（进 retired），主列不再
  import `GITHUB_MIRROR_TOKEN`；`push` 事件新增第二条平台池流水线
  `GitHub master 镜像（平台池）`（tags `cnb:arch:amd64` + docker git-lfs + 自带
  `*lock_push_mirror` + import 同一枚令牌），stage 名仍是 `GitHub master 镜像`、脚本
  `node scripts/ci-github-mirror-push.mjs --master`（**摘 `--readout`**、退码生效）、
  `timeout: 10m`。失败出口 = 该流水线自己的 error 落进 push build + 每日
  `镜像漂移判据`（`always()`、跨仓匿名 ls-remote）兜「之后没人再推」。`push 失败立案`
  挂在主列 `endStages`、可能早于平台池那格收尾，这一跳没在 push 节点上单独实测过，
  配置注释里如实写明。`findMirrorReadoutFailure()` 那套「读数档折零」专用立案随
  `--readout` 一起退役。
  逐笔对账：清单 / `.push-stages` / 总账 / `tests/no-platform-ci-config.test.ts`
  （出口名单扩成两个、`nextEventAt` 收口、锁计数按事件分开、新增 push 主列不带令牌用例）/
  `ci-pr-failure-issue.mjs` + 用例 / `daily.yml` 与 `master-gate.yml` 头注 /
  `ci-mirror-drift.mjs` 处置话术 / §13.5.33.3 + 生成态镜像 / 本碎片同批。
  **不动 push 档其余格**：#3397 的「摘掉 GA 已跑过的格、镜像迁 GitHub-hosted」是另一张单。
  `--readout` 旗标完整留盘供快速回退。
