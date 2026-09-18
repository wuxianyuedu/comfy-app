// ── 工作流库 → 工坊「对外参数封装」状态派生（规范 §17.2 第①层）──────────
// 回答两个问题（与实际生成链路同口径）：
//   ① 这条工作流在工坊里能不能直接用 —— **该模式的必备口**是否都已有落点；
//   ② 工坊会用哪些控件驱动它（提示词 / 尺寸【比例 + 分辨率 / 比例 + 百万像素 +
//      倍数】/ 参考图…），每个口落到了哪个 IO 端口、哪些还没落（未配置必须显式可见）。
//
// 「哪些口必备」随**模式契约**走（`ModeContract.required`，在「模式契约」编辑器里
// 勾选），不是代码里写死某一个 id —— 用户口径是「哪个是必备的应该能配」。
//
// 契约条目来自 workflow-exposed-params（按模式），落点解析来自
// workflow-param-mapping（**只认作者画的线**）——与
// buildEncapsulatedInputs / buildLibraryWorkflowInput 的执行判定同一套，
// 这里只做「状态 / 展示」派生，无 React 无 IO。

import {
  buildParamEntries,
  isSizeDetermined,
  manualTargetFor,
  parseParamMapping,
  resolveMapping,
  SIZE_SUB_IDS,
} from "~/lib/workflow/workflow-param-mapping";
import {
  exposedParamDisplayLabel,
  exposedParamsForMode,
} from "~/lib/workflow/workflow-exposed-params";
import {
  builtInRequiredInputs,
  isModeContractInputId,
  type ModeContractInputId,
} from "./model-mode-contract";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

/** 工坊控件形态：尺寸在工坊里是「比例 + 分辨率 / 比例 + 百万像素 + 倍数」组合控件，
 *  时长是秒数选择。 */
export type EncapsulationControl = "text" | "size" | "image" | "duration";

export interface EncapsulationEntryStatus {
  /** 契约内稳定键（prompt / negative / size / first-frame / reference-image…）。 */
  id: string;
  /** 展示名（size 与模式契约编辑器同一份措辞，见 `modeContractInputLabel`）。 */
  label: string;
  control: EncapsulationControl;
  /** 生效落点（IO 端口键）；null = 还没落到任何端口（未配置）。 */
  targetIoKey: string | null;
  /** 落点是否由作者画过线（库里所有落点都来自作者画的线）。 */
  manual: boolean;
}

export interface EncapsulationStatus {
  entries: EncapsulationEntryStatus[];
  /** **该模式的必备口全部已有落点** → 工坊可直接驱动这条工作流。
   *
   *  必备口随模式契约配置（见 `ModeContract.required`）；没配任何必备口的模式
   *  恒为 ready（没有「缺了它就不能用」的口）。 */
  ready: boolean;
  /** 还没落到端口的必备口名（徽标 tooltip / 未配置提示用）。
   *  未配置的非必备口不算「不能跑」，不在这里 —— 那是提示，不是闸门。 */
  missingRequired: string[];
  /** 还没落到端口的**全部**口子名（含非必备），供「未配置」清单一览。 */
  missingLabels: string[];
  resolvedCount: number;
}

/** 契约口 → 工坊控件形态。 */
function controlFor(id: string): EncapsulationControl {
  if (id === "size") return "size";
  if (id === "duration") return "duration";
  if (
    id.startsWith("reference-image") ||
    id === "first-frame" ||
    id === "last-frame"
  ) {
    return "image";
  }
  return "text";
}

/** 展示名：一律以契约 id 取**统一的那一份**展示名（`exposedParamDisplayLabel`），
 *  不认契约自带 label。
 *
 *  自带 label 有两个坑：① 它可能来自**用户自定义契约**（措辞由用户当次输入，
 *  与内置口径能差到认不出是同一个口）；② 契约表里「尺寸」只写「尺寸」，而工坊
 *  控件是「比例 + 分辨率 / (百万像素 + 倍数)」的组合控件，只写两个字用户答不出
 *  该填什么（ISSUE #596：同一页面两处对不上）。 */
function displayLabel(id: string): string {
  return exposedParamDisplayLabel(id);
}

/** 派生一条工作流在工坊视角下的封装状态。
 *
 *  contractEntries：模式契约注册表里该模式的口子清单（可配置）。传了就用它
 *  作为契约口径，未传回落内置契约（`exposedParamsForMode`）。
 *
 *  requiredInputs：该模式的**必备口**（同样可配置，见 `ModeContract.required`）。
 *  未传时回落内置默认（提示词）。「能不能用」= 这些口是否都有落点。 */
