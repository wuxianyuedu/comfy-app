## Fixed

- `submitVideo` / `generateImage` 幂等闸的并发旁路（#3895）：闸原先是「快照上的
  check-then-act」，并发重试与首叫交叠时双双通过、重复提交外部计费任务。会话锁
  （#3891 同一批）把闸与外部调用收进同一把 per-session 互斥，锁内重读状态后再判，
  并发同参调用只提交一次。
