## Fixed

- **补上 #3809 拆分时漏加入库的三个模块文件**（ship-claim-rules / ship-issue-io /
  ship-release）—— 已推送的提交引用了这三个不存在的模块，ship CLI 的单子操作在
  模块加载期直接崩溃（ERR_MODULE_NOT_FOUND）；并把 ship-close.mjs 的
  finishIssueWork 引用改到 ship-release.mjs（ship-claim.mjs 已再导出，两种引用
  均可用）。
