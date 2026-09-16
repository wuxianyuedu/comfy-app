// ── 工作流库工作流的服务端执行入口（工坊 / 成片工作室共用）──────────────
//
// 内置模板（txt2img / img2video 等 + `__PROMPT__` / `__SEED__` token 替换）
// 已移除：本地 ComfyUI 的每一条生成链路都以**工作流库工作流**为唯一来源。
// 视图层走 `generation-client.buildLibraryWorkflowInput` + tRPC `generate.generate`；
// 服务端编排（成片工作室 / 首帧合成）没有浏览器可用的 tRPC，故收在这一个模块里。
//
// 与视图层的唯一差别是**取工作流元数据的方式**：视图层经 `workflow.detailFull`
// 拿富化后的 workflowIO，本模块直接读仓储行。封装口径（`buildEncapsulatedInputs`）
// 与落库形状（`workflowInputs` 三元组）两边完全一致 —— 那是同一份纯函数。
import "server-only";

import {
  taskRepository,
  workflowTemplateRepository,
} from "@/lib/core/repository";
import { enqueue } from "@/lib/comfyui/enqueue";
import { parseModesJson } from "@/lib/workflow-types";
import type { WorkflowIOMap } from "@/lib/workflow-io-types";
import {
  buildEncapsulatedInputs,
  type WorkshopExposedValues,
} from "./workflow-encapsulation";

/** 一次工作流库执行的入参：提示词 / 尺寸 / 参考图等对外参数 + 任务归属。 */
export interface RunWorkflowInput {
  userId: string;
  /** 工作流库工作流 id（`WorkflowTemplate.id`）。 */
  workflowId: string;
  /** 任务归属画布 / 工坊项目。 */
  projectId?: string | null;
  values: WorkshopExposedValues;
}

/** 按工作流的默认模式（缺省回退 taskType / modes[0]）组装对外参数。
 *
 *  工作流不存在 / 不属于该用户时抛错 —— 没有内置模板可回落，静默失败会
 *  变成「任务创建了但没有图」，比直接报错难查。 */
export async function createWorkflowRunTask(
  input: RunWorkflowInput,
): Promise<{ taskId: string; workflowName: string; taskType: string }> {
  const tpl = await workflowTemplateRepository.findByIdForUser(
    input.userId,
    input.workflowId,
  );
  if (!tpl) throw new Error(`工作流不存在：${input.workflowId}`);

  const modes = parseModesJson(tpl.modes);
  const mode = tpl.defaultMode ?? tpl.taskType ?? modes[0] ?? null;
  const io =
    tpl.workflowIO &&
    typeof tpl.workflowIO === "object" &&
    !Array.isArray(tpl.workflowIO)
      ? (tpl.workflowIO as unknown as WorkflowIOMap)
      : {};
  const { workflowInputs } = buildEncapsulatedInputs(io, mode, input.values);

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

  const task = await taskRepository.createQueued({
    userId: input.userId,
    type: tpl.taskType,
    prompt: input.values.prompt ?? "",
    negativePrompt: input.values.negativePrompt ?? null,
    params,
    workflowName: tpl.name,
    projectId: input.projectId ?? null,
  });

  /* Raw UI 图（comfy-cli 展开子图）与 API 图两条路径，与 generate 路由同一判据：
   * 有 rawJson 才能让 comfy-cli 做 UI→API 转换；否则用库里已拆平的 graph。 */
  if (tpl.rawJson) {
    enqueue({
      taskId: task.id,
      rawJson: tpl.rawJson,
      overrides: workflowInputs,
    });
  } else {
    enqueue({
      taskId: task.id,
      prompt: buildPromptFromGraph(tpl.graph, workflowInputs),
    });
  }
  return { taskId: task.id, workflowName: tpl.name, taskType: tpl.taskType };
}

/** 已在库里拆平的 API 图：回填 workflowInputs 的三元组值。
 *
 *  `graph` 是 API 格式（nodeId → { class_type, inputs }），与
 *  `buildCustomWorkflow` 吃的是同一种形状；这里只做「按 nodeId + name 写回」，
 *  不重跑提示词 / 采样器自动注入（对外封装已经把该给的值都给了）。 */
function buildPromptFromGraph(
  graph: unknown,
  overrides: { nodeId: string; name: string; value: unknown }[],
): Record<string, unknown> {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return {};
  const out = JSON.parse(JSON.stringify(graph)) as Record<
    string,
    { inputs?: Record<string, unknown> }
  >;
  for (const it of overrides) {
    const node = out[it.nodeId];
    if (!node?.inputs || it.value === undefined) continue;
    const current = node.inputs[it.name];
    node.inputs[it.name] =
      typeof current === "number" &&
      typeof it.value === "string" &&
      it.value.trim() !== "" &&
      !Number.isNaN(Number(it.value))
        ? Number(it.value)
        : it.value;
  }
  return out;
}
