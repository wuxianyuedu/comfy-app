## Added

- **统一生产模型读取侧（Phase 3c-1）**：补 `GET /api/production`（按 `proj_*` 回读生产数据，`exists`/`production`）与 `fetchProduction` 客户端；新增纯函数 `applyShotPatches`——把 shot 补丁按 `data.shotId` 合并到已有画布节点（非镜头节点原样保留），与 3a 的 `planShotSync`/`shotToNodePatch` 合起来构成画布物化镜头节点的纯逻辑内核。配 route GET 契约测试 + `applyShotPatches` 单测。本阶段只到「读 + 纯合并」，ReactFlow 物化接线在 3c-2。
