## Added

- **成片从统一项目读取镜头（Phase 5 接入第一步 / 设计 §6.3）**：新增服务端 `createFilmFromProject`，把「一键出片」接到统一项目上——镜头直接取自该项目的 `production.shots`（工坊已定稿、含风格），逐条映射为成片镜头（按镜号 `index` 排序，`prompt` / `negativePrompt` / `sceneHeading` 原样带入），**不再走**「自建剧本 → LLM 平行分镜」那条与工坊割裂的路径。
  - `filmProject` 新增 `projectId` 列（关联 `proj_*`，带索引）：成片挂到统一项目下。落库经共用的 `persistFilmWithShots`（`createFilm` 与 `createFilmFromProject` 同口径，§12.12 去重）。仓储 `create` 收 `projectId`。
  - tRPC `film.createFromProject` 入口（authed）。
  - 生成 / 轮询 / 合成（`startFilm` / `watchFilm` / `composeFilm`）不改：镜头行来源不同、下游链路一致。

## 说明

Phase 5 后端接入第一步。后续独立项：`composeFilm` 产出后把成片 URL / `rendered` 回写 `ProductionProgress`（§6.3 + §7 剩余的 film 状态源收敛）、FilmStudio 视图改为「某项目的成片渲染/预览」入口、以及 agent 视频/合成工具（`lib/agent/tools.ts`，§8 P5）。
