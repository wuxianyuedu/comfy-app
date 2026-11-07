## Changed

- **B5 子批 15：20 份 / 107 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批全部落在 `lib/comfyui`：raw 工作流层（raw / raw-overrides / raw-ui-only-nodes /
  raw-cli-client / localWorkflows / workflow-detail-combo）、校验与追踪（validation / trace）、
  生命周期与队列（lifecycle-session-log / reaper / status），以及 9 份对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - raw 层：`JSON.parse` 结果先置 `unknown` 再 `asRecord` / `isRecord` 收窄；`asRawWorkflow`
    改为 `isRawWorkflow`（`isPlainRecord` + `nodes` 为数组）；子图连线 / 引脚按最小视图
    逐字段构造；`widget` 判型改 `isRecord`。
  - 校验与追踪：`node_errors` 逐层 `isRecord` / `asRecord`；新增 `isValidationError` 谓词；
    `trace` 的条目与 `payload` 全部 `isRecord` 收窄，原语走 `typeof` 分支。
  - 生命周期 / 队列 / 回收：`/queue` 与 history 回执逐层判型；会话标记新增
    `isComfySessionMark`（字段 `typeof` + mode 白名单）；`status` 的 `cmds` 逐层收窄。
  - 用例：fixture 工厂补显式类型（`AppSettings` / `DEFAULTS` / `ComfyRuntimeSnapshot`），
    断言改 `isRecord` 谓词、`vi.fn<签名>()`、真实 `Response` / `ChildProcess` 构造。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–15：300 份 / 704 处已清）」。

Refs #3181
