## Changed

- oxlint `typescript/array-type` 再清一处漂移（#2775）：`tests/in-process-event-channel-retired.test.ts`
  的 `execChainFiles()` 返回注解 `string[]` → `Array<string>`（预设选项 `{ default: "generic" }`）。
  纯类型注解改写，不涉及任何断言与运行期取值。
