"use client";

// ── 工坊生成客户端：本地 ComfyUI 链路（API 中继见 generation-api-client）──
// 本模块**只跑在浏览器**：EventSource / fetch 都取自浏览器，工作流库与工坊
// 的视图层组件是它唯一的消费者。首行标 `"use client"` 是把这个事实写死 ——
// 既让打包器把 node 侧排除在外，也让「日志唯一通道」那条门禁
// （tests/single-logger-channel.test.ts）能把这里的 console 与**服务端**的
// 直接 console 区分开：服务端直写会绕开脱敏与 ERROR 镜像，而这里的
// console.info 正是项目规定的客户端日志口（被 LogProvider 拦截进应用日志
// 面板，规范 07 §7.6）。
// The 镜头生图 / 视频生成 stages run on one of two channels:
//   • local —— tRPC 的 generate mutation → ComfyUI 任务，经 SSE 观察
//    （与 studio 画布同一条链路：generate.generate + tasks 事件流）
//   • api   —— /api/workshop-api/generate 中继（baseUrl / apiKey 留在服务端，
//     五花八门的上游形状由 api-channel-shared 归一）—— 客户端在
//     generation-api-client.ts（#3949 需求 8 拆分），本文件尾部原样再导出。
// 这是 ShotStudio / VideoStudio / WorkshopPipeline 共用的客户端助手。
// 每份网络载荷都用 unknown 守卫收窄（不做类型断言）。

