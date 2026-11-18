## Fixed

- 日志落库失败可见化：`replaceLogs` 不再在仓储层内部吞错——拒绝按既有设计传给 `runner-state.persistLogs` 的 `deps.log.warn` 镜像通道（原先那条告警路径因内部吞错而成为死代码）；成片时间线 `appendLog` 落库失败改为留 warn 日志。此前任务日志与成片时间线都会无声缺行，排障现场不完整。（#4271）
