## Added

- **工坊写入统一生产模型（Phase 3b-2）**：工坊自动保存 / 卸载兜底时，在既有 `workshopDraft` 镜像之外，**额外**把一份生产数据（meta/剧本/场景/角色/镜头/进度）写穿到 `production` 表——新增 `PUT /api/production` 端点 + `pushProduction` 客户端 + `buildProductionPayload` 组装。纯增量双写：不动已测的 workshopDraft 读写/恢复路径（持久化回归测试仍绿），为 Phase 3c 画布读取物化铺路。配 `route.test.ts`（未鉴权 401 / 缺参 400 / 正常落库且 JSON 列原样存回）。
