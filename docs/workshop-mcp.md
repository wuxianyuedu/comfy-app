# 工坊 MCP（Model Context Protocol）支持

让 AI 客户端能**端到端指挥工坊创作全流程**：脚本 → 角色 → 分镜 → 生图 → 生视频。
同一份工具定义同时提供 **stdio** 与 **HTTP(Streamable)** 两种 transport，可由外部 AI
客户端（Claude Desktop / Cline 等）或应用内 agent 连接。

> **占位符约定**：本文中 `{{...}}` 形式的占位符代表文档引用的真实值（如端口），
> 真实值由 `pnpm doc:check` 运行时从源码/配置动态提取并核对。占位符语义见
> [`docs/reference-facts.md`](./reference-facts.md)。改动上游源码后可运行
> `pnpm doc:check` 检查本文是否有值未同步。

## 架构

- `src/server/mcp/workshop-mcp.ts` — `buildWorkshopMcpServer()`：注册全部工坊工具的
  `McpServer`（同一份工具定义，双 transport 共用）。
- `src/server/workshop/orchestrator.ts` — 5 阶段流水线逻辑（脚本/角色/分镜/生图/生视频）。
- `src/server/workshop/repository.ts` — `workshopSession` 会话 CRUD（纯映射函数可单测）。
- `src/server/workshop/db.ts` `llm.ts` `api-channel.ts` — **刻意不依赖 `server-only` /
  `~/env`** 的工坊本地模块，复用同一份 Drizzle schema 与 `llmConfig` 表、API 通道配置，
  因此 stdio（独立 Node 进程）与 Next HTTP 路由都能直接复用。
- `tools/workshop-mcp-stdio.ts` / `tools/workshop-mcp-http.ts` — 两个 transport 入口。

> 为什么需要本地模块：原 `api-channel.server.ts`、`llm/server.ts` 顶部 `import "server-only"`，
> 该包在纯 Node 进程会抛错；所以 MCP 服务端用一套不触碰 `server-only` 的实现复用纯函数
> 模块（`script-parse` / `script-parser` / `prompt-builder` / `api-channel-shared`）。

## 运行

```bash
# 1) 确保 workshopSession 表已建（启动器会自动 push；手动也可）：
pnpm db:push            # 或 pnpm exec drizzle-kit push --force

# 2) 配置 LLM 与 API 通道（与界面设置 UI 共享同一份配置）：
#    - LLM：界面「设置」写入 llmConfig 表，或环境变量 LLM_BASE_URL/LLM_MODEL/LLM_API_KEY
#    - 生图/生视频：data/workshop-api-settings.json（HTTP 通道）

# stdio：供外部 AI 客户端连接（如 Claude Desktop 的 mcpServers 配置）
pnpm mcp:stdio

# HTTP：独立服务，默认 http://127.0.0.1:{{mcp.http.port}}/mcp（Streamable，无状态）
pnpm mcp:http
```

> **可达面只有本机回环**。这组工具会写库、删会话、发起出图/出视频（花的是本机额度），
> 而入口本身没有鉴权 —— 所以「谁连得上」就是唯一的信任边界：监听地址固定取
> `src/lib/endpoints.ts` 的 `LOOPBACK_HOST`，跨源默认**关闭**（本机原生 MCP 客户端不需要
> CORS）。确有浏览器客户端时，用 `MCP_HTTP_ALLOWED_ORIGINS` 逐条登记具体 origin
> （逗号分隔，不做通配），命中才回该 origin；形状由
> `tests/mcp-http-entry-loopback.test.ts` 钉住（绑回环 + 不许通配），改回去就红。

Claude Desktop 示例（`claude_desktop_config.json`）：
```json
{ "mcpServers": { "comfy-workshop": { "command": "pnpm", "args": ["mcp:stdio"], "cwd": "<项目根>" } } }
```

## 工具清单（条数以 `src/server/mcp/workshop-mcp.ts` 的 `registerTool` 为准，下表逐条列全 —— 故意不写死数字）

