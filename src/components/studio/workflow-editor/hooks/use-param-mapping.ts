"use client";

/* ── 对外参数映射的编排层（规范 §17.2 第②层）──
 *
 * 编辑器把「对外参数 → 节点端口」的连线模型接到画布上时，需要四样东西：
 *   ① 连线状态（手工线优先于自动映射）与「当前选中哪个对外参数」；
 *   ② 从已经打开的画布端口拖出的即时连线；
 *   ③ 保存时把连线合进 paramMap（source 命名空间）+ 校验（防环 / 一源多口）；
 *   ④ 视图拿这些状态渲染左侧「对外参数」栏。
 *
 * 纯函数（聚类 / 自动映射 / 校验 / 序列化）都在 `~/lib/workflow-param-mapping`，
 * 这里只做状态与持久化编排。 */

import { useCallback, useMemo, useState } from "react";
import {
  applyParamMapping,
  autoMapEntries,
  buildParamEntries,
  buildSourceOverrides,
  manualTargetFor,
  parseParamMapping,
  resolveMapping,
  serializeParamMapping,
  type ParamEntry,
  type ParamMapping,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

export interface ParamMappingController {
  entries: ParamEntry[];
  /** 当前模式下生效的「对外参数 id → 目标 ioKey」。 */
  resolved: Record<string, string | null>;
  /** 自动映射的默认连线状态（作者手工线之外的兜底）。 */
  auto: Record<string, string | null>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** 该对外参数是否被作者手工改过连线。 */
  isManual: (id: string) => boolean;
  /** 手工连线到某个端口（来自画布上的拖拽）；null = 断开连线。 */
  connect: (id: string, ioKey: string | null) => void;
  /** 撤销某个对外参数的手工线，回到自动映射。 */
  resetToAuto: (id: string) => void;
  /** 撤销当前模式的全部手工线。 */
  resetAll: () => void;
  /** 合入本轮编辑后的完整映射（保存时序列化进 paramMap.source）。 */
  mapping: ParamMapping;
  /** 保存前把映射并入 paramMap；校验不过是空数组。 */
  validate: () => { ok: boolean; problems: string[] };
  /** 带映射的 paramMap（保存 / 拖拽落盘共用）。 */
  withMapping: (base: Record<string, unknown>) => Record<string, unknown>;
}

export interface UseParamMappingArgs {
  workflowId: string;
  io: WorkflowIOMap | null | undefined;
  mode: string | null | undefined;
  /** 工作流模板的 paramMap 原始列（含 `source` 命名空间下的连线映射）。 */
  paramMap: Record<string, unknown>;
}

/** 对外参数映射的状态 + 持久化编排。 */
export function useParamMapping({
  io,
  mode,
  paramMap,
}: UseParamMappingArgs): ParamMappingController {
  /* paramMap 是外部事实源（GET 恢复 / 保存回写）。本地 overlay 只在作者这一轮
   * 编辑里累积手工线，避免每连一条就整体 PATCH 一次。 */
  const persisted = useMemo(() => parseParamMapping(paramMap), [paramMap]);
  const [overlay, setOverlay] = useState<ParamMapping>({ manual: {}, manualByMode: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => buildParamEntries(io), [io]);
  const auto = useMemo(() => autoMapEntries(entries, io), [entries, io]);

  /* 通用层与按模式层分别合并（键空间都是 entryId → 目标/模式表），
   *  本地 overlay 覆盖已落库的那一份。 */
  const manualMerged = useMemo(
    () => ({ ...(persisted.manual ?? {}), ...(overlay.manual ?? {}) }),
    [persisted, overlay]
  );
  const manualByModeMerged = useMemo(
    () => ({
      ...(persisted.manualByMode ?? {}),
      ...(overlay.manualByMode ?? {}),
    }),
    [persisted, overlay]
  );

  const merged = useMemo<ParamMapping>(
    () => ({
      manual: manualMerged,
      manualByMode: manualByModeMerged,
      labels: { ...(persisted.labels ?? {}), ...(overlay.labels ?? {}) },
    }),
    [manualMerged, manualByModeMerged, persisted, overlay]
  );

  const resolved = useMemo(
    () => resolveMapping(entries, io, merged, mode),
    [entries, io, merged, mode]
  );

  const isManual = useCallback(
    (id: string) => manualTargetFor(merged, id, mode ?? null) !== undefined,
    [merged, mode]
  );

  /** 写入一个手工线（带模式时只覆盖该模式）。 */
  const writeManual = useCallback(
    (id: string, ioKey: string | null) => {
      setOverlay((prev) => {
        if (!mode) {
          return { ...prev, manual: { ...(prev.manual ?? {}), [id]: ioKey } };
        }
        /* 按模式层：`{ [entryId]: { [mode]: ioKey } }`（与落库形状同构）。 */
        const byMode = { ...(prev.manualByMode ?? {}) };
        byMode[id] = { ...(byMode[id] ?? {}), [mode]: ioKey };
        return { ...prev, manualByMode: byMode };
      });
    },
    [mode]
  );

  const clearManual = useCallback(
    (id: string) => {
      setOverlay((prev) => {
        if (!mode) {
          const manual = { ...(prev.manual ?? {}) };
          delete manual[id];
          return { ...prev, manual };
        }
        const byMode = { ...(prev.manualByMode ?? {}) };
        const next = { ...(byMode[id] ?? {}) };
        delete next[mode];
        if (Object.keys(next).length > 0) byMode[id] = next;
        else delete byMode[id];
        return { ...prev, manualByMode: byMode };
      });
    },
    [mode]
  );

  return {
    entries,
    resolved,
    auto,
    selectedId,
    setSelectedId,
    isManual,
    connect: writeManual,
    resetToAuto: clearManual,
    resetAll: () => setOverlay({ manual: {}, manualByMode: {} }),
    mapping: merged,
    validate: () => validateMapping(entries, io, merged, mode),
    /* 保存时把连线并入 paramMap：以调用方给的最新 paramMap 为底稿（它会
     *  带上 paramMap 里的其它命名空间，如 positiveNode），再叠加 source。 */
    withMapping: (base) => serializeParamMapping(merged, base),
  };
}

/** 映射合法性校验（保存前）：防自环、防一个对外参数连到不存在的端口、
 *  防同一端口被多个对外参数占用。返回人话级的 problem 列表。 */
export function validateMapping(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
  mapping: ParamMapping,
  mode?: string | null
): { ok: boolean; problems: string[] } {
  const resolved = resolveMapping(entries, io, mapping, mode);
  const problems: string[] = [];
  const owner = new Map<string, string>();
  for (const entry of entries) {
    const target = resolved[entry.id];
    if (!target) continue;
    if (!io?.[target]) {
      problems.push(`「${entry.label}」连到了一个不存在的端口（${target}）`);
      continue;
    }
    const prev = owner.get(target);
    if (prev && prev !== entry.id) {
      const other = entries.find((item) => item.id === prev);
      problems.push(
        `端口「${target}」被「${other?.label ?? prev}」与「${entry.label}」同时占用`
      );
      continue;
    }
    owner.set(target, entry.id);
  }
  return { ok: problems.length === 0, problems };
}

export { applyParamMapping, buildSourceOverrides };
