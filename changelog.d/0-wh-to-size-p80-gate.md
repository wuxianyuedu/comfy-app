## Added

- **UI 基元棘轮新增 P80「视图层 `w-N` 与 `h-N` 同值应换 `size-N`」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  shadcn `styling.md`：`Use size-* when width and height are equal.
  size-10 not w-10 h-10.` `size-N` 是 `w-N h-N` 的简写、由 tailwind 内建；
  同一份 `w-N h-N` 手写会让「改尺寸」要动两处、且两处不同步就会漂
  （`w-8 h-9` 是有意的宽×高还是漏改？机器看不出来）；与 `rounded-full` /
  `size-*` 混用时视觉一致性问题（圆点用 size 表达"这是个圆"、用 w/h 表达
  的是"两个方向独立设"）。

  判据按 `className` 字符串解析（`className="…"` / `className='…'` 都支持）：
  收集里面出现的 `w-N` 与 `h-N` 的数字集，看**交集**、同字符串内交集非空
  即计一处（`size-N` 是唯一修法）、不同 className 之间相互独立。夹在其中
  的其它 utility（`w-8 rounded-lg h-8`）不影响判定；小数（`w-1.5 h-1.5`）
  也能命中。`ui/` 走 `EXEMPT_DIRS` 天然豁免（`ui/avatar.tsx` 里 `size-*`
  变体表本身就是这条判据要推荐的写法）。

  走棘轮：本批上线时视图层实测约 **44 文件 91 处** 存量（`HomePage.tsx` 7、
  `EmptyCanvasHint.tsx` 4、`MaterialLibraryPanel.tsx` 4、`WorkflowSubgraphNode.tsx`
  4、`SubgraphHeader.tsx` 3、`HistoryPanel.tsx` 3 等），`--update` 冻结
  起点、只许降。下一批按域分片把每个 `w-N h-N` 换成 `size-N`。

  差分回归 3 例见 `tests/check-ui-primitives.test.ts`：同 className 里
  `w-8 h-8` 计入 → 阻断 / 只有一侧或不等值（`w-8 h-9`、`w-full h-14`）不误伤
  / 两个独立 className 各有一对 `w-N h-N` 计 2 处（一处一处治理）。
