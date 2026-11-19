## Fixed

- LLM 配置读取失败不再静默：`getLLMConfig` / `getWorkshopLLMConfig` 的 catch 里补
  warn 读数（「本次请求按 env 默认配置执行」+ 错误原因）。此前吞掉 DB 故障——
  用户在设置页配好的远程模型/密钥无声失效，报的是「尚未配置生效模型」这类与
  真实原因完全无关的错误，日志里找不到任何 DB 故障读数。回落语义保留。
  （#4419）
