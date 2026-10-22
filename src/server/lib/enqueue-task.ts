import "server-only";

import { TRPCError } from "@trpc/server";

import {
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { createAppRuntimeLogger } from "~/lib/log/app-runtime-log";

const log = createAppRuntimeLogger("enqueue-task");

/** 一次入队的入参：工作流 + 这一条任务自己的字段。 */
export interface EnqueueTaskInput {
  userId: string;
  /** 工作流库 id——工作流的**唯一来源**（内置模板与 __PROMPT__ token 替换已移除）。 */
  workflowId: string;
  prompt?: string;
  negativePrompt?: string;
  /** 原样存进 `task.params` 的整包参数（供回看与复投），不在这里做二次加工。 */
  params: unknown;
  projectId?: string | null;
  shotId?: string | null;
  referenceImages?: string[];
  /**
   * 写完库行后是否立刻 `kickQueue()`。
   *
   * 默认真是给单条提交用的（省掉等 2s 节拍）；批量提交要传 false，
   * 让调用方在整批写完后统一 kick 一次——每行 kick 一次不会更正确，
   * 只会让派发器被无意义地敲 N 遍。
   */
  kick?: boolean;
}

/** 入队结果：调用方要拿 taskId 去记自己的关联（如试验格子）。 */
export interface EnqueuedTask {
  taskId: string;
  workflowName: string;
  /** 工作流的 taskType，落库即 `task.type`。 */
  taskType: string;
}

/**
 * 「从工作流库的某个模板入队一条任务」的**唯一实现**。
 *
 * 为什么必须收在一处：这条链上有三道判据（模板存在性、可执行形状、执行宿主归属）
 * 加一次 `createQueued` 与一次可选 `kickQueue`。它们散在路由里时，任何第二个调用方
 * （风格试验的批量、工坊的镜头重生成）要么照抄一遍（本仓 check-code-duplication
 * 硬闸正是要拦这个），要么少抄一道——少抄的那道不会立刻报错，只会在
 * ComfyUI 侧变成一个跟入库处对不上的错误。
 *
 * ADR 口径（P3 §5 ADR §14 D1 第二刀）：**提交只写库里那一行**，派发动作不在这里。
 * 队列只许有一份真相（库）；`kickQueue()` 只是省掉等 2s 节拍，行归对侧（host 片）时
 * 它自然空转，不与 host 抢同一行（领取谓词是 impl 里唯一的 `ownedBy()`）。
 */
export async function enqueueWorkflowTask(
  input: EnqueueTaskInput,
): Promise<EnqueuedTask> {
  const tpl = await workflowTemplateRepository.findByIdForUser(
    input.userId,
    input.workflowId,
  );
  if (!tpl) {
    throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
  }

  /* 执行载荷恒为 RAW 原件——comfy-cli 按节点类定义做权威 UI→API 转换（顺带展开子图）。
     没有内容时抛错而不是静默提交一份空图：空图到了 ComfyUI 侧变成
     「一个节点都没有」的报错，用户看不出问题其实出在入库时。 */
  if (!hasExecutableWorkflow(tpl)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "工作流没有可执行内容（rawJson 为空）：请重新导入该工作流",
    });
  }

  const referenceImages = input.referenceImages?.length
    ? input.referenceImages
    : undefined;
  const executorClaim = resolveExecutorClaim();

  const task = await taskRepository.createQueued({
    userId: input.userId,
    type: tpl.taskType,
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt,
    params: input.params,
    workflowName: tpl.name,
    projectId: input.projectId ?? null,
    shotId: input.shotId ?? null,
    referenceImages,
    claimedBy: executorClaim,
    execPayload: tpl.rawJson,
  });

  if (input.kick !== false) {
    kickQueue();
  }
  log.info(`生成任务已入队 ${task.id}`, {
    type: tpl.taskType,
    workflow: tpl.name,
  });

  return { taskId: task.id, workflowName: tpl.name, taskType: tpl.taskType };
}
