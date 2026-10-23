// ── 工作流库工作流的服务端执行入口（工坊 / 成片工作室共用）──────────────
//
// 内置模板（txt2img / img2video 等 + `__PROMPT__` / `__SEED__` token 替换）
// 已移除：本地 ComfyUI 的每一条生成链路都以**工作流库工作流**为唯一来源。
// 视图层走 `generation-client.buildLibraryWorkflowInput` + tRPC `generate.generate`；
// 服务端编排（成片工作室 / 首帧合成 / 风格试验的矩阵扇出）没有浏览器可用的 tRPC，
// 故收在这一个模块里 —— 扇出不在这里另写一遍入队：它逐格调本函数，整批只敲一次节拍。
//
// 与视图层的唯一差别是**取工作流元数据的方式**：视图层经 `workflow.detailFull`
// 拿富化后的 workflowIO，本模块直接读仓储行。封装口径（`buildEncapsulatedInputs`）
// 与落库形状（`workflowInputs` 三元组）两边完全一致 —— 那是同一份纯函数。
import { upperToken } from "~/lib/upper-token";
import "server-only";

import {
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { parseModesJson } from "~/lib/workflow/workflow-types";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import {
  buildEncapsulatedInputs,
  type WorkshopExposedValues,
} from "./workflow-encapsulation";
import { loadModeContracts } from "./mode-contract.server";

/** 一次工作流库执行的入参：提示词 / 尺寸 / 参考图等对外参数 + 任务归属。 */
export interface RunWorkflowInput {
  userId: string;
  /** 工作流库工作流 id（`WorkflowTemplate.id`）。 */
  workflowId: string;
  /** 任务归属画布 / 工坊项目。 */
  projectId?: string | null;
  values: WorkshopExposedValues;
  /**
   * **显式指定模式**（缺省仍按工作流的 `defaultMode ?? taskType ?? modes[0]` 推导）。
   *
   * 为什么要有这一项：调用方自己带着模式的屏（风格试验存的是用户手选的就绪模式）
   * 不该被工作流的默认模式顶掉 —— 顶掉之后落点按另一个模式的契约算，出图仍会成功，
   * 用户却看不出这批跑的其实不是他选的那个模式。
   */
  mode?: string | null;
  /**
   * 写完库行后是否立刻 `kickQueue()`。默认真（单条提交不必等 2s 节拍）。
   *
   * 批量提交传 `false`，由调用方在整批写完后统一 kick 一次：逐条 kick 不会更正确，
   * 只会把派发器敲 N 遍（与 `~/server/lib/enqueue-task.ts` 同一取舍）。
   */
  kick?: boolean;
}

/** 组装对外参数并落一行排队中的任务。
 *
 *  模式：调用方传了 `input.mode` 就用它，没传才按工作流的
 *  `defaultMode ?? taskType ?? modes[0]` 推导。
 *
 *  工作流不存在 / 不属于该用户时抛错 —— 没有内置模板可回落，静默失败会
 *  变成「任务创建了但没有图」，比直接报错难查。 */
export async function createWorkflowRunTask(
  input: RunWorkflowInput,
): Promise<{
  taskId: string;
  workflowName: string;
  taskType: string;
  /** 给了值却落不到端口的契约口（调用方必须如实上屏，见 `describeUnmatchedInputs`）。 */
  unmatched: string[];
}> {
  const tpl = await workflowTemplateRepository.findByIdForUser(
    input.userId,
    input.workflowId,
  );
  if (!tpl) throw new Error(`工作流不存在：${input.workflowId}`);

  const modes = parseModesJson(tpl.modes);
  const mode =
    input.mode ?? tpl.defaultMode ?? tpl.taskType ?? modes[0] ?? null;
  const io =
    tpl.workflowIO &&
    typeof tpl.workflowIO === "object" &&
    !Array.isArray(tpl.workflowIO)
      ? (tpl.workflowIO as unknown as WorkflowIOMap)
      : {};
  /* 该模式生效的契约口清单：作者改过的模式按注册表（含自定义口），没改过的
   *  走内置默认（不传即回落）。读不到注册表时按空注册表处理 —— 回落内置契约，
   *  不阻断生成。 */
  const contracts = await loadModeContracts();
  const contractIds = contracts.find(
    (c) => c.mode === upperToken(mode),
  )?.inputs;
  const { workflowInputs, unmatched } = buildEncapsulatedInputs({
    io,
    paramMap: tpl.paramMap,
    mode,
    values: input.values,
    contractIds,
  });

  const params = {
    workflow: tpl.id,
    ...(input.values.prompt !== undefined
      ? { prompt: input.values.prompt }
      : {}),
    ...(input.values.negativePrompt !== undefined
      ? { negative: input.values.negativePrompt }
      : {}),
    ...(workflowInputs.length > 0 ? { workflowInputs } : {}),
  };

  /* 执行载荷恒为 RAW 原件 —— comfy-cli 按节点类定义做权威 UI→API 转换 +
   * 子图展开（判据收在 `hasExecutableWorkflow`，与 generate 路由同一份）。
   * 没有内容时抛错，而不是静默提交一份空图（空图会在 ComfyUI 侧变成
   * 「一个节点都没有」的报错，用户看不出是入库时就没内容）。
   *
   * 这道闸**必须在落库之前**：写在 `createQueued` 之后时，抛错那一行已经是
   * 库里的 QUEUED 任务了 —— 一次注定失败的提交仍会排进单卡串行的队列，跑到
   * 用户别的任务前面（`MAX_CONCURRENCY = 1`），而它除了失败什么都干不了。 */
  if (!hasExecutableWorkflow(tpl)) {
    throw new Error(`工作流没有可执行内容（rawJson 为空）：${tpl.name}`);
  }

  const executorClaim = resolveExecutorClaim();
  const task = await taskRepository.createQueued({
    userId: input.userId,
    type: tpl.taskType,
    prompt: input.values.prompt ?? "",
    negativePrompt: input.values.negativePrompt ?? null,
    params,
    workflowName: tpl.name,
    projectId: input.projectId ?? null,
    claimedBy: executorClaim,
    execPayload: tpl.rawJson,
  });

  /* 提交只写库里那一行（`claimedBy` 决定归谁领）——P3 §5 ADR §14 D1 第二刀：
   * 这里过去对 inline 片额外调 `enqueue()` 往进程内存队列推一份，于是「派发的
   * 真相」有两份（内存 vs 库），host 与 Next 各读各的。现在两宿主只走
   * `executor-dispatch.ts` 那一条 pull；下面这一次 kick 纯粹是**省掉等节拍**
   * （不推进行内队列），行归对侧时它自然空转、不会双执行。
   * 批量提交传 `kick: false`，由调用方在整批写完后统一敲一次。 */
  if (input.kick !== false) {
    kickQueue();
  }
  return {
    taskId: task.id,
    workflowName: tpl.name,
    taskType: tpl.taskType,
    unmatched,
  };
}
