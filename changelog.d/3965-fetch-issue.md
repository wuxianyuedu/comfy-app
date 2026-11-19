## Added

- ship：新增 `pnpm ship --fetch-issue <号>`（#3965）——把一张 issue 的正文、评论与图片一次性取到本机固定目录 `.workbuddy/issues/<号>/`（gitignored、按号分目录，重跑即更新）；图片走 `issues get-imgs` 官方通道下载并替换 markdown 里的链接为本机相对路径，治「手工抓图片 URL 撞 404」。只读平台（三条读命令），与显式动作互斥。
