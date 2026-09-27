## Fixed

- **同一次启动跑两份 schema 同步（`scripts/dev-launcher.mjs` + `scripts/dev.mjs`）**：
  编排器自己 `spawnSchemaSync`，它拉起的 dev server 又再跑一份 —— 两份 15~30s 的
  drizzle **并发写同一个 `db.sqlite`**（重复劳动 + 写锁竞争）。现在编排器给 dev server
  注入 `COMFYAPP_SKIP_SCHEMA_SYNC=1`（常量收在 `db-schema-state.mjs`，两侧共用一个
  名字），dev.mjs 见到即跳过；独立 `pnpm dev`（无编排器）行为不变。
