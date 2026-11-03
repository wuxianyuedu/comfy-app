"use client";

/* ── 对外输出参数的落点编辑（右列）──
 * 与左列同一份编排（本地叠加 + 落库），但键空间分开：输出取值行写
 * `paramMap.output.mode:<模式>`。落库统一走 `commitParamMap`（先写本地 overlay 再
 * 落库），输出线才会立刻画出来，而非等一次 PATCH + 查询重拉（约 2s）。
 * 没有 `onPatchParamMap`（只读消费方）时不可拖：拖不动的不摆出能拖的样子。 */
import { useMemo } from "react";

import {
  applyOutputBindingEdit,
  canApplyOutputBindingEdit,
  clearOutputBindingEdit,
} from "~/lib/workflow/workflow-output-binding";
import type { WorkflowIOMap } from "../../workflow-io";
import type { deriveLibraryOutputCards } from "../workflow-library-param-cards";

export function useOutputWiring(params: {
  commitParamMap: (next: Record<string, unknown>) => void;
  effectiveMode: string | null;
  /* 本地 overlay 已经并入的生效 paramMap（useParamWiring 吐出的那份）——
   * 卡片列与连线要读的是同一份。 */
  effectiveParamMap: Record<string, unknown>;
  onPatchParamMap?: (next: Record<string, unknown>) => void | Promise<void>;
  outputCards: ReturnType<typeof deriveLibraryOutputCards>;
  workflowIO: WorkflowIOMap | null;
}) {
  /* 解构出两个稳定引用再进 useMemo：params 每次渲染都是新对象，回调里直接写
   * `params.x` 会被 eslint 要求依赖整个 params（那样 useMemo 每次都重算）。 */
  const { effectiveParamMap, commitParamMap } = params;
  const { workflowIO, effectiveMode, onPatchParamMap, outputCards } = params;
  const outputWiring = useMemo(
    () => ({
      isManual: (ioKey: string) => outputCards.isManual(ioKey),
      connect: (outputIoKey: string, targetIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) {
          return;
        }
        if (!canApplyOutputBindingEdit({ ioKey: targetIoKey, mode: effectiveMode }, workflowIO)) {
          return;
        }
        /* 连回它**默认**取值的那一行 = 撤销这条手工线（否则「恢复默认」与「拖回来」
         *  会留下两种等价状态）。但这只对**已有手工绑定**的口成立：单输出行工作流
         *  （images → images）连的是唯一一行，按旧判据会被当成「撤销不存在的手工线」
         *  静默吃掉（「拖了没反应、输出线永远连不上」）。没有手工绑定时应写入显式
         *  绑定让线出现（卡片头 ↺ 仍可一键撤掉）。 */
        const revert = outputIoKey === targetIoKey && outputCards.isManual(outputIoKey);
        const next = revert
          ? clearOutputBindingEdit(effectiveParamMap, outputIoKey, effectiveMode)
          : applyOutputBindingEdit(effectiveParamMap, {
              outputIoKey,
              ioKey: targetIoKey,
              mode: effectiveMode,
            });
        commitParamMap(next);
      },
      disconnect: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) {
          return;
        }
        commitParamMap(
          applyOutputBindingEdit(effectiveParamMap, {
            outputIoKey,
            ioKey: null,
            mode: effectiveMode,
          }),
        );
      },
      reset: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) {
          return;
        }
        commitParamMap(clearOutputBindingEdit(effectiveParamMap, outputIoKey, effectiveMode));
      },
    }),
    [outputCards, effectiveMode, onPatchParamMap, effectiveParamMap, commitParamMap, workflowIO],
  );
  return outputWiring;
}
