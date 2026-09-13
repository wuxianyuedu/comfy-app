"use client";

/* ── 工作流库画布预览的「对外参数映射」编辑编排（规范 §17.2 第②层）──
 *
 * 库里这份映射与编辑器画布上的**同一份事实**（`paramMap.source.mode:<模式>`），
 * 用户在库里也要能改（ISSUE #355：「连线要能编辑，现在编辑不了」）。这一层负责：
 *   ① 拖线手势的落点解析（命中哪一行，等价于 React Flow 的 onConnect）；
 *   ② 一次编辑的落库编排（patch paramMap），本地叠加一层 overlay 立即回读；
 *   ③ 「恢复默认」：清掉该对外参数在当前模式下的手工线。
 *
 * 落库形状由 `~/lib/workflow-param-wiring` 给出（纯函数，与编辑器同一份）。
 * 视图只消费这里返回的 controller：不碰 tRPC、不解析映射。 */

import { useCallback, useMemo, useState } from "react";

import {
  applyWireEdit,
  clearWireEdit,
  hasWireEdit,
  type ParamWireEdit,
} from "~/lib/workflow-param-wiring";

export interface ParamWiringController {
  /** 当前生效模式；没有模式时编辑无从归属，写入是空操作。 */
  mode: string | null;
  /** 这个对外参数在当前模式下是否被作者改过（含显式断开）。 */
  isManual: (entryId: string) => boolean;
  /** 拖线落上：把某个对外参数连到 ioKey（写入后立即回读）。 */
  connect: (entryId: string, ioKey: string) => void;
  /** 断开：该对外参数在这个模式下显式断线（不再回到自动判定）。 */
  disconnect: (entryId: string) => void;
  /** 恢复默认：撤销该对外参数在当前模式下的手工线。 */
  resetToAuto: (entryId: string) => void;
  /** **生效的 paramMap** = 已落库的那一份叠上本轮本地改动。
   *
   *  卡片列与连线必须都读这一份：只读落库那份的话，用户刚拖出来的线要等一次
   *  PATCH 往返（失败时永远不）才显示，「拖了没反应」与「拖坏了」看起来一模一样。 */
  effectiveParamMap: Record<string, unknown>;
}

export interface UseParamWiringArgs {
  /** 工作流模板的 paramMap 原始列（外部事实源，GET 恢复 / 保存回写）。 */
  paramMap: Record<string, unknown>;
  /** 当前生效模式（`resolveWorkflowMode` 给出的那个）。 */
  mode: string | null | undefined;
  /** 落库回调（父级持有 workflowId 与 tRPC mutation）。 */
  onPatchParamMap?: (next: Record<string, unknown>) => void | Promise<void>;
}

export function useParamWiring({
  paramMap,
  mode,
  onPatchParamMap,
}: UseParamWiringArgs): ParamWiringController {
  const activeMode = mode ?? null;
  /* 本地 overlay：库里改一条线不必等一次 PATCH 往返才看得见结果。
   * 它按「模式 → 条目 → 目标」与落库键空间同构，故 `hasWireEdit` 只查它一份。 */
  const [overlay, setOverlay] = useState<Record<string, unknown>>({});
  /* 生效映射 = 已落库的那一份叠上本轮本地改动。 */
  const effective = useMemo(
    () => mergeParamMaps(paramMap, overlay),
    [paramMap, overlay],
  );

  const commit = useCallback(
    (next: Record<string, unknown>) => {
      setOverlay(next);
      void onPatchParamMap?.(next);
    },
    [onPatchParamMap],
  );

  const isManual = useCallback(
    (entryId: string) => hasWireEdit(effective, entryId, activeMode),
    [effective, activeMode],
  );

  const connect = useCallback(
    (entryId: string, ioKey: string) => {
      if (!activeMode) return;
      commit(applyWireEdit(effective, { entryId, ioKey, mode: activeMode }));
    },
    [activeMode, commit, effective],
  );

  const disconnect = useCallback(
    (entryId: string) => {
      if (!activeMode) return;
      const edit: ParamWireEdit = { entryId, ioKey: null, mode: activeMode };
      commit(applyWireEdit(effective, edit));
    },
    [activeMode, commit, effective],
  );

  const resetToAuto = useCallback(
    (entryId: string) => {
      if (!activeMode) return;
      commit(clearWireEdit(effective, entryId, activeMode));
    },
    [activeMode, commit, effective],
  );

  return {
    mode: activeMode,
    isManual,
    connect,
    disconnect,
    resetToAuto,
    effectiveParamMap: effective,
  };
}

/** 已落库的 paramMap 叠上本地 overlay（source 命名空间按模式逐条合并）。 */
function mergeParamMaps(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(overlay).length === 0) return base;
  const baseSource = sourceOf(base);
  const overlaySource = sourceOf(overlay);
  const source: Record<string, unknown> = { ...baseSource };
  for (const [key, value] of Object.entries(overlaySource)) {
    const prev = baseSource[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === "object" &&
      !Array.isArray(prev)
    ) {
      source[key] = { ...prev, ...value };
      continue;
    }
    source[key] = value;
  }
  return { ...base, source };
}

function sourceOf(paramMap: Record<string, unknown>): Record<string, unknown> {
  const raw = paramMap.source;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}
