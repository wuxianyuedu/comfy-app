## Fixed

- **工坊 / FilmStudio / TrainingStudio 跟随主题（ISSUE #75）**：三处沉浸工作区里成批的「浅色专用文字色」（`text-violet-600`、`text-emerald-600`、`text-amber-600`、`text-red-600`）压在深色底上，浅色主题里读不清；`WorkshopHeader` 的工作流名输入框、`TrainingStudio` 的触发词输入框与训练日志框写死 `bg-black/20~40`；`AgentOverlay` 的对话气泡与输入框用 `bg-white/6` / `bg-white/5` 暗色叠层；工坊两个弹层遮罩写死 `bg-black/50`。现级别色全部补 `dark:` 分支（浅色取 `-700` 档），深色叠层改 `bg-canvas-deep` / `bg-subtle`，遮罩改 `bg-black/20 dark:bg-black/50`。
