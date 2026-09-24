## Added

- **评审接进自主 run 循环（Phase 8 · P8-1c）——生图后自动逐镜 AI 评审，不合格自动抽卡重生成（换种子），有界重试**：
  镜头评审 UI（#941）与抽卡真随机（#942）到位后，把「不合格→抽卡」这条也接进流水线本身，让自主执行
  跑完生图能自我质检并返工，不必人逐镜点评审。默认关闭（`autoReview`），由 `run.start` / CLI `--auto-review` 开启。
  - `run-types.ts`：`ProductionRun` 加 `autoReview` / `reviewedShotRev`（每镜「评审定稿时的 rev」）/
    `reviewAttempts`（每镜已抽卡次数）三字段（`normalize` 宽容解析、`DEFAULT` 兜底）；新增 `REVIEW_MAX_RETRY=2`
    与规划器动作 `review_shots`。`planNextRunAction` 在图齐后、出片前插入评审步：开了 `autoReview` 且有镜
    「已出图但定稿快照落后于当前 rev」→ 纳入待评审；抽卡会把该镜 rev 抬高 → 重新回到待生图 → 重出后再评，
    直到通过或达重试上限（达上限则定稿保留、停止返工，保证收敛、不死循环）。
  - `run-engine.ts`：新增 `execReviewShots` —— 逐镜调 `reviewContent`（同时落库 `shot.review`）；通过则记
    `reviewedShotRev`；不合格且未达上限则 `reviewAttempts++` + `applyShotRedo`（清图 + rev 自增，重出走
    #942 的新种子）；达上限则定稿保留。退回重出走一次 `patchContent`，重出前重读一次避免覆盖刚写入的判定。
  - `run.start` 端点 + `run-client.startRun` 入参加 `autoReview?`；CLI `agent-film.mjs` 加 `--auto-review`。

## Tests

- `run-types.test.ts` 补自动评审规划（关→直接 render_film、开且未评→review_shots、待生图优先、定稿后放行、
  改过再评）与 `normalize` 新字段解析；`run-engine.test.ts` 补两条端到端推进：评审通过直达 done、评审持续
  不合格时抽卡封顶 `REVIEW_MAX_RETRY` 后保留并收敛到 done（评审 3 次、抽卡 2 次）。
