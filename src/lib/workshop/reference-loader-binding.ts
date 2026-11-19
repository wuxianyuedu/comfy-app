// ── 参考图装载绑定：paramMap 里 `referenceLoaders` 命名空间的读写（纯模块）──
//
// #4376：某个参考图槽位在某个模式下「用哪条装载预设、额外再喂给哪些端口」。
// 它挂在 `paramMap` 列的 `referenceLoaders` 键空间下（权威形状见
// `~/lib/workflow/workflow-param-map`），与作者画的落点线（`source`）同列不同键：
// 线回答「值落到哪」，这里回答「这个槽位的图从哪装载、还要扇出到哪」。
//
// 纯函数、无 React、无 IO；视图（绑定编辑）与工坊载荷构造（装载计划）共用。

import { isPlainRecord } from "~/lib/is-record";
import { MODE_KEY_PREFIX } from "~/lib/workflow/workflow-param-mapping";

/** 一个槽位的装载绑定。 */
export type ReferenceLoaderBinding = {
  /** 追加的喂给端口（ioKey 列表）：同一张参考图除主落点外还要到达的端口。 */
  extraTargets?: Array<string>;
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
    const binding: ReferenceLoaderBinding = {};
    if (typeof value.presetId === "string" && value.presetId !== "") {
      binding.presetId = value.presetId;
    }
    if (Array.isArray(value.extraTargets)) {
      const targets = value.extraTargets.filter(
        (t): t is string => typeof t === "string" && t !== "",
      );
      if (targets.length > 0) {
        binding.extraTargets = targets;
      }
    }
    if (binding.presetId !== undefined || binding.extraTargets !== undefined) {
      out[slotId] = binding;
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
    const clean: ReferenceLoaderBinding = {};
    if (binding.presetId !== undefined && binding.presetId !== "") {
      clean.presetId = binding.presetId;
    }
    if (binding.extraTargets !== undefined && binding.extraTargets.length > 0) {
      clean.extraTargets = [...binding.extraTargets];
    }
    if (clean.presetId !== undefined || clean.extraTargets !== undefined) {
      byMode[slotId] = clean;
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
