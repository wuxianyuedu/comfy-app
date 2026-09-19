## Changed
- 类型卫生治理：`src/components/studio/workflow-types.ts`
  - 删除贴在 `WorkflowNoteData`（便签）前、却描述 `WorkflowEditorNodes.tsx` 里
    `IO_PORT_HEIGHT` / `PORT_ROW_GAP` / `IO_PORT_WIDTH` 的孤儿注释（常量不在此文件，
    且锚定的类型与 wfIoPort 毫无关系）。
  - `getNodeView().raw` 与 `RawNodeView.raw`（`WorkflowNodeJsonPopover.tsx`）的内联
    节点元数据类型统一复用 `RawMetaEntry`，消除第三份同构复制。
  - `boundaryPins.inputs` / `.outputs` 抽取为共享的 `BoundaryPin` 接口（原本两处逐字段抄写）。
  - `RawMetaEntry.flags` / `properties` / `mode` 改为可选，与 `WorkflowDetail.rawNodes`
    口径一致——纯 API 导入时这些字段本就缺失，读取方早已用 `?.` + `??` 防卫。
  - 文件头补充「`raw_inputs`（snake = 服务端 DTO）/ `rawInputs`（camel = 画布 data）/
    `inputs`（裸名 = 子图 data）同源」的命名约定注释，避免 Ctrl+F 漏找。
