## Added

- **人工评分与校准（FR-QA-08 · #2480）—— 人的判断留痕且优先**：
  - 数据层：`HumanVerdict` 快照式裁决（镜头带 `rev`、剧本带内容指纹）+
    `taskImage` 加 `humanRating` / `isFavorite`；宽容解析与三个 reducer
    （`applyHumanVerdict` / `applyHumanRating` / `applyScriptHumanVerdict`），
    测试基建 DDL 同批对齐。
  - 规划器与引擎人工裁决优先：人通过且快照新鲜 → 定稿豁免 AI 评审；人否决 →
    即使 AI 已定稿也拉回评审循环（达 `REVIEW_MAX_RETRY` 上限保留；
    人改内容后快照自然失效，不会死循环）。
  - 端点：`run.setHumanVerdict` / `run.setHumanRating` / `run.setScriptHumanVerdict` /
    `run.reviewCalibration` + `task.setImageFeedback`（带归属校验）。
  - 校准纯函数 `review-calibration.ts`：人评（0~5 → 1~5 映射，达线口径
    `HUMAN_PASS_THRESHOLD`）⇄ AI 维度分的 MAE / 判定一致率 / 按维度偏差，
    只读不写，读数内嵌镜头评审弹窗。
  - UI：共享 `HumanVerdictRow`（裁决 + 星评，镜头弹窗与剧本弹窗复用）、
    历史页产物卡评分 / 收藏（`ImageFeedbackRow`）。
- **需求文档同批**：catalog 的 FR-QA-07 / FR-QA-08 状态按 §1 四态词表修正为
  「已上线」（此前写成「已落地」，不在词表里；§3 缺口索引同步收窄到
  FR-QA-01~06 与 FR-QA-09）；specs 的 FR-QA-08 补齐已落地验收与落点（含边界：
  人工裁决当前覆盖镜头与剧本，角色卡另立）；pipeline-stages 阶段①④ 补人工裁决行。
