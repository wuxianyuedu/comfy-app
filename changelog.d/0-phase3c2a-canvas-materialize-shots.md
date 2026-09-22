## Added

- **画布挂载时物化 production 镜头（Phase 3c-2a）**：打开项目画布时读取该项目的 `production.shots`，经 `planShotSync` + `applyShotPatches` + `placeCanvasNode` 幂等地把镜头物化为画布节点——已有镜头节点（按 `data.shotId` 匹配）合并补丁、缺失的新建、非镜头自由节点原样保留。实现「工坊产出镜头 → 打开画布即看到对应节点」的单向物化（实时刷新与画布编辑回写留 3c-2b）。物化逻辑抽为模块级 `materializeProductionShots`，避免 `CanvasInner` 超过函数长度棘轮。
