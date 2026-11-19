## Changed

- **B5 子批 9：20 份 / 46 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批是工作流库 / 编辑器 / 表单族：`workflow-library/**`、`workflow-editor/**`、
  `workflow-form/**` 与 `workflow-io`。修法仍是「运行时校验 + 类型守卫」：
  - 流式事件：`JSON.parse` / `res.json()` 先落 `unknown`，`isSettingsStreamEvent` /
    `isParseStreamEvent` / `isSettingsResp` 按消费方读取的字段逐项校验，畸形行沿用
    「跳过 / 抛错」既有分支。
  - 子图与原始节点：`isRawSubgraphDef` / `isRawNodesArray` / `subgraphsOf` 逐层
    `isPlainRecord` 收窄；`workflow-io` 的 IO 字段经 `readIoKey` 读取。
  - 画布节点 / 事件目标：`node.data` 用 `isPlainRecord`，`event.target` 用
    `instanceof HTMLElement`；`StyleSwitcher` 新增 `isGroupStyle` 白名单谓词。
  - 测试侧：mock 改 `vi.fn<签名>()` / `vi.mocked`；缺动作的 store 用
    `Reflect.deleteProperty` 构造；拖拽事件替身经本地 `isDragEvent` 运行时校验，
    不再用整块形状断言；`dragHandlers` 空值改早抛代替 `!`。
- 顺带修掉一处新引入的 `unicorn/switch-case-braces` 回潮：两个流事件谓词的
  `switch` 改为等价的 `if` 链（行为逐分支一致）。
- 语义未变：合法输入结果一致；对畸形载荷才按运行时校验回落。
- 台账：B5 行改「清账中（子批1–9：180 份 / 381 处已清）」。

Refs #3181
