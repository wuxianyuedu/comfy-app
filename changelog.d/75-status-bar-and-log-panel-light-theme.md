## Fixed

- **底部状态栏与日志面板跟随主题，浅色下不再整条黑底 / 深底压白字（ISSUE #75）**：状态栏根容器此前写死 `bg-[#0c0c12]/95` + `border-white/6` + `text-gray-500`，完全没有浅色态——用户切到 Light 后窗口底部仍是黑色一条；日志面板外壳的 `bg-[#12101c]` / `bg-[#13131a]` / `bg-[#0d0d14]` / `border-white/8` 与行样式同样只有暗色值。现全部改成语义 token（`--color-panel` / `--color-card` / `--color-canvas-deep` / `--color-border-strong` / `--color-ink-*`），级别与 ANSI 词法配色（`LEVEL_BADGE_STYLES` / `LEVEL_TEXT_STYLES` / `TOKEN_CLASS`）补上浅色取值，Dark 观感保持不变。
