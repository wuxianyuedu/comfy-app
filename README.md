# Comfy-APP

基于 **ComfyUI** 的一站式本地 AI 创作平台（文生图 / 图生图），支持本地模型配置、自定义工作流导入、Skill 技能卡片与全链路创作工坊。技术栈：Next.js 15 (App Router) + TypeScript + Prisma + SQLite。

> 仅供本地创作使用，模型与算力来自本机 ComfyUI 实例。

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制 .env.local 为 .env，确保 DATABASE_URL 等已设置）
cp .env.local .env      # 或手动创建 .env

# 3. 初始化数据库
npm run db:push

# 4. 启动开发服务器（默认 http://localhost:3000，端口被占用时自动顺延）
npm run dev
```

> Windows 用户可直接双击 `run.bat`，它会自动 `cd` 到项目目录、执行 `db:push` 并启动 dev server，出错会暂停提示。

依赖本机已运行的 ComfyUI（默认 `http://localhost:8188`），相关地址在 `.env` 中通过 `COMFYUI_BASE` 配置。

---

## 核心功能

### 1. 自由创作（/create）
- 文生图 / 图生图 / 自定义工作流三种模式。
- 大模型（Checkpoint）、LoRA、采样参数、尺寸、张数、种子等完整控制。
- **自定义工作流画布**（ReactFlow 引擎）：导入 ComfyUI「导出（API 格式）」JSON，可视化拖拽节点、连线、编辑参数并直接执行。

### 2. Skill 技能卡片（/create 内置）
- 参考 [libtv-skills](https://github.com/libtv-labs/libtv-skills)（OpenClaw 规范）与即梦 Skill 选择器。
- 12 个内置技能（皮克斯动画、爆款拉片复刻、新中式美学、古典武侠电幻、油画厚涂、赛博朋克等）。
- 选中技能后自动预填提示词、负向词、采样参数与推荐模型。
- API：`GET/POST /api/skills`，首次访问自动种子内置技能。

### 3. 创作工坊 · 全链路管线（/workshop）
- **剧本生成**：灵感/粗稿 → 结构化场景（离线模板 或 **接入本地/远端 LLM 智能扩写**）。
- **角色设计**：角色卡 → 自动编译 ComfyUI 生图提示词，可关联 Skill 风格；支持「一句话生成角色」「AI 润色」。
- **分镜规划**：剧本 + 角色 → 镜头表（景别/描述/出场角色）→ 单镜或批量生图；支持 **AI 智能拆镜**。
- LLM 接入（Ollama / OpenAI 兼容）详见 [docs/LLM.md](./docs/LLM.md)；工坊总览见 [docs/WORKSHOP.md](./docs/WORKSHOP.md)。

### 4. 模型库（/models）
- CHECKPOINT / LORA 等模型网格浏览，搜索与分类筛选，可用性开关。

### 5. 我的作品（/me/works）
- 生成历史画廊，封面图、工作流名徽章、任务状态。

---

## 目录结构

```
src/
├── app/
│   ├── create/           # 自由创作页
│   ├── workshop/         # 全链路创作工坊
│   ├── models/           # 模型库
│   ├── me/works/         # 我的作品
│   └── api/
│       ├── skills/       # Skill 列表/创建
│       ├── generate/     # 生图入口
│       ├── tasks/        # 任务状态 + SSE 流
│       ├── workflows/    # 自定义工作流 CRUD
│       ├── models/       # 模型列表
│       └── llm/          # LLM 代理 + 配置（config）
├── components/
│   ├── create/           # 创作台
│   ├── workshop/         # 工坊三工具 + LLM 设置
│   ├── workflow-canvas/  # ReactFlow 画布引擎
│   ├── skill/            # Skill 选择器
│   └── layout/           # 导航栏等
├── lib/
│   ├── workshop/         # 工坊类型 + 剧本解析 + prompt 编译
│   ├── llm/              # LLM 抽象层（server/client/prompts/parse）
│   ├── comfyui/          # ComfyUI 客户端与节点工具
│   └── db.ts             # Prisma 单例
└── prisma/schema.prisma  # 数据模型（User/Model/Task/Skill/WorkflowTemplate/LlmConfig...）
```

---

## 数据模型

- **User** — 体验用户（M4 将接入 Auth.js 账户系统）
- **Model** — 本地模型元数据（CHECKPOINT/LORA/CONTROLNET/...）
- **Task / TaskImage** — 生图任务与结果图
- **Skill** — 技能卡片（prompt 模板 + 默认参数 + 分类）
- **WorkflowTemplate** — 用户导入的 ComfyUI 工作流（含 paramMap 节点映射）
- **LlmConfig** — LLM 后端配置单例（provider/baseUrl/model/apiKey/temperature/maxTokens）

---

## 路线图

| 里程碑 | 状态 |
|--------|------|
| M1 数据层 | ✅ |
| M2 文生图端到端 | ✅ |
| M3 工作流日志面板 | ✅ |
| Skill 技能系统 | ✅ |
| 创作工坊全链路 | ✅ |
| LLM 文本生成接入（本地+远端） | ✅ |
| M4 账户系统 (Auth.js) | ⏳ |
| M5 打磨 / P1 视频 | ⏳ |

---

## 文档

- [创作工坊使用指南](./docs/WORKSHOP.md)
- [LLM 接入指南](./docs/LLM.md)
