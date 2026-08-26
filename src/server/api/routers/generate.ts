import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { taskRepository, workflowTemplateRepository } from "@/lib/core/repository";
import {
  buildAndValidate,
  buildCustomWorkflow,
} from "@/lib/comfyui/workflow";
import { getWorkflow } from "@/lib/comfyui/_meta";
import { enqueue } from "@/lib/comfyui/runner";

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
  canvasGraph: z.record(z.string(), z.any()).optional(),
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
        built = await buildAndValidate(data.workflow, { ...data, count } as any);
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
            params: data as unknown,
            workflowName,
            projectId: data.projectId ?? null,
            referenceImages: data.referenceImages?.length
              ? data.referenceImages
              : undefined,
          });
          enqueue({
            taskId: task.id,
            rawJson: tpl.rawJson as any,
            overrides: data.workflowInputs,
          });
          return { taskId: task.id };
        }

        // Canvas-edited graph or API-only import.
        const graph =
          (data.canvasGraph as Record<string, any>) ??
          (tpl?.graph as Record<string, any>);
        if (!graph) {
          throw new Error("Workflow graph is empty");
        }
        try {
          built = {
            ok: true,
            prompt: buildCustomWorkflow(
              graph,
              { ...data, count } as any,
              (data.paramMap as any) ?? (tpl?.paramMap as any)
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
        params: data as unknown,
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