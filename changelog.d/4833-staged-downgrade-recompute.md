## Changed

- 合并前复算（`check:premerge` 的 base 段）把「UI 基元复用棘轮 / 浮层层级刻度硬闸」这类带 `--staged` 的毫秒级硬闸收进复算面（#4833）：新增 `base-check/hook-steps.mjs` 的 `STAGED_TO_FULL_TREE` 登记表，登记在案的步骤收批时剥旗标、在分支 ⊕ 目标的合成树上判全仓——与平台「重档静态判据」格对它们做的（`fullTreeArgv()`，现委托同一份 `stripStagedFlag`）逐字同语义。此前这两条在本地复算面上没有任何执行者，红只能等 GA 才暴露（#4831 首轮实测一次完整 CI 往返）。入表条件：无基线、无 `--update` 的硬闸且全量扫描毫秒到秒级；`CHANGED_SCOPED` 那族不收。
