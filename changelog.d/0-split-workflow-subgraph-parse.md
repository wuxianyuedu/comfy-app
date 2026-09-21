## Changed

- **`src/lib/comfyui/workflow-subgraph-parse.ts` 拆包**：主文件 988 行超过 §12.6
  文件长度棘轮的阈值，且里面有子图侧最大的函数 `buildSubgraphGraph`（约 365 行）。
  拆成两块，依赖方向**单向、无回环**：
  · **新增** `workflow-subgraph-parse-graph.ts`（674 行）—— `buildSubgraphGraph` + 私有依赖 `LOAD_IMAGE_NODE_TYPES` 常量与 `resolveInputSlots` / `slotNameAt`
  两个 helper，以及一同搬来的**边界事实采集**层（`boundarySlotsByNode` /
  `parseSubgraphLinks` / `parseSubgraphSlots` 与 3 个 interface
  `SubgraphLinkEntry` / `BoundaryLinkInfo` / `SubgraphGraphResult`）；
  · **主文件缩到 360 行** —— 保留边界 pin 解析（`parseSubgraphPins` /
  `buildBoundaryLinks` / `reportDroppedBoundaryLinks`）、注释采集
  （`extractSubgraphAnnotations`）与 ID 生成（`runtimeInnerId`），并从
  图模块 re-export 前者符号。

  唯一消费者 `workflow-detail.ts` 继续按 `~/lib/comfyui/workflow-subgraph-parse`
  路径 import —— **完全不变**（§12.18 复用优先）。主文件用 `import type
{ BoundaryLinkInfo }` 从图模块取一个签名字段类型，`check-circular-deps`
  会当成一条边、但方向是「主 → 图」，与 re-export 那条边同向、无回环。
  `logger` 只被主文件的 `reportDroppedBoundaryLinks` 用到，图模块不再引
  这条依赖。

  `check-circular-deps`、`check-function-length`、`check-file-structure --strict`
  三门全绿；`workflow-subgraph-parse.test.ts`（20）+ `workflow-detail-io.test.ts`
  （39）+ `workflow-detail-raw.test.ts`（15）共 74 用例全过。
  类型安全审查 src/lib 报告的 M-5 条目（第二个 900+ 行文件）。
