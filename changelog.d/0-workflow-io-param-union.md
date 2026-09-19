## Changed
- `WorkflowIOParam`（`components/studio/workflow-types.ts`）与 `WorkflowDetailIOEntry`
  （`src/lib/comfyui/workflow-detail.ts`，GET /api/workflows/[id] 下发类型）改为
  `IOParamSlot` 判别联合：合法的 (direction, kind) 组合只有 `input+param`、
  `input+widget`、`output+output`，`output+param` 这类非法组合在类型层面被排除。
  - 新增 `IOParamSlot`（`src/lib/workflow/workflow-io-types.ts`）作为方向 × 种类的
    单一真相源，两端共用，避免两份同义定义漂移；画布侧经
    `workflow-types.ts` 的 `export type { IOParamSlot }` re-export 复用。
  - `WorkflowDetailIOEntry` 由 `extends WorkflowIOEntry { kind: ... }` 改为
    `IOParamSlot & Omit<WorkflowIOEntry, "direction" | "kind">`；GET 构造边界
    （`buildWorkflowDetailJson`）按 `kind` 推导 `direction`，与客户端
    `WorkflowIOParam`（同为判别联合）保持 tRPC 推断严格兼容。
  - `WorkflowStores.toggleIO` 构造点位同步：先按 `ref.kind` 合成 `slot: IOParamSlot`
    再展开，非法组合在类型层面构造不出来。
  - 注：`kind` 仍是开放字符串（自定义种类经 `WorkflowIOEntry` 透传，不进判别联合），
    故判别联合只收窄「方向 × 已知三桶种类」，不影响自定义种类落库/回显。
