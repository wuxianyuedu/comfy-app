## Added

- **生图自动优选：抽卡 N 选 1（FR-QA-04④ · #2612）**：
  - 评审器抽参：`reviewShotImage` 的评分核心拆为无写副作用的
    `scoreShotImage`（镜头上下文 + 任意一张图 → 判定），原入口行为不变。
  - 编排 `autoselectShotImage`：对同一镜头的 2~4 个候选任务逐张视觉评审
    （复用 #2479 生图 rubric 与视觉通道），均分最高者为赢家（平分取先），
    无产物候选跳过并记数；赢家判定经 `applyImageReview` 落
    `shot.imageReview`（与原入口同一落点）。
  - 路由 `run.autoselectShot` + `run-client.autoselectShot` 封装。
  - 工坊镜头卡新增「抽卡 ×N」（N=2/3/4，仅本地通道——只有它有任务行可评）：
    连发 N 次单镜生成收集候选 → 优选 → 赢家 imageUrl / taskId patch 回
    镜头草稿，通知里带各候选分数摘要。
  - **服务端不直写 imageUrl / taskId**：镜头内容的编辑真值是工坊草稿
    （自动保存整列覆盖），服务端直写会被反向覆盖——赢家经客户端草稿回写。
    覆盖隐患本身（评审/裁决/rev 字段被工坊保存抹掉）已立案 #2615，
    等字段所有权的合并/携带方案拍板。
- 需求文档同批：FR-QA-04 翻「已上线」（catalog 状态与 §3 缺口索引、specs
  ④ 验收与落点、pipeline-stages 阶段④缺口行）。
