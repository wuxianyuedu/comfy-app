## Fixed

- **ship 在链接 worktree 里收尾时，「我是谁」答错人 ⇒ 自动释放被跳过且话术把因果说反**
  （ISSUE #2833）。现场（#2825 / #2848 两轮收尾实测）：为隔离并行工作流用
  `git worktree add` 挂分支跑 `--merge --close-issue`，worktree 里**天然没有**
  `.gitignore` 掉的 `.env`，`resolveDevHandle` 的取值链跌到 `git config user.name`
  —— 「处理人是不是我」答错人，「开发结束」评论与撤 `处理人:` 标签被跳过，且话术
  把因果说成「处理人是别人」。修法两件：
  ① `dev-handle.mjs` 加回落档：本检出根读不到 `COMFYAPP_DEV_HANDLE` 时，顺着
  `git rev-parse --git-common-dir` 找**主检出**的 `.env` 再读一次（source 记
  `.env（主检出）`，仍算「人填的」；`explicitDevHandle` 同步同档，两个读「填过没有」
  的口子看到同一个 `.env` 面）；
  ② `finishIssueWork` 的话术把两件事分开：`handleExplicit=false` 时在「不代发」下面
  补一句「这份检出的『我是谁』是**取的**……回主检出 / 补 COMFYAPP_DEV_HANDLE 后再跑
  --release」，不许它长得像「处理人真是别人」。