import { clampPct } from "~/lib/progress";
import { upperToken } from "~/lib/upper-token";
import { vanillaApi } from "~/trpc/vanilla";
import { fireAndForget } from "~/lib/async-action";
import { isFailedTaskStreamStatus } from "~/lib/task-state";
import type { RouterInputs } from "~/trpc/react";
import { isPlainRecord, isRecord } from "~/lib/is-record";
import { getSizePresetTable } from "~/lib/media/size-preset-store";
import type { StyleRef } from "./types";
import { extractSavedOutputs, type SavedOutput } from "./api-channel-shared";
import {
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "~/lib/workflow/workflow-exposed-params";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { buildEncapsulatedInputs, type WorkshopExposedValues } from "./workflow-encapsulation";
import {
  referenceLoaderBindingsForMode,
  referenceLoaderMax,
  referenceLoaderMountNodes,
} from "./reference-loader-binding";
import {
  buildReferenceLoaderPlan,
  mountImagePortsForNodes,
  mountReferenceCapacityOf,
} from "./reference-loader-plan";
import { deriveEncapsulationStatus } from "./workshop-encapsulation-status";

/* 本地（ComfyUI）生成 mutation 的 tRPC 传输契约。 */
export type GenerateInput = RouterInputs["generate"]["generate"];

/* 创建一个本地 ComfyUI 生成任务；resolve 出任务 id。 */
/**
 * 给一次生成补上**归属**：属于哪个项目、为哪一镜跑的。
 *
 * 为什么单独一个出口：工坊有三条按镜生成的路径（分镜段的单镜生图、镜头生图段、
 * 视频段各一条），三处都要往同一份入参上挂这一对字段。各写一遍就会各漂一次，
 * 而「这一镜出过图吗」以后只能由这两个字段回答。
 *
 * 空的 `projectId` **不写成空串**：「没有归属」与「归属是空串」在库里必须能区分，
 * 否则统计会把两者并成一类，历史行（从没写过归属的那批）也会污染结论。
 */
export function withGenerationAttribution(
  input: GenerateInput,
  attribution: { projectId?: string | null; shotId?: string | null },
): GenerateInput {
  return {
    ...input,
    ...(attribution.projectId ? { projectId: attribution.projectId } : {}),
    ...(attribution.shotId ? { shotId: attribution.shotId } : {}),
  };
}

export async function startLocalGenerate(input: GenerateInput): Promise<string> {
  const res = await vanillaApi.generate.generate.mutate(input);
  if (!res?.taskId) {
    throw new Error("本地生成任务创建失败");
  }
  return res.taskId;
}

/** 取消一个本地任务（tRPC task.cancel）：任务状态置 CANCELLED，正在观察它的
 *  SSE 会收到终态帧并落定（产物被丢弃，镜头状态回 failed + 提示「已取消」）。
 *  任务不存在 / 已结束由服务端报错，调用方把错误原样给提示条。 */
export async function cancelLocalTask(taskId: string): Promise<void> {
  await vanillaApi.task.cancel.mutate({ id: taskId });
}

/** 批量生成的并发档：本地 ComfyUI 按队列串行执行，2 = 「一条在跑、一条排队
 *  预热」，消除「上一条落定 → 再提交下一条」之间的空转；API 通道保守取 2，
 *  不试探远端限流。三个批量循环（镜头生图 / 视频生成 / 分镜批量）共用这一档。 */
export const WORKSHOP_BATCH_CONCURRENCY = 2;

/** 本地 ComfyUI 单个任务的统一安全阀（30 分钟无响应即判超时）。
 *  生图 / 视频 / 分镜批量三处的观察循环共用同一份常量 —— 哪一处漏配，
 *  批量循环就会永久卡死在一条沉默的 SSE 流上。 */
export const LOCAL_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/** 重挂载恢复要用的任务真值快照（task 表 + 已落盘产物）。
 *
 *  SSE 流对「订阅前就已终态」的任务只回放日志与一条 state 帧 —— 成功终态
 *  既不带产物也不发 done 帧（产物只随 live 的 done 帧下发），订阅一个已经
 *  成功的任务拿不到 imageUrl。所以「刷新后恢复失联任务」必须先查这份真值：
 *  已终态直接回写，仍在跑才去重订阅等 done 帧。 */
export type TaskSnapshot = {
  /** 终态失败时的原因（任务表 error 列）。 */
  error?: string;
  /** 已落盘产物（本地任务 imageUrl / clipUrl 的真值来源）。 */
  outputs: Array<SavedOutput>;
  /** 任务表里的状态原文（SUCCEEDED / FAILED / CANCELLED / RUNNING / QUEUED…）。 */
  status: string;
};

/** 查一个本地任务的状态与产物快照；任务不存在 / 查询失败返回 null
 *（调用方按「任务失联」如实收尾，不假装它还在跑）。 */
export async function fetchTaskSnapshot(taskId: string): Promise<TaskSnapshot | null> {
  try {
    const task: unknown = await vanillaApi.task.detail.query({ id: taskId });
    if (!isRecord(task)) {
      return null;
    }
    const status = task.status;
    if (typeof status !== "string" || status === "") {
      return null;
    }
    return {
      status,
      ...(typeof task.error === "string" && task.error ? { error: task.error } : {}),
      outputs: extractSavedOutputs(task.images),
    };
  } catch {
    return null;
  }
}

/** 工坊里可选的生成模式：先把工作流按「内容类别（图 / 视频）」分栏，
 *  再在栏内按具体模式（文生图 / 图生图 / 文生视频 / 图生视频…）分类。
 *  工坊按当前阶段只展示对应类别下的工作流。 */
export type WorkshopWorkflowCategory = "image" | "video";

/** 工作流库里的一个可选工作流（工坊「生成资源」下拉用）。 */
export type WorkshopWorkflowOption = {
  /** 服务端富化的内容类别（image / video / audio；未知按 image 处理）。 */
  category: WorkshopWorkflowCategory;
  /** 对外参数封装就绪：契约必备口「提示词」已有落点，工坊可直接驱动。 */
  encapsulationReady: boolean;
  id: string;
  /** 挂在条目上的模型标签（工作流库「管理模型」维护，如 z-Image）。 */
  modelTags: Array<string>;
  /** 该工作流可跑的全部模式码（taskType 常是其中的默认模式）。 */
  modes: Array<string>;
  name: string;
  /** 工作流库落库的 paramMap（含落点线与尺寸来源声明）——测试页据此判断
   *  「尺寸是否由首张参考图决定」，与封装页读同一份事实。 */
  paramMap?: Record<string, unknown>;
  taskType?: string;
};

/** 工作流列表项 → 工坊选项；字段缺失/异常时给出安全缺省。
 *
 *  类别优先取服务端富化的 typeCategory（由 taskType 在类型体系里查到），
 *  查不到则退到「模式码是否视频」。 */
function toWorkflowOption(row: Record<string, unknown>): WorkshopWorkflowOption | null {
  const id = row.id;
  const name = row.name;
  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }
  const taskType = typeof row.taskType === "string" ? row.taskType : undefined;
  const modes = Array.isArray(row.modes)
    ? row.modes.filter((mode): mode is string => typeof mode === "string")
    : [];
  const declared = row.typeCategory;
  const category: WorkshopWorkflowCategory =
    declared === "video"
      ? "video"
      : declared === "image"
        ? "image"
        : isVideoMode(taskType) || modes.some((mode) => isVideoMode(mode))
          ? "video"
          : "image";
  const modelTags = Array.isArray(row.modelTags)
    ? row.modelTags.filter((tag): tag is string => typeof tag === "string" && tag !== "")
    : [];
  const mode = row.defaultMode ?? taskType ?? modes[0] ?? null;
  const encapsulationReady = deriveEncapsulationStatus({
    io: parseWorkflowIOMap(row.workflowIO),
    paramMap: isPlainRecord(row.paramMap) ? row.paramMap : null,
    mode: typeof mode === "string" ? mode : null,
  }).ready;
  return {
    id,
    name,
    ...(taskType === undefined ? {} : { taskType }),
    category,
    modes,
    modelTags,
    encapsulationReady,
    ...(isPlainRecord(row.paramMap) ? { paramMap: row.paramMap } : {}),
  };
}

