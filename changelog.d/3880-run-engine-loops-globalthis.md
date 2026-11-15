## Fixed

- run 引擎的 per-project 在飞互斥表挂 `globalThis`（#3880，审计源 #3848）：dev HMR 重估模块后不再丢失在飞循环、对同一项目重复起推进循环（与 film 侧 `filmWatchInFlight_v1` 同口径）。
