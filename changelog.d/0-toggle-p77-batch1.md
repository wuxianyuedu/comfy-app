## Fixed

- **视图层 1 处「旁路开关」`<Button aria-pressed>` 迁 `<Toggle>`**（P77 首批 ·
  单按钮 pressed 语义类）：
  `canvas/RgthreeBodies.tsx` 里的 group 旁路开关是一颗「点击翻转 bypass」的
  二态小章。此前用 `<Button variant="ghost" aria-pressed={bypass} onClick=…>`
  手拼 pressed 状态。P77 判据 `aria-pressed\s*=` 命中。

  这里**不该**走 `<ToggleGroup>`（那是 2–7 项**选项组**的账，见 shadcn
  `forms.md`），正确基元是 `<Toggle>`（`ui/toggle.tsx` = Base UI Toggle 薄
  封装，内部自动打 `aria-pressed` / `data-pressed` / Enter / Space / 焦点环，
  对外 API 是 `pressed` + `onPressedChange`）。迁移后：
  - `aria-pressed={bypass}` + `onClick={() => ctx.setBypass(…)}` →
    `pressed={bypass}` + `onPressedChange={() => ctx.setBypass(…)}`；
  - `variant="ghost"` 移除（Toggle 没 ghost 变体；本件 `className` 里
    已经用 `bg-transparent hover:bg-transparent` 覆盖了底色，视觉等价）；
  - 原来 `onClick` 里的 `event.stopPropagation()` 拆给 `onPointerDown`
    与 `onMouseDown`（这两处本来也已经 stopPropagation，onClick 那份是
    ReactFlow 拖拽兜底；Toggle 的 `onPressedChange` 签名不带 event，
    兜底路径靠 pointer/mousedown 已经足够）。
  - `title` 与内部 `<span>` 视觉层完全保留。

  基线 **100 → 99**（P77 累计 7 → 6）。剩余 6 处分两类：
  - **2–7 项选项组** → `<ToggleGroup>` + `<ToggleGroupItem>`
    （FilmStudio 2 处、LogFilterBar 1 处、UsageTestDialog / LlmLocalSection
    / SizePresetTableModal 各 1 处）；这几处 active 态目前都是**具体类
    覆盖**（`bg-primary/20 ring-primary/50` 之类），迁 ToggleGroup 需要
    把 active 视觉统一挪到 `ToggleGroupItem` 的 `data-[state=on]`
    分支（或 `aria-pressed:` 伪类），是一次**跨文件视觉走查**、留下一批。
  - `Button` 上单按钮 pressed → 也可选 `<Toggle>`（本批 RgthreeBodies 是
    同类首样）。
