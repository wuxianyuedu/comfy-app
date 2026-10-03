"use client";

/* ── 对外输出参数的落点编辑（右列）──
 *
 * 与左列同一份编排思路（本地叠加 + 落库），但键空间分开：输出的取值行写在
 * `paramMap.output.mode:<模式>`。落库统一走 `commitParamMap`（先写本地 overlay
 * 再落库）—— 这样输出线像左列一样**立刻**画出来，而不是等一次 PATCH + 查询
 * 重拉（约 2s）回来才显示。
 *
 * 没有 `onPatchParamMap`（只读消费方）时不可拖：回调为 undefined，连线层据此
 * 不起手（拖不动的东西不摆出能拖的样子）。
 */
import { useMemo } from "react";

import {
  applyOutputBindingEdit,
  canApplyOutputBindingEdit,
  clearOutputBindingEdit,
} from "~/lib/workflow/workflow-output-binding";
import type { WorkflowIOMap } from "../../workflow-io";
import type { deriveLibraryOutputCards } from "../workflow-library-param-cards";

export function useOutputWiring(params: {
  workflowIO: WorkflowIOMap | null;
  effectiveMode: string | null;
  onPatchParamMap?: (next: Record<string, unknown>) => void | Promise<void>;
  outputCards: ReturnType<typeof deriveLibraryOutputCards>;
  /* 本地 overlay 已经并入的生效 paramMap（useParamWiring 吐出的那份）——
   * 卡片列与连线要读的是同一份。 */
  effectiveParamMap: Record<string, unknown>;
  commitParamMap: (next: Record<string, unknown>) => void;
}) {
  /* 解构出两个稳定引用再进 useMemo：params 每次渲染都是新对象，回调里直接写
   * `params.x` 会被 eslint 要求依赖整个 params（那样 useMemo 每次都重算）。 */
  const { effectiveParamMap, commitParamMap } = params;
  const { workflowIO, effectiveMode, onPatchParamMap, outputCards } = params;
  const outputWiring = useMemo(
    () => ({
      isManual: (ioKey: string) => outputCards.isManual(ioKey),
      connect: (outputIoKey: string, targetIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        if (
          !canApplyOutputBindingEdit(
            { ioKey: targetIoKey, mode: effectiveMode },
            workflowIO,
          )
        )
          return;
        /* 连回它**默认**取值的那一行 = 撤销这条手工线（而不是把它写成一条
         *  多余的覆盖）—— 否则「恢复默认」与「拖回来」会留下两种等价状态。
         *  但这只对**已有手工绑定**的口成立：单输出行的工作流（images → images）
         *  连的是它唯一的那一行，按旧判据会被当成「撤销一条不存在的手工线」
         *  静默吃掉 —— 用户看到的就是「拖了没反应、输出线永远连不上」。没有
         *  手工绑定时应写入显式绑定让线出现（卡片头 ↺ 仍可一键撤掉）。 */
        const revert =
          outputIoKey === targetIoKey && outputCards.isManual(outputIoKey);
        const next = revert
          ? clearOutputBindingEdit(
              effectiveParamMap,
              outputIoKey,
              effectiveMode,
            )
          : applyOutputBindingEdit(effectiveParamMap, {
              outputIoKey,
              ioKey: targetIoKey,
              mode: effectiveMode,
            });
        commitParamMap(next);
      },
      disconnect: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        commitParamMap(
          applyOutputBindingEdit(effectiveParamMap, {
            outputIoKey,
            ioKey: null,
            mode: effectiveMode,
          }),
        );
      },
      reset: (outputIoKey: string) => {
        if (!effectiveMode || !onPatchParamMap) return;
        commitParamMap(
          clearOutputBindingEdit(effectiveParamMap, outputIoKey, effectiveMode),
        );
      },
    }),
    [
      outputCards,
      effectiveMode,
      onPatchParamMap,
      effectiveParamMap,
      commitParamMap,
      workflowIO,
    ],
  );
  return outputWiring;
}
