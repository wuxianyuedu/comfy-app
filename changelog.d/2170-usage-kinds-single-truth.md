## Changed

远端模型「用途词表」三份独立真相**并成一份**（ISSUE #2170，业主拍板）：
`usage-test.server.ts` 的 `USAGE_TEST_KINDS` / `UsageTestKind`、`usage-test-client.ts`
的内联类型、`usage-field-editor.ts` 的状态字段，全部改为从权威词表
`~/lib/llm/types` 的 `REMOTE_MODEL_KINDS` / `RemoteModelKind` 派生 —— 值与类型
只剩一处定义。

并成一份的自动护栏：各处按 `Record<UsageTestKind,…>` 建的模板/标签/默认参数表
在 tsc 下必须穷尽 —— 往词表加一种用途（如 `audio`）而不同批补端点测试模板，
类型检查当场红，而不是运行时悄悄少一档（这正是该口径的既定代价，业主接受）。
判据同步：`usage-test.server.test.ts` 的旧断言 `toEqual(["chat","image","video"])`
是一份逐字复制值的判据，改为 `toBe(REMOTE_MODEL_KINDS)`（同一引用）+ 权威词表
自身的期望值 —— 两条合起来才是「并成一份」的机器读数。
