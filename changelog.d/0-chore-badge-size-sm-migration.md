## Changed

- **`ui/task-type-chip.tsx` 与 `ui/source-tag.tsx` 从手抄 `CHIP_SHAPE`
  常量迁到 `Badge size="sm"`**（PR #910 之后可选 cleanup；P67 治理
  系列尾单）：PR-4 给 Badge cva 加了 `size` 轴（default / sm / xs），
  `size="sm"` 是 `h-auto rounded-md px-1.5 py-0.5 text-[10px]` ——
  正是这两个密集行内元信息档此前在本地各自维护的 `CHIP_SHAPE` 常量
  里的 layout 类（`font-medium` 是 Badge base 自带、 CHIP_SHAPE 里
  的那份其实冗余，一并消失）。两文件本地常量精简成一条
  `OUTLINE_RESET = "border-transparent"`，**只用来顶掉
  `variant="outline"` 的 `border-border`**（chip 两档**不想要边框**、
  色底就够表达语义，这条与 `size` 无关、留在本地）。

  **外部 API 与视觉完全不变**（`TaskTypeChip` / `SourceTag` props 一字
  未改、DOM 结构与 PR-1 一致），4 处消费点（`WorkflowLibraryList` /
  `DetailHeader` 里的 `<TaskTypeChip />` / `<SourceTag />` 使用位）
  0 改动。7 份关联测试（`WidgetInputRow.test.tsx` / `WorkflowLibraryList.test.tsx`
  / `LogPanel.test.tsx` / `CanvasNode.test.tsx` / `ProjectEdge.test.tsx`
  / `WorkflowEdge.test.tsx` / `RelatedEdgesHighlight.test.tsx`）全绿。

  **未走 `tone` 轴的取舍**（PR body 里也说明）：Badge cva 同时加了
  `tone`（5 档语义色），本可把 source-tag 的 `local` 档写成
  `tone="success"`；但 PR-1 治理时刻意选了 `bg-success/12`（比
  tone.success 的 `/10` 稍强一档），因为密集列表里「本地工作流」需要
  比"完成态"更显眼一档的锚点提示。`online` 档用 `bg-subtle text-ink-faint`
  （比 tone.neutral 的 `text-ink-muted` 更浅一档）。**本 PR 只做
  CHIP_SHAPE → size=sm 的搬迁、不引入视觉漂移**；若后续想让全库徽章
  完全走同一 tone 表，另开 PR 一并把 status-badge / list-badge 家族
  的半透明度做统一。
