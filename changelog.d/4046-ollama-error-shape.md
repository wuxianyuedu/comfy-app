## Fixed

- **ollama-start/stop 错误体统一、stop 文案透出（#4046）**：两个兄弟端点的
  失败体此前两种形状（start `{error}`、stop `{ok:false, detail}`），且
  `stopOllama` 客户端完全不读响应体——服务端精心区分的「未在运行」「进程
  仍在响应，请手动确认」等可行动文案被整条换成一句固定话术。现在失败体统一
  `{error}`（与 start 同形状），`stopOllama` 补 `readJsonBody + readApiError`
  透出服务端文案。接口契约与兼容审计 #3907 的 P3 项。
