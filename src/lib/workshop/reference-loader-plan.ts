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
import type { WorkflowImageInputPort } from "~/lib/comfyui/workflow-detail-raw";
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
  /** 全图图片族连线口（#4405）：追加端口允许落在**未暴露**的张量口上
   *  （多参考图工作流的消费口通常没被勾选暴露进 workflowIO）——那些口的
   *  nodeId / name 从这里取，不能在 `io` 暴露面里查（查不到会被静默丢）。 */
  graphImagePorts?: ReadonlyArray<WorkflowImageInputPort>;
  io: WorkflowIOMap | null;
  presets: ReadonlyArray<ReferenceLoaderPreset>;
  /** 契约槽位 id → 主落点 ioKey（null = 该槽位没连线）。 */
  resolved: Record<string, string | null>;
}): ReferenceLoaderPlanResult {
  const plan: Record<string, ReferenceLoaderPreset> = {};
  const extraInputs: Array<{ name: string; nodeId: string; value: string }> = [];
  const { bindings, filenames, io, presets, resolved, graphImagePorts } = args;
  if (!io || Object.keys(bindings).length === 0) {
    return { plan, extraInputs };
  }
  /* 目标 ioKey → 端口定位：暴露面优先，未暴露的张量口由全图候选补齐。 */
  const portById = new Map<string, { name: string; nodeId: string }>();
  for (const [ioKey, raw] of Object.entries(io)) {
    portById.set(ioKey, { name: raw.name, nodeId: runtimeNodeId(raw) });
  }
  for (const port of graphImagePorts ?? []) {
    if (!portById.has(port.ioKey)) {
      portById.set(port.ioKey, { name: port.name, nodeId: port.nodeId });
    }
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
      const port = portById.get(ioKey);
      if (!port) {
        continue;
      }
      if (preset) {
        plan[`${port.nodeId}::${port.name}`] = preset;
      }
      if (ioKey !== primary) {
        extraInputs.push({ name: port.name, nodeId: port.nodeId, value: filename });
      }
    }
  }
  return { plan, extraInputs };
}
