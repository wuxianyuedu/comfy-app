## Changed

- **`ui/task-type-chip.tsx` / `ui/source-tag.tsx` 从裸 `<span>` 胶囊改为 `<Badge>` 薄封装**
  （P67 判据 a 治理第一步，规范 §16.2.3 / §12.18；同时消掉 `source-tag.tsx`
  两处 §4.11.1 色值违规）：两处此前各写一份 `inline-flex items-center
rounded-md px-1.5 py-0.5 text-[10px] font-medium` 的胶囊模板，`ui/badge.tsx`
  已装但绕开——正是 P67 判据的锚点形态。改完两处分别 import `<Badge>`、
  保留同一份 `CHIP_SHAPE` layout 覆盖（Badge 默认 `h-5 / rounded-4xl / px-2
/ text-xs` 是通用胶囊，本 chip 是密集行内元信息、要更紧一档），
  `className` 只覆盖**尺寸形态**、不动 variant 逻辑（对齐 shadcn `styling.md`
  「className for layout, not styling」）。

  **`source-tag.tsx` 顺带修 §4.11.1**：`local` 档此前写死 `bg-emerald-500/12
text-emerald-700 dark:text-emerald-400`，「把成功色换成 teal」对它不生效；
  改走 `bg-success/12 text-success-strong`（与 `status-badge` 的 SUCCEEDED
  档同源 token）。`online` 档此前是 `bg-surface-2 text-ink-faint`（已是项目
  语义 token，非 Tailwind 字面量），保留不动。

  **`task-type-chip.tsx` 刻意保留 violet / sky / amber 字面量**（规范 §3.6.1
  类型色例外）：image / video / audio 是「这一类工作流是哪种媒体」的**分类
  锚点**、不是状态色，改品牌色对它**不生效是刻意的**——否则 image 会跟着
  primary 漂走、与「运行中」语义混起来。同款先例见 `aurora-background.tsx`
  / `seed-mode-button.tsx` 在 `scripts/check-theme-colors.cjs` 的
  `EXEMPT_TABLES` 登记；`check-theme-colors.cjs` 只扫 `rgb(…) / rgba(…)`
  函数式色，Tailwind 字面量不在检测面内，无需登记即已放行。

- **`scripts/.ui-primitives-baseline.json` 收紧**：P67 判据起点 8 处 → 6 处
  （棘轮只许降）。剩下 6 处按后续 PR 逐个治理：`empty-state` / `form-field`
  (P67 d/e，依赖装 `shadcn@latest add empty field` 补地基)、
  `progress-bar` (P67 b)、`list-badge` / `status-badge` (P67 a，与本次同族)、
  `range-slider` (P67 c，独立立项)。
