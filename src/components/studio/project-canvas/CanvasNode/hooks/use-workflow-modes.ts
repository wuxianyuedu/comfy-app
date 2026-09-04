/* ── 工作流节点的「多模式」保存动作（第②层逻辑）───────────────────────
 * R-ardot25：模式列表与默认模式要 PATCH 回 WorkflowTemplate（后端同时把
 * defaultMode 同步到 taskType 列）。这段「乐观更新 + 失败回滚」原先内联在
 * CanvasNode.tsx 的 onModesChange 里，是该组件唯一的 IO 点。
 *
 * 为什么失败必须回滚本地 modes：不回滚的话界面上会留一个服务端根本没有的
 * 模式 chip（zombie chip），刷新后消失，用户会以为数据丢了。
 */

"use client";

import { useCallback } from "react";
import { errorMessage } from "@/lib/error-message";
import { patchWorkflow } from "@/lib/workflow-mutations";
import type { WorkflowModesState } from "@/components/studio/project-canvas/WorkflowNode";

export interface UseWorkflowModesArgs {
  workflowId?: string;
  /** 当前模式状态（乐观更新前的快照，用于失败回滚）。 */
  modes: WorkflowModesState | null;
  setModes: (next: WorkflowModesState) => void;
  /** 保存失败时的节点级报错（写进 d.error + status: "error"）。 */
  onFailed: (reason: string) => void;
}

export interface WorkflowModesController {
  /** 写入新模式并落库；失败自动回滚 + 报错。 */
  saveModes: (next: WorkflowModesState) => Promise<void>;
}

export function useWorkflowModes({
  workflowId,
  modes,
  setModes,
  onFailed,
}: UseWorkflowModesArgs): WorkflowModesController {
  const saveModes = useCallback(
    async (next: WorkflowModesState) => {
      if (!workflowId) return;
      setModes(next);
      try {
        await patchWorkflow({
          id: workflowId,
          modes: next.modes,
          defaultMode: next.defaultMode,
        });
      } catch (err) {
        // rollback local state to avoid zombie mode chip
        setModes(modes ?? { modes: [], defaultMode: null });
        onFailed(errorMessage(err, "保存模式失败，请重试"));
      }
    },
    [workflowId, modes, setModes, onFailed]
  );

  return { saveModes };
}
