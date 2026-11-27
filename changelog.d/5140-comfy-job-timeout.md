## Fixed

- 慢模型不再被等候方误杀（#5140）：单任务执行超时收成唯一常量 `COMFY_JOB_TIMEOUT_MS`
  （10min），comfy-cli `--timeout`、WS 执行器超时与首帧等候包络（11min = 330 拍 × 2s）
  全部同源；看门狗比执行超时宽 15min。补「等候包络 ≥ 执行超时」不变量用例。
