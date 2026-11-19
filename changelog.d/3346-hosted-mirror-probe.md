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
- **PR 标题改读平台注入的 `CNB_PULL_REQUEST_TITLE`**：合并类事件上平台给每个 Job
  注入只读标题（同族 DESCRIPTION / PROPOSER / BRANCH / EVENT_URL），自托管与平台池
  同源 —— 托管机实验格不再需要 cnb 通道（首跑读数：容器里没有 cnb 二进制，标题退回
  「PR #号 · sha」老格式）。env 缺席时保留原 `cnb pulls get-pull` 回读兜底；
  曾做过一版镜像预装 cnb CLI 的方案（PR #3364），被这个零依赖方案取代后关闭。
- **await 前置改按「树等价」匹配，跳过路径的回执带派发 sha**（首跑读数：同一 PR 事件
  上两条流水线**各自合成 merge 提交** —— 托管机推 `550f9e58`、主格 HEAD `c415c6ef`，
  同两父同树、sha 不同 ⇒ 按 sha 等值匹配的等待 300s 必然白等，且直接放宽成「ref 存在
  即跳过」会断在判决链：判决回读按 `display_title` 里的 sha 认领本跑）。三件同批：
  ① `ci-mirror-hosted-await.mjs` 在 ref 出现非本格 sha 时浅取那一笔、比 `^{tree}` 与
  本格 HEAD 的树（同 ⇒ 托管机交付了等价内容，跳过；不同 ⇒ 旧值，继续等）；
  ② 跳过路径的 `mirror-dispatch.json` 带 `sha`（托管机实际推送的那笔）；
  ③ 判决回读 `readDispatchState` 透传 `sha`（40 位十六进制才收），`runVerdict` 的
  认领键优先用回执里的 sha（缺席回落本格 HEAD）—— 托管机那条 run 才认得到。
  已知代价不变：双派发竞态窗（同树两条 run，判决链按回执 sha 认领，树同判同）。
- **树不等 ⇒ 当场兜底，不等满预算**（#3366 重跑现场读数：重跑 build 里托管机管线被
  平台标 `skipped`——上一跑已成功过——ref 上是上一跑推的旧值，树与本跑 legitimately
  不同；旧值永远不会自己变成我们的树，等满 300s 只是白等）。树守卫正确地拒绝跳过
  （fail-closed 没破），但改成**当场落回兜底**：它要被重推，ref 变化的那一刻会被后续
  读数重新核验。附带修正读数话术：「ref 还没出现」与「ref 在但树不同」分开念。
- 用例：`tests/ci-github-mirror-push.test.ts` 新增 once 两态（推送 / LFS 各只试一次，
  缺省档重试语义仍在）与等托管机四场景（见 HEAD 即跳过 + 落回执、旧 sha 到点兜底、
  读没通到点兜底、前提取不到不抢话术）；`tests/no-platform-ci-config.test.ts`
  新增实验流水线的形状钉面与主列 `--await-hosted` / fail-closed 钉面。
