## Fixed

- **用量测试链路的裸奔异步收口**（#4217）：`runUsageTest` / `continueUsageWait`
  此前裸 `await fetch`——应用服务重启窗口 / 断网时 reject 冒成 unhandled
  rejection，且 `running` / `querying` 永远为 true、弹窗按钮卡死。现在网络层
  失败落成 `{ ok: false, detail }` 的失败结果并复位进行态。
- `usage-test-client` 的两处 fetch 改走 `fetchWithTimeout`（提交 200s / 查询
  120s——视频用途的服务端预算是分钟级，默认 15s 会误杀真在跑的测试）。
- 复核说明：Agent 聊天的 `void send()` 经 `runAsyncAction`（内部全 try/catch、
  不 rethrow）不会 reject，busy 也会复位——审计对该处的怀疑不成立，未改。
