## Fixed

- **视图层 3 处 2-7 选项组 `<Button aria-pressed>` 迁 `<ToggleGroup>`**
  （P77 二批 · 用户口径：全部统一走 Base UI 默认 `data-[state=on]:bg-muted`、
  允许视觉漂移）：
  - `studio/FilmStudio.tsx:610` 镜头来源 2 按钮（project / script），
    原来是两个 `variant={cond ? "primary" : "ghost"}` 的 `<Button>`；
  - `studio/workflow-form/SizePresetTableModal.tsx:74` SCENES map（image /
    video），原来是每处 `bg-primary/20 ring-primary/50 ring-1` 手写 active
    视觉；
  - `studio/canvas/RgthreeBodies.tsx:69`（一批 · `#1034` 里做的）用的是
    单按钮 `<Toggle>`（不是 ToggleGroup），形态不同。

  三处都走 `<ToggleGroup multiple={false} value={[active]} onValueChange>`
  + `<ToggleGroupItem value="...">`。active 视觉**由基元统一**（data-pressed
  态走 `bg-muted`），原各处 className 里的 `bg-primary/20` `ring-primary/50`
  `variant="primary"` 手写对全部去掉 —— 视觉会漂（用户明确允许）。
  FilmStudio 的 `size="xs"` 也一并去掉（`ToggleGroupItem` 只有
  `default/sm/lg`，尺寸由 `className="px-2.5 py-1 text-xs"` 保留原档）。

  基线 **87 → 84**（P77 累计 6 → 3；剩余 3 处需要单独处理）：
  - `LogFilterBar.tsx:95` 4 选项 map、每处有 `LEVEL_LABEL_STYLES[level]`
    与 `FILTER_SELECTED_STYLES`（**level-specific 语义色**，红=错误、
    黄=警告等，不属于"active 视觉"要统一的范围）；
  - `UsageTestDialog.tsx:290` 5 preset map、`active = modeValue?.trim()
    === m && !isModeValueBroken(...)` 有"broken 值"这一维、`value`
    不总是 preset 之一；
  - `LlmLocalSection.tsx:167` 多选的 `<Button aria-pressed={checked}>`
    循环（一个模型 chip 独立开/关、不互斥），要走 `multiple={true}` +
    `value={string[]}` + 集合 diff 才能保留原语义。
  
  这三处是"active 视觉不是简单统一"、或"单选语义不匹配"的形态，需要
  个案设计。留下一批。
