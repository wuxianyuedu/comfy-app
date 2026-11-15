import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const generateRuntimeLog = createAppRuntimeLogger("generate");
import { taskRepository, workflowTemplateRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { task } from "~/server/db/schema";
import { KeyedAsyncMutex } from "~/lib/async-mutex";
/* 入参判据住在 `~/lib/workflow/workflow-generate-input`（台账 E4 第四格）：客户端
 * 构造载荷与重试预检用的是**同一个** schema，这里只是把它接到 `.input()` 上。
 * 在它旁边再定义一份，就等于把那条通路重新拆成两边各写各的。 */
import { generateInputSchema } from "~/lib/workflow/workflow-generate-input";

/** 同镜头活动任务的「查重 + 入队」互斥（#3849）：key = `${projectId}:${shotId}`。 */
const shotTaskMutex = new KeyedAsyncMutex();

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

    const createTask = () =>
      taskRepository.createQueued({
        userId: ctx.user.id,
        type: taskType,
        prompt: data.prompt ?? "",
        negativePrompt: data.negative,
        params: data,
        workflowName,
        projectId: data.projectId ?? null,
        shotId: data.shotId ?? null,
        referenceImages: (data.referenceImages?.length ?? 0) > 0 ? data.referenceImages : undefined,
        claimedBy: executorClaim,
        execPayload: tpl.rawJson,
        parentId: data.parentId ?? null,
      });

    /* 同一镜头同时至多一条进行中的生成任务（#3849，重复扣款形态）：双击 /
     * 并发提交不再重复出图。库级唯一索引做不了（drizzle-kit 0.31 的 SQLite
     * diff 对部分索引 / 表达式索引永不收敛，见 schema.ts task 表注释），由
     * 应用层承 —— 按 (projectId, shotId) 的进程内互斥 + 锁内查重（§8.9 ②：
     * check-then-act 必须原子化）。任务的写入方都在本进程，进程内互斥即完备；
     * 不按镜归属的任务（projectId / shotId 缺省）不走这道闸。 */
    const projectId = data.projectId ?? null;
    const shotId = data.shotId ?? null;
    const createdTask =
      projectId !== null && shotId !== null
        ? await shotTaskMutex.run(`${projectId}:${shotId}`, async () => {
            const occupied = await ctx.db
              .select({ id: task.id })
              .from(task)
              .where(
                and(
                  eq(task.projectId, projectId),
                  eq(task.shotId, shotId),
                  inArray(task.status, ["QUEUED", "RUNNING"]),
                ),
              )
              .limit(1);
            if (occupied.length > 0) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "该镜头已有进行中的生成任务，等它完成或取消后再试",
              });
            }
            return createTask();
          })
        : await createTask();
    /* 提交只写库里那一行，派发动作不在这里（P3 §5 ADR §14 D1 第二刀）：
     * 这里过去对 inline 片直接 `enqueue()` 推进进程内存队列，于是「队列」有两份
     * 真相（内存 vs 库）。现在两宿主统一走 `executor-dispatch.ts` 的一条 pull，
     * 这次 kick 只是省掉等 2s 节拍；行归对侧（host 片）时它自然空转，
     * 不会与 host 抢同一行——领取谓词是 impl 里唯一的 `ownedBy()`。 */
    kickQueue();
    generateRuntimeLog.info(`生成任务已入队 ${createdTask.id}`, {
      type: taskType,
      workflow: workflowName,
    });
    return { taskId: createdTask.id };
  }),
});
