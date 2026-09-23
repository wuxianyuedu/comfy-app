## Added

- **Agent「视频 / 合成」端到端工具（Phase 5 收尾 / 设计 §8 P5）**：给工坊指挥助手补上从「分镜 / 生图」推进到「成片」的真实能力——新增 `render_film` 工具：用当前统一项目已产出的镜头，触发**服务端**成片管线（`film.createFromProject` → `start` → `watchFilm` 逐镜生成视频 → `composeFilm` ffmpeg 合成，完成后 `syncFilmToProject` 回写各镜 clip 与项目进度）。这是真正可执行的收尾工具，而非像 `generate_shot_images` 那样回退到手动。
  - 能力层 `src/lib/film/render-film-client.ts` 的 `renderProjectFilm`：前置校验（无活跃项目 / 未选视频工作流 / 服务端无镜头）后走 `createFromProject`+`start`，不轮询（服务端自动跑完，工坊 / 画布共读 `production` 进度，#892/#894）。
  - `executor` 新增可选 handler `renderFilm`（缺省时给「请到成片工作室导出」的可行动回退，不空转）；`WorkshopPipeline` 的 agentHandlers 注入 `renderFilm`（调 lib 客户端，组件不碰 tRPC，§17）。
  - 工具定义进 `WORKSHOP_AGENT_TOOL_DEFS`（服务端 `workshopOpenAITools` 自动喂给模型 + 回退校验），并在系统提示 / JSON 回退指令枚举里补 `render_film`，让模型知道何时收尾出片。

至此 Phase 5「统一项目 ↔ 成片」双向打通 + Agent 端到端：#896 建片、#897 进度回写、#900 逐镜 clip 回写、#901 成片工作室项目来源入口、本 PR Agent 一键成片工具。
