## Changed

- **远端模型的 Base URL 约定改为「不带 /v1」，版本段由应用统一拼（#3656）**：
  设置 → 远端模型的 Base URL 现在填到域名或路径前缀为止（如
  `https://apihub.agnes-ai.com`），不再要求自带 `/v1`；拼接唯一出处是新函数
  `joinApiUrl()`（`src/lib/llm/provider-types.ts`）——Base 已带版本段（历史行、
  本地 Ollama 默认地址 `…:11434/v1`）不重复补，动作路径自带版本段（Anthropic
  `/v1/messages`）时 Base 的版本段让位，其余补 `/v1`。三处消费方同一口径：
  文本模型的最终请求地址（`/v1/chat/completions`、`/v1/responses`、
  `/v1/messages`）、「测试连接」固定探 `{版本段}/models`（Base 不带版本段时探
  `/v1/models`；Base 末段是资源段时先归一再探）、「实际使用」测试弹窗与工坊
  生图 / 生视频的远端定向（图像 `/v1/images/generations`、视频 `/v1/videos`）。
  已填 `…/v1` 的历史配置与本地 Ollama 行为不变。

## Added

- **图像 / 视频模型的「接口端点」改为下拉（#3656）**：「添加 / 编辑模型」弹窗
  里该字段从只读展示换成按用途给词表的下拉（图像 `/v1/images/generations`、
  视频 `/v1/videos`，词表 `REMOTE_MEDIA_ENDPOINT_OPTIONS`），选择落库在
  `remoteModel` 新列 `endpointPath`（drizzle 迁移 `0003`；写侧按行用途白名单
  收窄），**没选 = 用途默认第一项**；选项与提示念按 Base URL 拼出的最终请求
  地址；工坊运行时同一口径（显式配置优先，缺省按用途默认）。模型行摘要念
  生效的那条端点路径。
