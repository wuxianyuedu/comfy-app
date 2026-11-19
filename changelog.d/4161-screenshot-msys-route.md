## Fixed

- **screenshot 的路由参数在 Git Bash 下被 MSYS 路径转换改写，指南用法实测失败
  （ISSUE #4161）**：`pnpm screenshot /settings` 的 `/settings` 被 MSYS 翻成
  `D:/Program Files/Git/settings`，拼接出非法 URL，截图失败。现在：
  - 脚本对能识别的改写形状**自动恢复**（按 MSYS 安装根的 `/git/` 标记取回路由，
    兼容 Program Files/Git、Git、PortableGit 布局与「只传 `/`」；用户路由以
    `/git` 开头时 first-match 仍落在安装根上，完整恢复）；
  - 恢复不了的形状给**指向 MSYS_NO_PATHCONV 的可读报错**（退出码 2），不再是一句
    `Cannot navigate to invalid URL`；
  - 路由参数不再强制要求开头斜杠（`pnpm screenshot settings` 同样可用）；
  - 指南（`docs/guides/ui-screenshot.md`）与脚本用法说明补 Git Bash 注记。
