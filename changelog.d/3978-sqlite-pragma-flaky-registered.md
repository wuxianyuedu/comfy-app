## Fixed

- `tests/sqlite-pragma-sites.test.ts` 的结论分类修正（#3978）：「applySqlitePragmas
  在同样形状下全绿」一格此前只看子进程 stdout 的**第一行**——重试告警（经仓库 logger
  落到子进程 stdout）会先于 `ok` 出现，于是「重试后成功」被误读成失败。本机
  （Windows / 这块盘）确定性红（3 次隔离复跑），在 origin/master 干净 worktree 上
  复算同样红；GA 机器上时序未撞出所以落地时没被拦住。修法：结论看**全部输出行**——
  出现过 `ok` 即成功，`fail:…` / 非零退出且无 `ok` 照旧是非 ok；「裸循环会抛」的
  对照组与「全部进程到位」的前置判据保持不变。
