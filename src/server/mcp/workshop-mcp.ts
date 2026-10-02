// ── Workshop MCP 服务端（工具定义，双 transport 共用）───────────
// buildWorkshopMcpServer() 返回已注册全部工坊工具的 McpServer，供 stdio
// 与 HTTP(Streamable) 两种 transport 共用（同一份工具定义）。
//
// 工具覆盖工坊全流程：会话 → 脚本 → 角色 → 分镜 → 生图 → 生视频，
// AI 客户端可按顺序调用以指挥端到端创作。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  sizeSpecFromText,
  toSizeSpec,
  type SizeSpec,
} from "~/lib/media/size-presets";
import type { ProjectMeta } from "~/lib/workshop/types";
import {
  characterListInputSchema,
  shotListInputSchema,
} from "~/lib/workshop/types";
import { saveComfySettings } from "~/server/workshop/comfyui";
import * as orchestrator from "~/server/workshop/orchestrator";

/** 尺寸参数（两种类别任选其一）：
 *   · 比例 + 分辨率          —— `ratio` + `clarity`（"1k"/"2k"/"4k"）；
 *   · 比例 + 百万像素 + 倍数  —— `ratio` + `clarity`（"1M"/"2M"/"4M"）+ `multiple`。
 *  另外保留 `size`（"1024x1024"）作为老口径入参：识别得出比例/像素档就等价换算，
 *  识别不出（模型需要的怪尺寸）就回退默认档 —— 尺寸只有那两种表达，不再有第三套。 */
const sizeArgs = {
  ratio: z
    .string()
    .optional()
    .describe('比例（16:9 / 3:4 / 1:1 …），与 clarity 一起构成尺寸；如 "16:9"'),
  clarity: z
    .string()
    .optional()
    .describe('像素档：分辨率 "1k"/"2k"/"4k"，或百万像素 "1M"/"2M"/"4M"'),
  multiple: z
    .number()
    .int()
    .optional()
    .describe("宽高对齐倍数（8/16/32/64），仅百万像素档使用"),
  size: z
    .string()
    .optional()
    .describe(
      '老口径尺寸「宽x高」，如 "1024x1024"（能用 ratio + clarity 就别用它）',
    ),
};

/** 工具入参 → 尺寸表达；一个都没给时返回 undefined（各通道走自己的默认档）。 */
function sizeSpecOf(args: {
  ratio?: string;
  clarity?: string;
  multiple?: number;
  size?: string;
}): SizeSpec | undefined {
  if (args.ratio || args.clarity || args.multiple !== undefined) {
    return toSizeSpec({
      ratio: args.ratio,
      clarity: args.clarity,
      multiple: args.multiple,
    });
  }
  if (args.size) return sizeSpecFromText(args.size);
  return undefined;
}

const SERVER_INSTRUCTIONS = `工坊（Workshop）创作流水线工具集。标准编排顺序：
1) workshop_create_session 创建会话（可带 idea 灵感）
2) workshop_generate_script 由灵感扩写为剧本（或 workshop_set_script 直接写入）
3) workshop_extract_characters 从剧本提取角色卡（或 workshop_set_characters 直接写入）
4) workshop_build_storyboard 拆分分镜（或 workshop_set_storyboard 直接写入）
5) workshop_generate_image 为镜头 / 角色生图（channel: "api"）
6) workshop_submit_video + workshop_poll_video 生成视频片段（channel: "api"）
所有写操作都需要 sessionId 参数（来自 create_session 的返回）。成片合成暂未提供。`;

