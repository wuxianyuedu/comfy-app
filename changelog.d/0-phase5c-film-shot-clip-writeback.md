## Added

- **成片合成后逐镜视频回写统一项目（Phase 5 回写闭环第二段 / §6.3）**：在 P5-2 的项目级 `rendered` 回写之上，把每一镜的视频结果也按来源镜头回写进统一 `production.shots`：合成完成后按 `filmShot.shotId` 命中项目侧对应 `Shot`，写入 `clipUrl` + `clipStatus="done"`（自由建片镜头无 `shotId` 自动跳过；无产物的镜头不覆盖）。
  - `filmShot` 新增 `shotId` 列（关联 `production.shots[].id`）；`createFilmFromProject` 建片时逐条回填来源镜头 id；仓储 `createMany` / `listByFilm` 透传该字段。
  - P5-2 的 `markProductionRendered` 演进为 `syncFilmToProject`：把「逐镜 clip」与「`progress.rendered`」合并成**一次**读-改-写（`progress` 与 `shots` 是 `production` 行两列，分两次写会互相覆盖），仅项目建片生效，失败只记 warn、不影响成片。

## 闭环说明

至此，「从统一项目建的片」在合成完成后，来源项目的**镜头视频态 + 完成状态**都回写进那份共读的 `production`（Phase 4 单一来源 / #892）：工坊重挂载恢复 `rendered`、画布进度显示「已合成 · 100%」（#894），并可在项目镜头上看到各自出片的视频片段（`clipUrl`）。纯文本自由建片（无 `projectId` / `shotId`）行为不变。

Phase 5 剩余后续：FilmStudio 视图改为「某项目的成片渲染 / 预览」入口（接 `film.createFromProject`）、agent 视频 / 合成工具（`lib/agent/tools.ts`）。
