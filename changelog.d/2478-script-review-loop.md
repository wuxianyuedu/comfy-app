## Added

- **剧本评审与定向改写闭环（FR-QA-07 ④ · #2478）**：run 引擎新增 `review_script` /
  `revise_script` 两个动作——剧本指纹（`scriptDigestOf`）≠ 评审收口快照即待评审
  （人改剧本同判据触发，人机接力），不达标时按**低分维度**定向改写再复评，有界收敛
  （复用 `REVIEW_MAX_RETRY`：评审 ≤ 3 轮；达标 = pass 且维度均分 ≥
  `SCRIPT_REVIEW_SCORE_THRESHOLD`）；每轮判定与分数落 `production.scriptReview` 列
  （曲线可回看），改写前旧版留档 `revisions`（最近 3 版）。分镜联动：剧本收口后指纹
  落后于分镜快照即重排分镜（下游吃到新剧本）。工坊剧本面板新增「AI 评审剧本」入口
  （维度分数条 + 轮次曲线 + 按意见改写，改完自动复评并切到新版）。MCP 侧评估：不暴露
  `workshop_review_script` / `workshop_revise_script`（会话与 production 两套存储，
  理由入 `docs/workshop-mcp.md`）。
