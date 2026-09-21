## Changed

- **按 §12.18 把两处「异步动作反馈样板」收口到 `runAsyncAction`（规范 16 §16.2.4.30 / P27 的家）**：
  - `use-encapsulation-test-run` 的「流程测试」运行：`置忙 → 提交 → watch → catch setError → finally 清忙` 改为 `runAsyncAction(runLoop, { report, failureText:"流程测试失败", readResultEnvelope:false })`。外层只兜「提交阶段抛错」→ `setError`；运行终态仍由 `watchWorkflowRun` 的 `onSettled` 落 `setError`（故 `readResultEnvelope:false`、成功静默），忙标记收尾在 `await` 之后。
  - `use-workshop-agent` 的 `send`：agent 循环包成局部 `runLoop`，交给 `runAsyncAction`；抛错经 `report` 落 `setError` + 追加一条「抱歉，出错了：<detail>」assistant 消息。循环体缩进零改动（只换 try 开 / catch-finally 闭）。
  - **刻意未迁**：`use-workshop-agent` 的 `executeOneTool`（工具执行器）——它要拿 `result.summary/ok/detail` 拼回给模型的 wire 消息、且成功/失败产出不同形状，`runAsyncAction` 的 `{ok,detail}` 返回会丢 `summary` 改行为，不是它的落点，保持原 `instanceof` 写法（P27 本就不拦该形状）。
  - tsc + eslint + P27/P32 + `use-encapsulation-test-run.test.ts` 全过。
