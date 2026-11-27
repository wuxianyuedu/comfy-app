## Fixed

- LLM 配置不可用的三类失败给出可行动文案（#5145）：新增 `lib/llm/config-health.ts` 纯函数出口，
  统一「没配生效模型 / 密钥失效或无权限（指到设置 → 远程模型）/ 本地模型服务未启动（指到
  Ollama 与 Base URL）」；主链 `upstreamChat` 与工坊链 `completeWorkshopLLM` 共用同一份文案，
  修掉两处逐字重复与措辞分叉。空模型在发请求前判掉。同批补纯函数与两条调用链用例。
