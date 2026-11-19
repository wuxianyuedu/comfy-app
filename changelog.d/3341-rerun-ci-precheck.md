## Fixed

- `pnpm ship --rerun-ci` 在动手前补一层**只读前置读数**（#3341，不是硬闸）。#3338 现场：
  节点侧 egress 中断 / runner 掉线期间，同一条 PR 分支上 `--rerun-ci` 被反复调用，7 分钟
  连推 5 笔 `ci: rerun` 空提交、4 条 build 白烧 3–4 分钟墙钟 —— 平台没有重跑按钮，
  「再推一笔」是唯一出口，但没有任何一处把「再推也不会变」说出口。
  现在 `runRerunCiStage` 在空提交**之前**按当前 head 的 sha 归属最近一条 build 并念终态：
  **在跑的** ⇒ 「再推一笔会为同一内容再派一条，先等终态」；**红的** ⇒ 终态 + 红在哪些格
  （`failedStageNames`，复用 `classifyBuildOutcome` 的失败池）+「节点形红（Prepare /
  镜像同步那类 egress 断网）节点恢复前再推大概率还是红 —— 重跑不会改变 infra 故障」+
  点名 `pnpm ship --diagnose <sn>`；**被取消的** ⇒ 「那一跑没有结论，重跑正是对的动作」。
  **读数不是闸**：所有情形下空提交照推、退码不变（显式动作不许被推断）；读数取不到
  （cnb 不在 / 列表取不到 / 归属不到）念一句照实，不冒充结论。
  取数复用既有出口：`resolveBuildSn`（按 sha 归属，#2950 的逐页扫同一份）+ `fetchBuildStatus`
  + `readBuildVerdict`，不另立第二套判定。归属读数排在提交前 —— 提交之后 sha 已变，
  按新 sha 归属不到任何东西。