/** 拉取工作流列表，供工坊选择「用哪个工作流库工作流生成」。
 *
 *  workflow.list 的返回形状是 `{ workflows, localPending, localRoots }`
 *  （本地工作流根目录跟踪加入后，#4119）；历史上是裸数组 —— 两种形状都认，
 *  取 `workflows` 数组，否则「生成资源」与测试模型页的候选会恒为空。 */
export async function fetchWorkshopWorkflows(): Promise<Array<WorkshopWorkflowOption>> {
  const res = await vanillaApi.workflow.list.query({});
  /* `workflow.list` 的返回形状演进过（ISSUE #4119）：早期是裸数组，现在是
   * `{ workflows, localPending, localRoots }`（带本地工作流根目录跟踪字段）。
   * 两种都认、取 `workflows` 数组 —— 客户端只用得到列表本身；都不是 ⇒ 空列表
   * （调用点把空当「没有工作流」渲染空态，不抛）。 */
  const rows: unknown[] = Array.isArray(res)
    ? res
    : isRecord(res) && Array.isArray(res.workflows)
      ? res.workflows
      : [];
  const out: Array<WorkshopWorkflowOption> = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const option = toWorkflowOption(row);
    if (option) {
      out.push(option);
    }
  }
  return out;
}

/** 技能行 → 风格卡；缺字段的行**丢掉**而不是抛错 —— 少一张风格卡比整块面板
 *  空白好，且这条口在挂载期的三路拉取里，抛出去会被调用点的 catch 吞成「没有技能」。 */
function toStyleRef(row: Record<string, unknown>): StyleRef | null {
  const slug = row.slug;
  const name = row.name;
  const promptTemplate = row.promptTemplate;
  if (typeof slug !== "string" || typeof name !== "string" || typeof promptTemplate !== "string") {
    return null;
  }
  return {
    slug,
    name,
    icon: typeof row.icon === "string" ? row.icon : "✨",
    promptTemplate,
    negativePrompt: typeof row.negativePrompt === "string" ? row.negativePrompt : undefined,
    defaultParams: isRecord(row.defaultParams) ? row.defaultParams : undefined,
  };
}

/** 拉取技能（风格卡）清单。
 *
 *  口是 tRPC 的 `skill.list`，与成片工作室同一扇门 —— 内置技能种子因此只有一份
 *  （`~/lib/skills-seed`，由仓储的 `ensureBuiltIns` 落库）。
 *
 *  这里原先发的是 `fetch("/api/skills")`，而仓库里**没有这个路由**：请求必然 404，
 *  404 的 HTML 又让 `res.json()` 抛错，被调用点那句 `catch {}` 吞成「没有技能」，
 *  于是工坊的风格卡常年空态、全仓库没有一条判据红过。「客户端写的地址有没有落点」
 *  由 `tests/rest-endpoint-targets.test.ts` 钉住。 */
