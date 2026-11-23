// ── 参考图装载计划构造（#4376，纯模块，规范 §17.2 第①层）──────────────────
//
// 工坊载荷构造的最后一步：把「槽位绑定（预设）」落到执行期计划。
// 输入是四份既有事实：
//   · bindings   —— 作者在工作流库配的绑定（`reference-loader-binding.ts`）；
//   · resolved   —— 契约槽位 → 主落点 ioKey（映射层 resolveMapping 的结果）；
//   · filenames  —— 本次生成的参考图文件名（按槽位序，已在 ComfyUI input 目录）；
//   · mountPorts —— 挂载节点按 image_0..N 规律展开出的参考图口（#4534，按序）。
// 输出：
//   · plan       —— `${nodeId}::${入口名}` → 预设定义（generate.referenceLoaderPlan）；
//   · extraInputs —— 追加端口的同值覆盖项（主落点的覆盖项由映射层已发，不重发）。
//
// 主落点没连线时，若挂载节点展开出了对应序号的模式口，则自动接线到那一口
//（#4534：多参考图工作流的消费口原本至少连一张，其余口留空等待装载）。
// 挂载口通常落在未暴露的张量口上（#4405 的候选口径），nodeId / name 由
// `mountImagePortsForNodes` 从全图图片族连线口现收后按对象传入，不必在本层再查暴露面。

import type { WorkflowImageInputPort } from "~/lib/comfyui/workflow-detail-raw";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { runtimeNodeId } from "~/lib/workflow/workflow-param-mapping";
import { findReferenceLoaderPreset, type ReferenceLoaderPreset } from "./reference-loader-preset";
import type { ReferenceLoaderBindingTable } from "./reference-loader-binding";

export type ReferenceLoaderPlanResult = {
  /** 追加端口的同值覆盖项（并进 workflowInputs 一起下发）。 */
  extraInputs: Array<{ name: string; nodeId: string; value: string }>;
  /** `${nodeId}::${入口名}` → 预设定义（空对象 = 本次没有走预设的端点）。 */
  plan: Record<string, ReferenceLoaderPreset>;
};

/** 挂载节点消费口的命名规律：末段是 `image` + 可选分隔符 + 数字
 *  （`image0` / `image_1` / `images.image_2`…，#4534 的两例实测形态）。
 *  单数口（就叫 `image` 的首帧 / 上传口）没有数字后缀，不是多参考图展开点。 */
const MOUNT_PORT_NAME_RE = /(?:^|\.)image[_-]?\d+$/i;

function mountPortOrder(name: string): number {
  const matched = /image[_-]?(?<index>\d+)$/i.exec(name);
  return matched === null ? Number.MAX_SAFE_INTEGER : Number(matched.groups?.index);
}

/** 挂载节点按 image_0..N 规律展开出的参考图口（按序；ISSUE #4534）。
 *
 *  规则：节点在挂载名单里、端口名符合上面的命名规律（数字后缀定序）。
 *  槽位按**位置**对齐：第 i 个参考图槽位 → 第 i 个模式口 —— 这类工作流原本
 *  至少连了一张参考图（通常就是 image_0，由图内既有连线供图，作者把契约
 *  槽位 0 连到供图节点），其余口留空等待装载，正好按序补位。 */
export function mountImagePortsForNodes(args: {
  graphImagePorts?: ReadonlyArray<WorkflowImageInputPort>;
  mountNodeIds: ReadonlyArray<string>;
}): Array<WorkflowImageInputPort> {
  const mountSet = new Set(args.mountNodeIds);
  const matched = (args.graphImagePorts ?? []).filter(
    (port) => mountSet.has(port.nodeId) && MOUNT_PORT_NAME_RE.test(port.name),
  );
  return [...matched].sort((a, b) => mountPortOrder(a.name) - mountPortOrder(b.name));
}

