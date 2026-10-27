## Added

- **工坊 MCP 会话与界面共享同一份 production（FR-AG-01③ / FR-MC-01 · #2482）**：
  - 桥模块 `src/server/workshop/production-bridge.ts`（无 `server-only`，与 MCP 本地
    模块同款约束，stdio / 独立 HTTP 进程可达）：建/绑 `project` + `production`
    行、内容读写；同一份 libsql 库、同一批表——Next 侧（画布 / 工坊 / run 引擎）
    与 MCP 侧读写同一行。
  - 会话绑定：`workshop_create_session` 新增可选 `projectId`（绑界面侧既有项目，
    校验存在与归属；缺省新建一对行）；每个新会话创建即绑定，外部 AI 写入的内容
    界面刷新即见，界面改动 AI 下一次 `workshop_get_session` 就能读到。
  - 真值口径：绑定后内容**权威读在 production**，`workshopSession` 的内容列退化为
    写时镜像（防直接读表的第二真值困惑），idea / stage / projectId 才是会话行
    自己的权威字段。
  - 归属口径：`production.userId` 非空且外键——`userId` 显式给必须存在，缺省落
    本机最早创建的用户（确定性），一个用户都没有时给可行动错误。
  - 遗留会话（桥之前建的、`projectId` 为 NULL）：首次写时桥接（以当前内容建项目），
    只读不写的保持原样、不凭空长出项目。
  - 编排器 17 个工具零改动（桥挂在 repository 的 create / get / update 三口）；
    `workshopSession` 表新增 `projectId` 列（drizzle push 自动建列）。
- 需求文档同批：FR-AG-01 翻「已上线」（#2482 补齐最后一格）、FR-MC-01 的
  「界面侧会话共享待后续」注记勾改、pipeline-stages 通用口径「双操作者」行补落点、
  `docs/workshop-mcp.md` 架构 / 工具表 / 范围节同步。
