## Changed

- **B5 子批 16：20 份 / 74 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批横跨 `lib/comfyui/workflow-detail` 生产链、`lib/core`（日志 / 仓储基类 / 行形状），
  以及 `lib/console` 与 10 份对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - workflow-detail：`JSON.parse` 结果统一经 `parseWorkflowDetailJson` / `requireWorkflowDetailJson`
    （`asRecord` + `isWorkflowDetailFull` 形状守卫）读回，坏缓存条目丢弃重建；`positions`
    改 `parsePositionsColumn`（坐标元组判型）；类名 / `kind` 改 `typeof` / 白名单收窄。
  - core：仓储行改 `isRecord` + `isColumn` / `isEntityOf` 谓词（非法行回落 null / 跳过 / 抛
    `AppError`）；`logger` 转发改 `Reflect.apply`、`payload` 逐层判型；`redact-secret` 先
    `isRecord` 再 `Object.entries`；`repository-film` 加 `isUnknownArray`；`repository-task`
    加 `hasLimit` / `isQueryOf`；`repository-task-impl` 按 `typeof` 过滤；`console-catalog`
    解构后判 `undefined` 回落。
  - 用例：fixture 优先用生产同源守卫（`asRawWorkflow` / `requireRawWorkflow`）或标明确类型；
    日志行新增 `firstLine` / `parseLogLine`（空行 / 非对象显式 throw）；仓储用例用
    `$inferInsert` 与 `isRecord` + `typeof` 守卫。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–16：320 份 / 778 处已清）」。

Refs #3181
