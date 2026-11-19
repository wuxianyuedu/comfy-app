## Fixed

- **坏请求口径统一（#4045）**：畸形 multipart 表单此前在 `film/bgm` 是
  400 JSON、在 `materials` 落 catch 变 500 JSON、在 `upload` 是 try 外未捕获
  的 500 非 JSON 体——同一类客户端错误三种结局，状态码语义也错（客户端错误
  被记成服务端 500）。三处统一：parse 失败 → 400 + 可读文案。`/api/llm/test`
  的 `req.json().catch(() => ({}))` 把坏 JSON 伪装成「配置为空」返回 200——
  改走 `readJsonRecord`（坏 JSON → 400 请求格式错误）。接口契约与兼容审计
  #3907 的 P3 项。
