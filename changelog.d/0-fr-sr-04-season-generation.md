## Added

- FR-SR-04 整季生成（剧集级排期与批量 / 断点续跑）：新增 `seriesGeneration` 子路由，落地两个 procedure —— `seasonGenerationProgress`（按集聚合 总/完成/失败/进行中/待生成，可读到「第几集第几镜」粒度）与 `batchGenerateSeason`（整季一次提交，服务端遍历每集 project → production.shots，按 `(projectId, shotId)` 的 task 存在性幂等去重：已有 SUCCEEDED/QUEUED/RUNNING 的镜不重排，只入队失败/未生成的镜；缺工作流返回 NOT_FOUND，他人季返回 FORBIDDEN）。拆到独立子路由是为把 `series` 路由控制在 900 行硬闸内（规范 §12.6 R5）。配套消费方：系列角色库面板的「整季生成」面板（选择工作流 + 一键提交 + 每集进度读数），挂在 `use-series-organizer` 的 `seriesGeneration.*` 调用上。
