## Fixed

- **深色主题下工作流库画布的三张卡片是白底近白字**（ISSUE #609）：根因不在组件，而在 `globals.css` 的 token 层叠 —— shadcn 语义别名（`--card` / `--background` / `--foreground` / `--border` / `--popover` / `--muted` …）的**浅色档写在靠后的裸 `:root {}`**，深色档写在靠前的 `.dark {}`；两个选择器落在同一个 `<html>` 上、特异性相同（0-1-0），源码顺序决定胜负，于是**浅色档在深色下恒压深色档**。`bg-card` 编出来是 `background-color: var(--card)`，`--card` 恒为 `#ffffff`，所有走别名的表面在深色下一起取错值。浅色档改为 `:root:not(.dark)` 后两态各自生效。
- **浅色主题下「预览 IO」的端口类型 chip 看不清**：`portChipStyle` 把 chip **底色**写死成暗色档的 `#1E1A2E` / `#331A28` / `#26262E`，浅色下是「深底 + 深类型字」。底色改用 `--color-chip-type-image-bg` / `--color-chip-type-video-bg`（中性档 `--color-border-strong`），chip 的**文字色**仍是端口类型色（类型色例外不变）。
- **浅色主题下「预览 IO」的 seed 数字框看不见边界**：`NumberField` 描边从 shadcn 的 `border-border`（浅色 `#ececf1`，与底和面板几乎同色）改为 `border-border-strong`。
- **浅色主题下画布底部操作提示气泡读不出来**：该气泡在「固定暗色清单」内、底色恒为 `bg-black/60`，但文字用了随主题的 `text-ink-soft`（浅色下是深灰，等于深底深字）；文字改为固定浅色 `text-gray-300`。
