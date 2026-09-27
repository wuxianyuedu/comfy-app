## Fixed

- **`WorkshopAside.tsx:44` `<label className="mt-3 block">` → `<FieldLabel>`**
  （P78 收尾批 · 累计 2 → 1）：工坊右栏的「按类别筛选工作流」字段行、
  label 包 `<Select>`（shadcn 派、`#1013` 已给 SelectItem 加了 SelectGroup）、
  与 `<span>` 空态提示。FieldLabel 内部还是 `<Label>` → `<label>`、DOM
  一致；把「字段行 label 的视觉契约」收进基元 cva。

  基线 **4 → 3**（P78 累计 33 → 1 · 九批覆盖 25 文件 32 处）。

## 剩 3 处 · 各需不同前置

- **P78 AttributeMultiSelect:166**（1 处）—— Popover 里 `<label role="option">`
  的自绘 option 行、语义不是标准 label（应走 `<li role="option">` +
  隐藏 `<input type=checkbox>` 或 `SelectMenu multiple` / `OptionListPopover`
  基元）、需要产品口径决定；
- **P76 LlmLocalSection:134**（1 处）—— `<FormField>` 的 render prop 里
  `{...a11y}` spread 到 `<select>`，走 SelectMenu 需要**先扩 SelectMenu
  的 a11y 属性转发口**（当前 `SelectMenuProps` 无 `id` / `aria-describedby`
  / `aria-invalid` spread 到底层 Trigger）；
- **P77 LlmLocalSection:167**（1 处）—— 混合多选 chip（当前模型永远
  checked + 其它候选独立开关）、和 ToggleGroup `value=truth-set` 语义
  不匹配，需要**产品决策**：扩 ToggleGroup 支持"永远 pressed 项"、
  还是每项独立 `<Toggle>` 放弃组内互斥。

三条都超出"机械替换"范围、留下一批各自独立处理。
