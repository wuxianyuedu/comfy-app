## Changed

- **`src/lib/comfyui/workflow-detail-raw.ts` 拆包**：主文件 930 行超过 §12.6
  文件长度棘轮的阈值，且里面有全库最大的函数 `buildRawInputs`（470 行、
  `check-function-length` 候选之首）。把 `buildRawInputs` + 它私有依赖的
  `LOAD_IMAGE_NODE_TYPES` 常量与 5 个 helper（`proxyKey` /
  `collectProxyWidgetPairs` / `isUuidLikeClassType` / `isWrapperAliasSlot` /
  `subgraphAuthorLabelsByUid`）整体搬到新兄弟模块
  `workflow-detail-raw-inputs.ts`（648 行、仍在阈值内）。主文件保留：
  · 5 个共享 interface（`RawInputEntry` / `RawOutputEntry` / `RawNodeMeta`
  / `DetailNodeView` / `RawViewPacket`）—— 3 个下游模块
  （`workflow-detail-io` / `workflow-detail` / `workflow-subgraph-parse`）
  都按 `~/lib/comfyui/workflow-detail-raw` 这个路径 import 它们；
  · 另 3 个 `build*` 出口（`buildRawNodeMeta` / `buildNodeTypeMap` /
  `buildInnerNodeInputs` / `buildRawView`）。
  主文件从新模块 `import { buildRawInputs }` 并 **re-export**，消费者 import
  路径**完全不变**（§12.18 复用优先 —— 拆包只挪文件、不动契约）。新模块
  按 `import type { RawInputEntry } from "./workflow-detail-raw"` 反向取类型
  是**类型层**、`import type` 被 TS 擦除、不构成运行时循环。
  `scripts/.function-length-baseline.json` 把 `src/lib/comfyui/workflow-detail-raw.ts: 1`
  这一条目改指到新路径（**路径迁移、总量 19 不变**，不是给棘轮开后门）。
  `check-function-length`、`check-file-structure` 两门都绿；
  `workflow-detail-raw.test.ts`（15）+ `workflow-detail-io.test.ts`（39）
  - `workflow-subgraph-parse.test.ts`（20）共 74 用例全过。
    类型安全审查 src/lib 报告的 M-5 条目（3 个 900+ 行文件里最大的那个，
    也是唯一带「巨型函数」双料超标的那一个）。
