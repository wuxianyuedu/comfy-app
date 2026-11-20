## Fixed

- comfy-cli 子进程清理绕开整树回收（#4603）：看门狗超时（executor-cli）、用户取消
  （enqueue）、宿主侧取消对账（executor-host）三处用裸 `kill("SIGKILL")` 单杀
  leader——违反硬规则 3「进程清理必须杀整棵树」；comfy-cli 一旦带出子进程
  （版本升级 / 环境注入），超时与取消会留下持锁、占端口的孤儿。三处统一改走
  `killProcessTree`（TS 侧直引；executor-host 的骨架形态保持「不 import 任何 TS」，
  用动态 import 在 host 注入链里取）。判据：enqueue.test 的句柄夹具与断言迁到
  `pid` + `killProcessTree` 调用形状。
