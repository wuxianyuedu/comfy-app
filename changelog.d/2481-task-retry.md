## Added

- **任务级「原样重跑」（#2481 · FR-QA-04③ 历史面落点）**：
  - 后端 `task.retry`：按**原任务行**重建一个 QUEUED 任务（新 taskId，不复活旧行）——
    执行载荷用原行 `execPayload`（提交时刻 RAW 原件），语义是「复现当时那次提交」，
    模板改删不影响；提示词 / 参数 / 归属（project / shot）/ 参考图逐字复制，
    `claimedBy` 按当前灰度开关取值并 `kickQueue()` 提速派发。
  - 门控两条（都可行动）：非终态（QUEUED / RUNNING）拒绝——任务本来就在跑；
    `execPayload` 为空的历史遗留行拒绝并指路到创作台重新生成。
  - 参考图语义如实写进实现：`referenceImages` 是 ComfyUI input 侧的持久文件名，
    原样复用；ComfyUI 侧文件被清理时任务在 LoadImage 节点失败并进任务日志
    （失败可见，不是静默缺图；原始本地文件只在客户端，服务端无可重传的源）。
  - 前端：历史页「重试」从**复制参数到剪贴板**（原 REST 从未实现，一直 404 的
    假重试）改为直调 `task.retry`，成功反馈带新任务号；`useCopyResult` /
    `copyFailureText` 在该 hook 的死用法随之摘除。
  - 测试：`task.retry` 四条（字段原样复制 + 新 id + 原行不动 / 越权 NOT_FOUND /
    非终态拒绝 / 空 execPayload 拒绝），`SeedTaskInput` 补 `execPayload`。
- 需求文档同批：specs FR-QA-04③ 与 pipeline-stages 阶段④的重试指针翻已落地。