export async function fetchWorkshopStyles(): Promise<Array<StyleRef>> {
  const res = await vanillaApi.skill.list.query();
  const rows: unknown = res.skills;
  if (!Array.isArray(rows)) {
    return [];
  }
  const out: Array<StyleRef> = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const style = toStyleRef(row);
    if (style) {
      out.push(style);
    }
  }
  return out;
}

/** 一次封装结果 + 该工作流在库里的模式信息（供调用方按模式做提示/校验）。 */
export type LibraryWorkflowBuildResult = {
  input: GenerateInput;
  /** 本次实际使用的模式码（服务端默认模式，缺省回退 taskType / modes[0]）。 */
  mode: string | null;
  /** 该工作流可跑的全部模式码。 */
  modes: Array<string>;
  /** 用户给了值、但落不到任何端口的口（未连线 / 断开 / 端口已消失）。
   *  键是**契约口 id**（`prompt` / `size-width`…），不是工作流里的端口名。 */
  unmatched: Array<string>;
  /** 本次生成会用到首帧 / 尾帧图（按模式判定，供调用方决定要不要预传图）。 */
  usesFirstFrame: boolean;
  usesLastFrame: boolean;
};

/** 该模式**生效的契约口清单**（成品配置 + 本机覆盖合并后的注册表，含作者
 *  自定义口）。注册表读不到（接口缺失 / 查询失败）→ `undefined`，调用方回落
 *  内置默认契约 —— 生成链路不因注册表不可用而阻断。 */
async function loadEffectiveContractIds(
  mode: string | null,
): Promise<ReadonlyArray<string> | undefined> {
  try {
    const rows = await vanillaApi.llm.modeContractsGet.query();
    return rows.contracts.find((c) => c.mode === upperToken(mode))?.inputs;
  } catch {
    return undefined;
  }
}

/** 用选定的工作流库工作流封装一次生成请求。
 *
 *  ISSUE #145：工坊对外只暴露「提示词 / 尺寸 / 参考图(首帧)」，其余 IO 参数
 *  一律用工作流图内的默认值。这里拉取工作流详情（含 enrich 过的 workflowIO 与
 *  作者的连线表 `paramMap`），交给 `buildEncapsulatedInputs` 按工作流的模式码
 *  组装成 `workflowInputs` 三元组 —— **落点只认作者在库里连的线**。
 *
 *  返回的 input 可直接交给 `startLocalGenerate`；没连线 / 断开的对外口会出现在
 *  `unmatched` 里（由调用方决定是否提示用户）。 */
