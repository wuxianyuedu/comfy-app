## Fixed

- **错误码与响应口径小批次收口（#4048）**：run 路由「生产数据行不存在」的两种
  码统一走 `missingProductionError()`；`assertSeriesOwner` 拆成「不存在 →
  NOT_FOUND、不归你 → FORBIDDEN」（与 season/episode/character 同边界），
  series-generation 自带的分叉副本改用共享版；`task.openFolder` 成功载荷的
  `error` 键（全库约定的失败文案键）+ 英文短码改为业务字段 `reason` + 中文；
  `/api/agent/chat` 的 400 收口结构化信封（同路由三种错误形状 → 一种）；
  workshop draft 的 DELETE 幂等应答带 `alreadyGone`（与 materials 对齐）。
  接口契约与兼容审计 #3907 的 P3 项。
