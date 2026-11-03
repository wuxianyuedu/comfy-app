/* ── 工作流节点的「多模式」保存动作（第②层逻辑）
 * 模式列表与默认模式 PATCH 回 WorkflowTemplate（后端同步 defaultMode 到 taskType）。
 * 失败必须回滚本地 modes，否则会留下服务端没有的 zombie chip，刷新后消失。
 */

"use client";

import { useCallback } from "react";
import { errorMessage } from "~/lib/error-message";
import { patchWorkflow } from "~/lib/workflow/workflow-mutations";
import type { WorkflowModesState } from "~/components/studio/project-canvas/WorkflowNode";

export type UseWorkflowModesArgs = {
  /** 当前模式状态（乐观更新前的快照，用于失败回滚）。 */
  modes: WorkflowModesState | null;
  /** 保存失败时的节点级报错（写进 d.error + status: "error"）。 */
  onFailed: (reason: string) => void;
  setModes: (next: WorkflowModesState) => void;
  workflowId?: string;
};

export type WorkflowModesController = {
  /** 写入新模式并落库；失败自动回滚 + 报错。 */
  saveModes: (next: WorkflowModesState) => Promise<void>;
};

export function useWorkflowModes({
  workflowId,
  modes,
  setModes,
  onFailed,
}: UseWorkflowModesArgs): WorkflowModesController {
  const saveModes = useCallback(
    async (next: WorkflowModesState) => {
      if (!workflowId) {
        return;
      }
      setModes(next);
      try {
        await patchWorkflow({
          id: workflowId,
          modes: next.modes,
          defaultMode: next.defaultMode,
        });
      } catch (error) {
        // 回滚本地状态，避免出现「僵尸模式章」
        setModes(modes ?? { modes: [], defaultMode: null });
        onFailed(errorMessage(error, "保存模式失败，请重试"));
      }
    },
    [workflowId, modes, setModes, onFailed],
  );

  return { saveModes };
}
