## Added

- **统一生产模型存储（Phase 3b-1）**：新增 `production` 表（id = `proj_*` 一对一、`userId` 外键、meta 字段 + `scriptMarkdown` + `scenes`/`characters`/`shots`/`progress` JSON 列 + 时间戳 + `(userId,updatedAt)` 索引），作为画布 / 工坊 / 成片共享的一份生产数据，取代此前「工坊镜头在 workshopDraft、画布节点在 project.nodes」两份并行不同步的割裂。配套 `repository-production.ts`（server-only，`upsertForUser` / `getForUser`，按归属过滤）与内存 SQLite 集成测试（新建/更新分支、JSON 列还原、跨用户隔离）。本阶段只加表与仓储（纯新增表，不动既有表、不改工坊持久化）；工坊写入与画布物化在 3b-2 / 3c 接入。
