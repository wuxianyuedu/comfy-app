"use client";

import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ErrorBoundary } from "~/components/ui/error-boundary";

import { WorkflowEditorInner } from "../workflow-editor/WorkflowEditorInner";
import { FullScreenLayer } from "../fullscreen/FullScreenLayer";
import { Button } from "~/components/ui/button";
import { zClass } from "~/lib/shell/overlay-z";

/* 编辑器渲染期异常兜底：此前无错误边界，WorkflowEditorInner 抛错会让 React 卸载整棵子树
 *（表现为工作流库列表闪现或白屏且无法定位）。接入后崩溃停留在编辑器内，显示错误详情 +
 *「返回」按钮（用户主动点击才回库），console 同步打印 componentStack。 */
function EditorCrashFallback({ error, onClose }: { error: Error | null; onClose: () => void }) {
  return (
    <FullScreenLayer
      className="bg-canvas flex items-center justify-center"
      zClass={zClass("modal")}
    >
      <div className="border-destructive/25 bg-destructive/5 w-[min(560px,90vw)] rounded-2xl border p-6">
        <p className="text-destructive text-sm font-semibold">编辑器渲染出错</p>
        <p className="text-ink-soft mt-2 text-xs leading-relaxed break-all">
          {error?.message ?? "未知错误（详见控制台 componentStack）"}
        </p>
        <Button
          className="bg-subtle text-ink-bright hover:bg-surface-2 mt-4 h-auto rounded-lg px-4 py-2"
          onClick={onClose}
          variant="secondary"
        >
          返回工作流库
        </Button>
      </div>
    </FullScreenLayer>
  );
}

export function WorkflowCanvasEditor({
  workflowId,
  open,
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave?: () => void;
  open: boolean;
  workflowId: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <ErrorBoundary
      fallback={(error) => <EditorCrashFallback error={error} onClose={onClose} />}
      onError={(error) => {
        console.error("[WorkflowCanvasEditor] 渲染异常，编辑器已降级", error);
      }}
    >
      <ReactFlowProvider>
        <WorkflowEditorInner onClose={onClose} onSave={onSave} workflowId={workflowId} />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
