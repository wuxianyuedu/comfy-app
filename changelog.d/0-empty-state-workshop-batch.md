## Fixed

- **视图层 workshop 目录 6 处手搓空态卡迁 `<EmptyState>`**（P75 一批 ·
  累计 12 → 6）：
  - `CharacterDesigner.tsx:559` 「还没有角色…」；
  - `FinalComposer.tsx:166` 「暂无分镜数据…」；
  - `ShotStudio.tsx:390` 「暂无镜头数据…」；
  - `StoryboardPlanner.tsx:154, 181` 两处（"先创建场景" 与 "暂无分镜"）；
  - `VideoStudio.tsx:247` 「暂无镜头数据…」。

  全部走 `<EmptyState variant="hint" description="…" className="py-* text-*" />`
  · hint 变体本身是「inline dashed 提示卡」（`border-border-strong bg-subtle
  text-ink-soft rounded-lg border border-dashed px-3 py-3 text-[11px]`）·
  通过 `className` 覆盖 py-6/py-10/p-8 + text-xs/sm 保留原尺寸感 ·
  tailwind-merge 保证 py 冲突按后写赢。

  视觉与"手搓版"接近（原：`border-border text-muted-foreground rounded-xl
  border border-dashed` · 现：基元的 `border-border-strong bg-subtle
  text-ink-soft rounded-lg` · 差别是 bg 多了一档 subtle · rounded 从 xl
  降到 lg · text 从 muted-foreground 换到 ink-soft）。用户口径允许视觉漂移。
