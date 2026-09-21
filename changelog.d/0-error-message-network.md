## Changed

- **按 §12.18 收口 #1 网络路径 3 处到 `errorMessage`（连带更新断言原文的测试）**：`llm/browser`（探测 detail）、`llm/model-catalog-client`（探测 detail）、`comfy/comfy-readiness-client`（探测 message）此前用 `e instanceof Error ? e.message : "…"` 回**原始**网络消息（如 `"Failed to fetch"` / `"The operation was aborted"`），接线到 `errorMessage(e, "…")` 后统一翻成人话（「网络请求失败，请检查应用服务是否正在运行」/「请求超时或被中断，请稍候重试」）——这正是 `errorMessage` 相对裸 `instanceof` 的价值（§12.15「接线」）。
  - 同步更新两处断言旧原文的测试：`browser.test.ts`（`"Failed to fetch"` → 翻译后文案）、`clients.test.ts`（`fetchLocalModels` 的 abort 用例：测试名与断言从「原始错误消息」改为「翻译成人话」）。
  - `comfy/ensure` 的 `detail` 与 `use-workshop-agent` 的工具执行器**保持不动**：前者 `detail` 是合法业务字段（客户端按它判「还在启动」，翻译会改判据），后者要拿 `result.summary/ok/detail` 拼回给模型的 wire 消息，都不是 `errorMessage`/`runAsyncAction` 的落点。
  - tsc + eslint + 相关测试 93 例全过。
