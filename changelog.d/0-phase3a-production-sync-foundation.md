## Added

- **生产模型同步地基（Phase 3a）**：新建 `src/lib/production/` 子域，落地画布节点 ↔ 工坊镜头（Shot）的 shot 级同步内核——纯函数 reducer `sync.ts`（`shotToNodePatch` 投影镜头为节点补丁、`nodeEditToShot` 只回写编辑面、`planShotSync` 规划哪些镜头需新建节点、`shotStatusToNodeStatus` 统一两侧状态词表），配 5 项单测（实测 100%）。画布节点数据加 `shotId?` 反向引用锚点（非镜头节点为 undefined、不参与同步，保住画布即性编排）。按 §18.14 登记 `production` 子域（R14）、按 §18.6 设覆盖率门槛。本阶段只建地基与纯函数，不接 UI——工坊写入 / 画布物化在 Phase 3b/3c 接入。
