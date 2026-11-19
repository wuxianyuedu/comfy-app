## Changed

- **每日红自动提单：完整失败日志直接作为 CNB 附件挂在单子上**（#4408）：
  GA 每日档（`Daily (mirror)`）跑红自动立案时（`ci-ga-daily-failure-issue.mjs`），
  除正文里的红色失败窗口外，现在把**完整失败日志**上传成 CNB 仓库附件并把下载链接
  写进单子正文 —— 本地从单子里直接下载，不再出站 `api.github.com`、不靠 `gh`
  （本地 / 自托管机到 github.com 出网间歇不通）。上传链与 PR 侧日志搬运
  （`ci-ga-logs-relay.mjs`，#3437）收成共享模块 `scripts/ci/ci-cnb-attachment.mjs`
  （`POST /-/upload/files` → `PUT` → 随单子正文发布后站内可读）；附件传不成立即退回
  原「窗口 + GitHub 下载端点」形状，立案照写。日志在取数层已按硬规则 17 脱敏后才上传。
