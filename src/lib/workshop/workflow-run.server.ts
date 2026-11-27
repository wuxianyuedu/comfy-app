// ── 工作流库工作流的服务端执行入口（工坊 / 成片工作室共用）──────────────
//
// 内置模板（txt2img / img2video 等 + `__PROMPT__` / `__SEED__` token 替换）
// 已移除：本地 ComfyUI 的每一条生成链路都以**工作流库工作流**为唯一来源。
// 视图层走 `generation-client.buildLibraryWorkflowInput` + tRPC `generate.generate`；
// 服务端编排（成片工作室 / 首帧合成）没有浏览器可用的 tRPC，故收在这一个模块里。
//
// 与视图层的取数差一步：视图层经 `workflow.detailFull` 拿富化后的 workflowIO
//（COMBO 候选来自 object_info）；本模块读仓储行后再把富化的 `options` 拷回来
//（ISSUE #5137），否则尺寸口只能拿到 `"16:9"` 短标签、被 ComfyUI 拒收。
// 身份字段（nodeId / name / direction / kind）一律以库行为准 —— 落点由作者连线决定。
// 封装口径（`buildEncapsulatedInputs`）与落库形状（`workflowInputs` 三元组）两边一致。
import { upperToken } from "~/lib/upper-token";
import { createLogger } from "~/lib/core/logger";
import { errorText } from "~/lib/error-message";
import { buildWorkflowDetailFull } from "~/lib/comfyui/workflow-detail";
import "server-only";

const log = createLogger("workshop:run");

