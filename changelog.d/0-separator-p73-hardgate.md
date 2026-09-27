## Added

- **P73 判据（硬闸）**：视图层自闭合 `<div>` + className 含 `border-{t|b|l|r}`
  = 手搓的分隔线、该走 `~/components/ui/separator` 的 `<Separator>`
  （shadcn `composition.md`：`Use Separator instead of <hr> or
  <div className="border-t">`）。
  锚点用 `<div\b[^>]*?className="[^"]*\bborder-[tblr]\b[^"]*"[^>]*?\/>`
  精准命中「自闭合 div + border-X」——含子内容的卡片结构边框
  （`<div className="border-t">文字…</div>`）**不**被算。

## Fixed

- **视图层 4 处自闭合虚线分隔线迁 `<Separator>`**（同 PR 内清零 · 直接进
  硬闸）：
  - `SectionHeader.tsx:24` `border-border-strong flex-1 border-t border-dashed`；
  - `GroupedControls.tsx:103` 同款；
  - `IoEndpointsSection.tsx:58` `border-border-strong h-px shrink-0 border-t border-dashed`；
  - `IoEndpointsSection.tsx:66` `border-border-subtle flex-1 border-t border-dashed`。

  迁移：`<Separator className="... border-dashed bg-transparent h-0/h-px" />`
  ——`Separator` 基元默认是 `bg-border` + `h-px w-full`，覆盖 `bg-transparent`
  后由 `border-t border-dashed` 画线、保留原虚线视觉与 flex-1 填充语义。
  `<Separator>` 底层是 base-ui `SeparatorPrimitive`（渲染 `<hr>`），比
  `<div role="separator">` 语义更正确、也更贴合「这是一条分隔线」的意图。
