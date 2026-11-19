// ── 参考图装载计划构造（#4376，纯模块，规范 §17.2 第①层）──────────────────
//
// 工坊载荷构造的最后一步：把「槽位绑定（预设 + 追加端口）」落到执行期计划。
// 输入是三份既有事实：
//   · bindings   —— 作者在工作流库配的绑定（`reference-loader-binding.ts`）；
//   · resolved   —— 契约槽位 → 主落点 ioKey（映射层 resolveMapping 的结果）；
//   · filenames  —— 本次生成的参考图文件名（按槽位序，已在 ComfyUI input 目录）。
// 输出：
//   · plan       —— `${nodeId}::${入口名}` → 预设定义（generate.referenceLoaderPlan）；
//   · extraInputs —— 追加端口的同值覆盖项（主落点的覆盖项由映射层已发，不重发）。
//
// 主落点没连线（作者只配了追加端口）时，追加端口就是全部落点，照常发覆盖项。

import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { runtimeNodeId } from "~/lib/workflow/workflow-param-mapping";
import { referenceSlotOf } from "./workflow-encapsulation";
import { findReferenceLoaderPreset, type ReferenceLoaderPreset } from "./reference-loader-preset";
import type { ReferenceLoaderBindingTable } from "./reference-loader-binding";

export type ReferenceLoaderPlanResult = {
  /** 追加端口的同值覆盖项（并进 workflowInputs 一起下发）。 */
  extraInputs: Array<{ name: string; nodeId: string; value: string }>;
  /** `${nodeId}::${入口名}` → 预设定义（空对象 = 本次没有走预设的端点）。 */
  plan: Record<string, ReferenceLoaderPreset>;
};

export function buildReferenceLoaderPlan(args: {
  bindings: ReferenceLoaderBindingTable;
  /** 参考图文件名（按槽位序；`reference-image` = 0，`reference-image-2` = 1…）。 */
  filenames: ReadonlyArray<string>;
  io: WorkflowIOMap | null;
  presets: ReadonlyArray<ReferenceLoaderPreset>;
  /** 契约槽位 id → 主落点 ioKey（null = 该槽位没连线）。 */
  resolved: Record<string, string | null>;
}): ReferenceLoaderPlanResult {
  const plan: Record<string, ReferenceLoaderPreset> = {};
  const extraInputs: Array<{ name: string; nodeId: string; value: string }> = [];
  const { bindings, filenames, io, presets, resolved } = args;
  if (!io || Object.keys(bindings).length === 0) {
    return { plan, extraInputs };
  }
  for (const [slotId, binding] of Object.entries(bindings)) {
    const slot = referenceSlotOf(slotId);
    if (slot < 0) {
      continue;
    }
    const filename = filenames[slot];
    if (filename === undefined || filename === "") {
      continue;
    }
    const preset = findReferenceLoaderPreset(presets, binding.presetId);
    const targets = new Set<string>();
    const primary = resolved[slotId];
    if (typeof primary === "string" && primary !== "") {
      targets.add(primary);
    }
    for (const target of binding.extraTargets ?? []) {
      targets.add(target);
    }
    for (const ioKey of targets) {
      const raw = io[ioKey];
      if (!raw) {
        continue;
      }
      const nodeId = runtimeNodeId(raw);
      const name = raw.name;
      if (preset) {
        plan[`${nodeId}::${name}`] = preset;
      }
      if (ioKey !== primary) {
        extraInputs.push({ nodeId, name, value: filename });
      }
    }
  }
  return { plan, extraInputs };
}
