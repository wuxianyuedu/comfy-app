## Changed

- **`ui/progress-bar.tsx` 从裸 `<div role="progressbar">` + 手挂 ARIA 改为
  `~/components/ui/progress` + base-ui `ProgressPrimitive.Root` 二次封装**
  （P67 判据 b 治理，规范 §16.2.3 / §12.18）：此前外层是手写的
  `<div role="progressbar" aria-valuemin={0} aria-valuemax={100}
aria-valuenow={pct}>` — 正是 P67 b 的锚点形态；`ui/progress.tsx`（shadcn
  官方 Progress 系）早已装、却没用上。**DOM 分两层**（语义分层、也方便
  测试各查各的）：
  - **ARIA 宿主**：外层换成 `ProgressPrimitive.Root`（base-ui 直连、与
    项目 shadcn `ui/progress.tsx` 内部同款），`data-slot="progress-bar-track"`
    挂在它上面（**沿用旧命名保 DOM 契约不破坏测试**）。base-ui 内部自动
    给全 `role="progressbar"` / `aria-valuemin` / `aria-valuemax` /
    `aria-valuenow`（value=null 时该属性自然 omit），本件只补
    `aria-valuetext="进行中"`（indeterminate 档）与 `max={100}`。
  - **视觉轨道**：改用 shadcn 导出的 `<ProgressTrack>`（base-ui Track
    的 cva 薄封装），管 `bg-*` / `h-*` / `overflow-hidden` / `rounded-*`；
    项目的 `trackClassName` 走 `cn` 覆盖到这一层。
  - **填充**：仍由本件自绘 `<div data-slot="progress-bar-fill">` + 手算
    `pctToWidth(value, { minVisible })`。base-ui 的 `Indicator` 只按
    `percentageValue` 直给宽度、不吃「0 恒为 0、0<x<minVisible 抬到
    minVisible」这一档项目观感选择——**是正当差值、不是绕开基元**
    （§12.18「有等价就 import，缺的差异用参数或薄封装补」）。Track 是
    容器、Indicator 是可选子件，塞自绘 fill 不违语义。

  **外部 API 完全不变**（`value` / `label` / `showValue` / `className`
  / `trackClassName` / `fillClassName` / `minVisible`），15 处消费点
  （`FilmStudio` / `WorkshopHeader` / `WorkshopEncapsulationPanel` /
  `TrainingStudio` / `CanvasProgressIndicator` / `HistoryTaskCard` /
  `StoryboardPlanner.parts` / `ShotStudio` / `VideoStudio.parts` /
  `WorkflowCanvasNodePreview` / `SettingsParts` 等）**0 改动**。

- **`progress-bar.test.tsx` 更新两处**：
  1. 文件头 doc 补上「PR-3 起 DOM 分两层」的语义分层说明；
  2. 第 6 例「外观可覆盖而不重画轨道」把 `trackClassName` 的断言目标从
     `data-slot="progress-bar-track"`（现是 ARIA 宿主）改到
     `data-slot="progress-track"`（现是视觉轨道）—— 因为 `trackClassName`
     语义上就是覆盖视觉档（bg / h），旧实现把 ARIA 与视觉挤在同一 `<div>`
     上、这次拆开。ARIA 类断言（role / aria-valuenow / aria-valuetext）
     继续查 `data-slot="progress-bar-track"`，与旧命名兼容。

- **`scripts/.ui-primitives-baseline.json` 收紧**：P67 判据 4 → 3 处
  （棘轮只许降）。`progress-bar.tsx` 从 files 中掉出；剩 3 处：
  `list-badge.tsx` / `status-badge.tsx`（P67 a Badge，PR-4 与已治理的
  `task-type-chip` / `source-tag` 同族、可能给 Badge cva 扩 size/tone
  一次到位）、`range-slider.tsx`（P67 c Slider，跟进 PR 独立立项 + e2e
  覆盖）。
