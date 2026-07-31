# LLM 文本生成接入指南

Comfy-APP 的「创作工坊」支持接入 **本地 LLM** 与 **远端 API** 做文本生成（剧本扩写、角色生成/润色、分镜智能切分）。本文档说明配置方式、架构与扩展点。

---

## 1. 支持的提供方

两类提供方都使用 **OpenAI Chat Completions 协议**（`POST {baseUrl}/chat/completions`），因此代码对两者零差异：

| 提供方 | 典型地址 | 是否需要 Key | 备注 |
|--------|----------|--------------|------|
| **本地（local）** | `http://localhost:11434/v1`（Ollama）/ `http://localhost:1234/v1`（LM Studio） | 否 | 完全免费、数据不出本机 |
| **远端（remote）** | `https://api.openai.com/v1` / DeepSeek / 通义 / 任何 OpenAI 兼容网关 | 是 | 经 `/api/llm` 代理，Key 不落浏览器 |

### 本地 Ollama 快速起步
```bash
# 安装后拉取一个模型
ollama pull llama3.1
ollama serve        # 默认监听 11434

# 在工坊 → 右上角「⚙️ LLM 设置」→ 提供方=本地，Base URL 保持默认，模型填 llama3.1
```

### 远端 API 示例
- OpenAI：`baseUrl=https://api.openai.com/v1`，`model=gpt-4o-mini`，填 `API Key`。
- DeepSeek：`baseUrl=https://api.deepseek.com/v1`，`model=deepseek-chat`。
- 通义千问：`baseUrl=https://dashscope.aliyuncs.com/compatible-mode/v1`，`model=qwen-plus`。

> 在设置弹窗点「测试连接」可用一个最小请求验证连通性。

---

## 2. 配置来源与优先级

有效配置由三层叠加而成（后者覆盖前者）：

1. **环境变量 `.env`**（默认值，见下）
2. **数据库单例 `LlmConfig`（id="singleton"）** —— 工坊设置 UI 保存的用户配置
3. **单次请求参数**（极少用；浏览器永不上传 `apiKey`）

```dotenv
# .env
LLM_PROVIDER=local
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1
LLM_API_KEY=
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2048
```

`apiKey` 仅在「远端」提供方需要，且**只写入服务端**（`.env` 或数据库），浏览器通过 `GET /api/llm/config` 拿到的 `hasApiKey` 仅为布尔脱敏值。

---

## 3. 架构与数据流

```
浏览器 (工坊工具)
   │  streamChat(messages)  ── POST /api/llm (stream:true)
   ▼
/api/llm/route.ts
   │  getLLMConfig() 合并 env + db（注入 apiKey）
   │  streamLLM() → fetch {baseUrl}/chat/completions
   ▼  SSE: data: {token}  …  data: [DONE]
浏览器逐 token 渲染 → 解析 JSON → 写入 Scene/Character/Shot
```

- **服务端隐藏密钥**：`src/lib/llm/server.ts` 在服务器侧拼装鉴权头（远端 `Authorization: Bearer <key>`），浏览器无感知。
- **流式**：使用 `ReadableStream` 输出 SSE；`src/lib/llm/browser.ts` 的 `streamChat` 解析 `data: {token}` 分片并回调 `onToken`。
- **解析鲁棒**：`src/lib/llm/parse.ts` 的 `extractJson` 会自动剥离 ```json 代码围栏和前后散文，定位首个 `[`/`{` 到末位 `]`/`}`。

---

## 4. API 契约

### `POST /api/llm`
请求体：
```jsonc
{
  "messages": [{ "role": "system"|"user"|"assistant", "content": "..." }],
  "stream": true,            // true=SSE 流式 / false=JSON {content}
  "provider"?: "local"|"remote",
  "model"?: "llama3.1",
  "temperature"?: 0.7,
  "maxTokens"?: 2048
}
```
- 流式响应：`text/event-stream`，每行 `data: {"token":"..."}`，结束为 `data: [DONE]`；错误为 `data: {"error":"..."}`。
- 非流式响应：`{ "content": "..." }`。
- 错误：参数错误 `400`；上游失败 `502`。

### `GET /api/llm/config`
返回脱敏配置：
```jsonc
{ "config": { "provider":"local", "baseUrl":"http://localhost:11434/v1",
              "model":"llama3.1", "temperature":0.7, "maxTokens":2048, "hasApiKey":false } }
```

### `POST /api/llm/config`
保存配置（upsert 单例），`apiKey` 字段为空字符串时清除。返回同 GET 的脱敏结构。

---

## 5. 各工具的 LLM 提示词

提示词与 JSON 解析集中在 `src/lib/llm/prompts.ts`：

| 工具 | 系统提示词常量 | 输入 | 输出结构 | 解析函数 |
|------|----------------|------|----------|----------|
| 剧本 | `SCRIPT_SYSTEM` | 项目信息 + 灵感 | `Array<{heading,location,time,action,dialogue,shotCount}>` | `parseScriptScenes` |
| 角色（一句话） | `CHARACTER_FROM_BRIEF_SYSTEM` | 一句设定 | `{name,appearance,costume,personality}` | `parseCharacterFull` |
| 角色（润色） | `CHARACTER_SYSTEM` | 现有字段 + Skill 风格 | `{appearance,costume,personality}` | `parseCharacter` |
| 分镜 | `STORYBOARD_SYSTEM` | 场景 + 角色名单 + 风格 | `Array<{shotType,description,characterNames}>` | `parseStoryboard` |

> 角色/分镜的最终 **生图 prompt 仍由** `src/lib/workshop/prompt-builder.ts` 编译（保证与 Skill 风格、角色字段一致），LLM 只负责丰富「创意文本」部分。

---

## 6. 扩展指南

- **换模型/换服务**：仅改设置 UI 或 `.env`，无需改代码。
- **新增 LLM 驱动的工具**：在 `prompts.ts` 加系统提示词与解析函数，在组件里 `import { streamChat } from "@/lib/llm/browser"` 并调用即可；若需连续对话，扩展 `LLMMessage[]` 历史。
- **接入其他协议**（如 Claude 原生、Google Gemini）：在 `src/lib/llm/server.ts` 的 `completeLLM` / `streamLLM` 中按提供方分支适配，保持 `getLLMConfig` 返回结构不变即可。
- **密钥管理**：如改用 HashiCorp / 系统钥匙串，只需改 `getLLMConfig` 的 `apiKey` 来源。
