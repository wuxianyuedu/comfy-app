## Fixed

- 镜像仓 GA 的「受影响用例」档里 `tests/gate-executors.test.ts` 整份红：判据已迁入
  `scripts/gates/`（#3930），而该用例仍按平铺路径 `scripts/check-gate-executors.cjs`
  定位判据本体、拷贝夹具与读源码自检，Linux 执行者上全部 ENOENT。用例改为与判据自身
  扫描面同口径：按域相对路径定位（`gates/check-gate-executors.cjs`），`copyGateScripts`
  与扫描面对账均递归枚举 `scripts/**`（#3997）。
- 同族：`tests/tw4-hardgate-behaviour.test.ts` 也按平铺名给夹具传 `tw4-*` 判据，
  改为域相对路径 `tw4/tw4-*.mjs`（#3997）。
- 同族：`tests/on-demand-duties-gate.test.ts` 的台账类事实被误改成域路径
  `tw4/tw4-canonical-report.mjs`，而判据按 **basename** 对键（`onDemand.includes`）⇒
  双向各红一条；改回裸名 `tw4-canonical-report.mjs`（#3997）。
- 同族：`tests/pending-merge-loss-gate.test.ts` 按平铺名给夹具传判据、按旧同级说明符
  断言「共用内核」；改为域相对路径 `gates/…` + `../base-check/…`，⑦ 的裸目录也按
  `gates/` + `base-check/` 相对布局摆（#3997）。
- 顺手清掉一处分隔符假定：`check-allow-builds.cjs` 的「内容不可信」清单按平台分隔符
  出口，Windows 上与 POSIX 断言对不上；统一成 `a/b/c` 形状（#3997）。



