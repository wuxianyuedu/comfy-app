## Fixed

format-bot 红路径首跑（PR #2359，ISSUE #2358）暴露的真缺陷：**PR 事件下
`CNB_BRANCH` 是目标分支名**（官方文档语义，`.cnb.yml` 锁注释早有记载），脚本拿它
当源分支 ⇒ 「永不回写 master」护栏拦住了自己；且平台 PR 检出是 merge 提交，
推 `HEAD` 会把 merge 提交推进源分支。修法：

- 源分支由 `git ls-remote` 按 `CNB_COMMIT`（PR 事件 = 源分支 head）反查，恰好一个
  才动手，零个/多个 ⇒ 可读地红不猜目标；
- 修复提交改用 plumbing（hash-object → 临时索引 read-tree → commit-tree -p 源头）
  只建在源分支 head 之上，全程不碰工作区与 merge 检出；
- 防连环护栏改看**源分支头**的标题（HEAD 是 merge，其标题不是任何分支的事实）。
