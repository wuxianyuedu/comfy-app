## Fixed

- **工坊把本机 ollama 模型（如 qwen3:14b）标成「远端 API」**：全局 LLM 配置的 provider 存成 remote、baseUrl 指向本机回环时，工坊的下拉分组/徽标/页脚按存储字符串展示，主模型被兜底归入「远端」组，可用性探测也走远端通道。现在工坊侧按「生效提供方」统一判定——回环地址 + 无密钥一律按本地（与 describeFetchFailure / foldRemoteToLocal 同口径），本机 ollama 正确出现在「本地模型」组；带密钥的本机网关（转发远端计费模型）尊重原配置，不误判。
