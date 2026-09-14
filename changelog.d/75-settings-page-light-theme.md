## Fixed

- **设置页边框有了层次、日志框与 ANSI 配色跟随主题（ISSUE #75）**：用户反馈「设置界面的边框线条显得过于生硬」「有的浅色主题时，文字几乎看不见」。卡片此前统一用 `border-border`（浅色 `#ececf1` 纯灰、无弱化）且无任何投影，三张卡叠在一起就是三条同强度的横线；ComfyUI / Ollama / Drizzle Studio 三处启动日志框写死 `bg-black/30` + `text-gray-300`（浅底上深底压浅字，两头都不对）。现卡片改用 `border-border-subtle` 弱化边框 + 极轻投影建立层次，日志框改 `bg-canvas-deep` / `text-ink-field`，日志 ANSI 配色表补上浅色取值。
