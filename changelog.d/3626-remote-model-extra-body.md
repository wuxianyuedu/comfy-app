## Added

- **远程模型支持「额外请求体字段」透传配置（#3626）**：模型弹窗新增「额外请求体字段
  （JSON · 透传）」折叠块（文本 / 图像 / 视频三种 kind 都显示）—— 按厂商文档原样抄，
  透传进请求 body 且**覆盖**运行时默认组装（用途：`extra_body.response_format` 这类
  OpenAI 兼容扩展）。文本协议（chat-completions / anthropic-messages / responses）与
  图像 / 视频端点全部生效；模型级先落、弹窗 ad-hoc「额外参数」后落（可覆盖同名键）。
  空配置不发送该字段；非法 JSON / 顶层非对象在保存时被拦下（客户端表单 + 服务端
  zod refine 同一判据，`~/lib/llm/extra-body`）。校验失败有人类可读文案。

  落地面：`remoteModel` 新增 `extraBody` 列（raw JSON 对象文本）；`modelSave` /
  `modelView` 透传；usage-test 两条路由共用的请求前言带 `modelExtra`（坏行按未配置）；
  工坊生图 / 生视频链路（`ApiChannelFetchOptions.extraBody`，`bodyOverride`/默认映射
  后盖在请求体最后）与 `upstreamChat` 共用同一「盖在最后」口径。
