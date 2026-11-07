## Changed

- **B5 子批 18：20 份 / 51 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行；
  另在 `media/size-preset-store.ts` 顺带清掉 2 处未挂账的同型断言，净 53 处）。
  本批覆盖 `lib/llm` 用量测试链、`lib/log`（切片 / 会话 / 导出 / 转录）、
  `lib/media`（尺寸预设 / 素材 / 任务图 / data-url）、`lib/process`（pnpm 解析 /
  进程树 / 启动 / python）与 `page-window`、`production/payload` 及其用例。
  修法仍是「运行时校验 + 类型守卫」：
  - `lib/llm`：响应体改 `unknown` + `asRecord`；模型种类改本地 `isRemoteModelKind` 白名单；
    用例替身换真实 `Response` / `Request`，取值断言改 `toMatchObject`。
  - `lib/log`：`log-file-client` 新增 `isFileLogSlice` / `isLogSessionsPayload` /
    `isSavedLogExport` 形状守卫；`capture-streams` 转发改 `Reflect.apply`；
    `log-cli-json` 的 tag 改字面量联合判定。
  - `lib/media`：`isRecord` 直接读字段；尺寸预设行改显式完整对象（不再 `{} as`）；
    `data-url` 经 `Reflect.get(globalThis, "Buffer")` + 构造器守卫取 Buffer。
  - `lib/process`：`JSON.parse` 结果声明 `unknown` 后逐层 `typeof` / `Reflect.get`；
    进程树 / 启动 / python 用例改本地 `asserts value is T` 断言函数（运行期校验）；
    `page-window` 用 `Array.isArray` 断言函数，仍返回同一数组引用。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 跳过 / 抛错行为
  （`log-file-client` 对形状不符的 200 响应按解析失败抛出 / 回落，与既有「网络层异常不咽成 null」一致）。
- 台账：B5 行改「清账中（子批1–18：360 份 / 903 处已清）」。

Refs #3181
