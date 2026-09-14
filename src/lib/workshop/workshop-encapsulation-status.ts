// ── 工作流库 → 工坊「对外参数封装」状态派生（规范 §17.2 第①层）──────────
// 回答两个问题（与实际生成链路同口径）：
//   ① 这条工作流在工坊里能不能直接用 —— 契约必备口「提示词」是否已有落点；
//   ② 工坊会用哪些控件驱动它（提示词 / 尺寸【比例 + 分辨率 · 百万像素 + 倍数】/
//      参考图…），每个口落到了哪个 IO 端口、哪些还没落（未配置必须显式可见）。
//
// 契约条目来自 workflow-exposed-params（按模式），落点解析来自
// workflow-param-mapping（自动判定 + 作者落点覆盖）——与
// buildEncapsulatedInputs / buildLibraryWorkflowInput 的执行判定同一套，
// 这里只做「状态 / 展示」派生，无 React 无 IO。

import {
  buildParamEntries,
  manualTargetFor,
  resolveMapping,
} from "~/lib/workflow-param-mapping";
import { exposedParamsForMode } from "~/lib/workflow-exposed-params";
import { modeContractInputLabel } from "~/lib/workshop/model-mode-contract";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";

/** 工坊控件形态：尺寸在工坊里是「比例 + 分辨率 / 百万像素 + 倍数」组合控件。 */
export type EncapsulationControl = "text" | "size" | "image";

export interface EncapsulationEntryStatus {
  /** 契约内稳定键（prompt / negative / size / first-frame / reference-image…）。 */
  id: string;
  /** 展示名（size 与模式契约编辑器同一份措辞，见 `modeContractInputLabel`）。 */
  label: string;
  control: EncapsulationControl;
  /** 生效落点（IO 端口键）；null = 还没落到任何端口（未配置）。 */
  targetIoKey: string | null;
  /** 落点是否由作者手工指定（区别于自动判定）。 */
  manual: boolean;
}

export interface EncapsulationStatus {
  entries: EncapsulationEntryStatus[];
  /** 契约必备口（提示词）已有落点 → 工坊可直接驱动这条工作流。 */
  ready: boolean;
  resolvedCount: number;
  /** 还没落到端口的口子名（供徽标 tooltip / 未配置提示）。 */
  missingLabels: string[];
}

/** 契约口 → 工坊控件形态。 */
function controlFor(id: string): EncapsulationControl {
  if (id === "size") return "size";
  if (
    id.startsWith("reference-image") ||
    id === "first-frame" ||
    id === "last-frame"
  ) {
    return "image";
  }
  return "text";
}

/** 展示名：size 按工坊控件的真实形态说话（与模式契约编辑器同一份措辞，
 *  单一出处 = `MODE_CONTRACT_INPUT_TYPES`；两处各写一份字符串必然漂移），
 *  其余用契约自带 label。 */
function displayLabel(id: string, label: string): string {
  if (id === "size") return modeContractInputLabel("size");
  return label;
}

/** 派生一条工作流在工坊视角下的封装状态。
 *
 *  contractEntries：模式契约注册表里该模式的口子清单（可配置）。传了就用它
 *  作为契约口径（自定义口对 buildParamEntries 不可见时，落点取作者手工覆盖
 *  manualByMode），未传回落内置契约（exposedParamsForMode）。 */
export function deriveEncapsulationStatus(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
  mode: string | null | undefined;
  contractEntries?: Array<{
    id: string;
    label: string;
    control: "text" | "size" | "image";
  }>;
}): EncapsulationStatus {
  const { io, paramMap, mode, contractEntries } = args;
  const entries = buildParamEntries(io, undefined, { mode: mode ?? null });
  const resolved = resolveMapping(entries, io, paramMap, mode ?? null);
  /* 契约口必须显式可见：工作流缺对应端口时 buildParamEntries 会整口省略，
   * 但「未配置」恰恰要在这里现形（否则用户看不到缺了什么、也不知道为什么
   * 工坊驱动不了）。按契约清单补齐缺失口（落点 null）。 */
  const canonical: Array<{ id: string; label: string; control: "text" | "size" | "image" }> =
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
      label: displayLabel(slot.id, slot.label),
      control: slot.control,
      targetIoKey: target,
      manual: manual !== undefined && manual !== null,
    };
  });
  const ordered = Array.from(
    new Map(mapped.map((e) => [e.id, e])).values(),
  );
  const resolvedCount = ordered.filter((e) => e.targetIoKey !== null).length;
  const prompt = mapped.find((e) => e.id === "prompt");  return {
    entries: ordered,
    ready: (prompt?.targetIoKey ?? null) !== null,
    resolvedCount,
    missingLabels: ordered
      .filter((e) => e.targetIoKey === null)
      .map((e) => e.label),
  };
}