export async function buildLibraryWorkflowInput(
  workflowId: string,
  values: WorkshopExposedValues,
  /** 指定模式（缺省 = 工作流的默认模式）。
   *
   *  多模式工作流（文生图 / 图生图…）在**封装页签的流程测试**里要能逐个模式跑：
   *  两个模式的契约口与落点通常不同，只能测默认模式等于只能验一条链路。工坊
   *  正跑生成时仍走缺省口径（用工作流的默认模式）。 */
  requestedMode?: string | null,
  /** 该模式**生效的契约口清单**（`modeContractEntries(...)` 的 id）。
   *
   *  不传时按内置默认契约组载荷 —— 作者在「模式契约」里新增的自定义口不在
   *  其中，给它的值就落不下去（如实进 `unmatched`，不静默丢）。能拿到契约
   *  注册表的调用方（封装页签的流程测试）必须传。 */
  contractIds?: ReadonlyArray<string>,
): Promise<LibraryWorkflowBuildResult> {
  const detail = await vanillaApi.workflow.detailFull.query({ id: workflowId });
  const io = detail?.workflowIO ?? null;
  const modes = Array.isArray(detail?.availableModes)
    ? detail.availableModes.filter((mode): mode is string => typeof mode === "string")
    : [];
  const mode =
    requestedMode !== null && requestedMode !== undefined && requestedMode.trim() !== ""
      ? requestedMode
      : (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);
  /* 契约口清单（#4355）：调用方没点名时取**生效注册表**（成品配置 + 本机覆盖，
   * 含作者自定义口）里该模式那一条 —— 作者在模式契约里改过的口径（如加参考图
   * 槽）在工坊链路真的生效；注册表读不到时回落内置默认契约（不阻断生成）。
   * 封装页签的流程测试仍以显式入参优先。 */
  const effectiveContractIds = contractIds ?? (await loadEffectiveContractIds(mode));
  /* 参考图挂载节点（ISSUE #4534 / #4856）：按 image_0..N 规律展开出的参考图口
   * （按槽位序）——作者没连线的槽位自动接线到这些口上，不必逐口手连。
   * 先于封装计算：挂载容量要参与「参考图丢失」的补报判定（超出契约口数但仍在
   * 挂载容量内的参考图不算丢，见 buildEncapsulatedInputs 的 mountReferenceCapacity）。 */
  const mountPorts = mountImagePortsForNodes({
    graphImagePorts: detail?.imageInputPorts,
    mountNodeIds: referenceLoaderMountNodes(detail?.paramMap),
  });
  const { workflowInputs, unmatched, resolved } = buildEncapsulatedInputs({
    io,
    paramMap: detail?.paramMap ?? null,
    mode,
    values,
    contractIds: effectiveContractIds,
    /* 宽高按**本机生效的那份**尺寸表算（ISSUE #3972）：设置里改过的表要真的
     * 改变下发给 ComfyUI 的宽高，而不是只改界面显示。水合前的快照是默认表，
     * 与旧行为一致（不劣化）。 */
    table: getSizePresetTable(),
    mountReferenceCapacity: mountReferenceCapacityOf(mountPorts),
  });
  /* 参考图装载计划（#4376）：绑定了装载预设 / 追加端口的参考图槽位，把文件名
   * 扇出到全部目标端口，并给执行期下发「端点 → 预设」计划（计划随任务行自含）。
   * 预设清单现取一次（清单很小）；取不到 → 不下发计划，相关入口回落裸
   * LoadImage（与契约注册表取不到时回落内置契约同一口径，不阻断生成）。 */
  let finalInputs = workflowInputs;
  let referenceLoaderPlan: GenerateInput["referenceLoaderPlan"];
  const loaderBindings = referenceLoaderBindingsForMode(detail?.paramMap, mode);
  /* 参考图上限（ISSUE #4537）：装载计划的文件名与组载荷同一份截断口径——
   * 超出上限的参考图不参与装载。 */
  const referenceCap = referenceLoaderMax(detail?.paramMap);
  const cappedReferenceImages =
    referenceCap === null
      ? (values.referenceImages ?? [])
      : (values.referenceImages ?? []).slice(0, referenceCap);
  if (
    (Object.keys(loaderBindings).length > 0 || mountPorts.length > 0) &&
    cappedReferenceImages.length > 0
  ) {
    try {
      const { presets } = await vanillaApi.referenceLoader.presetsGet.query();
      const { plan, extraInputs } = buildReferenceLoaderPlan({
        bindings: loaderBindings,
        filenames: cappedReferenceImages,
        /* 挂载口常落在未暴露的张量口上（#4405）：mountImagePortsForNodes
         * 已按全图图片族连线口现收，按对象传入，本层不再查暴露面。 */
        mountPorts,
        io,
        presets,
        resolved,
      });
      if (extraInputs.length > 0) {
        finalInputs = [...workflowInputs, ...extraInputs];
      }
      if (Object.keys(plan).length > 0) {
        referenceLoaderPlan = plan;
      }
    } catch {
      /* 预设清单取不到 → 不下发计划（裸 LoadImage 兜底），不阻断生成。 */
    }
  }
  /* 尺寸**不**再带 `size`（"WxH"）兼容字段：尺寸只以「比例 + 分辨率」或
   *  「比例 + 百万像素 + 倍数」表达，逐端口落进 `workflowInputs`；
   *  目标工作流要 width/height 时由封装层按场景尺寸表现算（见
   *  `buildEncapsulatedInputs`）。历史里那一串 "768x1024" 就是这条兼容字段。 */
  const input: GenerateInput = {
    workflow: workflowId,
    ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
    ...(values.negativePrompt === undefined ? {} : { negative: values.negativePrompt }),
    ...(values.firstFrame === undefined ? {} : { firstFrame: values.firstFrame }),
    ...(values.lastFrame === undefined ? {} : { lastFrame: values.lastFrame }),
    // 视频时长：帧数走内置字段，秒数由 workflowInputs 里的时长口落下去。
    ...(values.frames === undefined ? {} : { frames: values.frames }),
    ...(finalInputs.length > 0 ? { workflowInputs: finalInputs } : {}),
    ...(referenceLoaderPlan ? { referenceLoaderPlan } : {}),
  };
  return {
    input,
    unmatched,
    mode,
    modes,
    usesFirstFrame: modeUsesFirstFrame(mode),
    usesLastFrame: modeUsesLastFrame(mode),
  };
}

