## Added

- **成片合成完成回写统一项目完成状态（Phase 5 回写闭环 / 设计 §6.3 + §7 film 状态源收敛）**：`composeFilm` 合成成功后，若该成片是「从统一项目建的」（`filmProject.projectId` 非空），则把来源项目的 `production.progress` 读-改-写为「已合成」——`rendered=true`、阶段推进到 `render`，其余字段（剧本 / 场景 / 角色 / 镜头 / 其它进度）原样保留。
  - 新增服务端 `markProductionRendered(userId, projectId)`：经 `productionRepository` 读改写，`progress` 走 `normalizeProductionProgress` 规范化后再置真（脏数据也收敛）。仅项目建片生效；纯文本自由建片（`projectId` 为空）不受影响。
  - 回写失败只记一条 warn，不影响已完成的成片本身（`markDone` 已成功）。

## 闭环说明

`production.progress` 是两侧共读的唯一持久来源（Phase 4 / #892）。本次把「成片是否已合成」这个此前只活在 `filmProject.status` 里的状态，收敛进这一份：合成完成 → 工坊重挂载恢复 `rendered`（#892）、画布进度指示显示「已合成 · 100%」（#894）自动跟上，无需各自再维护一份成片状态。

后续独立项：`filmShot ↔ production.shot` 逐镜视频 URL 回写（需给 `filmShot` 加 `shotId` 关联）、FilmStudio 视图改为「某项目的成片渲染 / 预览」入口、agent 视频 / 合成工具（`lib/agent/tools.ts`）。
