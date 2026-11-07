## Changed

- **B5 子批 17：20 份 / 74 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批横跨 `lib` 顶层 DOM/表单工具、文件与媒体用例，以及 `lib/llm` 的客户端 / 服务端 / 提示词链。
  修法仍是「运行时校验 + 类型守卫」：
  - `dom-props` / `form-props`：泛型 props 拆分保留原有精确 `Pick/Omit` 签名；`own`/`rest`
    改由 `Reflect` 操作 `Record` 视图，配合本地断言函数（`assertOwnProps` / `assertStringValue` /
    `assertOwnKey`，运行时逐值判型后 throw）收窄；`commonOwnProps` 用本地谓词 `filter` 收窄为 `A & B`。
  - `dom-rect` / `list-filter` / `is-record`：`typeof` / `Array.isArray` / 复用 `isRecord` 收窄。
  - `llm/server`：provider / `remoteModelKind` / 温度表改运行期白名单谓词；响应体接 `unknown` +
    `asRecord` 逐层读 `choices[0].message.content` / `delta.content` / `tool_calls`（空串 / 空数组
    回落不变）；`cause` 改 `Reflect.get`。
  - `llm/prompts`：`extractJson` 结果改 `asRecord(...) ?? {}`；`characterNames` 先 `Array.isArray`
    再逐元素 `String`。`llm/browser` / `model-catalog-client` / `ollama-client` / `remote-model-schema`
    同口径（`isRecord`、`isOllamaModel`、`isRemoteModelFieldKey` + `Object.hasOwn`）。
  - `llm/types`：`isLoopbackBaseUrl` 形参放宽为 `unknown`（非字符串输入回落空串，删掉一处
    `no-unnecessary-condition` 逐行禁用）；`resolveTaskTemperature.overrides` 放宽为
    `Partial<Record<TaskType, number>>`（实现本就按「有键且非空才算覆盖」裁决）。
  - 用例：`Response` / `File` / `FileReader` / `ReadableStream` / 子进程一律用真实对象或
    `Object.defineProperty` 构造，替身不再靠断言；数组下标取元素后判 `undefined` 再收窄。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–17：340 份 / 852 处已清）」。

Refs #3181
