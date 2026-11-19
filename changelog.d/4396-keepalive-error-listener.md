## Fixed

- **keepAlive 拉起补 error 监听，ENOENT 不再假成功**（#4396）：三条 keepAlive
  分支（POSIX 直接 spawn / 壳 CLI 中介 / powershell 中介）返回的 child 都没有
  `error` 监听——目标不存在时 Node 走异步 error 事件、不发 exit：无人监听即
  uncaughtException，且 `waitForDetachMediator` 只能等满 5s 超时、给用户回
  「启动命令已执行」的假成功。现在三条分支都挂监听记日志；
  `waitForDetachMediator` 同时等 error——按「中介失败」（code=-1）收场，原因
  并进 stderr。同族缺口（console-run / executor-cli / lifecycle-launch）此前已补齐。
