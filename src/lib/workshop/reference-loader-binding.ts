// ── 参考图装载绑定：paramMap 里 `referenceLoaders` 命名空间的读写（纯模块）──
//
// #4376：某个参考图槽位在某个模式下「用哪条装载预设」。它挂在 `paramMap`
// 列的 `referenceLoaders` 键空间下（权威形状见 `~/lib/workflow/workflow-param-map`），
// 与作者画的落点线（`source`）同列不同键：线回答「值落到哪」，这里回答
// 「这个槽位的图从哪装载」。扇出到多个端口由参考图挂载节点承担（#4547：
// 原追加端口已移除，同一张图的落点扩面用挂载节点自动接线，见
// `reference-loader-plan.ts` 的 mountImagePortsForNodes）。
//
// 纯函数、无 React、无 IO；视图（绑定编辑）与工坊载荷构造（装载计划）共用。

import { isPlainRecord } from "~/lib/is-record";
import { MODE_KEY_PREFIX } from "~/lib/workflow/workflow-param-mapping";

import type { ReferenceLoaderPreset } from "./reference-loader-preset";

/** 一个槽位的装载绑定。 */
export type ReferenceLoaderBinding = {
  /** 装载预设 id；缺省 / 预设已删 = 裸 LoadImage 直连（#4355 行为）。 */
  presetId?: string;
};

export type ReferenceLoaderBindingTable = Record<string, ReferenceLoaderBinding>;

/** 某一模式下生效的装载绑定表（`{ <槽位id>: 绑定 }`）；没有配置 → 空对象。
 *  畸形数据按「没配」处理，不把脏形状带给执行期。 */
export function referenceLoaderBindingsForMode(
  paramMap: unknown,
  mode: string | null | undefined,
): ReferenceLoaderBindingTable {
  if (!isPlainRecord(paramMap) || mode === null || mode === undefined || mode === "") {
    return {};
  }
  const namespace = paramMap.referenceLoaders;
  if (!isPlainRecord(namespace)) {
    return {};
  }
  const byMode = namespace[`${MODE_KEY_PREFIX}${mode}`];
  if (!isPlainRecord(byMode)) {
    return {};
  }
  const out: ReferenceLoaderBindingTable = {};
  for (const [slotId, value] of Object.entries(byMode)) {
    if (!isPlainRecord(value)) {
      continue;
    }
    /* 存量数据里可能残留已移除的追加端口键（#4547），读端按「没配」忽略。 */
    if (typeof value.presetId === "string" && value.presetId !== "") {
      out[slotId] = { presetId: value.presetId };
    }
  }
  return out;
}

/** 把某个槽位的绑定写回 paramMap（不可变返回；`binding: null` = 删除该槽位的绑定）。
 *
 *  只增改 `referenceLoaders` 命名空间，`source` / `output` 与其余键原样保留；
 *  模式表清空后连键一起摘掉，不留空壳。 */
export function withReferenceLoaderBinding(args: {
  /** null = 删除该槽位的绑定。 */
  binding: ReferenceLoaderBinding | null;
  mode: string;
  paramMap: unknown;
  slotId: string;
}): Record<string, unknown> {
  const { paramMap, mode, slotId, binding } = args;
  const base = isPlainRecord(paramMap) ? { ...paramMap } : {};
  const namespace = isPlainRecord(base.referenceLoaders) ? { ...base.referenceLoaders } : {};
  const modeKey = `${MODE_KEY_PREFIX}${mode}`;
  const byMode = isPlainRecord(namespace[modeKey]) ? { ...namespace[modeKey] } : {};
  if (binding === null) {
    delete byMode[slotId];
  } else {
    if (binding.presetId !== undefined && binding.presetId !== "") {
      byMode[slotId] = { presetId: binding.presetId };
    } else {
      delete byMode[slotId];
    }
  }
  if (Object.keys(byMode).length > 0) {
    namespace[modeKey] = byMode;
  } else {
    delete namespace[modeKey];
  }
  if (Object.keys(namespace).length > 0) {
    base.referenceLoaders = namespace;
  } else {
    delete base.referenceLoaders;
  }
  return base;
}

/** 参考图上限的取值边界：与工坊喂图侧的全局上限（`REFERENCE_IMAGE_MAX` = 16，
 *  #4355）对齐——工作流级的上限再低都行，再高也不超过喂图侧能给的数量。 */
export const REFERENCE_LOADER_CAP_LIMIT = 16;

/** 这条工作流实际最多使用几张参考图（**工作流级**，跨模式生效；ISSUE #4537）。
 *
 *  模式契约的参考图槽位是**按模式全局**的（如 I2I 内置两个槽位）；本配置让
 *  单条工作流在此之上有自己的容量声明。`null` = 未配置：跟随模式契约的槽位数
 *  （现状行为）。畸形数据按「没配」处理，不把脏形状带给执行期。 */
export function referenceLoaderMax(paramMap: unknown): number | null {
  if (!isPlainRecord(paramMap)) {
    return null;
  }
  const namespace = paramMap.referenceLoaders;
  if (!isPlainRecord(namespace)) {
    return null;
  }
  const value = namespace.maxReferences;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < 1 || value > REFERENCE_LOADER_CAP_LIMIT) {
    return null;
  }
  return value;
}

/** 写回「参考图上限」（不可变返回；`max: null` = 清除配置，回到跟随契约）。
 *
 *  与槽位绑定同住 `referenceLoaders` 命名空间（`maxReferences` 是命名空间级的
 *  工作流属性，不是某个槽位的绑定）；畸形值按清除处理，不留脏形状；命名空间
 *  清空后连键一起摘掉。 */
