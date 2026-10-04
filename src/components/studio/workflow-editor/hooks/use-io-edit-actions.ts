"use client";
/* IOEditStore 的两个受控出口。
 *
 * 两者都只是 store 的薄封装：写 workflowIO 走 `setState`（合并语义由
 * 调用处决定），预览开关**必须**走 store 动作 `setIoPreviewOpen` ——
 * 关闭预览时 store 会把 `ioEditMode` 一并关掉、打开时一并打开，绕过动作
 * 直接写状态就会留下「面板没了、勾选框还在」的两截状态（ISSUE #400，
 * 判据见 workflow-editor-topbar-config 的源码级测试）。 */
import { useCallback } from "react";

import type { useIOEditApi } from "../WorkflowStores";
import type { WorkflowIOParam } from "../../workflow-types";

export function useIoEditActions(params: {
  ioApi: ReturnType<typeof useIOEditApi>;
}) {
  const { ioApi } = params;
  const setWorkflowIO = useCallback(
    (
      updater:
        | Record<string, WorkflowIOParam>
        | ((
            prev: Record<string, WorkflowIOParam>,
          ) => Record<string, WorkflowIOParam>),
    ) => {
      ioApi.setState((state) => ({
        workflowIO:
          typeof updater === "function" ? updater(state.workflowIO) : updater,
      }));
    },
    [ioApi],
  );
  const setIoPreviewOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) =>
      ioApi
        .getState()
        .setIoPreviewOpen(
          typeof v === "function" ? v(ioApi.getState().ioPreviewOpen) : v,
        ),
    [ioApi],
  );
  return { setWorkflowIO, setIoPreviewOpen };
}
