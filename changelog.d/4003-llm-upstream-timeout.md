## Fixed

- **LLM 上游调用补上等待预算与取消传播（#4003）**：`src/lib/llm/server.ts` 的
  `upstreamChat` 此前裸 `fetch`，上游（本地 Ollama / 远端 API）挂起时整条调用链永久等待——
  agent run 循环的当前步永不落定（用户的暂停 / 取消只在步间生效，步内挂起就失效）、
  `film.create` 等 tRPC 请求与 `/api/llm` 的 SSE 流全部挂着。现在非流式 180s、流式 600s
  墙钟预算到点中止（与工坊侧 `workshop/llm.ts` 的 180s 同量级），`/api/llm` 把
  `req.signal` 传进上游（客户端断开连上游一起停），浏览器侧 `completeChat` / `chatAgent`
  补 signal。可终止性审计 #3889 的 P1 项。
