# 创作工坊（Workshop）· 全链路创作管线

`/workshop` 是 Comfy-APP 中的**全链路 AI 创作工具**，将「剧本 → 角色 → 分镜 → 生图」串成一条可复用的流水线。它复用了应用中已有的 **Skill 技能系统** 与 **ComfyUI 生图 API**，无需额外后端。

> 适用场景：短视频脚本、微电影、动画分镜、广告片、漫画/漫剧等需要「先有故事、再有画面」的创作。

---

## 1. 总览

```
┌─────────────┐   ┌─────────────┐   ┌────────────────┐   ┌──────────┐
│  剧本生成    │ → │  角色设计    │ → │  分镜规划       │ → │  一键生图 │
│ Script       │   │ Character   │   │ Storyboard     │   │ Generate │
└─────────────┘   └─────────────┘   └────────────────┘   └──────────┘
   场景列表          角色卡+提示词        镜头表+生图prompt     调用 /api/generate
```

三个工具共享同一份项目状态，数据在步骤间自动流转：

| 步骤 | 输入 | 输出 | 关键文件 |
|------|------|------|----------|
| 剧本生成 | 一句话灵感 / 粗稿 | `Scene[]`（场景名/地点/时间/画面/台词/建议镜头数） | `ScriptGenerator.tsx` |
| 角色设计 | 角色属性表单 | `Character[]`（含自动生成的 ComfyUI 正向/负向 prompt） | `CharacterDesigner.tsx` |
| 分镜规划 | 剧本 + 角色 | `Shot[]`（每镜 = 一个生图任务） | `StoryboardPlanner.tsx` |

---

## 2. 剧本生成（Script Generator）

### 功能
- **项目信息**：标题、类型（短视频/微电影/动画/广告/漫画）、基调、一句话梗概。
- **智能辅助结构化**：在展开的输入框中粘贴一段话或一句话灵感，有两个按钮：
  - **模板结构化（离线）**：若输入较短（< 120 字且无空行），自动用 3 幕模板展开为「开端 / 发展 / 高潮结尾」；若输入已分段，按空行或 `场景N` / `SCENE N` 标记切分为多个场景。**纯本地、无需模型。**
  - **✨ AI 智能扩写**：调用已配置的 LLM（见第 9 节），把灵感扩展为 2–6 个结构化场景（JSON），流式输出可实时预览。未配置 LLM 时按钮会引导去设置。
- **手动编辑**：每个场景可编辑 场景名 / 地点 / 时间 / 画面描述 / 台词 / 建议镜头数，支持增删。

### 数据结构（`Scene`）
```ts
interface Scene {
  id: string;
  heading: string;       // 场景标题
  location: string;      // 地点
  time: string;          // 时间
  action: string;        // 画面/动作描述
  dialogue: string;      // 台词/旁白
  shotCount: number;     // 建议镜头数（分镜导入时使用）
}
```

---

## 3. 角色设计（Character Designer）

### 功能
- 角色卡表单：姓名、年龄/性别、外貌特征、服装、性格/气质、风格标签（标签输入，回车添加）。
- **✨ 用一句话生成角色**：输入一句角色设定（如「穿唐装的白发剑客，气质孤傲」），调用 LLM 一次性补全姓名 / 外貌 / 服装 / 性格，并自动编译生图提示词。
- **✨ AI 润色**（每卡）：已填角色名后点「AI 润色」，LLM 参考现有字段与所选 Skill 风格补全外貌 / 服装 / 性格。
- **关联 Skill 风格**：下拉选择内置技能（如「皮克斯动画风格」「油画厚涂写实」），自动套用其提示词模板与推荐参数。
- **自动生成提示词**：填写任意字段后实时编译出 ComfyUI 正向 / 负向 prompt 预览。

### 编译规则（`buildCharacterPrompt`）
```
正向 = [年龄性别, 外貌, 服装] + [mood: 性格] + [风格标签] + [Skill 模板]
负向 = 通用负向词 + Skill 负向词
```

### 数据结构（`Character`）
```ts
interface Character {
  id: string;
  name: string;
  ageGender: string;
  appearance: string;
  costume: string;
  personality: string;
  styleTags: string[];
  skillSlug?: string;            // 关联 Skill
  positivePrompt: string;        // 自动生成
  negativePrompt: string;        // 自动生成
  params: Record<string, unknown>;
}
```

---

## 4. 分镜规划（Storyboard Planner）

### 功能
- **从剧本导入**：一键把每个场景按 `shotCount` 拆分为多个镜头（Shot，纯模板、离线）。
- **✨ AI 智能拆镜**：调用 LLM 把每个场景智能拆分为 2–5 个镜头，自动决定景别、画面描述，并按角色名单关联出场角色；全程显示进度。未配置 LLM 时该按钮不可用，可回退「从剧本导入」。
- 每镜可编辑：**镜号 / 景别（大远景→特写→仰拍俯拍）/ 画面描述 / 出场角色（多选）/ 风格 Skill**。
- **自动编译生图 prompt**：`场景氛围 + 镜头关键词 + 描述 + 关联角色 prompt + 风格模板`。
- **单镜生成 / 批量生成**：调用统一 Checkpoint 提交到 `/api/generate`，通过 SSE 拉取结果并内嵌预览。

### 景别（`ShotType`）
大远景 `extreme_wide` · 远景 `wide` · 全景 `full` · 中景 `medium` · 近景 `close` · 特写 `extreme_close` · 仰拍 `poi` · 俯拍 `pod`

