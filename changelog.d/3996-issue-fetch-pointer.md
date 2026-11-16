## Changed

- **AGENTS.md 的「改动前必读文档」清单新增一条指路**（ISSUE #3996）：要取 Issue / PR 的
  正文、评论、图片，一律走 `pnpm ship --fetch-issue <号>` 这个现成入口（#3965 建的一步
  取全工具：正文 + 评论 + 图片按号落 `.tmp/issues/<号>/`，图片走 `get-imgs` 官方通道），
  不再手敲 `cnb issues get` / `get-imgs` 加手拼图片地址 —— 上一单（#3995）现场手拼
  URL 撞了 404；工具本身一直在（ship 的 SKILL.md 早已登记），是执行时没走到它。