/** 进度事件附带的节点级信息（ComfyUI progress 消息里的当前节点与步数）。 */
export type TaskProgressNode = {
  id: string;
  label?: string;
  max: number;
  value: number;
};

/** 一条执行步骤日志（对应项目画布 /api/tasks/:id/stream 的 `log` 帧），
 *  字段与后端 LogEntry 一致。工作流库就地运行也据此展示「执行日志」。 */
export type TaskLogEntry = {
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  src?: string;
  t: number;
};

export type TaskWatchHandlers = {
  /** 每条执行步骤日志（SSE `log` 帧）。供调用方累积展示。 */
  onLog?: (entry: TaskLogEntry) => void;
  /* 任务完成过程中，每落盘一个产物文件就回调一次。 */
  onOutput?: (output: SavedOutput) => void;
  onProgress?: (progress: number, node?: TaskProgressNode) => void;
  /* 任务到达终态时**恰好**回调一次。 */
  onSettled: (result: { message?: string; ok: boolean }) => void;
};

/* 把 SSE `log` 帧的 unknown 载荷收窄成 TaskLogEntry；收窄不了则为 null。 */
function narrowLogEntry(raw: unknown): TaskLogEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  const t = raw.t;
  const level = raw.level;
  const msg = raw.msg;
  if (typeof t !== "number" || typeof msg !== "string") {
    return null;
  }
  /* SAFETY: 类型断言已复核 */
  const validLevels = ["info", "progress", "warn", "error", "success"] as const;
  const lv = validLevels.find((v) => v === level) ?? null;
  if (!lv) {
    return null;
  }
  return {
    t,
    level: lv,
    msg,
    ...(typeof raw.src === "string" && raw.src ? { src: raw.src } : {}),
  };
}

/**
 * 订阅某任务的 SSE 流（`/api/tasks/:id/stream`），直到它尘埃落定。
 * 返回一个 closer，用于提前断掉连接（取消 / 组件卸载）。
 */
