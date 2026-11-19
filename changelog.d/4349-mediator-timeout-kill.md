## Fixed

- **keepAlive 中介超时即回收**（#4349）：`waitForDetachMediator` 超时后原先只补
  返回值、不回收 PowerShell 中介进程——中介卡住时每次失败拉起都在进程表里漏一个。
  现在 `DetachMediatorHandle` 增加可选 `kill`，超时那一刻执行回收（与 runFFmpeg
  的超时杀进程同一取向）；中介已自行退出时 kill 是无害空操作。
