## Added
- `pnpm ship --screenshot-reply <号> --file <png> [--body-file <文案>]`（#5191）：截图上传 + Issue 回帖一步完成，不再手敲两条 cnb 命令与人工截取 `asset_link`。上传复用 `cnbJson`、正文署名 / 末尾换行 / 图片链接归一与写后逐字回读全部复用 `ship-comment.mjs`；上传回执没有 `asset_link` 退 2、回读不一致退 1，回帖文案署名首行不会重复。
