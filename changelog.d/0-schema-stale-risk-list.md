## Added

- **「数据库结构过期」提示完整列出会丢哪些表/列**：schema 自动同步被「会丢数据」的语句（删列 / 重建表）挡下时，提示原因不再只给条数——现在逐条列出「哪个表哪列会丢」（如 `user.color（删列，该列的数据会丢）`、`workflowTemplate（重建表，对不上的列的数据会丢）`），随既有的状态文件 → `GET /api/schema` 链路一路透传到状态栏 toast 与「立即同步」确认弹窗；认不出的语句原样列出（截断到 80 字符）。证据：`scripts/db-push-core.mjs`（`describeRiskyChanges`）、`scripts/db-schema-state.mjs`（stale detail）。
