"use client";

// ── 工坊生成客户端：本地 ComfyUI 链路 + API 中继 ───────────────────────
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
//     五花八门的上游形状由 api-channel-shared 归一）
// 这是 ShotStudio / VideoStudio / WorkshopPipeline 共用的客户端助手。
// 每份网络载荷都用 unknown 守卫收窄（不做类型断言）。

import { clampPct } from "~/lib/progress";
import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";
import { isRecord } from "~/lib/is-record";
import type { Character } from "./types";
import {
  extractSavedOutputs,
  type ApiChannelView,
  type ApiChannelsView,
  type SavedOutput,
} from "./api-channel-shared";
import {
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "~/lib/workflow/workflow-exposed-params";
import {
  buildEncapsulatedInputs,
  type WorkshopExposedValues,
} from "./workflow-encapsulation";
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

export async function startLocalGenerate(
  input: GenerateInput,
): Promise<string> {
  const res = await vanillaApi.generate.generate.mutate(input);
  if (!res?.taskId) throw new Error("本地生成任务创建失败");
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
export interface TaskSnapshot {
  /** 任务表里的状态原文（SUCCEEDED / FAILED / CANCELLED / RUNNING / QUEUED…）。 */
  status: string;
  /** 终态失败时的原因（任务表 error 列）。 */
  error?: string;
  /** 已落盘产物（本地任务 imageUrl / clipUrl 的真值来源）。 */
  outputs: SavedOutput[];
}

/** 查一个本地任务的状态与产物快照；任务不存在 / 查询失败返回 null
 *（调用方按「任务失联」如实收尾，不假装它还在跑）。 */
export async function fetchTaskSnapshot(
  taskId: string,
): Promise<TaskSnapshot | null> {
  try {
    const task: unknown = await vanillaApi.task.detail.query({ id: taskId });
    if (!isRecord(task)) return null;
    const status = task.status;
    if (typeof status !== "string" || status === "") return null;
    return {
      status,
      ...(typeof task.error === "string" && task.error
        ? { error: task.error }
        : {}),
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
export interface WorkshopWorkflowOption {
  id: string;
  name: string;
  taskType?: string;
  /** 服务端富化的内容类别（image / video / audio；未知按 image 处理）。 */
  category: WorkshopWorkflowCategory;
  /** 该工作流可跑的全部模式码（taskType 常是其中的默认模式）。 */
  modes: string[];
  /** 挂在条目上的模型标签（工作流库「管理模型」维护，如 z-Image）。 */
  modelTags: string[];
  /** 对外参数封装就绪：契约必备口「提示词」已有落点，工坊可直接驱动。 */
  encapsulationReady: boolean;
}

/** 工作流列表项 → 工坊选项；字段缺失/异常时给出安全缺省。
 *
 *  类别优先取服务端富化的 typeCategory（由 taskType 在类型体系里查到），
 *  查不到则退到「模式码是否视频」。 */
function toWorkflowOption(
  row: Record<string, unknown>,
): WorkshopWorkflowOption | null {
  const id = row.id;
  const name = row.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
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
    ? row.modelTags.filter(
        (tag): tag is string => typeof tag === "string" && tag !== "",
      )
    : [];
  const mode = row.defaultMode ?? taskType ?? modes[0] ?? null;
  const encapsulationReady = deriveEncapsulationStatus({
    io: (row.workflowIO ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["io"],
    paramMap: (row.paramMap ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["paramMap"],
    mode: typeof mode === "string" ? mode : null,
  }).ready;
  return {
    id,
    name,
    ...(taskType !== undefined ? { taskType } : {}),
    category,
    modes,
    modelTags,
    encapsulationReady,
  };
}

/** 拉取工作流列表，供工坊选择「用哪个工作流库工作流生成」。 */
export async function fetchWorkshopWorkflows(): Promise<
  WorkshopWorkflowOption[]
> {
  const res = await vanillaApi.workflow.list.query({});
  const rows: unknown = res;
  if (!Array.isArray(rows)) return [];
  const out: WorkshopWorkflowOption[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const option = toWorkflowOption(row);
    if (option) out.push(option);
  }
  return out;
}

/** 一次封装结果 + 该工作流在库里的模式信息（供调用方按模式做提示/校验）。 */
export interface LibraryWorkflowBuildResult {
  input: GenerateInput;
  /** 用户给了值、但落不到任何端口的口（未连线 / 断开 / 端口已消失）。
   *  键是**契约口 id**（`prompt` / `size-width`…），不是工作流里的端口名。 */
  unmatched: string[];
  /** 本次实际使用的模式码（服务端默认模式，缺省回退 taskType / modes[0]）。 */
  mode: string | null;
  /** 该工作流可跑的全部模式码。 */
  modes: string[];
  /** 本次生成会用到首帧 / 尾帧图（按模式判定，供调用方决定要不要预传图）。 */
  usesFirstFrame: boolean;
  usesLastFrame: boolean;
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
  contractIds?: readonly string[],
): Promise<LibraryWorkflowBuildResult> {
  const detail = await vanillaApi.workflow.detailFull.query({ id: workflowId });
  const io = detail?.workflowIO ?? null;
  const modes = Array.isArray(detail?.availableModes)
    ? detail.availableModes.filter(
        (mode): mode is string => typeof mode === "string",
      )
    : [];
  const mode =
    requestedMode && requestedMode.trim() !== ""
      ? requestedMode
      : (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);
  const { workflowInputs, unmatched } = buildEncapsulatedInputs({
    io,
    paramMap: detail?.paramMap ?? null,
    mode,
    values,
    contractIds,
  });
  /* 尺寸**不**再带 `size`（"WxH"）兼容字段：尺寸只以「比例 + 分辨率」或
   *  「比例 + 百万像素 + 倍数」表达，逐端口落进 `workflowInputs`；
   *  目标工作流要 width/height 时由封装层按场景尺寸表现算（见
   *  `buildEncapsulatedInputs`）。历史里那一串 "768x1024" 就是这条兼容字段。 */
  const input: GenerateInput = {
    workflow: workflowId,
    ...(values.prompt !== undefined ? { prompt: values.prompt } : {}),
    ...(values.negativePrompt !== undefined
      ? { negative: values.negativePrompt }
      : {}),
    ...(values.firstFrame !== undefined
      ? { firstFrame: values.firstFrame }
      : {}),
    ...(values.lastFrame !== undefined ? { lastFrame: values.lastFrame } : {}),
    // 视频时长：帧数走内置字段，秒数由 workflowInputs 里的时长口落下去。
    ...(values.frames !== undefined ? { frames: values.frames } : {}),
    ...(workflowInputs.length > 0 ? { workflowInputs } : {}),
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
export interface TaskProgressNode {
  id: string;
  label?: string;
  value: number;
  max: number;
}

/** 一条执行步骤日志（对应项目画布 /api/tasks/:id/stream 的 `log` 帧），
 *  字段与后端 LogEntry 一致。工作流库就地运行也据此展示「执行日志」。 */
export interface TaskLogEntry {
  t: number;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  src?: string;
}

export interface TaskWatchHandlers {
  onProgress?: (progress: number, node?: TaskProgressNode) => void;
  /** 每条执行步骤日志（SSE `log` 帧）。供调用方累积展示。 */
  onLog?: (entry: TaskLogEntry) => void;
  /* 任务完成过程中，每落盘一个产物文件就回调一次。 */
  onOutput?: (output: SavedOutput) => void;
  /* 任务到达终态时**恰好**回调一次。 */
  onSettled: (result: { ok: boolean; message?: string }) => void;
}

/* 把 SSE `log` 帧的 unknown 载荷收窄成 TaskLogEntry；收窄不了则为 null。 */
function narrowLogEntry(raw: unknown): TaskLogEntry | null {
  if (!isRecord(raw)) return null;
  const t = raw.t;
  const level = raw.level;
  const msg = raw.msg;
  if (typeof t !== "number" || typeof msg !== "string") return null;
  const validLevels = ["info", "progress", "warn", "error", "success"] as const;
  const lv = validLevels.find((v) => v === level) ?? null;
  if (!lv) return null;
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
    note(
      ok
        ? "落定：成功，已关闭流"
        : `落定：失败，已关闭流（原因：${message ?? "未提供"}）`,
    );
    h.onSettled({ ok, message });
  };
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const msg: unknown = JSON.parse(ev.data);
      if (!isRecord(msg)) return;
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
            if (
              typeof id === "string" &&
              typeof value === "number" &&
              typeof max === "number"
            ) {
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
        if (type === "state") {
          // 数据库侧的实情轮询会把发射器漏掉的终态结论补发一次。
          const st: unknown = msg.status;
          if (st === "FAILED" || st === "CANCELLED" || st === "ERROR") {
            const err: unknown = msg.error;
            note(`收到 state 帧 status=${st}，按失败落定`);
            settle(
              false,
              typeof err === "string" && err.trim() ? err : `任务 ${st}`,
            );
          } else if (st === "SUCCEEDED") {
            /*  成功收口走这条：终态 state 帧带 DB 的产出清单（与 TaskImage 同源，
             * 见 executor-finalize 的 `saved`）。inline 与 host 执行的任务到这里
             * 完全同形——进程内 done 帧已随 ADR §14 D1 退役，不存在「另一种宿主
             * 收不到成功」的那半边流量了。
             * 已落定时整帧跳过：产出回调不许重发（同一终态可能被轮询发两次）。 */
            if (settled) return;
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
        }
        return;
      }
      if (type === "log") {
        const entry = narrowLogEntry(msg.entry);
        if (entry) h.onLog?.(entry);
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
      es.readyState === EventSource.CLOSED
        ? "SSE 连接已关闭"
        : "SSE 连接中断，浏览器将自动重连",
    );
    // 短暂断开会自动重连；只有流真正彻底关闭才算终态。
    if (es.readyState === EventSource.CLOSED) settle(false, "任务连接中断");
  };
  return () => {
    if (!settled) {
      note("订阅被主动关闭（组件卸载 / 取消），未落定");
      settled = true;
    }
    es.close();
  };
}

// ── API 中继通道 ──────────────────────────────────────────────────────

/* 从中继错误信封里取出可读信息
 *（形如 `{ error: string }`，或鉴权失败时的 `{ error: { message } }`）。 */
function relayErrorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    const err: unknown = data.error;
    if (typeof err === "string" && err) return err;
    if (isRecord(err)) {
      const msg: unknown = err.message;
      if (typeof msg === "string" && msg) return msg;
    }
  }
  return `API 请求失败 (${status})`;
}

/**
 * 中继（`/api/workshop-api/generate`）的响应载荷：服务协议约定 `res.ok` 时
 * body 一定是一个 JSON 对象；解析失败或形状不符 → `null`。三个 caller 各自
 * 决定「拿到 null 时是抛错还是降级」（生图 / 提交视频：抛；轮询：返回
 * `{ pending: true }`）。
 */
type RelayResponse = Record<string, unknown> | null;

/** API 中继的统一请求上限。远端生图 / 生视频本身就可能要几分钟（10 分钟与
 *  视频轮询的 deadline 同量纲），但一个真挂死的连接不该让 UI 无限 busy ——
 *  到点 abort，调用方拿到一句可行动的中文报错。 */
const RELAY_TIMEOUT_MS = 10 * 60 * 1000;

async function postRelay(
  body: Record<string, unknown>,
): Promise<RelayResponse> {
  let res: Response;
  try {
    res = await fetch("/api/workshop-api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    /* AbortSignal.timeout 的到点是 TimeoutError（浏览器主动 abort 是
     * AbortError）：翻译成可行动的中文，别让控制台的英文 DOMException
     * 原样进错误条。 */
    if (
      e instanceof DOMException &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    ) {
      throw new Error(
        "API 通道请求超时（10 分钟无响应），请检查通道地址或稍后重试",
      );
    }
    throw e;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new Error(relayErrorMessage(data, res.status));
  // 「res.ok 但 body 不是对象」——以前是三个 caller 各自 `isRecord(data)` 前奏，
  // 现在这一层判据只写一次；null 交给 caller 决定抛错还是降级。
  return isRecord(data) ? data : null;
}

/* API 通道：一次性图片生成 → 返回可用的图片 URL。
 * 当 `model` 传的是设置页里的远端模型名（remoteModel 表）时，服务端按该条目的
 * 连接参数生图；不传则回落到工坊 API 通道设置（旧行为）。 */
export async function apiGenerateImage(req: {
  prompt: string;
  negative?: string;
  size?: string;
  /** 设置页配置的远端模型名（remoteModel 表按名取连接参数） */
  model?: string;
  /** 工坊模式码（T2I / I2I / …）：远端模型有该模式适配器时按它翻译字段 */
  mode?: string;
  /** 统一输入：宽高比（如 "16:9"）/ 百万像素（如 "1.5"）/ 宽高对齐倍数 / 输入图。
   *  三者合起来就是工坊的「比例 + 百万像素 + 倍数」尺寸表达 —— 选「分辨率」时
   *  由调用方（`shotSizeToRelay`）换算后再传，不把 "1k" 这种档位名丢给远端。 */
  aspectRatio?: string;
  megapixels?: string;
  multiple?: number;
  image?: string;
}): Promise<string> {
  const data = await postRelay({
    kind: "image",
    prompt: req.prompt,
    negative: req.negative,
    size: req.size,
    ...(req.model ? { model: req.model } : {}),
    ...(req.mode ? { mode: req.mode } : {}),
    ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
    ...(req.megapixels ? { megapixels: req.megapixels } : {}),
    ...(req.multiple !== undefined ? { multiple: req.multiple } : {}),
    ...(req.image ? { image: req.image } : {}),
  });
  const url =
    data && typeof data.url === "string" && data.url ? data.url : null;
  if (!url) throw new Error("API 生图响应中未找到图片 URL");
  return url;
}

export interface ApiVideoSubmitResult {
  /* 上游同步返回时给出的成品视频 URL。 */
  url?: string;
  /* 否则用 apiPollVideo 轮询的异步任务 id。 */
  remoteTaskId?: string;
}

/* API 通道：提交一个（图生）视频任务。 */
export async function apiSubmitVideo(req: {
  prompt: string;
  negative?: string;
  /* 参考首帧（任何可解析的来源都行：/generated/… 、data URL、http）。 */
  image?: string;
  frames?: number;
  fps?: number;
}): Promise<ApiVideoSubmitResult> {
  const data = await postRelay({
    kind: "video",
    prompt: req.prompt,
    negative: req.negative,
    image: req.image,
    frames: req.frames,
    fps: req.fps,
  });
  if (!data) throw new Error("API 视频响应格式错误");
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  const remoteTaskId =
    typeof data.remoteTaskId === "string" && data.remoteTaskId
      ? data.remoteTaskId
      : undefined;
  if (!url && !remoteTaskId)
    throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
  return { url, remoteTaskId };
}

/* API 通道：对异步视频任务做一次轮询。 */
export async function apiPollVideo(
  remoteTaskId: string,
): Promise<{ url?: string; pending: boolean }> {
  const data = await postRelay({ kind: "video", remoteTaskId });
  if (!data) return { pending: true };
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  return { url, pending: !url };
}

/* 把生成出/参考用的图片上传进本机 ComfyUI 的 input 目录，
 * 好让视频工作流的 LoadImage 节点能消费它；返回文件名。 */
export async function prepareLocalInputImage(image: string): Promise<string> {
  const res = await fetch("/api/workshop-local/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  const filename =
    isRecord(data) && typeof data.filename === "string" && data.filename
      ? data.filename
      : null;
  if (!res.ok || !filename) {
    throw new Error(
      !res.ok ? relayErrorMessage(data, res.status) : "参考图准备失败",
    );
  }
  return filename;
}

/* 定妆照 URL → 已上传文件名的会话内缓存：批量生成时同一镜的同一张定妆照
 * 会随每个镜头反复请求，缓存让 ComfyUI 输入目录里不再为同一张图堆 N 份副本。 */
const portraitRefCache = new Map<string, string>();
/** 缓存上限：超过就整表清掉（定妆照数量有限，正常到不了）。 */
const PORTRAIT_REF_CACHE_MAX = 32;

/** 收集镜头相关角色的**已选定定妆照**，上传进 ComfyUI 输入目录，
 *  作为本次镜头生图的参考图（`referenceImages` 的值）。
 *
 *  流程口径（docs/guides/feature-workshop-flow.md §4）：定妆照就是「后续分镜图
 *  的参考图基准」。参考图口吃的是**已上传文件的文件名**，所以逐张经
 *  `prepareLocalInputImage` 上传；单张失败不拖垮整次生成 —— 跳过并计入
 *  `failedCount`，由调用方决定是否提示（降级不得静默，规范 10 §10.3.1）。
 *
 *  顺序按 `characterIds`（分镜里的角色出场序）。内置默认契约只有两个参考图槽
 *  （reference-image / -2），超过两张的定妆照落不进端口，这里截到两张、
 *  不做无效上传。没有角色选了定妆照 → 空数组，调用方不给这个口。 */
export async function preparePortraitReferences(
  characters: Character[],
  characterIds: readonly string[],
): Promise<{ files: string[]; failedCount: number }> {
  const urls = characterIds
    .map((id) => characters.find((c) => c.id === id)?.portraitUrl)
    .filter((url): url is string => typeof url === "string" && url !== "")
    .slice(0, 2);
  const files: string[] = [];
  let failedCount = 0;
  for (const url of urls) {
    const cached = portraitRefCache.get(url);
    if (cached) {
      files.push(cached);
      continue;
    }
    try {
      const filename = await prepareLocalInputImage(url);
      if (portraitRefCache.size >= PORTRAIT_REF_CACHE_MAX) {
        portraitRefCache.clear();
      }
      portraitRefCache.set(url, filename);
      files.push(filename);
    } catch {
      failedCount += 1;
    }
  }
  return { files, failedCount };
}

function narrowChannel(v: unknown, fallbackPath: string): ApiChannelView {
  const rec = isRecord(v) ? v : {};
  return {
    configured: rec.configured === true,
    baseUrl: typeof rec.baseUrl === "string" ? rec.baseUrl : "",
    path: typeof rec.path === "string" && rec.path ? rec.path : fallbackPath,
    model: typeof rec.model === "string" ? rec.model : "",
    hasApiKey: rec.hasApiKey === true,
  };
}

/* 两个 API 通道的脱敏视图；配置服务不可用时为 null
 *（调用方把 null 当作「未配置」，并弹出设置面板）。 */
export async function fetchApiChannels(): Promise<ApiChannelsView | null> {
  try {
    const res = await fetch("/api/workshop-api/config");
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const channels = isRecord(data) ? data.channels : undefined;
    if (!isRecord(channels)) return null;
    return {
      image: narrowChannel(channels.image, "/images/generations"),
      video: narrowChannel(channels.video, "/videos/generations"),
    };
  } catch {
    return null;
  }
}
