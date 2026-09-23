## Added

- **画布镜头节点 → Shot 生成态回写（Phase 3c-2b）**：补上统一生产模型 shot 级双向同步的「画布 → 工坊」方向——在画布上对某镜头节点（`data.shotId`）触发生图并落定（done / error）后，把生成态（status / taskId / 结果 url）回写进对应的 `Shot`，闭合「画布上跑的镜头工坊认得」这条回路（此前 3c-2a 只做 production → 画布的单向物化）。
  - 落点两处，且因画布 / 工坊互斥挂载不会互相覆盖：① 共享工坊草稿（localStorage，按 active `proj_*`）+ `workshopDraft` 表镜像，工坊重挂载即读到；② `production` 表镜像（读-改-写，保留 `progress` 等其它字段），画布重挂载再物化时不回退成旧态。
  - 单一写入者（ADR §6.4）：回写只动生成态字段，编辑面（prompt / negative）仍是工坊写入面。反向状态词表映射（`nodeStatusToShotStatus`）与 `shotStatusToNodeStatus` 对偶，收在 `src/lib/production/sync.ts`。
  - 复用优先（§12.12 / §12.18）：把工坊草稿的存储原语（`WorkshopDraft` 类型 / `readDraft` / `writeDraft` / 键规则 / 逐字段校验）与「草稿 → 生产数据」组装口径（`buildProductionPayload`）从 `use-workshop-pipeline` 私有实现下沉到 `src/lib/workshop/draft-store.ts` 与 `src/lib/production/payload.ts`，工坊与画布回写共用同一份，避免两套漂移。回写落库收在 `src/lib/production/shot-writeback.ts`，触发侧为 `CanvasNode` 的 `use-shot-generation-writeback`（仅观察节点终态、调一次落库，视图不新增 IO）。
