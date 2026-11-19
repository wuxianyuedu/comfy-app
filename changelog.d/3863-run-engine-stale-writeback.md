## Fixed

- run 引擎（`advanceRunLoopOnce`）回写 `production.run` 前重读库中状态：用户在动作执行期间 pause/cancel 不再被拍首旧快照复活（#3863，审计源 #3848）。paused 时仅吸收 stage 与执行日志、保持 paused，resume 后不重做已完成动作。
