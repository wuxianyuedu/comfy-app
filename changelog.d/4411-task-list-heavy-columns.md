## Fixed

- 任务列表 / 项目产物页不再整批拉回 MB 级重列。#4044 的列裁剪清单只排除了
  `workflowSnapshot` 与 `logs`，之后进 schema 的 `execPayload`（提交时刻 RAW 原件）
  与 `rawCli`（comfy-cli 完整原文）没跟着更新 —— take=60 的列表页每次请求把几十 MB
  拉回内存、同步反序列化后再全部丢弃（node:sqlite 同步驱动，直接压在事件循环上），
  页越老、任务越多越卡。现在 `listByUser` 两个分页口径与
  `findByProjectIdWithImages`（顺带把 take 下推到 SQL）统一裁掉四个重列；详情路径
  仍取全列不受影响。（#4411）
