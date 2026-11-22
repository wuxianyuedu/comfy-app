## Fixed

- **服务端出网裸 fetch 全部收敛到 safeFetch 统一口径（#4724，#3904 的子项）**。
  #4052 确立「服务端出网一律过 `safeFetch`（scheme 白名单 / 内网与元数据拦截 /
  逐跳重定向校验）」后，仍有配置派生 URL 走裸 fetch——本轮把点名的六处连同同族
  共 19 处全部收敛：LLM 模型清单探测、主 LLM 代理、工坊 LLM 补全、API 通道
  （生图 / 视频提交 / 两路轮询）、视频任务媒体落盘、工坊 ComfyUI 通道六处、
  Ollama 起停探测、reaper 对账探测。场景按「调用方为什么连」取 `llm-upstream`
  （用户配置的服务端点，允许回环/私网）或 `remote-media`（上游返回的媒体地址，
  只放行公网）。新增门禁 `check-server-bare-fetch.cjs`（硬闸）：src/server、
  src/app/api 与声明服务端身份的 src/lib 模块内出现绕过 safeFetch 的裸 `fetch(`
  即阻断，防「复用即踩雷」的潜伏点。
