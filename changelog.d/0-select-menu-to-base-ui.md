## Changed

- **`ui/select-menu.tsx` 从「`Popover` + 手拼 combobox 语义」迁到
  base-ui Select 原语**（P67 §12.18 系列尾单，审计报告里 C 类"中间地带"
  的第一顺位）：此前 SelectMenu 用 `ui/popover` 做浮层、再**手工拼装
  combobox 全套语义**——`role="combobox"` + `aria-controls` 指向
  `listboxId = useId()` + `<ul role="listbox">` + `<li role="option"
aria-selected>` + 手写 `handleKeyDown` (←/→/Enter) + 局部 `highlighted`
  state + `scrollIntoView` 滚入视野 + `setOpen` 与 `emitOpenChange` 两
  处状态同步。base-ui Select **原生就是 combobox**：Trigger 自带
  `role="combobox" + aria-haspopup="listbox" + aria-expanded`（源码
  实测 `SelectTrigger.js:127`）、List/Item 带 `role="listbox"` /
  `role="option"` / `aria-selected`、键盘 ←/→ / Home / End / Enter /
  Esc 与滚入视野全内置、`data-highlighted` / `data-selected` /
  `data-disabled` 三条数据属性把视觉状态从 JS 挪进 CSS。文件因此从
  **285 行降到 ~200 行**（大头还是文件头 doc 与四条视觉常量），
  且读屏器与浏览器兼容性都比手拼更稳。

  **富 ReactNode 标签的顾虑实证不成立**——原文件头把「`labels:
Record<string, ReactNode>` 才能塞彩色圆点/徽标」当作不迁 Select
  的理由，但 base-ui 原生支持：`SelectPrimitive.Value` 的 `.d.ts`
  行 32 明确 `children?: ReactNode | ((value: any) => ReactNode)`、
  行 28 的官方示例正是 `{(v) => v ? labels[v] : 'No value'}`；
  `Select.Item` 通过 `ItemText` 承接任意 ReactNode；Root 的
  `items?: Record<string, ReactNode>` 还能整表映射。本件走最直接
  的 `<SelectPrimitive.Value>{display}</SelectPrimitive.Value>`
  与 `<SelectPrimitive.ItemText>{labels?.[opt] ?? opt}</SelectPrimitive.ItemText>`
  两处 children 通道，语义与旧实现完全等价。

  **外部 API 与视觉契约一字未改**——33 处消费点（`TrainingStudio` /
  `ImageGenerationPanel` / `WorkflowLibraryFilters` /
  `RemoteModelDialog` / `CharacterDesigner` /
  `CharacterPortraitStudio` / `ExtractModelSelect` / `FinalComposer`
  / `ScriptGenerator` / `StoryboardPlanner.parts` /
  `WorkshopEncapsulationPanel` / `WidgetControl` / `VideoField` /
  `WorkflowSubgraphNode` / `WorkflowCanvasNodePreview` /
  `LibraryHostCard` / `AttributeMultiSelect` / `StyleSwitcher`
  / `DimensionControl` / `AspectMegapixelControl` /
  `ShotSizePicker` 等）**0 改动**：props 完全保留（`value` /
  `onChange` / `options` / `labels` / `placeholder` / `disabled`
  / `className` / `fullWidth` / `popoverMinWidth` /
  `autoFitFromOptions` / `footer` / `onOpenChange`）。视觉走四条
  常量（`TRIGGER_BASE` / `CONTENT_BASE` / `LIST_BASE` / `ITEM_BASE`）
  把旧 Popover + Trigger 的深色定制逐字搬到 base-ui 各件上；
  Trigger 默认 `w-auto`（**刻意不带 `w-full`**、与 PR 之前同一
  份历史坑：并排三个筛选下拉曾撞过覆盖顺序，见文件头详注）；
  Item 三态靠 `data-[highlighted]` / `data-[selected]` 属性
  选择器 + tailwind-merge 后写胜（selected 类写在 highlighted
  之后、两者同现时 selected 胜出、与旧三元表达一致）；Item **无
  check 图标**（旧实现就没有、base-ui 允许不引 ItemIndicator）；
  浮层 `min-w` 走原 `autoFitFromOptions` 算法（四条常量
  `POPOVER_AUTO_MAX=720 / POPOVER_AUTO_HEADROOM=56 /
POPOVER_PER_CHAR_PX=8 / POPOVER_AUTO_MIN=160` 与旧一致）；
  `footer` 作为 List 的**兄弟节点**渲染在 Popup 底部、不参与滚动
  （`mt-1 border-t pt-1`）；chevron 用 lucide `ChevronDown` +
  `group-data-[open]:rotate-180` 替代旧的内联 `<svg>` + `open &&`
  条件 class。

  消失的自造：`useState(open)` / `useState(highlighted)` /
  `useState(prevOpen)` 三处局部 state、`useRef(listRef)` /
  `useRef(onOpenChangeRef)` 两处 ref、`useEffect` 打开时重置
  高亮 + `onNextFrame` 滚入视野、`pick` `useCallback`、
  `handleKeyDown` 键盘算式、`React.useId` 手挂 `listboxId`、
  `<PopoverContent>` 与 `<Popover>` 浮层壳。**总计删掉约 80 行
  JS + 20 行 import**（原 `React, { useCallback, useEffect,
useMemo, useRef, useState }` → 只留 `useMemo`；`onNextFrame`
  与 Popover 系 import 全部去除）。
