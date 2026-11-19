## Fixed

- **LLM 流式解析的 SSE 行缓冲补上限**（#4340）：`streamLLM` 把「最后一段不完整
  行」留在缓冲里等下一块，上游是任意 OpenAI 兼容端点——baseUrl 配错（指到网页
  端点）、返回 HTML / 二进制、或不守协议地发超长无换行帧时，缓冲唯一的刹车是
  600s 流超时，可冲高到数百 MB。现在不完整行超过 `MAX_SSE_LINE_BUFFER_CHARS`
  （1MB）即中止并报「上游输出不是 SSE 流：请检查 baseUrl 是否指向 OpenAI 兼容
  端点」，错误经既有出口到达界面；finally 的 `reader.cancel` 停掉上游连接。
