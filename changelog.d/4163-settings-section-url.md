## Added

- **设置页分区支持 URL 直达（ISSUE #4163）**：独立路由 `/settings` 现在消费
  `location.hash`——`/settings#settings-comfyui`（与分区节 DOM 锚点同形）挂载后
  直接停驻「创作后端」分区，与应用内跳转事件走同一条白名单收敛路径
  （`sectionFromLocationHash` → `readInitialSection`，非法 / 缺省回落「本地模型」）。
  交付截图（`pnpm screenshot "/settings#settings-comfyui"`）与分享 / 收藏链接
  不再需要一次性 Playwright 脚本点击 + 滚动。
