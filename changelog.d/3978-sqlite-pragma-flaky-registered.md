## Fixed

- `tests/sqlite-pragma-sites.test.ts` 登记进 `KNOWN_FAILED_FILES`（#3978）：#3954 落地的
  「applySqlitePragmas 在同样形状下全绿」一格断言**零次**撞锁重试，而重试正是该功能的
  工作方式；本机（Windows / 这块盘）确定性红（3 次隔离复跑），在 origin/master 干净
  worktree 上复算**同样红**——是 #3954 自带的概率性形状（其头注自认「亚毫秒窗口上的
  概率事件」），GA 机器上时序未撞出所以落地时没被拦住。断言改法（认「重试后成功」
  而非「零重试」）归 #3978 讨论；登记附归因，修好后按纪律立刻删。
