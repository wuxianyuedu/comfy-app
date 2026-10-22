// 「提交一次生成」= 「从工作流库的某个模板入队一条任务」，实现只有一份：
// `~/server/lib/enqueue-task.ts`（单条与批量共用）。这一层因此只剩两件事：把入参判据
// 接上（`generateInputSchema`，与客户端构造载荷、重试预检同一份），以及把会话里的归属
// 交给它。
//
// 判据搬走的原因见那份模块的头注释 —— 第二处 `createQueued` 迟早会少抄一道闸，而少抄
// 的那道不会在这里报错，只会在 ComfyUI 侧变成一个跟入库处对不上的错误。里程碑日志
// （「生成任务已入队 …」）跟着那一处一起走，命名空间是 `enqueue-task`。
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { generateInputSchema } from "~/lib/workflow/workflow-generate-input";
import { enqueueWorkflowTask } from "~/server/lib/enqueue-task";

export const generateRouter = createTRPCRouter({
  /* POST /api/generate —— 新建 */
  generate: authedProcedure
    .input(generateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const data = input;
      const { taskId } = await enqueueWorkflowTask({
        userId: ctx.user.id,
        workflowId: data.workflow,
        prompt: data.prompt,
        negativePrompt: data.negative,
        /* `params` 原样存这一份入参：历史详情的「复投 / 参考图重放」读的就是它。 */
        params: data,
        projectId: data.projectId ?? null,
        shotId: data.shotId ?? null,
        referenceImages: data.referenceImages,
      });
      return { taskId };
    }),
});
