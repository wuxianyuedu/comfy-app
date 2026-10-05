## Added

- **`~/components/studio/TypeChip`**：画布节点与参数表单上那枚「类型标签」，此前
  `inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 font-semibold` 在
  studio 的 **6 个文件里抄了 10 处**（其中 8 处逐字相同），是三族里最大的一族孪生。
  三档 `size` 是按调用点量出来的，不是凑的：`md` = 12px（5 处）、`sm` = `text-3xs`
  10px（4 处，缺省档）、`xs` = 同 10px 但 `px-1 py-px`（1 处，组合控件里挤在最右端）。
  `md` 那档**故意仍写 `text-[12px]` 而没换成 `text-xs`**：实测 `text-xs` 会连带把
  `line-height` 锁成 16px，而这些 chip 现在吃的是继承行高 —— 换 token 会静默改行高。
  它因此仍计入字面字号棘轮，是契约 §Components 里记下的一处刻意。
  `tone="none"` 那一档是必需的而非冗余：四处 chip 的颜色由 `portChipStyle()` 的行内
  样式给全，而行内样式覆盖 class 这件事不可靠 —— `chipStyle` 未必把 `background` 与
  `color` 都给全，缺哪一项，缺省档就从 class 里漏出来改渲染。所以「调用点全权上色」
  写成显式一档。

## Changed

- 十处调用点改用该件：`CanvasNode/SelectedToolbar`、`project-canvas/WorkflowNode`、
  `project-canvas/WorkflowNodeArdot`（其 `PortChip` 只留配色逻辑）、
  `workflow-form/AspectMegapixelControl`、`WorkflowNodeParts`、
  `WorkflowWirePortRows`（三处）、`DynamicWorkflowForm/sections/WidgetInputRow`（两处）。
  十处原来**每一处**都手写 `style={{ fontFamily: "var(--font-sans)" }}`（画布节点父级带
  等宽字体，chip 要显式回到 sans）—— 那是形状的一部分，收进实现，调用点再传 `style`
  时排在后面仍可覆盖。
- `ParamOwnerTag.tsx:15` **没并进来**：它是同名件自己的形状（带描边、`py-px`、
  `font-medium`、`text-[9.5px]`、primary 底色），六项形状标记只命中两项。

## Added

- **防回潮判据 + 棘轮降档**（`tests/design-md-contract-sync.test.ts`，固定清单成员）：
  类型 chip 那六个标记**全命中**的文件只许是 `TypeChip.tsx` 一个（与序号圆同法，按标记
  集合判、不按类名先后顺序判）。负控制同时喂进「一份手抄的 chip」（必须全命中）与
  `ParamOwnerTag` 那枚异类（必须不命中）—— 不然这条判据只是在抓一切。
  字面圆角棘轮 **21 → 12**、字面字号棘轮 **302 → 298**（实测读数）。
- 订正契约里两条被上一轮否掉的主张：序号圆那行还写着「needs-design-decision」，
  而 `IndexDot` 已经落地（并写明第 6 处是 `AttributeMultiSelect` 的勾选方框，不是序号）。
