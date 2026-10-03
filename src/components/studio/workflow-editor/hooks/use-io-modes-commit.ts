"use client";
/* IO 预览面板的「模式集合变更」落库编排。
 *
 * 模式集合变更要同时做三件事（顺序即语义）：把被移除模式在各 IO 条目上的
 * 覆盖层摘掉、同步本地 detail 让页签即时反映、经 savePatch 一次落库。
 * 与库详情「类型」页签是同一份存储（见 WorkflowIoPreviewPanel 的说明）。 */
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { useIOEditApi } from "../WorkflowStores";
import { type useWorkflowSaveMutation } from "./use-workflow-save";
import type { WorkflowDetail } from "../../workflow-types";

export function useIoModesCommit(params: {
  ioApi: ReturnType<typeof useIOEditApi>;
  /** 顶层 hook 调用点 detail 尚可为 null；回调只会由预览面板触发
   *  （面板仅在 detail 就绪后渲染），为 null 时按空模式集处理。 */
  detail: WorkflowDetail | null;
  setDetail: Dispatch<SetStateAction<WorkflowDetail | null>>;
  savePatch: ReturnType<typeof useWorkflowSaveMutation>;
  workflowId: string;
}) {
  const { ioApi, detail, setDetail, savePatch, workflowId } = params;
  return useCallback(
    (modes: string[], defaultMode: string) => {
      /* 模式集合变更立即落库（与库详情「类型」同一存储），并同步
       * 本地 detail 让页签即时反映。被移除的模式在各 IO 条目上的
       * 覆盖层（modes[mode]）必须一并摘掉——页签栏只跟 modes 走，
       * 留下的无主覆盖会一直随 workflowIO 落库往返；清理结果随同
       * 一 PATCH 落库。 */
      const removedModes = (detail?.availableModes ?? []).filter(
        (m) => !modes.includes(m),
      );
      const cleanedIO =
        removedModes.length > 0
          ? ioApi.getState().purgeModeOverrides(removedModes)
          : null;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              availableModes: modes,
              defaultMode,
              taskType: defaultMode,
            }
          : prev,
      );
      savePatch.mutate({
        id: workflowId,
        modes,
        defaultMode,
        taskType: defaultMode,
        ...(cleanedIO ? { workflowIO: cleanedIO } : {}),
      });
    },
    [detail, ioApi, setDetail, savePatch, workflowId],
  );
}
