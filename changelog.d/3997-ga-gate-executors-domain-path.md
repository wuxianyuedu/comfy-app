## Fixed

- 镜像仓 GA 的「受影响用例」档里 `tests/gate-executors.test.ts` 整份红：判据已迁入
  `scripts/gates/`（#3930），而该用例仍按平铺路径 `scripts/check-gate-executors.cjs`
  定位判据本体、拷贝夹具与读源码自检，Linux 执行者上全部 ENOENT。用例改为与判据自身
  扫描面同口径：按域相对路径定位（`gates/check-gate-executors.cjs`），`copyGateScripts`
  与扫描面对账均递归枚举 `scripts/**`（#3997）。
- 同族：`tests/tw4-hardgate-behaviour.test.ts` 也按平铺名给夹具传 `tw4-*` 判据，
  改为域相对路径 `tw4/tw4-*.mjs`（#3997）。

