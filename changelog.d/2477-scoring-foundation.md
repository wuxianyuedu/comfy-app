## Added

- **评分地基（FR-QA-07 ①②③，#2477）**：`ReviewVerdict` 扩展 `scores`（维度 → 1~5 分
  + 一句话依据，畸形分归一时夹取）与 `rubricVersion`，旧数据读作「未评分」不报错；
  新增 rubric 注册表 `src/lib/production/review-rubrics.ts`——剧本 / 角色卡 / 分镜
  三张量表、每分值带锚点描述；`production` 表新增 `scriptReview` 列（剧本评审位，
  判定 + 轮次历史），新执行器 `reviewScript` 与路由 `run.reviewScript` 把判定写回该列；
  `TASK_TYPES` 新增 `review` 温度档（默认 0.1），评审器温度走 `temperatureByTask`
  的 `review` 档，设置页温度覆盖白名单同步；实体判定写回同时维护 `reviewHistory`
  轮次历史（上限 9 轮，曲线 = `[...reviewHistory, review]`）。
