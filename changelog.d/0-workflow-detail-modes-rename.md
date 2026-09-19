## Changed

- 把「工作流级模式清单」与「IO 条目的多模式覆盖层」两个**同名 `modes`** 彻底拆开，
  消除历史命名地雷（两者都在 `workflowIO` 附近、又都叫 `modes`，极易误读误改）：
  - 工作流级模式清单：`WorkflowDetail.modes`（`components/studio/workflow-types.ts`）
    与 `WorkflowDetailFull.modes`（`src/lib/comfyui/workflow-detail.ts`，GET
    `/api/workflows/[id]` 下发类型）→ `availableModes`。
    lib 侧同步改名，保证 tRPC 两端推断严格一致，否则服务端下发 `modes` 而客户端读
    `availableModes` 会整片拿到 `undefined`。
  - IO 条目的多模式覆盖层（各模式的默认值 / 可见性 / required / seedMode）：
    `WorkflowIOParam.modes`（`components/.../workflow-types.ts`）与
    `WorkflowIOEntry.modes`（`src/lib/workflow/workflow-io-types.ts`，写入
    `workflowIO` JSON 列的实际存储键）→ `modeOverrides`。
  - 注意：`WorkflowTemplate.modes`（DB 列，工作流级模式清单的存储键）**不改名**——
    它对应的是 `availableModes`，与 IO 条目的覆盖层是两回事，改名会动表结构与
    loader，超出本次范围。
- 存储键改名带来旧数据兼容：写入侧统一走 `modeOverrides` 后，改名前落库的旧工作流
  其覆盖层仍挂在 `modes` 键上。读取边界统一回退归一：
  - `parseWorkflowIOMap`（`src/lib/workflow/workflow-io-types.ts`，列表/库接口解析）
    与 `enrichWorkflowIO`（`src/lib/comfyui/workflow-detail-io.ts`，详情 GET）读取时
    取 `modeOverrides ?? modes`，旧键只在新键缺失时生效，不覆盖已用新键落库的数据；
    旧键不会原样下发，避免同一份覆盖层以两个名字往返。
- 调用方同步：`WorkflowIOPreviewPanel`、`WorkflowStores`（模式页签编辑 / 清除）、
  `use-workflow-io`、`DynamicWorkflowFormView`、`workflow-io.ts` 的
  `filterVisibleInMode` 泛型约束、以及各解析助手（`isVisibleInMode` /
  `resolveEntryDefault` / `resolveEntryRequired` / `resolveEntrySeedMode` /
  `collectModeCodes`）全部改读 `modeOverrides`。
