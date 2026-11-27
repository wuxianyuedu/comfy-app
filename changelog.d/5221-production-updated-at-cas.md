## Fixed

- 文档口径纠偏与编辑并发地基（#5221）：P0 设计文档中「复用 `production.rev`」改为事实——
  `production` 表没有 rev 列，镜头 rev 只是 shots JSON 里的派生标记。`PUT /api/production`
  新增可选 `ifUpdatedAt`：事务内比对当前 `updatedAt`，不一致则跳过写入并回 `stale:true`；
  `pushProduction` 支持 `expectedUpdatedAt` / `onStale`，让多个检出同时保存同一部剧时旧基准
  不再静默覆盖他人改动。保存成功写一条 `project_content_saved` 审计事件。同批补服务端与客户端行为用例。
