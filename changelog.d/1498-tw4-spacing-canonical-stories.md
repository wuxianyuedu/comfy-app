## Fixed

- **story 层最后 15 处「方括号任意值」收口成 spacing scale 倍数（ISSUE #1498）**：
  Tailwind v4 的 canonical 写法里，spacing 工具类的任意值能写成 `--spacing`
  倍数时就该写成裸数值（`h-[720px]` → `h-180`、`h-[110px]` → `h-27.5`），
  编辑器（`suggestCanonicalClasses`）一直提示、`scripts/tw4-spacing-canonical.mjs`
  也一直能判——**判据在（ISSUE #1451 已给它棘轮档），存量没人在跑**。

  分布在 9 份 story（`AppShell` / `ProjectCanvas` / `WorksGallery` /
  `canvas/NodeFrost` / `logs/LogFilterBar` / `logs/LogPanelHeader` / `logs/LogRow` /
  `workflow-form/WorkflowPortHandle` / `workshop/WorkshopPipeline`），
  由 `node scripts/tw4-spacing-canonical.mjs --write` 落盘、逐条核过换算
  （脚本自带 `--spacing` 仍是 0.25rem 的断言，换算前提不成立就直接拒绝改写）。
  改写后 `--check` 从 15 处降到 0，与基线 0 处重新对齐。
