import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { createAppRuntimeLogger } from "@/lib/app-runtime-log";

const generateRuntimeLog = createAppRuntimeLogger("generate");
import {
  taskRepository,
  workflowTemplateRepository,
} from "@/lib/core/repository";
import { buildCustomWorkflow, type ParamMap } from "@/lib/comfyui/workflow";
import { enqueue } from "@/lib/comfyui/enqueue";

/** ComfyUI API-format graph(Export (API Format)):nodeId → node。
 *  最小精确形状:buildCustomWorkflow 只对节点整体深拷贝并回填 inputs,
 *  字段值类型多样,故 inputs 值收口为 unknown(不入本文件以外的共享类型)。 */
type ApiGraph = Record<
  string,
  { class_type?: unknown; inputs?: Record<string, unknown> }
>;

/** Prisma Json 列(graph)→ 预期形状。仅排除 null/标量;原 `as any` 同样把任何
 *  对象/数组原样透传给 buildCustomWorkflow,数组因此也放行,保持运行时一致。 */
function asGraph(v: unknown): ApiGraph | null {
  if (typeof v !== "object" || v === null) return null;
  return v as ApiGraph;
}

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

      // Raw UI-format json executes via comfy-cli (expands subgraphs).
      if (tpl?.rawJson && !data.canvasGraph) {
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
          rawJson: tpl.rawJson,
          overrides: data.workflowInputs,
        });
        generateRuntimeLog.info(`生成任务已入队 ${task.id}`, {
          type: taskType,
          workflow: workflowName,
        });
        return { taskId: task.id };
      }

      // Canvas-edited graph or API-only import.
      // 空对象也算空图：模板 graph 列 NOT NULL，导入失败/空导出会落 `{}`，
      // 此时拿去构建会静默产出一个空 prompt 任务（提交到 ComfyUI 才失败，
      // 用户侧无提示），故与 null 同等对待。
      const graph = data.canvasGraph ?? asGraph(tpl?.graph);
      if (!graph || Object.keys(graph).length === 0) {
        throw new Error("Workflow graph is empty");
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

      enqueue({ taskId: task.id, prompt: built.prompt });
      return { taskId: task.id };
    }),
});
