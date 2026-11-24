"use client";

// ── 编辑对外参数：参考图「一张卡多端点」的会话编排（规范 §17.2 第②层）──
// 把「生效契约清单 + 连线后自动追加槽位 + 槽位写回契约」从巨型预览组件里收出来：
// 逻辑可单测，视图只消费返回值（连线回调、派生 id、失败提示）。状态都是本屏会话态，
// 真正持久化的仍是 paramMap 的连线与模式契约的本机覆盖。

import { useCallback, useMemo, useState } from "react";

import { exposedClassOf } from "~/lib/workflow/workflow-exposed-params";
import { buildParamEntries, sizeGroupIds } from "~/lib/workflow/workflow-param-mapping";
import { modeContractEntries, type ModeContract } from "~/lib/workshop/model-mode-contract";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";

import {
  nextReferenceSlotAfterConnect,
  referenceImageSlotIds,
  wiredReferenceSlotIds,
  withReferenceSlotInContracts,
} from "../reference-image-array";

export type UseReferenceImageArrayArgs = {
  /** 拖线落点的既有写入口。 */
  connect: (entryId: string, ioKey: string) => void;
  /** 模式契约注册表（写回时按项目默认落差集）。 */
  contracts: ReadonlyArray<ModeContract>;
  /** 当前生效模式；null 时接线写入无归属，追加空操作。 */
  effectiveMode: string | null;
  io: WorkflowIOMap | null;
  paramMap: Record<string, unknown>;
  /** 一次撤销多个条目的手工线（尺寸 / 参考图分组重置）。 */
  resetMany: (ids: ReadonlyArray<string>) => void;
  saveContracts: (contracts: Array<ModeContract>) => Promise<void>;
};

export function useReferenceImageArray({
  connect,
  contracts,
  effectiveMode,
  io,
  paramMap,
  resetMany,
  saveContracts,
}: UseReferenceImageArrayArgs) {
  /* 本次会话里新冒出来、还没连线的槽。一旦连上线，槽位 id 进 paramMap，
   * 刷新后由 wiredReferenceSlotIds 恢复，不依赖这份会话态。按模式分桶。 */
  const [extraRefSlots, setExtraRefSlots] = useState<Record<string, Array<string>>>({});
  /* 新槽写回模式契约失败时给一句出口 —— 不静默失败（规范 §4）。 */
  const [notice, setNotice] = useState<string | null>(null);

  /* 卡片头的话术与「工坊封装」页同一份：改过的模式走注册表，没改的走内置默认。 */
  const contractEntries = useMemo(
    () => modeContractEntries(effectiveMode, contracts),
    [contracts, effectiveMode],
  );

  /* 卡片列 / 连线闸门共用的生效契约：原有口 + 已连线的参考图槽 + 本会话新槽。
   * 已连线的槽即使从契约删掉也继续显示，否则那条线指向不存在的端点。 */
  const effectiveContractIds = useMemo(
    () => [
      ...new Set([
        ...contractEntries.map((item) => item.id),
        ...wiredReferenceSlotIds(paramMap, effectiveMode),
        ...(effectiveMode === null ? [] : (extraRefSlots[effectiveMode] ?? [])),
      ]),
    ],
    [contractEntries, effectiveMode, extraRefSlots, paramMap],
  );

  /* 卡片列与连线闸门同源的条目表（含刚追加、还没落契约的槽）。 */
  const paramEntries = useMemo(
    () => buildParamEntries(io, { mode: effectiveMode, contractIds: effectiveContractIds }),
    [effectiveContractIds, effectiveMode, io],
  );

  /* 整张卡的 ↺：尺寸六个子口 / 参考图全部槽一起撤，不能只撤其中一颗。 */
  const resetParam = useCallback(
    (id: string) => {
      resetMany(
        exposedClassOf(id) === "reference-image"
          ? referenceImageSlotIds(effectiveContractIds)
          : sizeGroupIds(id),
      );
    },
    [effectiveContractIds, resetMany],
  );

  const onConnect = useCallback(
    (entryId: string, ioKey: string) => {
      connect(entryId, ioKey);
      const next = nextReferenceSlotAfterConnect({ entryId, knownIds: effectiveContractIds });
      if (next === null || effectiveMode === null) {
        return;
      }
      setExtraRefSlots((prev) => {
        const list = prev[effectiveMode] ?? [];
        if (list.includes(next)) {
          return prev;
        }
        return { ...prev, [effectiveMode]: [...list, next] };
      });
      /* 运行期按契约口建值、按契约 id 解析落点：新槽必须进契约，画出的线才带值。 */
      const nextContracts = withReferenceSlotInContracts({
        contracts,
        mode: effectiveMode,
        slot: next,
        fallbackInputs: effectiveContractIds,
      });
      if (nextContracts === null) {
        return;
      }
      void saveContracts(nextContracts).then(
        () => {
          setNotice(null);
        },
        () => {
          setNotice(
            "参考图端点已长出，但模式契约保存失败：请到「模式契约」页手动补这一口，否则这条线运行时不生效。",
          );
        },
      );
    },
    [connect, contracts, effectiveContractIds, effectiveMode, saveContracts],
  );

  return {
    contractEntries,
    effectiveContractIds,
    notice,
    onConnect,
    paramEntries,
    resetParam,
  };
}
