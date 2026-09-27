## Fixed

- **视图层 2 处 `<Button aria-pressed>` 迁 `<ToggleGroup>`**（P77 三批 ·
  累计 6→1）：
  - `studio/logs/LogFilterBar.tsx:89` 日志级别 4 档（all/info/warn/error）
    的 filter 单选组。active 视觉走基元的 `data-[state=on]:bg-muted`、
    原 `FILTER_SELECTED_STYLES` 与 `hover:bg-subtle` 手写对去掉；
    **`LEVEL_LABEL_STYLES[level]` 保留**——它是「info=蓝、warn=琥珀、error=
    红、all=中性」的 level-specific 语义色（跟 log-row 里同一档对齐、
    不是 active 状态色），P77 二批统一的是 active、不是这个。
  - `app/(main)/settings/components/UsageTestDialog.tsx:278` 视频 mode
    快捷选择 5 preset。**broken 值语义保留**：`value` 用一个 IIFE 现算——
    只有当 `modeValue.trim()` 存在、非 broken、且在 `VIDEO_MODE_PRESETS`
    里时数组给 `[trimmed]`、否则给 `[]`（所有 item 都无 active），
    与迁移前 `active = modeValue?.trim() === m && !isModeValueBroken(...)`
    的判据完全一致。`VIDEO_MODE_PRESETS` 是 `as const` 元组、`.includes
    (string)` 会被 TS 拒，改用 `.some((p) => p === trimmed)` 避开 union
    参数限制。

  基线 **84 → 82**（P77 累计 6 → 1）。

## 剩余 1 处留下一批

- `LlmLocalSection.tsx:167` —— 本地模型「额外候选」的**多选 chip**（点
  一次翻转一个模型的开关、多档共存），不是 2-7 项**单选**组。要走
  `<ToggleGroup multiple={true} value={extraModels}>` + `onValueChange`
  里的集合 diff（把"点了 X 就把 X 从集合里翻一下"的语义映射到
  "整组新集合是 `vals`"），比单选要复杂一点、留下一批单独做。
