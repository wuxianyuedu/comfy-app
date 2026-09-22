## Changed

- **工坊并入统一项目（Phase 2 核心）**：工坊此前有自己的一套 `wsp_*` 多项目体系（独立项目索引、顶栏项目切换器、`workshopDraft` 按 `wsp_*` 存），与画布项目 `proj_*` 各玩各的，是「画布项目和工坊项目割裂」的主因。现在工坊不再有自建项目：当前项目 = 画布活跃 `proj_*`（`getActiveId`），草稿按 `proj_*` 键存、服务端 `workshopDraft` 镜像也以 `proj_*` 为主键；工坊顶栏的项目切换器（切换 / 新建 / 重命名 / 删除）整块移除，这些操作统一收归首页。`use-workshop-pipeline` 删除了 `wsp_*` 索引、`newProjectId`、`switchProject/createProject/renameProject/deleteProject` 与「定妆照期间拦切换」的门禁（工坊内已无切换）；挂载回填只恢复当前项目。持久化回归测试改按「先建 proj_* → 工坊跟随 → 切页签不丢内容」重写。
