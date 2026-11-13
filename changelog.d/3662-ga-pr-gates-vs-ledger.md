## Fixed

- **「PR 档不跑增量面」这句话只对 CNB 侧成立 —— GA 的 PR 侧一直跑着那两格**（#3662，出口 B）。
  `受影响用例` / `固定结构用例` 两格在门格总账里记成 `retired`（note 原文：「2026-11-02 从 PR
  撤到每日全量单测……PR 上 45m 预算、冷节点易 25m+ 且偶发 AggregateError 假红，性价比低」），
  `AGENTS.md` 硬规则 7 与规范 §13.5.25 的档位表也照那句写；而
  `.github/workflows/pr-gate.yml` 里 `fixed-structural-tests` / `affected-tests` 两个 job
  **每个 PR 都在跑**，且在判决的 `needs:` 里 ⇒ 红了照样拦合。账上写着不再跑、实际每个 PR 都跑。

  **为什么此前对判据是隐形的**：门格总账的档位登记只认三份清单（CNB 的 PR / push / GA
  `daily.yml` 的 step 名），**GA 的 PR job 一处都不在** ⇒ 「记成 retired 却仍在 PR 上跑」
  这一形态对那条双向对账不可见（`retired` 只断言「不出现在任何清单里」）。

  **落法（照 GA 侧的真身）**：门格总账加第四个面 **ga-pr**（执行者 = GA `pr-gate.yml` 的
  step，名字逐字，与 daily 段同一口径）；名单由 `gaPrGateSteps()` 从工作流文件**现读**
  （`GA_STEP_RE` + 显式的前提设施豁免名单 `GA_PR_INFRA_STEPS`）⇒ 「GA 的 PR 侧跑了什么」
  从文件本身读出来，不抄第二份。ga-pr 段登记 25 格；retired 段里那些 **CNB 时代的老名字**
  （`分支守卫` / `类型检查` / `oxfmt 格式` / `重档静态判据` / `受影响用例` /
  `固定结构用例` / `Install dependencies` 等）一并撤掉 —— 它们对应的格在跑，只是登记面换了
  名字空间。新增判据（`tests/no-platform-ci-config.test.ts` 的「ga-pr 档」那条）：**GA 的 PR
  侧跑的每一格都要在总账里有一席**；豁免名单里写了一个已不存在的 step 名 ⇒ 静默失效，当场红。

  **撤档理由在 GA 侧重测（出口 B 的另一半）**：那三条理由逐条**不成立**（读数取自镜像仓
  `wuxianyuedu/comfy-app` 的 `pr-gate.yml` run，2026-11-12/13，4 核托管 runner）：
  ① 「45m 预算」—— 预算至今是 45m，但实测墙钟 `fixed-structural-tests` **87~133s**、
  `affected-tests` **37~135s**（各 10 跑全绿），最慢一跑 ≈ 预算的 5%，且这两格不是 PR 的关键路径；
  ② 「冷节点易 25m+」—— 那条 25m+ 的读数来自 **CNB 自托管共享节点**（PR #2982：281 份用例被
  墙钟掐断、一份结论都没给出、退 2 = 未判定），GA 是独享 4 核 VM，离那道墙钟差一个数量级；
  ③ 「偶发 AggregateError 假红」—— GA 侧 4 次红的失败行逐字读过，**四次全是真红**
  （真断言红 ×3：字号 49→50 / 13px 未登记角色 / `llm.workshopAdaptersSummary`；
  真缺陷红 ×1：`run.json` 重命名竞态，已由 #3666 修），**没有一例**是 AggregateError 或
  「墙钟掐断 ⇒ 未判定」。

  **连带的表述订正**（同批）：`AGENTS.md` 硬规则 7、规范 §13.5.25 档位表与 pre-push 段表说明、
  `.cnb.yml` 的 `.gates` 注释 ⇒ 一律改成「**CNB 侧**已撤，**GA 的 PR 侧仍跑这两格**」。
  `docs/standards/11-测试与可观测性.md` 那一段本来就是对的（它早写着「PR 侧的执行者现在在
  GA `pr-gate.yml` 的并行 job 上」）—— 这次改的是与它不一致的那些。
