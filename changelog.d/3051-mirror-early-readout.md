## Fixed

- 双远端镜像那一格的**起跑时机**与**失败话术**（#3051，机械线之外的治理线，承接 #2978）：
  `GitHub 镜像同步` 原先挂在 `endStages`，而平台对这一档的语义是「stages 跑完才执行」——
  这条流水线实测整跑 2546s（全绿跑 `cnb-aju-1k6bpjnrk` 逐格：固定结构用例 873.2s /
  Install dependencies 446.4s / 受影响用例 350.2s / 重档静态判据 345.3s），于是 GitHub 那一跑
  最早只能在一个多小时之后起跑，等「按同一笔 sha 读回判决」那一格上线就成了串行。
  现前移进 `.gates` 主列（`缓存槽读数` 之后、`Install dependencies` 之前），同批进
  `COMFYAPP_CI_GATES` 与门格总账。
- **搬的是位置，不是那句不承重**：主列的退码会把排在它后面的格整片 `skipped`，而这一跳今天还不通
  （实测 `Failed to connect to github.com port 443 after 21114 ms`，另有 #3014 令牌被拒 /
  #3003 LFS 缺件 / #3027 自家钩子拦下三形），所以脚本新增 `--readout`：内部三态照旧打点、
  对外恒不退非零，与 `镜像身份` / `工作区复用读数` 同一族。什么时候翻成 fail-closed 写在
  #3051 期望第 3 条（等回读那一格上线），不在本批。
- `explainRemoteProbeFailure()` 补 **egress 那一类**分支：此前网络不通落到默认那句
  「仓库在不在 / 令牌活不活」上（实测那一句正指在一条好的令牌上），现在与「仓库没建」「身份
  够不到」并成三形、各给各的下一动作；`结论：exit 2` 那句同步改成点名三层之一。
- 两跳 git 调用改由本仓给墙钟（`REMOTE_PROBE_TIMEOUT_MS` = 15s 探针、`PUSH_TIMEOUT_MS` = 4min
  推送，留在那一格 `timeout: 5m` 的外框内）：不给就得吃 git 自己的 21114ms connect 超时，
  而前移到主列之后那是每条 PR 白付的二十一秒。子命令由新增的 `gitSubcommand()` 认
  （`pushArgs()` 以 `-c core.hooksPath=` 开头，按 `args[0]` 判会让推送悄悄拿不到限时）。
- 复算：`tsc --noEmit` 0；改动五份 eslint 0；39 条已清零规则集全仓复扫（2421 份、
  `--type-aware`）0 命中；`ci-github-mirror-push` / `no-platform-ci-config` / `ci-gate-names`
  四份用例 164 条全绿（`ci-github-mirror-push` / `no-platform-ci-config` / `ci-gate-names` /
  `ci-build-readout`）；两件台账判据当场跑过 —— `check-gate-executors.cjs` ✓（88 份判据脚本、
  判定型有执行者 83）、`check-gate-name-executors.mjs` ✓（清单里每个名字都有执行者）。
  两条新断言各用现场变异打过红：`gitTimeoutFor` 改回按 `args[0]` 判 ⇒ 推送那一支拿到
  `undefined`（限时静默缺席）；egress 分支的关键字拿掉 ⇒ 现场那句落回默认话术而红。
  验完逐字还原（`git diff --stat` 只剩本批真实改动）。同批改 §13.10.13 里「这一档放的是哪几格」
  那句（镜像格已前移）并带上 `docs/generated` 镜像。
