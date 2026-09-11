"use client";

/* ── 对外参数映射的编排层（规范 §17.2 第②层）──
 *
 * 编辑器把「对外参数 → 节点端口」的连线模型接到画布上时，需要四样东西：
 *   ① 连线状态（作者画的线优先于默认连线状态）与「当前选中哪个对外参数」；
 *   ② 从已打开的画布端口拖出的即时连线；
 *   ③ 保存时把线合进 paramMap（source 命名空间）+ 校验（防一个端口被两口占用）；
 *   ④ 视图拿这些状态渲染对外参数节点与连线。
 *
 * 纯函数（聚类 / 默认连线状态 / 校验 / 序列化）都在 `~/lib/workflow-param-mapping`，
 * 这里只做状态与持久化编排。
 *
 * 连线**必须**在某模式下画：没有选中模式时 `connect` / `disconnect` 是空操作，
 * 画布上也不提供连线手柄（见 §5 的「没有模式禁止连线」）。每条线落库写作
 * `source.mode:<模式>`，不存在脱离模式的手工线。 */

import { useCallback, useMemo, useState } from "react";
import {
  applyParamMapping,
  autoMapEntries,
  buildParamEntries,
  buildSourceOverrides,
  clearModeWiring,
  hasManualWiring,
  isDefaultMapping,
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
  /** 默认连线状态（作者画的线之外的兜底）。 */
  auto: Record<string, string | null>;
  /** 当前模式；为空时画布不提供连线能力。 */
  mode: string | null;
  /** 当前模式是否允许编辑连线（有模式才有归属）。 */
  canWire: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** 该对外参数在当前模式下是否被作者改过线。 */
  isManual: (id: string) => boolean;
  /** 当前模式下是否有任何被改过的线（画布级「恢复默认」的可用性依据）。 */
  hasManual: boolean;
  /** 在当前模式下画一条线到某个端口；null = 断开该模式下的线。 */
  connect: (id: string, ioKey: string | null) => void;
  /** 撤销某个对外参数在当前模式下的线，回到默认连线状态。 */
  resetToAuto: (id: string) => void;
  /** 撤销当前模式下的全部线（「恢复默认」）。 */
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
  /** 当前模式（工作流 defaultMode）；为空时禁止连线。 */
  mode: string | null | undefined;
  /** 工作流模板的 paramMap 原始列（含 `source` 命名空间下的连线）。 */
  paramMap: Record<string, unknown>;
}

/** 对外参数映射的状态 + 持久化编排。 */
export function useParamMapping({
  io,
  mode,
  paramMap,
}: UseParamMappingArgs): ParamMappingController {
  const activeMode = mode ?? null;
  /* paramMap 是外部事实源（GET 恢复 / 保存回写）。本地 overlay 只在作者这一轮
   * 编辑里累积线，避免每连一条就整体 PATCH 一次。 */
  const persisted = useMemo(() => parseParamMapping(paramMap), [paramMap]);
  const [overlay, setOverlay] = useState<ParamMapping>({ manualByMode: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => buildParamEntries(io), [io]);
  const auto = useMemo(() => autoMapEntries(entries, io), [entries, io]);

  /* 本地 overlay 覆盖已落库的那一份（键空间与落库同构：模式 → 条目 → 目标）。 */
  const manualByModeMerged = useMemo(() => {
    const out: Record<string, Record<string, string | null>> = {};
    for (const source of [persisted.manualByMode ?? {}, overlay.manualByMode ?? {}]) {
      for (const [modeKey, byEntry] of Object.entries(source)) {
        out[modeKey] = { ...(out[modeKey] ?? {}), ...byEntry };
      }
    }
    return out;
  }, [persisted, overlay]);

  const merged = useMemo<ParamMapping>(
    () => ({
      manualByMode: manualByModeMerged,
      auto,
      labels: { ...(persisted.labels ?? {}), ...(overlay.labels ?? {}) },
    }),
    [manualByModeMerged, auto, persisted, overlay]
  );

  const resolved = useMemo(
    () => resolveMapping(entries, io, merged, activeMode),
    [entries, io, merged, activeMode]
  );

  const isManual = useCallback(
    (id: string) => manualTargetFor(merged, id, activeMode) !== undefined,
    [merged, activeMode]
  );

  /** 在当前模式下写入一条线；没有模式时是空操作（连线必须有归属）。 */
  const writeManual = useCallback(
    (id: string, ioKey: string | null) => {
      if (!activeMode) return;
      setOverlay((prev) => {
        const byMode = { ...(prev.manualByMode ?? {}) };
        byMode[activeMode] = { ...(byMode[activeMode] ?? {}), [id]: ioKey };
        return { ...prev, manualByMode: byMode };
      });
    },
    [activeMode]
  );

  const clearManual = useCallback(
    (id: string) => {
      if (!activeMode) return;
      setOverlay((prev) => {
        const byMode = { ...(prev.manualByMode ?? {}) };
        const next = { ...(byMode[activeMode] ?? {}) };
        delete next[id];
        if (Object.keys(next).length > 0) byMode[activeMode] = next;
        else delete byMode[activeMode];
        return { ...prev, manualByMode: byMode };
      });
    },
    [activeMode]
  );

  /* 「恢复默认」＝ 清掉当前模式的全部线。本地 overlay 与已落库的那一份一起清，
   *  否则 overlay 里刚画的一条会在下一帧把已删除的线复活。 */
  const resetAll = useCallback(() => {
    setOverlay((prev) => clearModeWiring(prev, activeMode));
  }, [activeMode]);

  const validate = useCallback(
    () => validateMapping(entries, io, merged, activeMode),
    [entries, io, merged, activeMode]
  );

  /* 保存时把线并入 paramMap：以调用方给的最新 paramMap 为底稿（它会带上
   *  paramMap 里的其它命名空间，如 positiveNode），再叠加 source。 */
  const withMapping = useCallback(
    (base: Record<string, unknown>) => serializeParamMapping(merged, base),
    [merged]
  );

  return {
    entries,
    resolved,
    auto,
    mode: activeMode,
    canWire: !!activeMode,
    selectedId,
    setSelectedId,
    isManual,
    hasManual: hasManualWiring(merged, activeMode),
    connect: writeManual,
    resetToAuto: clearManual,
    resetAll,
    mapping: merged,
    validate,
    withMapping,
  };
}

/** 映射合法性校验（保存前）：防连到不存在的端口、防同一端口被多个对外参数
 *  占用。返回人话级的 problem 列表。 */
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

/** 某个对外参数在当前模式下是否仍是默认连线状态（画布行尾徽标 / 「恢复默认」用）。 */
export { applyParamMapping, buildSourceOverrides, isDefaultMapping };
