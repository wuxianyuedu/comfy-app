## Changed

- **`ui/segment-popover.tsx` 段内选项从「`<Button role="option">` 手写循环」
  迁到 `~/components/ui/toggle-group`**（P67 §12.18 中间地带收尾第一顺位，
  1bfc79c 已装 shadcn ToggleGroup + Toggle）：每一段（Section）原本是
  「`group.options.map(opt => <Button role="option" aria-selected={selected}
onClick={() => section.onChange(opt.value)}>...)`」的手写循环——与
  `ui/toggle-group` 是**同一件事的第二份实现**。base-ui ToggleGroup 提供：
  `multiple={false}` 单选模式、`value` 数组受控、`aria-pressed` 状态、
  跨子分组共享一份 `section.value`（React Context 天然处理互斥、不
  需要每 subgroup 各持 state）、键盘 ←/→ / Home / End 与 roving focus。
  段外层 `<Popover>` + `<PopoverTrigger>` + `<PopoverContent>` 保留
  （面板形态没有基元对应），但**去掉**了 trigger 上的 `aria-haspopup="listbox"`
  与 content 上的 `role="listbox"`——面板里已经是**分段单选组**、不再
  是 listbox；base-ui Popover.Trigger 自带 `aria-haspopup="dialog"`
  （源码 `PopoverTrigger.js:123`）。选中态从 `bg-primary/20 text-ink-bright
ring-primary/55` 的手写三元挪到 `data-[state=on]:` 属性选择器 +
  tailwind-merge 后写胜，与旧视觉一致；未选 `text-ink-muted hover:bg-subtle`
  走同一份 ITEM_CLASS 常量。消费方 API（`MultiSegmentPopover` props /
  `SegmentSection` shape / `RatioIcon` / `shortRatioLabel`）**完全不变**。
  5 处消费点（`DimensionControl` / `AspectMegapixelControl` /
  `GroupedControls` / `VideoControl` / `ShotSizePicker`）0 改动。

- **`ui/validation-error-list.tsx` / `ui/multi-mode-select.tsx` /
  `ui/key-value-rows.tsx` 三份文件头各补一段「为什么没合到对应基元」的
  实证说明**（P67 §12.18 中间地带 · 已评估保留 · 免下次 review 又问一遍）：
  - `ValidationErrorList` vs `ui/field.tsx` 的 `FieldError`：形状重合，
    但**FieldError 是「表单字段行内」**（挂在具体 `<Field>` 下、绑定
    `aria-describedby`、单条 message 或 `<ul>`）、**本件是「面板式清单」**
    （错误面板 / 历史卡 / 结果卡容器里、无字段绑定、每行是 `nodeId` +
    `classType` + `field` + `message` **四段**结构化信息、色彩由外层
    注入）。强合会丢字段结构。
  - `MultiModeSelect` vs `ui/combobox.tsx`（1bfc79c 装、cmdk 搜索）：
    形状重合，但本件有 3 条 Combobox 撑不住的复合语义——**①**
    draft/apply 事务（面板内草稿 set + 保存 / 取消两个终态，Combobox 是
    即选即 `onChange`）、**②** `defaultMode` 指针（modes 里额外标一位
    「哪个是默认」并显示在 chip 主色上 + 保存时若被取消勾选回退到
    `arr[0]` 保证 `defaultMode ⊆ modes` 约束）、**③** image/video/audio
    分类页签（面板顶切段、打开定位到首个已选模式所属分类）。硬合会
    把事务化编辑降级为即时提交。
  - `KeyValueRows` vs `ui/item.tsx`：Item 是「media + content +
    title/description + actions」的复合行容器，**只贴本件 4 layout
    中的 `rows` 一档**；`stacked`（label 在值上方 + 网格）、`table`
    （真 `<table>` + `<th scope="row">` 无障碍强要求）、`inline`
    （`<span>` 内联不换行）三种超出 Item 的 `<div>` 系形状。合 Item
    收益 1/4、代价 4/4 拆本件 API，保留自绘。
