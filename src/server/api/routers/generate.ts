import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { createAppRuntimeLogger } from "~/lib/app-runtime-log";

const generateRuntimeLog = createAppRuntimeLogger("generate");
import {
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { buildCustomWorkflow, type ParamMap } from "~/lib/comfyui/workflow";
import { enqueue } from "~/lib/comfyui/enqueue";
import { resolveExecutionPayload } from "~/lib/comfyui/execution-shape";

/** Prisma Json 列(paramMap)→ ParamMap。仅排除 null/标量,其余原样透传
 *  (object 已可赋给全可选属性的 ParamMap,无需断言)。 */
function asParamMap(v: unknown): ParamMap | null {
  if (typeof v !== "object" || v === null) return null;
  return v;
}

const WorkflowInputSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  value: z.unknown().optional(),
});

export const GenerateSchema = z.object({
  /** 工作流库工作流 id（内置模板已移除，这里是唯一的工作流来源）。 */
  workflow: z.string().min(1),
  /** 提示词 / 反向提示词：供历史列表与任务标题（参数真值走 workflowInputs）。 */
  prompt: z.string().max(2000).optional(),
  negative: z.string().max(2000).optional(),
  /** 参考图 / 首末帧文件名（已在 ComfyUI input 目录）。 */
  inputImage: z.string().optional(),
  firstFrame: z.string().optional(),
  lastFrame: z.string().optional(),
  /** 视频时长：帧数（按秒表达的口由 workflowInputs 里的 duration 落下）。 */
  frames: z.number().int().min(1).max(1000).optional(),
  paramMap: z.record(z.string(), z.string()).optional(),
  workflowInputs: z.array(WorkflowInputSchema).optional(),
  // 画布导出的 ComfyUI API-format graph:节点值形状动态,按规约收口为 unknown。
  canvasGraph: z.record(z.string(), z.unknown()).optional(),
  projectId: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

export const generateRouter = createTRPCRouter({
  /** POST /api/generate */
  generate: authedProcedure
    .input(GenerateSchema)
    .mutation(async ({ ctx, input }) => {
      const data = input;

      // 工作流的**唯一来源**是工作流库（内置模板 + __PROMPT__ token 替换已移除）。
      const tpl = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        data.workflow,
      );
      if (!tpl && !data.canvasGraph) {
        throw new Error("Workflow not found");
      }
      const workflowName = tpl?.name ?? data.workflow;
      const taskType = tpl?.taskType ?? "TXT2IMG";

      /* 送哪一份执行载荷，只按**这条工作流自己是什么格式**判（两者地位同等，
       * 判据收在 `resolveExecutionPayload`，与服务端编排同一份）：
       *   · RAW 原件 → comfy-cli 做权威 UI→API 转换（顺带展开子图）；
       *   · API 图   → 同样交 comfy-cli 提交（它对 API 格式直接提交）。
       * 画布编辑过的图（`canvasGraph`）是第三种来源：它是用户在画布上现改的
       * API 图，优先于库里存的任意一份。 */
      const payload = data.canvasGraph
        ? ({ kind: "api", graph: data.canvasGraph } as const)
        : tpl
          ? resolveExecutionPayload(tpl)
          : null;
      if (payload?.kind === "raw") {
        const task = await taskRepository.createQueued({
          userId: ctx.user.id,
          type: taskType,
          prompt: data.prompt ?? "",
          negativePrompt: data.negative,
          params: data,
          workflowName,
          projectId: data.projectId ?? null,
          referenceImages: data.referenceImages?.length
            ? data.referenceImages
            : undefined,
        });
        enqueue({
          taskId: task.id,
          rawJson: payload.rawJson,
          overrides: data.workflowInputs,
        });
        generateRuntimeLog.info(`生成任务已入队 ${task.id}`, {
          type: taskType,
          workflow: workflowName,
        });
        return { taskId: task.id };
      }

      // Canvas-edited graph or API-format import.
      // 空对象也算空图：模板 graph 列 NOT NULL，导入失败/空导出会落 `{}`，
      // 此时拿去构建会静默产出一个空 prompt 任务（提交到 ComfyUI 才失败，
      // 用户侧无提示），故与 null 同等对待。
      const graph = payload?.kind === "api" ? payload.graph : null;
      if (!graph || Object.keys(graph).length === 0) {
        throw new Error(
          "工作流没有可执行内容（graph 与 rawJson 都为空）：请重新导入该工作流",
        );
      }
      let built: {
        ok: boolean;
        prompt?: Record<string, unknown>;
        error?: string;
      };
      try {
        built = {
          ok: true,
          prompt: buildCustomWorkflow(
            graph,
            data,
            data.paramMap ?? asParamMap(tpl?.paramMap),
          ),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Workflow build failed";
        throw new Error(msg);
      }

      const task = await taskRepository.createQueued({
        userId: ctx.user.id,
        type: taskType,
        prompt: data.prompt ?? "",
        negativePrompt: data.negative,
        params: data,
        workflowName,
        projectId: data.projectId ?? null,
        referenceImages: data.referenceImages?.length
          ? data.referenceImages
          : undefined,
      });

      /* 画布覆盖项两条路都要带：`buildCustomWorkflow` 先做结构注入（提示词 /
       * 采样器 / 已勾选落点），`overrides` 再在执行点兜一遍（`applyApiOverrides`
       * 处理「不进载荷的前端控件」如 control_after_generate）。与 RAW 路径同一份
       * 数组、同一套语义（见 `raw-overrides` 的模块注释）。 */
      enqueue({
        taskId: task.id,
        prompt: built.prompt,
        overrides: data.workflowInputs,
      });
      return { taskId: task.id };
    }),
});
