"use client";

/* ── 工作流库画布预览的「对外参数映射」编辑编排（规范 §17.2 第②层）──
 *
 * 库里这份映射与编辑器画布上的**同一份事实**（`paramMap.source.mode:<模式>`），
 * 用户在库里也要能改（ISSUE #355：「连线要能编辑，现在编辑不了」）。这一层负责：
 *   ① 拖线手势的落点解析（命中哪一行，等价于 React Flow 的 onConnect）；
 *   ② 一次编辑的落库编排（patch paramMap），本地叠加一层 overlay 立即回读；
 *   ③ 「恢复默认」：清掉该对外参数在当前模式下的手工线。
 *
 * 落库形状由 `~/lib/workflow/workflow-param-wiring` 给出（纯函数，与编辑器同一份）。
 * 视图只消费这里返回的 controller：不碰 tRPC、不解析映射。 */

import { useCallback, useMemo, useState } from "react";

import { isPlainRecord } from "~/lib/is-record";
import {
  applyWireEdit,
  clearWireEdit,
  hasWireEdit,
  type ParamWireEdit,
} from "~/lib/workflow/workflow-param-wiring";

export interface ParamWiringController {
  /** 当前生效模式；没有模式时编辑无从归属，写入是空操作。 */
  mode: string | null;
  /** 这个对外参数在当前模式下是否被作者改过（含显式断开）。 */
  isManual: (entryId: string) => boolean;
  /** 拖线落上：把某个对外参数连到 ioKey（写入后立即回读）。 */
  connect: (entryId: string, ioKey: string) => void;
  /** 断开：该对外参数在这个模式下显式断线（不再落任何端口）。 */
  disconnect: (entryId: string) => void;
  /** 恢复默认：撤销该对外参数在当前模式下的手工线。 */
  resetToAuto: (entryId: string) => void;
  /** 一次撤销**多个**条目的手工线（尺寸卡头一次撤六行形态）。
   *
   *  必须是一次计算 + 一次落库：逐个调 `resetToAuto` 时每一次都基于同一份**旧**
   *  值算新表，后一次会把前一次的删除覆盖回去 —— 表现就是「重置清不掉」
   *  （用户口径：尺寸那三项线变成固定连线，重置也清不掉）。 */
  resetMany: (entryIds: readonly string[]) => void;
  /** **生效的 paramMap** = 已落库的那一份叠上本轮本地改动。
   *
   *  卡片列与连线必须都读这一份：只读落库那份的话，用户刚拖出来的线要等一次
   *  PATCH 往返（失败时永远不）才显示，「拖了没反应」与「拖坏了」看起来一模一样。 */
  effectiveParamMap: Record<string, unknown>;
  /** 提交一份**完整** paramMap：先写本地 overlay（立刻回读），再落库。
   *
   *  左列（`connect` / `disconnect` / `resetToAuto`）已内建这套编排；右列的输出
   *  落点写在 `paramMap.output.*`，由调用方算好 next 后经这里提交 —— 两列共用同一
   *  份 overlay，输出线才会像输入线一样「拖完立刻画出来」，而不必等一次 PATCH +
   *  查询重拉（约 2s）才把线显示出来。 */
  commitParamMap: (next: Record<string, unknown>) => void;
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

  /* 批量撤销：**逐条在同一个中间结果上删**，最后一次提交。逐个调 `resetToAuto`
   *  会各自从同一份 `effective` 出发，后一次把前一次的结果覆盖掉（只清掉最后一
   *  条目）—— 用户看到的正是「重置清不掉」。 */
  const resetMany = useCallback(
    (entryIds: readonly string[]) => {
      if (!activeMode || entryIds.length === 0) return;
      let next = effective;
      for (const entryId of entryIds) {
        next = clearWireEdit(next, entryId, activeMode);
      }
      commit(next);
    },
    [activeMode, commit, effective],
  );

  return {
    mode: activeMode,
    isManual,
    connect,
    disconnect,
    resetToAuto,
    resetMany,
    effectiveParamMap: effective,
    commitParamMap: commit,
  };
}

/** 本地 overlay 会涉及的顶层命名空间：左列写 `source`、右列写 `output`，
 *  两者都是「按模式归拢 → 再按条目」的同构结构，合并规则一致。 */
const LOCAL_OVERLAY_NAMESPACES = ["source", "output"] as const;

/** 已落库的 paramMap 叠上本地 overlay。
 *
 *  两个命名空间都要合并：只合并 `source` 的话，右列（输出落点写在 `output`）的
 *  本地改动会被丢掉 —— 输出线又得等一次 PATCH + 查询重拉（约 2s）才出现。 */
function mergeParamMaps(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(overlay).length === 0) return base;
  const next: Record<string, unknown> = { ...base };
  for (const ns of LOCAL_OVERLAY_NAMESPACES) {
    const merged = mergeNamespace(
      namespaceOf(base, ns),
      namespaceOf(overlay, ns),
    );
    if (Object.keys(merged).length > 0) next[ns] = merged;
  }
  return next;
}

/** 取某个一级命名空间（不是普通对象时按空表处理）。 */
function namespaceOf(
  paramMap: Record<string, unknown>,
  ns: string,
): Record<string, unknown> {
  const raw = paramMap[ns];
  return isPlainRecord(raw) ? raw : {};
}

/** 命名空间内按「模式 → 条目」一层浅合并：overlay 给了的键覆盖 base，对象值再
 *  并一层（同一模式下其它条目原样保留）。 */
function mergeNamespace(
  baseNs: Record<string, unknown>,
  overlayNs: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseNs };
  for (const [key, value] of Object.entries(overlayNs)) {
    const prev = baseNs[key];
    if (isPlainRecord(value) && isPlainRecord(prev)) {
      merged[key] = { ...prev, ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
