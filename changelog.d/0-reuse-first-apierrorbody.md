## Changed

- **按 §12.18 接线 #1（apiErrorBody 信封子批）**：5 个 logs API route（current / export / history / list / sessions）把 `NextResponse.json({ …业务字段, error: error instanceof Error ? error.message : String(error) })` 收口到 `~/lib/api-error` 的 `apiErrorBody(error, "<动作>失败", { …业务字段 })`——**形状保持**（`error` 仍是字符串、业务字段原样在前），客户端读 `.error` 不变。P32「手拼错误信封」正是为这类落点设的家；此前它们靠 `instanceof` 三元躲过了门禁。tsc + eslint + logs route 测试 24 例全过（含 sessions 断言 "unknown source" 透传）。
