## Fixed

- **合并前复算的清理阶段不再吞掉判决**（#4832）：`base-check` 的临时 worktree
  清理此前用一次性 `rmSync(recursive, force)`，Windows 上撞杀软 / 索引器 / 残留
  句柄的偶发 `EPERM` 会把已算完的复算结论吞成「复算没跑成（退 1/2）」，push 被
  拦向错误方向。现在清理统一走「有限次退让重试 + 失败只记警告读数、不抛」，
  `git worktree remove` 同样只记读数；判决与退出码不再被清理阶段改写，残留目录
  由读数指给人工删除。用例补「偶发 EPERM 重试成功 / 始终 EPERM 不抛且记读数」
  两态正控。