export function withReferenceLoaderMax(args: {
  /** null = 清除上限配置。 */
  max: number | null;
  paramMap: unknown;
}): Record<string, unknown> {
  const { max, paramMap } = args;
  const base = isPlainRecord(paramMap) ? { ...paramMap } : {};
  const namespace = isPlainRecord(base.referenceLoaders) ? { ...base.referenceLoaders } : {};
  if (max !== null && Number.isInteger(max) && max >= 1 && max <= REFERENCE_LOADER_CAP_LIMIT) {
    namespace.maxReferences = max;
  } else {
    delete namespace.maxReferences;
  }
  if (Object.keys(namespace).length > 0) {
    base.referenceLoaders = namespace;
  } else {
    delete base.referenceLoaders;
  }
  return base;
}

/** 参考图挂载节点（ISSUE #4534）：作者在编辑器「参考图挂载」编辑态里点选的
 *  节点。装载计划按 `image_0..N` 命名规律把参考图槽位自动接到这些节点的图片口
 *  上（见 `mountImagePortsForNodes`），不必逐口手连。未配置 / 空名单 = 没有挂载
 *  节点。畸形数据按「没配」处理，不把脏形状带给执行期。 */
export function referenceLoaderMountNodes(paramMap: unknown): ReadonlyArray<string> {
  if (!isPlainRecord(paramMap)) {
    return [];
  }
  const namespace = paramMap.referenceLoaders;
  if (!isPlainRecord(namespace)) {
    return [];
  }
  const value = namespace.mountNodeIds;
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Array<string> = [];
  for (const id of value) {
    if (typeof id === "string" && id !== "" && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/** 写回参考图挂载节点名单（不可变返回；空名单 = 清除配置）。
 *
 *  与槽位绑定 / 上限同住 `referenceLoaders` 命名空间（`mountNodeIds` 是命名空间
 *  级的工作流属性）；畸形项过滤，命名空间清空后连键一起摘掉。 */
export function withReferenceLoaderMountNodes(args: {
  nodeIds: ReadonlyArray<string>;
  paramMap: unknown;
}): Record<string, unknown> {
  const { nodeIds, paramMap } = args;
  const base = isPlainRecord(paramMap) ? { ...paramMap } : {};
  const namespace = isPlainRecord(base.referenceLoaders) ? { ...base.referenceLoaders } : {};
  const clean: Array<string> = [];
  for (const id of nodeIds) {
    if (typeof id === "string" && id !== "" && !clean.includes(id)) {
      clean.push(id);
    }
  }
  if (clean.length > 0) {
    namespace.mountNodeIds = clean;
  } else {
    delete namespace.mountNodeIds;
  }
  if (Object.keys(namespace).length > 0) {
    base.referenceLoaders = namespace;
  } else {
    delete base.referenceLoaders;
  }
  return base;
}

/** 解析后的参考图挂载节点（#4593）：id + 给人看的名字。 */
export type ReferenceMountNode = {
  id: string;
  title: string;
};

/** 装载链的一行摘要（#4869）：「装载链：LoadImage → 处理节点… → 落点」。
 *
 *  让作者在绑定页直接看到该槽位运行时会生成哪条链、落到哪个部件，
 *  不必进预设编辑器。`preset` 缺省（未配 / 已删）= 裸 LoadImage 直连；
 *  `primary` 为空（未连线）时以「未连线」收尾——与绑定行的主落点显示同口径。 */
export function referenceLoaderChainSummary(
  preset: ReferenceLoaderPreset | undefined,
  primary: string | null,
): string {
  const target = primary === null || primary === "" ? "未连线" : primary;
  if (preset === undefined) {
    return `装载链：LoadImage 直连 → ${target}`;
  }
  const steps = preset.steps.map((step) => step.class).join(" → ");
  return `装载链：LoadImage → ${steps} → ${target}`;
}

/**
 * 从 RAW 工作流图解析「参考图挂载在了哪些节点」（#4593）：把挂载节点 id 名单
 * 对到 RAW 节点的标题，供工作流库详情直接展示——不必进编辑器就能看到挂载在了
 * 什么节点。RAW 节点的 `title` 缺省时回落「类型 #id」（ComfyUI 图的 title 是
 * 可选字段）；名单里指不到的 id 保留原样返回（配置里有、图里找不到是真实现场，
 * 兜底显示比静默丢更诚实）。RAW 不是对象 / 节点缺 id 的按跳过处理。
 */
export function resolveReferenceMountNodes(args: {
  mountNodeIds: ReadonlyArray<string>;
  rawJson: unknown;
}): Array<ReferenceMountNode> {
  const { mountNodeIds, rawJson } = args;
  if (mountNodeIds.length === 0) {
    return [];
  }
  const titles = new Map<string, string>();
  if (isPlainRecord(rawJson) && Array.isArray(rawJson.nodes)) {
    for (const node of rawJson.nodes) {
      if (!isPlainRecord(node)) {
        continue;
      }
      /* RAW 节点 id 是数字，容错处理其它形状；归不出给空串 = 跳过
       * （与 workflow-update-remap 的 nodeIdOf 同一口径）。 */
      const id =
        typeof node.id === "string" ? node.id : typeof node.id === "number" ? String(node.id) : "";
      if (id === "" || titles.has(id)) {
        continue;
      }
      const type = typeof node.type === "string" && node.type !== "" ? node.type : "节点";
      titles.set(
        id,
        typeof node.title === "string" && node.title !== "" ? node.title : `${type} #${id}`,
      );
    }
  }
  return mountNodeIds.map((id) => ({ id, title: titles.get(id) ?? id }));
}