export function deriveEncapsulationStatus(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
  contractEntries?: Array<{
    id: string;
    label: string;
    control: EncapsulationControl;
  }>;
  requiredInputs?: readonly string[];
}): EncapsulationStatus {
  const { io, paramMap, mode, contractEntries, requiredInputs } = args;
  /* 调用方（封装面板 / 库列表 / 生成前预检）传的是**存库原始形状**
   *  （`{ source: { "mode:X": {…} } }`），而下游 `resolveMapping` /
   *  `manualTargetFor` 只认解析后的 `ParamMapping` —— 没有这一次解析，落点
   *  一个都读不到（每个契约口都被读成「未配置」、`ready` 恒 false）。
   *  `parseParamMapping` 对畸形 / 空值也返回空表，不会抛。 */
  const mapping = parseParamMapping(paramMap);
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  const resolved = resolveMapping(entries, io, mapping, mode ?? null);
  /* 契约口必须显式可见：工作流缺对应端口时 buildParamEntries 会整口省略，
   * 但「未配置」恰恰要在这里现形（否则用户看不到缺了什么、也不知道为什么
   * 工坊驱动不了）。按契约清单补齐缺失口（落点 null）。 */
  const canonical: Array<{
    id: string;
    label: string;
    control: EncapsulationControl;
  }> =
    contractEntries ??
    exposedParamsForMode(mode ?? null).map((d) => ({
      id: d.id,
      label: d.label,
      control: controlFor(d.id),
    }));
  /* 「尺寸」在映射层是四个子口（宽 / 高 / 宽高比 / 像素量 / 分辨率档，见
   *  workflow-param-mapping 的 `SIZE_SUB_IDS`）：**能定出宽高**才算配置完成
   *  （宽+高，或 比例+（像素量 / 分辨率档））—— 只连一个子口解不出另一维，
   *  工坊那边跑不起来，这里就如实显示成未配置。 */
  /* 逐子口取落点：本函数两个调用方（封装面板 / 生成前的预检）传的都是**存库原始
   *  形状**的 paramMap，而 `resolved` 只认已解析的映射表 —— 所以这里走
   *  `manualTargetFor`（它自己解析），`resolved` 只作补充（调用方已解析时更快）。 */
  const sizeWired: Record<string, string | null | undefined> = {};
  for (const id of SIZE_SUB_IDS) {
    sizeWired[id] = resolved[id] ?? manualTargetFor(mapping, id, mode ?? null);
  }
  const sizeDetermined = isSizeDetermined(sizeWired);
  const sizeSubTarget = (): string | null => {
    for (const id of SIZE_SUB_IDS) {
      const hit = sizeWired[id];
      if (hit) return hit;
    }
    return null;
  };
  const mapped: EncapsulationEntryStatus[] = canonical.map((slot) => {
    const manual = manualTargetFor(mapping, slot.id, mode ?? null);
    const isSizeSlot = slot.id === "size";
    const target = isSizeSlot
      ? sizeDetermined
        ? (sizeSubTarget() ?? manual ?? null)
        : null
      : (resolved[slot.id] ?? (manual !== undefined ? manual : null));
    return {
      id: slot.id,
      label: displayLabel(slot.id),
      control: slot.control,
      targetIoKey: target,
      manual: isSizeSlot
        ? target !== null
        : manual !== undefined && manual !== null,
    };
  });
  const ordered = Array.from(new Map(mapped.map((e) => [e.id, e])).values());
  const resolvedCount = ordered.filter((e) => e.targetIoKey !== null).length;
  /* 必备口：调用方给了就用它的（来自模式契约），没给回落内置默认。只保留
   * 契约里真的存在、且**有落点判定意义**的口 —— 契约里没有的口不该出现在
   *  「缺了它不能跑」的清单里（那份提示会指着一个用户看不见的口）。 */
  const contractIds = new Set(ordered.map((e) => e.id));
  const required = (
    requiredInputs ??
    builtInRequiredInputs(
      ordered
        .map((e) => e.id)
        .filter((id): id is ModeContractInputId => isModeContractInputId(id)),
    )
  ).filter((id) => contractIds.has(id));
  const missingRequired = ordered
    .filter((e) => required.includes(e.id) && e.targetIoKey === null)
    .map((e) => e.label);
  /* 「尺寸」另有一条判据：定不出宽高就不许跑（见 `isSizeDetermined`）。缺的这一
   * 项要出现在「缺了它不能跑」的清单里，否则用户看到的是一个「看起来配好了」
   * 的尺寸口，跑起来却拿不到宽高。 */
  const sizeSlot = ordered.find((e) => e.id === "size");
  if (
    sizeSlot &&
    !sizeDetermined &&
    !missingRequired.includes(sizeSlot.label)
  ) {
    missingRequired.push(sizeSlot.label);
  }
  return {
    entries: ordered,
    ready: missingRequired.length === 0,
    missingRequired,
    resolvedCount,
    missingLabels: ordered
      .filter((e) => e.targetIoKey === null)
      .map((e) => e.label),
  };
}
