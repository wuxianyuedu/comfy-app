## Added

- **成片工作室左栏换成真实项目镜头 + 逐行退回（Phase 6 · P6-4）**：来源为「当前项目镜头」时，左栏不再是样例时间轴，而是该项目 `production.shots` 的真实列表——每行含缩略图（有产出图则 `MediaThumbnail`，否则占位）、镜头名（场景标题 / 提示词截断）、时长、状态徽标；每行右侧给「↺ 退回让 AI 重做」入口，与画布镜头节点同源走 `requestShotRedo`。来源为「剧本自动分镜」时维持原样例时间轴不变。
  - 纯映射 `productionShotsToShotList`（`film-studio-config`）：`unknown[] → ShotListItem[]`，镜头状态小写词表 → 成片大写态（done→SUCCEEDED 等）、`mode` 按有无图取 img2video/txt2img、时长取 `duration`。`ShotListItem` 加 `thumbnailUrl`。
  - `use-film-studio` 挂载读一次活跃项目 `production.shots` → `projectShots`（`beginStaleRun` 守卫）；`redoShot(shotId)` = `requestShotRedo` 后重载列表。

## 说明

左栏行由「单个可点 Button」改为「容器 div + 选择 Button + 退回 Button」兄弟结构，规避嵌套按钮。项目镜头行只作展示 + 退回，不进样例时间轴的编辑态（剧本模式编辑不变）。
