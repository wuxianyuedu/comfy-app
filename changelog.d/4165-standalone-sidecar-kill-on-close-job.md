## Fixed

- **standalone（分发）形态下壳被硬杀时，内嵌 server（sidecar）整棵进程树无人兜底成孤儿**：
  此前 `KILL_ON_JOB_CLOSE` Job Object 只挂在编排器那棵树上，sidecar 既没有 job、壳死时也
  跑不了 `reap-process.mjs` 补刀，且 standalone 不写会话锚点、下一次启动的孤儿回收对它
  没有认亲方式——孤儿 node / next-server 继续占端口与日志句柄。现在 `spawn_sidecar` 起完
  就给 sidecar 挂上壳自持的 `KILL_ON_JOB_CLOSE` job（与编排器同构，`BREAKAWAY_OK` 保住
  保活服务的逃逸语义），壳一死 OS 关句柄，整棵树当场回收；规范 §7.6 的表述与实现对齐
  （#4165）。
