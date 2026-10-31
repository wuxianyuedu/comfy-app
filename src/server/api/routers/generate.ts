import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const generateRuntimeLog = createAppRuntimeLogger("generate");
import { taskRepository, workflowTemplateRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
/* 入参判据住在 `~/lib/workflow/workflow-generate-input`（台账 E4 第四格）：客户端
 * 构造载荷与重试预检用的是**同一个** schema，这里只是把它接到 `.input()` 上。
 * 在它旁边再定义一份，就等于把那条通路重新拆成两边各写各的。 */
import { generateInputSchema } from "~/lib/workflow/workflow-generate-input";

export const generateRouter = createTRPCRouter({
  /* POST /api/generate —— 新建 */
  generate: authedProcedure.input(generateInputSchema).mutation(async ({ ctx, input }) => {
    const data = input;

    // 工作流的**唯一来源**是工作流库（内置模板 + __PROMPT__ token 替换已移除）。
    const tpl = await workflowTemplateRepository.findByIdForUser(ctx.user.id, data.workflow);
    if (!tpl) {
      throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
    }
    const workflowName = tpl.name;
    const taskType = tpl.taskType;

    /* 执行载荷恒为 RAW 原件 —— comfy-cli 按节点类定义做权威 UI→API 转换
     * （顺带展开子图）。判据收在 `hasExecutableWorkflow`，与服务端编排同一份。
     * 没有内容时抛错，而不是静默提交一份空图（空图会在 ComfyUI 侧变成
     * 「一个节点都没有」的报错，用户看不出是入库时就没内容）。 */
    if (!hasExecutableWorkflow(tpl)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "工作流没有可执行内容（rawJson 为空）：请重新导入该工作流",
      });
    }

    const executorClaim = resolveExecutorClaim();

    const task = await taskRepository.createQueued({
      claimedBy: executorClaim,
      execPayload: tpl.rawJson,
      negativePrompt: data.negative,
      params: data,
      parentId: data.parentId ?? null,
      projectId: data.projectId ?? null,
      prompt: data.prompt ?? "",
      referenceImages: data.referenceImages?.length ? data.referenceImages : undefined,
      shotId: data.shotId ?? null,
      type: taskType,
      userId: ctx.user.id,
      workflowName,
    });
    /* 提交只写库里那一行，派发动作不在这里（P3 §5 ADR §14 D1 第二刀）：
     * 这里过去对 inline 片直接 `enqueue()` 推进进程内存队列，于是「队列」有两份
     * 真相（内存 vs 库）。现在两宿主统一走 `executor-dispatch.ts` 的一条 pull，
     * 这次 kick 只是省掉等 2s 节拍；行归对侧（host 片）时它自然空转，
     * 不会与 host 抢同一行——领取谓词是 impl 里唯一的 `ownedBy()`。 */
    kickQueue();
    generateRuntimeLog.info(`生成任务已入队 ${task.id}`, {
      type: taskType,
      workflow: workflowName,
    });
    return { taskId: task.id };
  }),
});
