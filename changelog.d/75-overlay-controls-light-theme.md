## Fixed

- **下拉菜单 / 浮层控件跟随主题：浅色下不再深底压浅字、深色下不再拿前景色当描边（ISSUE #75）**：用户反馈「有很多下拉菜单颜色都有问题」。`DarkSelect` 的**当前选中项**写死 `text-violet-600`——浅色值压在深色弹层上，选中项几乎读不出来；`Select` / `Popover` 的浮层描边用 `ring-foreground/10`，在浅色主题里是「几乎黑的细边」（前景色 = 文字色），Deep 主题里又是白的，同一份代码两种观感且都不像分隔线。现浮层统一 `border-border-strong` + 中性 ring（`--ring-shadow`：浅色深、深色浅）+ 投影两态，`DarkSelect` 选中项补 `dark:` 分支，`ModalDialog` 遮罩从写死 `bg-black/65` 改为浅色 `bg-black/20`。
