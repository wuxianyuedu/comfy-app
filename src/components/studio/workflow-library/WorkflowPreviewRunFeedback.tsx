"use client";

/* ── 运行的内联反馈条（挂在预览底部，两种视图模式通用）──
 * 进度条 / 结果图 / 失败原因 / 素材上传提示 / 缺参提醒。
 * 结果图、失败原因与缺参提醒只在「实际使用」页签显示 —— 编辑对外参数是
 * 配置界面，不应展示上一次运行的结果与错误。 */

import { Button } from "~/components/ui/button";
import { ViewableImage } from "~/components/ui/image-viewer";
import { ProgressBar } from "~/components/ui/progress-bar";

import type { Phase } from "./hooks/use-generation-runner";

type Props = {
  missingLabels: Array<string>;
  /** 正在执行的节点名（SSE 帧里带的 label；没有时显示工作流整体进度）。 */
  nodeLabel: string | null;
  onDismissUploadNotice: () => void;
  pct: number;
  phase: Phase;
  resultUrl: string | null;
  running: boolean;
  /** 素材上传的可见出口：ComfyUI 未运行 / 正在启动 / 启动超时都落在这里。
   *  上传位自身没有错误区，只记 console 用户看不到任何原因（ISSUE #345）。 */
  uploadNotice: string | null;
  viewMode: "edit" | "use";
  workflowName: string;
};

export function WorkflowPreviewRunFeedback({
  missingLabels,
  nodeLabel,
  onDismissUploadNotice,
  pct,
  phase,
  resultUrl,
  running,
  uploadNotice,
  viewMode,
  workflowName,
}: Props) {
  return (
    <>
      {/* ── 进度条（两种模式通用，running 时显示） ── */}
      {phase.kind === "running" && (
        <div aria-live="polite" className="w-95">
          <ProgressBar
            className="text-2xs"
            fillClassName="u-gradient-brand duration-300"
            label={
              <>
                {nodeLabel ? `正在执行 ${nodeLabel}` : "正在执行工作流"}
                {phase.node ? `（${phase.node.value}/${phase.node.max}）` : ""}
              </>
            }
            trackClassName="bg-surface-2 h-1.5"
            value={pct}
          />
        </div>
      )}

      {/* ── 运行结果图（只在「实际使用」页签显示；编辑对外参数是配置界面，
            不应展示上一次运行的结果图） ── */}
      {resultUrl && viewMode === "use" && (
        <div className="w-95">
          <p className="text-ink-faint text-2xs mb-1">运行结果</p>
          {/* 缩略图盒子只有 380px 宽，看细节得点开通用查看器
              （原始大小 / 缩放 / 拖拽平移，见 `ui/image-viewer`）。 */}
          <ViewableImage
            alt="运行结果"
            className="border-border w-full rounded-xl border"
            label={`${workflowName} · 运行结果`}
            src={resultUrl}
          />
        </div>
      )}

      {/* ── 错误提示（只在「实际使用」页签显示；编辑对外参数是配置界面，
            不应展示上一次运行的执行错误） ── */}
      {phase.kind === "failed" && viewMode === "use" && (
        <div className="border-destructive/20 bg-destructive/8 text-destructive text-2xs w-95 rounded-lg border px-3 py-2 leading-relaxed">
          {phase.message}
        </div>
      )}

      {/* ── 素材上传提示 ── */}
      {uploadNotice && (
        <div
          aria-live="polite"
          className="border-warning/25 bg-warning/10 text-warning-strong text-2xs w-95 rounded-lg border px-3 py-2 leading-relaxed"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1">{uploadNotice}</span>
            <Button
              aria-label="关闭上传提示"
              className="text-warning-strong shrink-0 rounded"
              onClick={onDismissUploadNotice}
              size="icon-xs"
              variant="ghost"
            >
              ✕
            </Button>
          </div>
        </div>
      )}
      {!running && missingLabels.length > 0 && viewMode === "use" && (
        <p className="text-warning-strong/80 text-2xs w-95">
          必填参数未填：{missingLabels.join("、")}
        </p>
      )}
    </>
  );
}
