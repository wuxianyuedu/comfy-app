/* 传给 React.memo 的 WorkflowNode 的回调簇（ISSUE #5204 / 规范 4.8 C7）。
 * 父渲染现造箭头回调会让 memo 浅比较必失败 ⇒ 每次重渲整棵 W 节点。
 * 这里把六个回调收成 useCallback：会变的 seedModes / wfList / 生成函数用 ref
 * 在 effect 中同步后读取，不进依赖数组。 */
"use client";

import { useCallback, useEffect, useRef } from "react";

import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import type { WorkflowNodeProps } from "~/components/studio/project-canvas/WorkflowNode";
import type { WorkflowModesController } from "./use-workflow-modes";

type WfList = WorkflowNodeProps["workflowList"];

export type UseWorkflowCallbacksArgs = {
  patch: (p: Partial<CanvasNodeData>) => void;
  runGenerate: () => Promise<void>;
  saveModes: WorkflowModesController["saveModes"];
  seededFor: { current: string | null };
  seedModes: CanvasNodeData["seedModes"];
  wfList: WfList;
};

export function useWorkflowCallbacks({
  patch,
  runGenerate,
  saveModes,
  seededFor,
  seedModes,
  wfList,
}: UseWorkflowCallbacksArgs) {
  const currentSeedModes = useRef(seedModes);
  const currentWfList = useRef(wfList);
  useEffect(() => {
    currentSeedModes.current = seedModes;
    currentWfList.current = wfList;
  }, [seedModes, wfList]);

  const onFormChange = useCallback(
    (next: Record<string, unknown>) => {
      patch({ workflowInputs: next });
    },
    [patch],
  );

  const onModesChange = useCallback(
    (modes: Array<string>, defaultMode: string) => {
      void saveModes({ modes, defaultMode });
    },
    [saveModes],
  );

  const onSeedModeChange = useCallback(
    (ioKey: string, mode: string) => {
      patch({ seedModes: { ...currentSeedModes.current, [ioKey]: mode } });
    },
    [patch],
  );

  const onSelectWorkflow = useCallback(
    (workflowId: string) => {
      const wf = currentWfList.current.find((item) => item.id === workflowId);
      seededFor.current = null;
      patch({
        workflowId: workflowId || undefined,
        workflowName: wf?.name,
        workflowTaskType: wf?.taskType,
        workflowInputs: {},
        paramMap: undefined,
        workflowSinkId: undefined,
      });
    },
    [patch, seededFor],
  );

  /* runGenerate 是 hook 每次渲染新建的 async 函数；用 ref 转发成稳定引用。 */
  const runGenerateRef = useRef(runGenerate);
  useEffect(() => {
    runGenerateRef.current = runGenerate;
  }, [runGenerate]);
  const onGenerate = useCallback(() => {
    void runGenerateRef.current();
  }, []);

  return { onFormChange, onGenerate, onModesChange, onSeedModeChange, onSelectWorkflow };
}