| 工具 | 作用 |
|---|---|
| `workshop_create_session` | 新建会话，返回 `sessionId` |
| `workshop_list_sessions` | 列出会话摘要 |
| `workshop_get_session` | 取完整状态（idea/剧本/场景/角色/分镜/阶段） |
| `workshop_delete_session` | 删除会话 |
| `workshop_set_meta` | 改标题/类型/基调/梗概 |
| `workshop_set_idea` | 写灵感 |
| `workshop_generate_script` | LLM 把灵感扩写为剧本 + 解析场景 |
| `workshop_set_script` | 直接写剧本（可同步解析场景） |
| `workshop_extract_characters` | LLM 从剧本提取角色卡 |
| `workshop_set_characters` | 直接写角色卡（重算提示词） |
| `workshop_build_storyboard` | LLM 拆分分镜（匹配场景/角色，重算提示词） |
| `workshop_set_storyboard` | 直接写分镜 |
| `workshop_generate_image` | 为镜头/角色生图（`channel: "api"`） |
| `workshop_submit_video` | 提交图生/文生视频任务 |
| `workshop_poll_video` | 轮询视频任务，完成时回写 `clipUrl` |
| `workshop_compose_final` | 成片合成：写出合成清单 JSON（`render:true` 且 ffmpeg 可用时合成 mp4） |
| `workshop_set_comfy_workflow` | 配置 ComfyUI 通道（默认模型 / 自定义生图 / 图生视频工作流模板） |

## AI 指挥全流程（推荐顺序）

`create_session` → `generate_script`（或 `set_script`）→ `extract_characters`（或
`set_characters`）→ `build_storyboard`（或 `set_storyboard`）→ `generate_image` →
`submit_video` + `poll_video`。所有写操作带 `sessionId`。

## 范围与限制

- **生图 / 生视频双通道**：`channel: "api"` 走用户配置的可控 HTTP 端点（与界面设置 UI 共享
  `data/workshop-api-settings.json`）；`channel: "comfyui"` 直接调用本地 ComfyUI 的
  `/api/prompt` → `/api/history` → `/api/view`，纯 Node 进程可用。
  - 生图：默认内置一个**模型无关**的 SDXL txt2img 图；可用 `workshop_set_comfy_workflow`
    的 `imageWorkflow` 提供自定义图（支持 `{{prompt}}`/`{{negative}}` 占位）。
  - 生视频：需先在 `data/workshop-comfy-settings.json`（或 `workshop_set_comfy_workflow`
    的 `videoWorkflow`）配置 **图生视频(i2v) 工作流模板**（含 `{{prompt}}`/`{{negative}}`/
    `{{image}}` 占位，导出自 ComfyUI 的 API 按钮）——因为 i2v 依赖具体模型，无法内置通用图。
    未配置时生视频会给出明确指引。
- **成片合成**：`workshop_compose_final` 默认产出合成清单 JSON（与界面 FinalComposer 对齐）；
  `render: true` 且本地有 `ffmpeg`（或 `FFMPEG_PATH`）时，把本地片段（视频按 duration 截断、
  仅图片镜头以静帧占位，统一缩放 1280x720）合成为 mp4。
- 会话持久化在 `workshopSession` 表，与界面共享同一项目（界面侧接入待后续）。
- **剧本评审不暴露为 MCP 工具（#2478 评估结论）**：剧本质量闭环（`FR-QA-07`④）的
  执行器（`run.reviewScript` / `run.reviseScript`）落在 **production 统一项目**的
  `scriptReview` 列，而本 MCP 工具层只有 `sessionId` 语境（工坊会话与 production
  是两套存储，见上一条），没有把判定写回 production 列的归属口径；外部 AI 要指挥
  剧本打磨，走 run 控制面（`run.start` 的自动闭环已含剧本评审/改写轮次；按需控制面
  的 MCP 暴露见 `FR-AG-05` 的缺口单），不在本服务器复制第二份评审工具。
- 本地 ComfyUI 必须**正在运行**（启动器会自动拉起；或手动启动），MCP 进程通过
  `COMFYUI_BASE`（默认 `http://127.0.0.1:{{comfyui.port}}`，带端口探测）连接。
