## Added

- **托管机镜像同步实验（ISSUE #3346）**：自托管节点到 github.com:443 的出网间歇不通
  （`cnb-l86-1k6r1ckna`：重试 6 次耗 203s 全败、整格红、判决格整片 skipped），想量一次
  「CNB 托管机器（平台池）」那一侧稳不稳。三件同批：
  ① `pull_request` 新增第二条流水线「GitHub 镜像同步（托管机实验）」——平台池
  （`runner.tags: cnb:arch:amd64` + `docker.image: node:26`）上跑
  `ci-github-mirror-push.mjs --once --readout`：推送 / 回读 / LFS 三跳各**只试一次、
  不重试**，退码恒 0（读数档，不承重、不挡合并）；锁自带
  `mirror-pr-$CNB_PULL_REQUEST_IID`（共用 `pr-` 锁会掐停并行的质量门禁，#2114 同款）。
  ② 自托管主列「GitHub 镜像同步」加 `--await-hosted`（新模块
  `ci-mirror-hosted-await.mjs`）：在 `HOSTED_AWAIT_BUDGET_MS`（300s）内回读镜像 ref，
  见到本跑 HEAD ⇒ 托管机已推送并派发，本格落回执后**跳过推送**；到点没见 ⇒ 原有
  重试推送兜底（PR 可靠性不回退）。该格 `timeout` 随最坏账从 10m 抬到 15m（抬外框，
  判据与预算一字未动）。
  ③ 有期限的例外登记（同 #2363 探针形态）：锚点引用数判据同额扣除、
  `HOSTED_MIRROR_PROBE_BY` 到期读数取完 —— 转正（自托管侧摘推送）或整段删除。
- 已知代价（记入 `ci-mirror-hosted-await.mjs` 文件头）：兜底推送与托管机推送存在
  双派发竞态窗（同 sha 两条 GitHub run），判决链按 sha 取读数、同树同判。
- **git-lfs 预装进镜像**（PR 评审随手账）：托管机那条不再每跑 apt-get 装一遍 ——
  新增 `.cnb/ci-image/Dockerfile`（`FROM node:26` + git-lfs 一层），实验流水线的
  `docker.build` 按它构建临时镜像并按 `versionBy` 缓存（Dockerfile 不变就不重建）；
  「git-lfs 就位」那格删除。不引第三方镜像（供应链面不变）、不维护外部仓。
- 用例：`tests/ci-github-mirror-push.test.ts` 新增 once 两态（推送 / LFS 各只试一次，
  缺省档重试语义仍在）与等托管机四场景（见 HEAD 即跳过 + 落回执、旧 sha 到点兜底、
  读没通到点兜底、前提取不到不抢话术）；`tests/no-platform-ci-config.test.ts`
  新增实验流水线的形状钉面与主列 `--await-hosted` / fail-closed 钉面。
