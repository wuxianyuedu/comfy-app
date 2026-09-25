## Fixed

- **`ui/seed-mode-button.tsx` 面板内两处 `space-y-*` 换 `flex flex-col gap-*`**：
  P70（视图层 space-y/x→flex+gap）判据把 `ui/` 走 `EXEMPT_DIRS` 短路——那是给
  「视图 vs 基元」这一层分工用的，不代表基元内部可以走两套间距机制。
  shadcn `styling.md` 对 space-y-\* 的禁令同样适用基元内部：`space-y-*` 靠给子
  元素加 `margin-top`（`:not(:last-child) > *`）实现，与 flex/grid 的 `gap-*` 是
  两套机制，混用会让「改间距」要同时找两种写法。这里 seed 面板的
  「控件后行为 / 4 选 1 切换」两组各改一处，视觉等价。
- **`ui/validation-error-list.tsx` 一处模板串 `space-y-1 ${className}` 换 `cn()`**：
  一是 `space-y-*` 同上；二是模板串绕过 `cn()`（`src/lib/utils.ts` 里包了
  `tailwind-merge`），调用方传 `flex flex-col gap-*` 时与内部 `space-y-*` 会
  共存、彼此不覆盖。改成 `cn("flex flex-col gap-1", className)` 后同一族的
  冲突类由 tailwind-merge 归一。
