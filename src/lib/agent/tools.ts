// ── Agent 可调用的「工坊管线工具」定义 ─────────────────────
// 每个工具对应工坊某一阶段的一类操作。工具的**执行**发生在前端
// （因管线状态活在工坊 controller 的 React state 中），后端只负责
// 用 OpenAI 兼容 tools 协议描述这些能力、把模型的 tool_calls 原样
// 返回给前端执行。
//
// 纯定义，无副作用，不需要 zod —— 直接以 OpenAI function calling
// 的 JSON Schema 形状声明，单一来源维护。
import type { LLMTool } from "@/lib/llm/types";

/** 工坊 Agent 的全部工具定义（OpenAI function calling 格式）。 */
export const WORKSHOP_AGENT_TOOL_DEFS: LLMTool[] = [
  {
    type: "function",
    function: {
      name: "get_project_state",
      description:
        "查看当前工坊项目的完整状态快照：项目元信息、剧本内容、角色卡、分镜/镜头列表及其进度。执行任何操作前先调用它了解已有内容，避免重复生成。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_project_meta",
      description:
        "设置/更新当前项目的元信息（标题、类型、基调、一句话梗概）。类型取值：short_video / micro_film / animation / ad / comic / other。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "项目标题" },
          type: {
            type: "string",
            enum: [
              "short_video",
              "micro_film",
              "animation",
              "ad",
              "comic",
              "other",
            ],
            description: "项目类型",
          },
          tone: { type: "string", description: "基调/情绪" },
          logline: { type: "string", description: "一句话梗概" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_script",
      description:
        "让对话模型根据项目元信息与用户的创意描述，生成一份完整剧本 markdown 并写入当前项目。只在用户表达创作意图且剧本为空（或用户明确要求重写）时调用。",
      parameters: {
        type: "object",
        properties: {
          idea: { type: "string", description: "用户的创意灵感或粗稿描述" },
        },
        required: ["idea"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_script",
      description:
        "在已有剧本的基础上让对话模型做改写/扩展/修改。传入希望修改的指令，Agent 将用 LLM 产出修改后的全文并写回。",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description:
              "对现有剧本的修改要求（如『扩写第三场景』『把基调改更轻松』）",
          },
        },
        required: ["instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_characters",
      description:
        "从当前剧本中提取主要角色，生成角色卡（名字、年龄性别、外貌、服装、性格）。提取结果会写入项目的角色列表。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_character",
      description:
        "手动添加或让对话模型设计一个新角色并加入角色列表。提供角色名与简要描述。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "角色名" },
          description: {
            type: "string",
            description: "角色描述/外貌/性格等",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_storyboard",
      description:
        "把剧本拆解为镜头级的分镜规划：每个场景产生 2-5 个镜头（含景别、画面描述、出场角色）。执行前自动提取剧本场景。",
      parameters: {
        type: "object",
        properties: {
          sceneIds: {
            type: "array",
            items: { type: "string" },
            description: "仅对指定场景ID做分镜（缺省=全部场景）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_shot_images",
      description:
        "为当前全部（或指定）镜头生成本地 ComfyUI 图片。依赖工作流库里已有配好对外参数的图类工作流。",
      parameters: {
        type: "object",
        properties: {
          shotIds: {
            type: "array",
            items: { type: "string" },
            description: "仅对指定镜头ID生图（缺省=全部 idle 镜头）",
          },
        },
      },
    },
  },
];

/** 工坊全部工具 → OpenAI 兼容的 tools 请求数组。 */
export function workshopOpenAITools(): LLMTool[] {
  return WORKSHOP_AGENT_TOOL_DEFS;
}

/** 工具名字集合（供快速判断某个 tool_call 是否合法）。 */
export function workshopToolNames(): Set<string> {
  return new Set(WORKSHOP_AGENT_TOOL_DEFS.map((tool) => tool.function.name));
}
