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
  manualTargetFor,
  resolveMapping,
} from "~/lib/workflow-param-mapping";
import {
  exposedParamDisplayLabel,
  exposedParamsForMode,
} from "~/lib/workflow-exposed-params";
import {
  builtInRequiredInputs,
  isModeContractInputId,
  type ModeContractInputId,
} from "./model-mode-contract";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

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
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  const resolved = resolveMapping(entries, io, paramMap, mode ?? null);
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
  const mapped: EncapsulationEntryStatus[] = canonical.map((slot) => {
    const manual = manualTargetFor(paramMap, slot.id, mode ?? null);
    const target = resolved[slot.id] ?? (manual !== undefined ? manual : null);
    return {
      id: slot.id,
      label: displayLabel(slot.id),
      control: slot.control,
      targetIoKey: target,
      manual: manual !== undefined && manual !== null,
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