/** 构造并注册全部工坊工具的 MCP server。 */
export function buildWorkshopMcpServer(): McpServer {
  const server = new McpServer(
    { name: "comfy-workshop", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const json = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  server.registerTool(
    "workshop_create_session",
    {
      title: "创建工坊会话",
      description:
        "创建一个新的工坊创作会话，返回 sessionId。可附带标题、类型、基调、梗概与灵感。",
      inputSchema: {
        title: z.string().optional().describe("项目标题"),
        type: z
          .string()
          .optional()
          .describe(
            "项目类型：short_video/micro_film/animation/ad/comic/other",
          ),
        tone: z.string().optional().describe("基调，如「温暖治愈」"),
        logline: z.string().optional().describe("一句话梗概"),
        idea: z
          .string()
          .optional()
          .describe("灵感 / 梗概，后续可由 LLM 扩写为剧本"),
        userId: z
          .string()
          .nullable()
          .optional()
          .describe("可选：关联用户 id（AI 会话通常留空）"),
      },
    },
    async (args) => {
      const id = await orchestrator.createSession({
        title: args.title,
        type: args.type,
        tone: args.tone,
        logline: args.logline,
        idea: args.idea,
        userId: args.userId,
      });
      return json({ sessionId: id });
    },
  );

  server.registerTool(
    "workshop_list_sessions",
    {
      title: "列出工坊会话",
      description: "列出所有工坊会话（轻量摘要，不含大字段）。",
      inputSchema: {},
    },
    async () => json(await orchestrator.listSessions()),
  );

  server.registerTool(
    "workshop_get_session",
    {
      title: "获取会话完整状态",
      description:
        "返回某会话的完整流水线状态（idea / 剧本 / 场景 / 角色 / 分镜 / 阶段）。",
      inputSchema: { sessionId: z.string().describe("会话 id") },
    },
    async (args) => {
      const state = await orchestrator.getSession(args.sessionId);
      if (!state) throw new Error(`工坊会话不存在：${args.sessionId}`);
      return json(state);
    },
  );

  server.registerTool(
    "workshop_delete_session",
    {
      title: "删除工坊会话",
      description: "删除一个工坊会话。",
      inputSchema: { sessionId: z.string().describe("会话 id") },
    },
    async (args) =>
      json({ deleted: await orchestrator.deleteSession(args.sessionId) }),
  );

  server.registerTool(
    "workshop_set_meta",
    {
      title: "设置会话元信息",
      description: "更新标题 / 类型 / 基调 / 梗概。",
      inputSchema: {
        sessionId: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        tone: z.string().optional(),
        logline: z.string().optional(),
      },
    },
    async (args) =>
      json(
        await orchestrator.setMeta(args.sessionId, {
          title: args.title,
          type: args.type as ProjectMeta["type"] | undefined,
          tone: args.tone,
          logline: args.logline,
        }),
      ),
  );

  server.registerTool(
    "workshop_set_idea",
    {
      title: "设置灵感",
      description: "写入 / 覆盖灵感文本（后续用于 generate_script）。",
      inputSchema: {
        sessionId: z.string(),
        idea: z.string().describe("灵感 / 梗概"),
      },
    },
    async (args) => json(await orchestrator.setIdea(args.sessionId, args.idea)),
  );

  server.registerTool(
    "workshop_generate_script",
    {
      title: "生成剧本",
      description: "调用 LLM 把 idea 扩写为 Markdown 剧本，并解析出场景列表。",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => json(await orchestrator.generateScript(args.sessionId)),
  );

  server.registerTool(
    "workshop_set_script",
    {
      title: "写入剧本",
      description: "直接写入剧本 Markdown（可选同步解析场景）。",
      inputSchema: {
        sessionId: z.string(),
        markdown: z.string().describe("剧本 Markdown"),
        parse: z.boolean().optional().describe("是否同步解析场景，默认 true"),
      },
    },
    async (args) =>
      json(
        await orchestrator.setScript(
          args.sessionId,
          args.markdown,
          args.parse ?? true,
        ),
      ),
  );

  server.registerTool(
    "workshop_extract_characters",
    {
      title: "提取角色卡",
      description: "调用 LLM 从剧本提取角色卡，重名跳过并自动重算提示词。",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => json(await orchestrator.extractCharacters(args.sessionId)),
  );

  server.registerTool(
    "workshop_set_characters",
    {
      title: "写入角色卡",
      description: "直接写入角色卡数组（自动重算 positive/negative 提示词）。",
      inputSchema: {
        sessionId: z.string(),
        characters: characterListInputSchema.describe(
          "Character 数组（整幅覆盖该会话的角色卡；positive/negative 提示词由服务端按字段重算，传了也不信）",
        ),
      },
    },
    async (args) =>
      json(await orchestrator.setCharacters(args.sessionId, args.characters)),
  );

  server.registerTool(
    "workshop_build_storyboard",
    {
      title: "拆分分镜",
      description:
        "调用 LLM 把剧本拆为镜头序列，自动匹配场景与角色并重算提示词。",
      inputSchema: { sessionId: z.string() },
    },
    async (args) => json(await orchestrator.buildStoryboard(args.sessionId)),
  );

  server.registerTool(
    "workshop_set_storyboard",
    {
      title: "写入分镜",
      description: "直接写入镜头数组（自动重算 prompt/negativePrompt）。",
      inputSchema: {
        sessionId: z.string(),
        shots: shotListInputSchema.describe(
          "Shot 数组（整幅覆盖分镜；prompt/negativePrompt 由服务端按场景与角色重算）",
        ),
      },
    },
    async (args) =>
      json(await orchestrator.setStoryboard(args.sessionId, args.shots)),
  );

  server.registerTool(
    "workshop_generate_image",
    {
      title: "生图",
      description:
        '为某个镜头或角色生成图片。channel 默认 "api"；"comfyui" 走本地 ComfyUI（需 ComfyUI 在运行，可选 data/workshop-comfy-settings.json 的 imageWorkflow 模板，默认内置 SDXL txt2img 图）。尺寸用「比例 + 分辨率（1k/2k/4k）」或「比例 + 百万像素（1M/2M/4M）+ 倍数」表达，具体像素按图片场景尺寸表算。',
      inputSchema: {
        sessionId: z.string(),
        shotId: z
          .string()
          .optional()
          .describe("目标镜头 id（与 characterId 二选一）"),
        characterId: z
          .string()
          .optional()
          .describe("目标角色 id（与 shotId 二选一）"),
        channel: z
          .enum(["api", "comfyui"])
          .optional()
          .describe("生图通道，默认 api"),
        ...sizeArgs,
      },
    },
    async (args) =>
      json(
        await orchestrator.generateImage(args.sessionId, {
          shotId: args.shotId,
          characterId: args.characterId,
          channel: args.channel,
          size: sizeSpecOf(args),
        }),
      ),
  );

  server.registerTool(
    "workshop_submit_video",
    {
      title: "提交视频生成",
      description:
        '为镜头提交图生视频 / 文生视频任务（channel 默认 "api"）。可指定首帧图。',
      inputSchema: {
        sessionId: z.string(),
        shotId: z.string().describe("目标镜头 id"),
        channel: z
          .enum(["api", "comfyui"])
          .optional()
          .describe("生视频通道，默认 api"),
        prompt: z.string().optional().describe("视频提示词，默认用镜头描述"),
        negative: z.string().optional(),
        frames: z.number().optional(),
        fps: z.number().optional(),
        useFirstFrame: z
          .boolean()
          .optional()
          .describe("是否用该镜头已生成的图片作为首帧"),
      },
    },
    async (args) =>
      json(
        await orchestrator.submitVideo(args.sessionId, {
          shotId: args.shotId,
          channel: args.channel,
          prompt: args.prompt,
          negative: args.negative,
          frames: args.frames,
          fps: args.fps,
          useFirstFrame: args.useFirstFrame,
        }),
      ),
  );

  server.registerTool(
    "workshop_poll_video",
    {
      title: "轮询视频任务",
      description: "轮询某个镜头的异步视频任务状态；完成时回写 clipUrl。",
      inputSchema: {
        sessionId: z.string(),
        shotId: z.string().describe("目标镜头 id"),
      },
    },
    async (args) =>
      json(await orchestrator.pollVideo(args.sessionId, args.shotId)),
  );

  server.registerTool(
    "workshop_compose_final",
    {
      title: "成片合成",
      description:
        "把分镜按序合成为成片：写出合成清单（JSON）。render=true 且 ffmpeg 可用时额外合成 mp4。",
      inputSchema: {
        sessionId: z.string(),
        render: z
          .boolean()
          .optional()
          .describe(
            "是否调用 ffmpeg 合成 mp4（需本地片段为文件路径），默认 false",
          ),
        title: z.string().optional().describe("成片标题，默认用会话标题"),
      },
    },
    async (args) =>
      json(
        await orchestrator.composeFinal(args.sessionId, {
          render: args.render,
          title: args.title,
        }),
      ),
  );

  server.registerTool(
    "workshop_set_comfy_workflow",
    {
      title: "配置 ComfyUI 工作流",
      description:
        "保存 ComfyUI 通道配置：默认 SDXL txt2img 之外的自定义图（ComfyUI API 格式，支持 {{prompt}}/{{negative}}/{{image}} 占位）与 i2v 视频图。视频通道必须有 videoWorkflow 才能用。",
      inputSchema: {
        checkpoint: z
          .string()
          .optional()
          .describe(
            "默认 txt2img 使用的模型文件名，如 sd_xl_base_1.0.safetensors",
          ),
        imageWorkflow: z
          .unknown()
          .optional()
          .describe(
            "自定义生图工作流（ComfyUI API 格式图，含 {{prompt}}/{{negative}}）",
          ),
        videoWorkflow: z
          .unknown()
          .optional()
          .describe(
            "自定义图生视频工作流（含 {{prompt}}/{{negative}}/{{image}}）",
          ),
      },
    },
    async (args) =>
      json(
        await saveComfySettings({
          checkpoint: args.checkpoint,
          imageWorkflow: args.imageWorkflow,
          videoWorkflow: args.videoWorkflow,
        }),
      ),
  );

  return server;
}
