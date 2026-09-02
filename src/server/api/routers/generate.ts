import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { taskRepository, workflowTemplateRepository } from "@/lib/core/repository";
import {
  buildAndValidate,
  buildCustomWorkflow,
  type ParamMap,
} from "@/lib/comfyui/workflow";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { enqueue } from "@/lib/comfyui/runner";

/** ComfyUI API-format graph(Export (API Format)):nodeId → node。
 *  最小精确形状:buildCustomWorkflow 只对节点整体深拷贝并回填 inputs,
 *  字段值类型多样,故 inputs 值收口为 unknown(不入本文件以外的共享类型)。 */
type ApiGraph = Record<string, { class_type?: unknown; inputs?: Record<string, unknown> }>;

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

const LoraSchema = z.object({ name: z.string(), weight: z.number() });
const WorkflowInputSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  value: z.unknown().optional(),
});

export const GenerateSchema = z.object({
  workflow: z.string().min(1),
  prompt: z.string().max(2000).optional(),
  negative: z.string().max(2000).optional(),
  checkpoint: z.string().optional(),
  loras: z.array(LoraSchema).optional(),
  sampler: z.string().optional(),
  scheduler: z.string().optional(),
  steps: z.number().int().min(1).max(100).optional(),
  cfg: z.number().min(0).max(30).optional(),
  size: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  seed: z.number().int().optional(),
  denoise: z.number().min(0).max(1).optional(),
  inputImage: z.string().optional(),
  mask: z.string().optional(),
  upscaleModel: z.string().optional(),
  frames: z.number().int().min(1).max(1000).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  wanModel: z.string().optional(),
  wanVae: z.string().optional(),
  t5Model: z.string().optional(),
  firstFrame: z.string().optional(),
  lastFrame: z.string().optional(),
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
      const count = data.count ?? 1;

      let built: { ok: boolean; prompt?: Record<string, unknown>; error?: string };
      let workflowName: string;
      let taskType: string;

      const builtin = getWorkflow(data.workflow);
      if (builtin) {
        // Built-in workflow template (token-based).
        built = await buildAndValidate(data.workflow, { ...data, count });
        workflowName = data.workflow;
        taskType = builtin.taskType;
      } else {
        // Custom workflow imported from ComfyUI "Export (API Format)".
        const tpl = await workflowTemplateRepository.findByIdForUser(
          ctx.user.id,
          data.workflow
        );
        if (!tpl && !data.canvasGraph) {
          throw new Error("Workflow not found");
        }
        workflowName = tpl?.name ?? data.workflow;
        taskType = tpl?.taskType ?? "TXT2IMG";

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
          return { taskId: task.id };
        }

        // Canvas-edited graph or API-only import.
        const graph =
          (data.canvasGraph!) ??
          asGraph(tpl?.graph);
        if (!graph) {
          throw new Error("Workflow graph is empty");
        }
        try {
          built = {
            ok: true,
            prompt: buildCustomWorkflow(
              graph,
              { ...data, count },
              data.paramMap ?? asParamMap(tpl?.paramMap)
            ),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Workflow build failed";
          throw new Error(msg);
        }
      }

      if (!built.ok || !built.prompt) {
        throw new Error(built.error ?? "Workflow build failed");
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
