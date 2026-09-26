## Fixed

- `src/components/studio/__snapshots__/TrainingStudio.test.tsx.snap` 重生成 —— 这条用例在 `master` 上一直是红的（`Snapshot … mismatched`），但**红的原因不属于本条治理线**：漂移来自两批更早的改动没重算快照，
  - P75 二批：`ui/empty-state` 的 `page` / `error` 两档改成 shadcn 官方 `Empty` 系的薄封装 → DOM 多出 `data-slot="empty"` / `empty-header` / `empty-description` 三层结构；
  - P81：`<Button>` 直接子 icon 补 `data-icon="inline-start"`。
  净变化 16 增 5 删，全是这两类的结构/属性，**没有任何一条与 `<Hint>` 有关**（训练工作室没有原生 `title=` 的按钮）。
- 与本会话已合的两条的关系：#1135 那一批只重生成**确实被 P82 改到**的两份快照（`FilmStudio` / `WorkflowSubgraphNode`，它们顺带携带了同样的 P75/P81 漂移），当时刻意没把 `TrainingStudio` 一起收 —— 它不属于那次改动的作用面。本条把它单独补上，让 `pnpm test` 少一条假红。