/** 挂载补位能接住的参考图**容量**：各挂载节点模式口数的最大值（#4856）。
 *
 *  一个槽位只要**有一棵**挂载节点有对应序号的口就能落（同图多口喂是加分项），
 *  所以取各节点口数的最大值，而不是求和。无挂载节点时为 0 —— 此时参考图
 *  只能走契约口，超出部分如实上报（不再静默丢图）。 */
export function mountReferenceCapacityOf(ports: ReadonlyArray<WorkflowImageInputPort>): number {
  const perNode = new Map<string, number>();
  let max = 0;
  for (const port of ports) {
    const count = (perNode.get(port.nodeId) ?? 0) + 1;
    perNode.set(port.nodeId, count);
    max = Math.max(max, count);
  }
  return max;
}

export function buildReferenceLoaderPlan(args: {
  bindings: ReferenceLoaderBindingTable;
  /** 参考图文件名（按槽位序；`reference-image` = 0，`reference-image-2` = 1…）。 */
  filenames: ReadonlyArray<string>;
  io: WorkflowIOMap | null;
  /** 挂载节点展开出的参考图口（#4534，按槽位序）：作者没给落点的槽位自动
   *  接到对应序号的口上。 */
  mountPorts?: ReadonlyArray<WorkflowImageInputPort>;
  presets: ReadonlyArray<ReferenceLoaderPreset>;
  /** 契约槽位 id → 主落点 ioKey（null = 该槽位没连线）。 */
  resolved: Record<string, string | null>;
}): ReferenceLoaderPlanResult {
  const plan: Record<string, ReferenceLoaderPreset> = {};
  const extraInputs: Array<{ name: string; nodeId: string; value: string }> = [];
  const { bindings, filenames, io, presets, resolved, mountPorts } = args;
  if (!io || (Object.keys(bindings).length === 0 && (mountPorts?.length ?? 0) === 0)) {
    return { plan, extraInputs };
  }
  /* 目标 ioKey → 端口定位：主落点走暴露面；挂载口已带 nodeId / name 按对象直取。 */
  const portById = new Map<string, { name: string; nodeId: string }>();
  for (const [ioKey, raw] of Object.entries(io)) {
    portById.set(ioKey, { name: raw.name, nodeId: runtimeNodeId(raw) });
  }
  filenames.forEach((filename, slot) => {
    if (filename === undefined || filename === "") {
      return;
    }
    const slotId = slot === 0 ? "reference-image" : `reference-image-${slot + 1}`;
    const binding = bindings[slotId];
    const preset = binding ? findReferenceLoaderPreset(presets, binding.presetId) : undefined;
    const targets = new Set<string>();
    const primary = resolved[slotId];
    if (typeof primary === "string" && primary !== "") {
      targets.add(primary);
    }
    /* 挂载节点自动接线（#4534）：作者没给这个槽位任何落点时，按序落到挂载
     * 节点展开出的 image_0..N 模式口上——这类工作流原本至少连了一张参考图，
     * 其余口留空等待装载，不必逐口手连。 */
    if (targets.size === 0) {
      /* 挂载补位按**节点内序**对齐（#4856）：第 i 个槽位喂到**每颗**挂载节点的
       * 第 i 个模式口上（同一张图喂到多个端口）。此前是扁平排序后按统一下标
       * 对齐 —— 多挂载节点时交错错位（槽位 1 落到别的节点的第一个口上）。
       * 扁平清单已按数字后缀排序，按节点分组后组内序不变。 */
      const byNode = new Map<string, Array<WorkflowImageInputPort>>();
      for (const port of mountPorts ?? []) {
        const list = byNode.get(port.nodeId) ?? [];
        list.push(port);
        byNode.set(port.nodeId, list);
      }
      for (const list of byNode.values()) {
        const mountPort = list[slot];
        if (mountPort) {
          targets.add(mountPort.ioKey);
        }
      }
    }
    for (const ioKey of targets) {
      const port = portById.get(ioKey) ?? mountPorts?.find((p) => p.ioKey === ioKey);
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
  });
  return { plan, extraInputs };
}