### 数据结构（`Shot`）
```ts
interface Shot {
  id: string;
  index: number;
  sceneId: string;
  sceneHeading: string;
  shotType: ShotType;
  description: string;
  characterIds: string[];
  skillSlug?: string;
  prompt: string;          // 自动编译
  negativePrompt: string;  // 自动编译
  params: Record<string, unknown>;
  status: "idle" | "queued" | "running" | "done" | "failed";
  taskId?: string;
  imageUrl?: string;
}
```

---

## 5. 与 Skill 系统的集成

Workshop 直接复用 `/api/skills` 返回的技能列表作为「风格来源」（`StyleRef`）：

- **角色设计器** 与 **分镜规划器** 的下拉均从 `/api/skills` 拉取；
- 选择某个 Skill 后，其 `promptTemplate` / `negativePrompt` / `defaultParams` 会注入到对应 prompt 与参数中；
- 提交生图时，payload 携带 `skillSlug` + `skillName`，与「自由创作」页行为一致。

> 内置技能示例：皮克斯动画风格、爆款拉片复刻、新中式美学、古典武侠电幻、日系动漫插画、油画厚涂写实、水彩梦幻童话、赛博朋克都市、电影级人像摄影、胶片复古颗粒、漫剧分镜生成、概念设计原画。
> 新增自定义技能：见 `POST /api/skills`（需登录）。

---

## 6. 生图调用（API 契约）

分镜生成时，前端构造如下 payload 提交到 `POST /api/generate`：

```jsonc
{
  "workflow": "txt2img",
  "prompt": "<Shot.prompt>",
  "negative": "<Shot.negativePrompt>",
  "checkpoint": "<全局选择的 Checkpoint 文件名>",
  "steps": 28,
  "cfg": 7,
  "sampler": "euler_ancestral",
  "scheduler": "normal",
  "size": "832x1216",
  "count": 1,
  "skillSlug": "<可选>",
  "skillName": "<可选>"
}
```

结果通过 `GET /api/tasks/:taskId/stream`（SSE）推送，前端监听到 `image` / `done` 事件后内嵌预览图。

---

## 7. LLM 文本生成接入（本地 + 远端）

工坊的三个工具均支持接入 **本地 LLM**（Ollama / LM Studio / vLLM）或 **远端 API**（OpenAI 及任何 OpenAI 兼容接口），用于剧本扩写、角色生成/润色、分镜智能切分。详见 **[docs/LLM.md](./LLM.md)**。

要点：
- **统一协议**：本地与远端都走 OpenAI `/v1/chat/completions` 协议，代码零分支。
- **密钥安全**：API Key 仅存于服务端（`LlmConfig` 单例表 / `.env`），浏览器永不接触，调用经 `/api/llm` 代理转发。
- **流式输出**：剧本/角色/分镜均支持 SSE 流式生成，UI 实时预览。
- **离线兜底**：未配置 LLM 时，「模板结构化」「从剧本导入」等离线能力仍可用。

快速配置（点工坊右上角「⚙️ LLM 设置」）：
- 本地：`提供方=本地`，`Base URL=http://localhost:11434/v1`，`模型=llama3.1`（需先 `ollama pull llama3.1` 并运行 `ollama serve`）。
- 远端：`提供方=远端`，`Base URL=https://api.openai.com/v1`，`模型=gpt-4o-mini`，填 `API Key`，点「测试连接」验证。

---

## 8. 文件索引

| 路径 | 说明 |
|------|------|
| `src/app/workshop/page.tsx` | 工坊主页面（Tab + 共享状态 + 生图编排 + LLMProvider） |
| `src/components/workshop/ScriptGenerator.tsx` | 剧本生成器（模板 + AI 扩写） |
| `src/components/workshop/CharacterDesigner.tsx` | 角色设计器（AI 生成 + AI 润色） |
| `src/components/workshop/StoryboardPlanner.tsx` | 分镜规划器（模板 + AI 拆镜） |
| `src/components/workshop/llm-context.tsx` | LLMProvider / 状态徽章 / 设置弹窗 |
| `src/lib/llm/types.ts` | LLMConfig / LLMMessage 等类型 |
| `src/lib/llm/server.ts` | 服务端配置合并 + complete/stream 调用（隐藏 Key） |
| `src/lib/llm/browser.ts` | 浏览器端 streamChat / completeChat |
| `src/lib/llm/prompts.ts` | 剧本/角色/分镜 系统提示词 + JSON 解析 |
| `src/lib/llm/parse.ts` | extractJson（剥离代码围栏/散文） |
| `src/app/api/llm/route.ts` | LLM 代理（流式 SSE / 非流式 JSON） |
| `src/app/api/llm/config/route.ts` | LLM 配置 GET（脱敏）/ POST（upsert 单例） |
| `src/lib/workshop/types.ts` | 共享类型（Scene/Character/Shot/StyleRef 等） |
| `src/lib/workshop/script-parser.ts` | 自由文本 → 结构化剧本（离线模板） |
| `src/lib/workshop/prompt-builder.ts` | 角色/分镜 → ComfyUI prompt 编译 |
| `src/app/api/skills/route.ts` | Skill 列表（风格来源） |
| `src/app/api/generate/route.ts` | 生图入口 |

---

## 9. 后续可扩展

- **导出**：将 `Scene[]` / `Character[]` / `Shot[]` 导出为 JSON / Markdown 脚本文档。
- **分镜表导出 PNG**：调用已有 ReactFlow 画布能力渲染分镜看板。
- **批量队列持久化**：将 `Shot[]` 存入数据库，支持断点续生成。
- **LLM 上下文记忆**：在分镜拆镜时携带前序镜头，保证连续镜头的角色一致性。