import { taskRepository, workflowTemplateRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { parseModesJson } from "~/lib/workflow/workflow-types";
import { parseWorkflowIOMap, type WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { loadSizePresetTable } from "~/lib/media/size-preset-fs.server";
import type { SizePresetTable } from "~/lib/media/size-presets";
import { buildEncapsulatedInputs, type WorkshopExposedValues } from "./workflow-encapsulation";
import { loadModeContracts } from "./mode-contract.server";

/** 一次工作流库执行的入参：提示词 / 尺寸 / 参考图等对外参数 + 任务归属。 */
export type RunWorkflowInput = {
  /** 任务归属画布 / 工坊项目。 */
  projectId?: string | null;
  userId: string;
  values: WorkshopExposedValues;
  /** 工作流库工作流 id（`WorkflowTemplate.id`）。 */
  workflowId: string;
};

/** 一次工作流执行的**封装现场**：模板行 + 预解析的 IO / 模式 / 契约口 / 尺寸表。
 *  元数据解析与磁盘读取（契约注册表 / 尺寸表）只做一次，逐镜复用 —— 整季批量
 *  生成（series-generation）与单次服务端编排共用同一份封装链。 */
export type WorkflowRunContext = {
  /** 该模式**生效的契约口清单**（成品配置 + 本机覆盖；读不到注册表时 undefined
   *  = 回落内置契约，与 `createWorkflowRunTask` 旧口径一致）。 */
  contractIds?: ReadonlyArray<string>;
  /** 模板行的 workflowIO 解析结果（封装换算的落点表）。 */
  io: WorkflowIOMap;
  /** 生效模式（工作流默认模式，缺省回退 taskType / modes[0]）。 */
  mode: string | null;
  /** 本机生效的尺寸预设表（宽高换算按它查，ISSUE #3972）。 */
  sizeTable: SizePresetTable;
  /** 工作流库模板行（rawJson / paramMap / taskType 等的权威来源）。 */
  tpl: NonNullable<Awaited<ReturnType<typeof workflowTemplateRepository.findByIdForUser>>>;
};

/** 解析一次工作流执行的封装现场；工作流不存在 / 不属于该用户时返回 **null**
 *  （抛什么错由调用方决定：tRPC 路由抛 NOT_FOUND，服务端编排抛 Error）。 */
export async function prepareWorkflowRun(
  userId: string,
  workflowId: string,
): Promise<WorkflowRunContext | null> {
  const tpl = await workflowTemplateRepository.findByIdForUser(userId, workflowId);
  if (!tpl) {
    return null;
  }
  const modes = parseModesJson(tpl.modes);
  const mode = tpl.defaultMode ?? tpl.taskType ?? modes[0] ?? null;
  const io = parseWorkflowIOMap(tpl.workflowIO);
  /* COMBO 候选（aspect_ratio / size-resolution / size-multiple）的唯一权威是
   * ComfyUI 的 object_info，保存工作流时不可能落库。服务端此前直接用库里那份
   * 无 options 的 IO → 派值落成短标签 → ComfyUI 静默回落第一个候选。这里借
   * 视图层同一份富化派生（30s 缓存），**只拷 options**：富化会丢 IMAGEUPLOAD
   * 条目、会规范化 nodeId，整体替换会改掉作者的落点。 */
  try {
    const detail = await buildWorkflowDetailFull(userId, workflowId);
    for (const [key, entry] of Object.entries(io)) {
      const enriched = detail.workflowIO[key];
      if (enriched && Array.isArray(enriched.options) && enriched.options.length > 0) {
        io[key] = { ...entry, options: enriched.options };
      }
    }
  } catch (error) {
    /* 富化失败（ComfyUI 离线 / 派生异常）：不阻断入队，按库里的 IO 原样回落。 */
    log.warn("COMBO 候选富化失败，按库里 workflowIO 回落", {
      workflowId,
      err: errorText(error, "富化失败"),
    });
  }
  const contracts = await loadModeContracts();
  const contractIds = contracts.find((c) => c.mode === upperToken(mode))?.inputs;
  const sizeTable = await loadSizePresetTable();
  return { contractIds, io, mode, sizeTable, tpl };
}

/** 按封装现场把一次执行的对外值折算成任务行 `params`（workflow + prompt/negative
 *  + workflowInputs）。与视图层 `buildLibraryWorkflowInput` 的落库形状一致 ——
 *  背后是同一份纯函数 `buildEncapsulatedInputs`，落点只认作者连的线。 */
export function buildWorkflowRunParams(
  ctx: WorkflowRunContext,
  values: WorkshopExposedValues,
): Record<string, unknown> {
  const { workflowInputs } = buildEncapsulatedInputs({
    io: ctx.io,
    paramMap: ctx.tpl.paramMap,
    mode: ctx.mode,
    values,
    contractIds: ctx.contractIds,
    table: ctx.sizeTable,
  });
  return {
    workflow: ctx.tpl.id,
    ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
    ...(values.negativePrompt === undefined ? {} : { negative: values.negativePrompt }),
    ...(workflowInputs.length > 0 ? { workflowInputs } : {}),
  };
}

/** 把一次服务端编排的生成请求落成任务行：封装现场 → 逐值折算 params → 可执行
 *  预检 → createQueued → kick。工坊 / 成片工作室共用的单次入口（逐镜批量走
 *  `prepareWorkflowRun` + `buildWorkflowRunParams` 后自管入队守卫）。
 *
 *  工作流不存在 / 不属于该用户时抛错 —— 没有内置模板可回落，静默失败会
 *  变成「任务创建了但没有图」，比直接报错难查。 */
export async function createWorkflowRunTask(
  input: RunWorkflowInput,
): Promise<{ taskId: string; taskType: string; workflowName: string }> {
  const ctx = await prepareWorkflowRun(input.userId, input.workflowId);
  if (!ctx) {
    throw new Error(`工作流不存在：${input.workflowId}`);
  }
  const params = buildWorkflowRunParams(ctx, input.values);

  const executorClaim = resolveExecutorClaim();
  /* 执行载荷恒为 RAW 原件 —— comfy-cli 按节点类定义做权威 UI→API 转换 +
   * 子图展开（判据收在 `hasExecutableWorkflow`，与 generate 路由同一份）。
   * 没有内容时抛错，而不是静默提交一份空图（空图会在 ComfyUI 侧变成
   * 「一个节点都没有」的报错，用户看不出是入库时就没内容）。
   * **先校验、后建行**（#4022，与 generate 路由同序）：此前先 createQueued
   * 再校验，空 rawJson 会先留下一条 QUEUED 行、调用方拿到 throw 却还没走到
   * markQueued 挂镜头——orchestrator 的 cancelTask 补偿覆盖不到这一段，任务成
   * 孤儿（仅 reaper 兜底），多耗一次派发。 */
  if (!hasExecutableWorkflow(ctx.tpl)) {
    throw new Error(`工作流没有可执行内容（rawJson 为空）：${ctx.tpl.name}`);
  }
  const task = await taskRepository.createQueued({
    userId: input.userId,
    type: ctx.tpl.taskType,
    prompt: input.values.prompt ?? "",
    negativePrompt: input.values.negativePrompt ?? null,
    params,
    workflowName: ctx.tpl.name,
    projectId: input.projectId ?? null,
    claimedBy: executorClaim,
    execPayload: ctx.tpl.rawJson,
  });
  /* 提交只写库里那一行（`claimedBy` 决定归谁领）——P3 §5 ADR §14 D1 第二刀：
   * 这里过去对 inline 片额外调 `enqueue()` 往进程内存队列推一份，于是「派发的
   * 真相」有两份（内存 vs 库），host 与 Next 各读各的。现在两宿主只走
   * `executor-dispatch.ts` 那一条 pull；下面这一次 kick 纯粹是**省掉等节拍**
   * （不推进行内队列），行归对侧时它自然空转、不会双执行。 */
  kickQueue();
  return { taskId: task.id, workflowName: ctx.tpl.name, taskType: ctx.tpl.taskType };
}
