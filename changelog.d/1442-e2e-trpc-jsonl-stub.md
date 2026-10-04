## Fixed

- **e2e 桩不进 tRPC 的根因找到了：协议是 JSON Lines，不是 JSON 数组**（ISSUE #1442）。
  客户端是 `httpBatchStreamLink`（`src/trpc/link.ts`），它发 `trpc-accept: application/jsonl`
  协商，服务端 `jsonlStreamProducer` 回的是**逐行 JSON**（`content-type: application/json`
  - `transfer-encoding: chunked`）：第一行是 head（按 `batchIndex` 索引的对象），其后每行是
    `[chunkId, status, data]` 的 async chunk 定义。`[{result:{data:…}}]` 那个数组是**另一条
    协议**（非流式）的形态，喂进去会被整段当成 head，`decodeChunkDefinition` 形状对不上 →
    `type` 落空 → 槽位静默变 `undefined`，**全程不抛错**。这就是「四种信封形状行为完全一致、
    坏 JSON 也一样、控制台零报错、`loggerLink` 照样打 `<< query`」的全部原因。

## Added

- **`e2e/support/trpc-stub.ts`：能真喂进去的 tRPC 桩**（`stubTrpc()`）。按上面的协议产出
  响应，payload 就是过程的返回值（`Date` / `Map` 这类由 superjson 的 `meta` 带上，客户端
  原样还原，不必手工写路径）。接到 `e2e/queue-monitor.spec.ts`。
- **`tests/e2e-trpc-stub.test.ts`：把协议形态钉成机器判据**。判据不是复刻一份实现，而是
  **拿 `@trpc/server` 的真 `jsonlStreamConsumer` 读一遍**（含 `superjson.deserialize` 那一层、
  `Date` 是否还原、多槽是否各归各位）—— tRPC 升级换协议会在那里变红，而不是等某条 e2e
  变成「数据没进去」的假绿。
- **`e2e/queue-monitor.spec.ts` 补上「位次方向」@critical 用例** —— ISSUE #1442 点名的那条
  「最像『只有看屏幕才发现』的错误」：后端按 `createdAt` 倒序回、执行器 FIFO，视图必须反一次
  让最早提交的显示「第 1 位」。真库凑不出这个形状，此前只有 jsdom 两份用例判着。

## Changed

- **`e2e/critical-flows.spec.ts` 的 `stubBackend` 注释改成它实际做的事**：它**不喂数据**
  （fulfill 的是 JSON 数组，到不了上层），作用只是把请求很快答掉、别卡住界面。原文案
  「stub 掉与 ComfyUI / DB 相关的 tRPC 调用」读起来像在喂数据，ISSUE #1442 记的正是
  「下一个人会以为可以用它断数据，然后花半天猜信封」。
- **规范 §11.3.1 补「tRPC 桩：协议是 JSON Lines，不是 JSON 数组」一节**：协议形状、三个
  连带事实（每行都要 `{"json": …}` 信封 / `meta` 要作用在整行上 / 一个 URL 只有一个处理器）、
  以及「要喂数据用 `stubTrpc()`」的入口。
