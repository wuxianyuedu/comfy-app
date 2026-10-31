// ── Agent 可调用的「工坊管线工具」定义 ─────────────────────
// 每个工具对应工坊某一阶段的一类操作。工具的**执行**发生在前端
// （因管线状态活在工坊 controller 的 React state 中），后端只负责
// 用 OpenAI 兼容 tools 协议描述这些能力、把模型的 tool_calls 原样
// 返回给前端执行。
//
// 纯定义，无副作用，不需要 zod —— 直接以 OpenAI function calling
// 的 JSON Schema 形状声明，单一来源维护。
import type { LLMTool } from "~/lib/llm/types";

/** 工坊 Agent 的全部工具定义（OpenAI function calling 格式）。 */
export const WORKSHOP_AGENT_TOOL_DEFS: Array<LLMTool> = [
  {
    function: {
      description:
        "查看当前工坊项目的完整状态快照：项目元信息、剧本内容、角色卡、分镜/镜头列表及其进度。执行任何操作前先调用它了解已有内容，避免重复生成。",
      name: "get_project_state",
      parameters: { properties: {}, type: "object" },
    },
    type: "function",
  },
  {
    function: {
      description:
        "设置/更新当前项目的元信息（标题、类型、基调、一句话梗概）。类型取值：short_video / micro_film / animation / ad / comic / other。",
      name: "set_project_meta",
      parameters: {
        properties: {
          logline: { description: "一句话梗概", type: "string" },
          title: { description: "项目标题", type: "string" },
          tone: { description: "基调/情绪", type: "string" },
          type: {
            description: "项目类型",
            enum: ["short_video", "micro_film", "animation", "ad", "comic", "other"],
            type: "string",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "让对话模型根据项目元信息与用户的创意描述，生成一份完整剧本 markdown 并写入当前项目。只在用户表达创作意图且剧本为空（或用户明确要求重写）时调用。",
      name: "generate_script",
      parameters: {
        properties: {
          idea: { description: "用户的创意灵感或粗稿描述", type: "string" },
        },
        required: ["idea"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "在已有剧本的基础上让对话模型做改写/扩展/修改。传入希望修改的指令，Agent 将用 LLM 产出修改后的全文并写回。",
      name: "edit_script",
      parameters: {
        properties: {
          instruction: {
            description: "对现有剧本的修改要求（如『扩写第三场景』『把基调改更轻松』）",
            type: "string",
          },
        },
        required: ["instruction"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "从当前剧本中提取主要角色，生成角色卡（名字、年龄性别、外貌、服装、性格）。提取结果会写入项目的角色列表。",
      name: "extract_characters",
      parameters: { properties: {}, type: "object" },
    },
    type: "function",
  },
  {
    function: {
      description: "手动添加或让对话模型设计一个新角色并加入角色列表。提供角色名与简要描述。",
      name: "add_character",
      parameters: {
        properties: {
          description: {
            description: "角色描述/外貌/性格等",
            type: "string",
          },
          name: { description: "角色名", type: "string" },
        },
        required: ["name"],
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "把剧本拆解为镜头级的分镜规划：每个场景产生 2-5 个镜头（含景别、画面描述、出场角色）。执行前自动提取剧本场景。",
      name: "plan_storyboard",
      parameters: {
        properties: {
          sceneIds: {
            description: "仅对指定场景ID做分镜（缺省=全部场景）",
            items: { type: "string" },
            type: "array",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "为当前全部（或指定）镜头生成本地 ComfyUI 图片。依赖工作流库里已有配好对外参数的图类工作流。",
      name: "generate_shot_images",
      parameters: {
        properties: {
          shotIds: {
            description: "仅对指定镜头ID生图（缺省=全部 idle 镜头）",
            items: { type: "string" },
            type: "array",
          },
        },
        type: "object",
      },
    },
    type: "function",
  },
  {
    function: {
      description:
        "用当前统一项目已产出的镜头一键成片：服务端逐镜生成视频（图生视频）并用 ffmpeg 合成成片，完成后自动把各镜视频与成片状态回写项目进度。需要项目已有镜头、且已在工坊选好视频工作流。这是从「分镜/生图」推进到「成片」的收尾工具。",
      name: "render_film",
      parameters: { properties: {}, type: "object" },
    },
    type: "function",
  },
];

/** 工坊全部工具 → OpenAI 兼容的 tools 请求数组。 */
export function workshopOpenAITools(): Array<LLMTool> {
  return WORKSHOP_AGENT_TOOL_DEFS;
}

/** 工具名字集合（供快速判断某个 tool_call 是否合法）。 */
export function workshopToolNames(): Set<string> {
  return new Set(WORKSHOP_AGENT_TOOL_DEFS.map((tool) => tool.function.name));
}
