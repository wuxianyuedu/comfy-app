## Added

- **`pnpm ship --comment <号> --body-file <文件>`：往已有单子补一条读数有了入口**（ISSUE #2719）。
  此前这条动作只剩手工 `cnb issues post-issue-comment` —— 而它正是「敲错子命令退 0、平台一条也没写」
  那一族（`--claim` / `--release` 只写固定的两句状态评论，`--close-issue` 只跟验真的关单走）。
  这一格：评论 → 独立 `list-issue-comments --sort -created` 回读 → 逐字比对之后才念结论。
  五条口径：正文只从文件来（多行与反引号进不了 argv；`--body-file` 与建单的 `--issue-body-file`
  是两个对象）；比对前各去掉一个末尾换行（平台会吞掉文件末尾那一个，实测 1818 ⇄ 1817），
  其余任何差异退 1；署名行由 `withCommentHeader` 保证有且只有一行；写没跑起来 / 回读没跑起来
  退 2（回读没跑起来时明说「别急着重跑」）；与领取 / 结束 / 主流程任一旗标同跑退 2。
  评论的「写 + 回读」同时收成一份实现（`scripts/ship-comment.mjs`），领取 / 结束 / 关单收尾与
  CI 的 `runAppendIssueComment` 一并改走它 —— 此前这两段各写一份，漂移形态就是「一边补了回读、
  另一边没有」。口径见规范 §13.10.17。
