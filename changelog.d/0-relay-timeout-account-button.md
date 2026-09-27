## Fixed

- **API 中继请求统一 10 分钟超时**（`generation-client.postRelay`）：`apiGenerateImage`
  / `apiSubmitVideo` / `apiPollVideo` 此前裸 fetch，真挂死的连接让 UI 无限 busy。
  到点 abort 并翻译成可行动的中文报错（不再让英文 DOMException 原样进错误条）。
- **顶栏「账户」死按钮移除**（`WorkshopHeader.tsx`）：无 onClick 的可点击元素
  =「点了没反应」；待有明确的账户界面再恢复。