export function watchTask(taskId: string, h: TaskWatchHandlers): () => void {
  /* ── 订阅层的诊断日志 ────────────────────────────────────────────────
   *
   * 为什么要有：任务「在 ComfyUI 那边已经生成好了，界面却一直卡在生成中」
   * 这类现场，服务端日志是完整的（一路到「✓ 全部完成」），但**客户端收到
   * 了哪些帧、为什么还没落定**此前一行都没有 —— 只能靠猜。历史上真实咬过
   * 一口的缺口就是 `state` 帧的成功终态（SUCCEEDED）曾被静默跳过、只认
   * done 帧；host 执行（P3 §5 Phase 3-B1）没有进程内 done，该分支已补上
   * （见下方 state 处理的 SUCCEEDED 分支），诊断日志保留以便再出现别的
   * 「收到了却没落定」的形态时能直接指认。
   *
   * 这里只记**决策点**（订阅建立 / 收到终态帧 / 落定判定与原因 / 连接中断），
   * 不记心跳与逐帧进度，避免把面板刷屏。日志经 `LogProvider` 的 console
   * 拦截进客户端日志面板，因此只在浏览器端产生副作用，服务端不受影响。 */
  const tag = `[watchTask ${taskId.slice(0, 8)}]`;
  /* 诊断走**两条**通道：
   *   · `console.info` → `LogProvider` 的拦截把它写进应用日志面板；
   *   · `h.onLog` → 工作流库的「执行日志」弹窗时间线（`workflow-run-store`）。
   * 两个面板读的不是同一份数据，只写其一都会让用户「在看的那个面板」里
   * 恰好看不到 —— 这次卡住的现场就是执行日志弹窗里只有服务端行、客户端
   * 一行没有。`src` 标记来源，好把客户端行与服务端行分开看。 */
  const note = (msg: string) => {
    const line = `${tag} ${msg}`;
    console.info(line);
    h.onLog?.({ t: Date.now(), level: "info", msg: line, src: "client" });
  };

  const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);
  note("已订阅 SSE");
  let settled = false;
  /* `state` 帧会在每次进度变化时重复到达，同一个 status 只记一次，
   * 否则面板会被「status=RUNNING」刷屏。 */
  let lastStateStatus = "";
  const settle = (ok: boolean, message?: string) => {
    if (settled) {
      note(`重复落定被忽略（ok=${ok}）：${message ?? "无原因"}`);
      return;
    }
    settled = true;
    es.close();
    note(ok ? "落定：成功，已关闭流" : `落定：失败，已关闭流（原因：${message ?? "未提供"}）`);
    h.onSettled({ ok, message });
  };
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const msg: unknown = JSON.parse(ev.data);
      if (!isRecord(msg)) {
        return;
      }
      const type: unknown = msg.type;
      if (type === "state") {
        const p: unknown = msg.progress;
        if (typeof p === "number" && Number.isFinite(p)) {
          // 节点级信息（可选）：progress 消息里带的当前节点 id / 类别名 / 步数
          let node: TaskProgressNode | undefined;
          const rawNode: unknown = msg.node;
          if (isRecord(rawNode)) {
            const id: unknown = rawNode.id;
            const value: unknown = rawNode.value;
            const max: unknown = rawNode.max;
            const label: unknown = rawNode.label;
            if (typeof id === "string" && typeof value === "number" && typeof max === "number") {
              node = {
                id,
                value,
                max,
                ...(typeof label === "string" && label ? { label } : {}),
              };
            }
          }
          h.onProgress?.(clampPct(p), node);
        }
        // 数据库侧的实情轮询会把发射器漏掉的终态结论补发一次。
        // 终态集合（含 NOT_FOUND）读 ~/lib/task-state 的共享判据（#4606）：
        // 服务端新增终态帧值时这里不会再漏 —— 漏掉的表现是帧被丢弃、
        // 流关闭重连 404，用户看到误导性的「任务连接中断」。
        const st: unknown = msg.status;
        if (isFailedTaskStreamStatus(st)) {
          const err: unknown = msg.error;
          note(`收到 state 帧 status=${String(st)}，按失败落定`);
          settle(false, typeof err === "string" && err.trim() ? err : `任务 ${String(st)}`);
        } else if (st === "SUCCEEDED") {
          /*  成功收口走这条：终态 state 帧带 DB 的产出清单（与 TaskImage 同源，
           * 见 executor-finalize 的 `saved`）。inline 与 host 执行的任务到这里
           * 完全同形——进程内 done 帧已随 ADR §14 D1 退役，不存在「另一种宿主
           * 收不到成功」的那半边流量了。
           * 已落定时整帧跳过：产出回调不许重发（同一终态可能被轮询发两次）。 */
          if (settled) {
            return;
          }
          const outputs = extractSavedOutputs(msg.images);
          if (outputs.length === 0) {
            note("收到 state 帧 status=SUCCEEDED 但无产出，按失败落定");
            settle(false, "任务完成但没有产出文件");
            return;
          }
          note("收到 state 帧 status=SUCCEEDED，按成功落定");
          outputs.forEach((out) => h.onOutput?.(out));
          settle(true);
        } else {
          /* 非终态（QUEUED/RUNNING）与无 status 的 state 帧只刷进度、
           * 不落定；同一 status 只记一行诊断，防刷屏。 */
          const stStr = typeof st === "string" ? st : "";
          if (stStr !== lastStateStatus) {
            lastStateStatus = stStr;
            note(
              stStr
                ? `收到 state 帧 status=${stStr}，非终态不落定`
                : "收到无 status 的 state 帧，跳过",
            );
          }
        }
        return;
      }
      if (type === "log") {
        const entry = narrowLogEntry(msg.entry);
        if (entry) {
          h.onLog?.(entry);
        }
        return;
      }
      /*  这里过去还分两条分支收口 `done` / `error` 帧：那是 SSE 直接转发进程内
       *  EventEmitter 的年代（P3 §5 ADR §13-3C 之前）。流路由现在只发 `log` 与
       *  `state` 两种帧，终态一律由上面的 status 判回收口，两宿主同形。 */
    } catch {
      /* SSE 帧格式错误 —— 忽略这一条消息 */
    }
  };
  es.onerror = () => {
    /* 诊断：连接异常此前只有「彻底关闭才落定」这一条出口，中间过程不可见。
     *  EventSource 的 readyState 有三态，分别对应「重连中 / 已关闭」。 */
    note(
      es.readyState === EventSource.CLOSED ? "SSE 连接已关闭" : "SSE 连接中断，浏览器将自动重连",
    );
    // 短暂断开会自动重连；只有流真正彻底关闭才算终态。
    if (es.readyState === EventSource.CLOSED) {
      settle(false, "任务连接中断");
    }
  };
  return () => {
    if (!settled) {
      note("订阅被主动关闭（组件卸载 / 取消），未落定");
      settled = true;
    }
    es.close();
  };
}

