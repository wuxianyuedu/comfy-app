 
"use client";

import {
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";


import { ErrorBoundary } from "@/components/ui/ErrorBoundary";


import { WorkflowEditorInner } from "../workflow-editor/WorkflowEditorInner";

/* 编辑器渲染期异常兜底：全屏降级 UI。此前编辑器没有任何错误边界，
 * 一旦 WorkflowEditorInner 渲染抛错（如子工作流数据形状异常），React
 * 会卸载整棵子树，用户看到的是底下工作流库列表"闪现"甚至整页白屏，
 * 且无法定位根因。接入后崩溃时停留在编辑器内并显示错误详情 +
 * 「返回」按钮（用户主动点击才回工作流库），console 同步打印
 * componentStack 供排查。 */
function EditorCrashFallback({
  error,
  onClose,
}: {
  error: Error | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-(--color-canvas)">
      <div className="w-[min(560px,90vw)] rounded-2xl border border-red-500/25 bg-red-500/5 p-6">
        <p className="text-sm font-semibold text-red-400">编辑器渲染出错</p>
        <p className="mt-2 break-all text-xs leading-relaxed text-gray-400">
          {error?.message ?? "未知错误（详见控制台 componentStack）"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/15"
        >
          返回工作流库
        </button>
      </div>
    </div>
  );
}

export function WorkflowCanvasEditor({
  workflowId,
  open,
  onClose,
  onSave,
}: {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}) {
  if (!open) return null;

  return (
    <ErrorBoundary
      fallback={(error) => <EditorCrashFallback error={error} onClose={onClose} />}
      onError={(error) => {
        console.error("[WorkflowCanvasEditor] 渲染异常，编辑器已降级", error);
      }}
    >
      <ReactFlowProvider>
        <WorkflowEditorInner
          workflowId={workflowId}
          onClose={onClose}
          onSave={onSave}
        />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
