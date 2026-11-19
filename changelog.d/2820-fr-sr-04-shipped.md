## Changed

- 产品文档对齐 FR-SR-04 的落地现状（#2820）：功能已由 #2836 上线
  （`seriesGeneration.batchGenerateSeason` / `seasonGenerationProgress` 两个
  procedure + `SeriesOrganizer`「整季生成」入口），并经 #4009 / #4043 / #4088
  演进——feature-catalog 状态「计划中」→「已上线」，feature-specs 补已上线的
  行为与验收（按 `(projectId, shotId)` 任务存在性幂等、
  `createQueuedForShotIfNoActive` 原子防重、按集五档进度、归属断言、前端入口
  与「单项目批量循环保留不动」的边界）与真实落点清单。纯文档改动。