/** 观察一个本地任务直到落定，带「无响应看门狗 + 超时对账」（#4597）。
 *
 *  旧形态是 `withTimeoutResult(new Promise(…), LOCAL_TASK_TIMEOUT_MS, …)`：
 *  定时器从订阅那一刻起跑，判的是**总时长**——健康但跑得久的长任务（长视频
 *  渲染）会在仍有进展时被误判失败，而失败后没有任何对账出口（任务其实已
 *  SUCCEEDED、产物已落盘，也只能重新生成，重复占用唯一执行槽）。
 *  这里改成**无响应看门狗**：进度 / 日志 / 产物帧都算「有响应」并续期定时器，
 *  连续 `timeoutMs` 静默才触发；触发时先查任务真值（`fetchTaskSnapshot`）
 *  对账，把快照交给 `onIdleTimeout` —— 任务其实已成功就采纳产物，只有确认
 *  仍未终态才按失败收尾。返回值是清理函数（停看门狗 + 退订 SSE），调用方
 *  提前退场（组件卸载 / 批量取消）时调用。 */
export function observeTaskUntilSettled(opts: {
  /** 看门狗触发（连续 timeoutMs 无任何帧）：`snapshot` 是任务真值（查询失败
   *  为 null），采纳产物还是按失败收尾由调用方决定；SSE 已在本 helper 内退订。 */
  onIdleTimeout: (snapshot: TaskSnapshot | null) => void;
  onLog?: (entry: TaskLogEntry) => void;
  onOutput?: (output: SavedOutput) => void;
  onProgress?: (progress: number, node?: TaskProgressNode) => void;
  onSettled: (result: { message?: string; ok: boolean }) => void;
  taskId: string;
  timeoutMs: number;
}): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closeStream: () => void = () => undefined;
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      closeStream();
      /* 对账失败已在 catch 里折成 null；onIdleTimeout 自身的异常也不冒泡——
       * 看门狗触发的收尾不该变成 unhandledRejection（fireAndForget 收口）。 */
      fireAndForget(
        fetchTaskSnapshot(opts.taskId)
          .catch(() => null)
          .then((snapshot) => {
            opts.onIdleTimeout(snapshot);
          }),
        () => undefined,
      );
    }, opts.timeoutMs);
  };
  const touch = () => {
    if (timer !== null) {
      clearTimeout(timer);
      arm();
    }
  };
  closeStream = watchTask(opts.taskId, {
    onLog: (entry) => {
      touch();
      opts.onLog?.(entry);
    },
    onOutput: (output) => {
      touch();
      opts.onOutput?.(output);
    },
    onProgress: (progress, node) => {
      touch();
      opts.onProgress?.(progress, node);
    },
    onSettled: (result) => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      opts.onSettled(result);
    },
  });
  arm();
  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    closeStream();
  };
}

// ── API 中继通道的客户端（#3949 需求 8 拆分）──────────────────────────
// 本文件只留 local（ComfyUI）链路；API 中继的客户端拆到
// generation-api-client.ts（§12.6 文件行数上限的同一刀法）。这里原样再导出，
// 既有导入方（测试页 / 工坊各视图）的导入路径不变。
export {
  apiGenerateImage,
  apiPollVideo,
  apiPreviewRequest,
  apiSubmitVideo,
  fetchApiChannels,
  pollVideoUntilDone,
  prepareLocalInputImage,
  prepareShotReferences,
  type ApiVideoSubmitResult,
  type RelayDebugSink,
} from "./generation-api-client";
