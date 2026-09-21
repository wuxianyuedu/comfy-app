import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const generateRuntimeLog = createAppRuntimeLogger("generate");
import {
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { enqueue } from "~/lib/comfyui/enqueue";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";

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
  projectId: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

export const generateRouter = createTRPCRouter({
  /* POST /api/generate —— 新建 */
  generate: authedProcedure
    .input(GenerateSchema)
    .mutation(async ({ ctx, input }) => {
      const data = input;

      // 工作流的**唯一来源**是工作流库（内置模板 + __PROMPT__ token 替换已移除）。
      const tpl = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        data.workflow,
      );
      if (!tpl) {
        throw new Error("Workflow not found");
      }
      const workflowName = tpl.name;
      const taskType = tpl.taskType;

      /* 执行载荷恒为 RAW 原件 —— comfy-cli 按节点类定义做权威 UI→API 转换
       * （顺带展开子图）。判据收在 `hasExecutableWorkflow`，与服务端编排同一份。
       * 没有内容时抛错，而不是静默提交一份空图（空图会在 ComfyUI 侧变成
       * 「一个节点都没有」的报错，用户看不出是入库时就没内容）。 */
      if (!hasExecutableWorkflow(tpl)) {
        throw new Error(
          "工作流没有可执行内容（rawJson 为空）：请重新导入该工作流",
        );
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
      enqueue({
        taskId: task.id,
        workflowName,
        rawJson: tpl.rawJson,
        overrides: data.workflowInputs,
      });
      generateRuntimeLog.info(`生成任务已入队 ${task.id}`, {
        type: taskType,
        workflow: workflowName,
      });
      return { taskId: task.id };
    }),
});
