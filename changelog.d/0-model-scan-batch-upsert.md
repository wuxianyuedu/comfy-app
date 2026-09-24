## Fixed

- **模型目录同步的 N+1 写库与串行拉取（`src/lib/models.ts`）**：扫描结果此前是
  `for (const s of scanned) await upsertScanned(...)` —— 模型目录常数百到数千个文件，
  等于同数量的数据库往返，`/api/models/sync` 因此长时间挂起；前面的 `listModels(folder)`
  也是一个目录一个目录地串行 await。现在目录并发拉取，落库走新增的
  `modelRepository.upsertScannedMany`（多值 INSERT ... ON CONFLICT DO UPDATE，按 400 行
  分片以避开 SQLite 的绑定变量上限），往返数从 N 降到 N/400，语义与逐条完全一致
  （按 (fileName, folder) 冲突则更新为「可见 + 最新的 name / type / baseModel」）。
