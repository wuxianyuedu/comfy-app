## Fixed

- **任务列表把两个大 JSON 列整批拉回又立刻丢弃（`src/lib/core/repository-task.ts`）**：
  `listByUser` 的 `includeImages` 分支（`task.list` 走的就是它）按全列查询 ——
  `workflowSnapshot`（整份工作流 JSON）与 `logs`（全量日志）单行就能到数 MB，
  `take=60` 的列表页是几十 MB 的白拉白反序列化，而 router 只映射十来个卡片字段。
  现在该分支排除这两列，行形状收窄为新的 `TaskCardRow`；详情查询
  （`findByIdWithImages`）不受影响，仍取全列。
