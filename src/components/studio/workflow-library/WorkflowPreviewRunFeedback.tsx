"use client";

/* ── 运行的内联反馈条（挂在预览底部，两种视图模式通用）──
 * 进度条 / 结果图 / 失败原因 / 素材上传提示 / 缺参提醒。
 * 结果图、失败原因与缺参提醒只在「实际使用」页签显示 —— 编辑对外参数是
 * 配置界面，不应展示上一次运行的结果与错误。 */

import { Button } from "~/components/ui/button";
import { ViewableImage } from "~/components/ui/image-viewer";
import { ProgressBar } from "~/components/ui/progress-bar";

import type { Phase } from "./hooks/use-generation-runner";

interface Props {
  phase: Phase;
  pct: number;
  /** 正在执行的节点名（SSE 帧里带的 label；没有时显示工作流整体进度）。 */
  nodeLabel: string | null;
  resultUrl: string | null;
  workflowName: string;
  viewMode: "edit" | "use";
  running: boolean;
  missingLabels: string[];
  /** 素材上传的可见出口：ComfyUI 未运行 / 正在启动 / 启动超时都落在这里。
   *  上传位自身没有错误区，只记 console 用户看不到任何原因（ISSUE #345）。 */
  uploadNotice: string | null;
  onDismissUploadNotice: () => void;
}

export function WorkflowPreviewRunFeedback({
  phase,
  pct,
  nodeLabel,
  resultUrl,
  workflowName,
  viewMode,
  running,
  missingLabels,
  uploadNotice,
  onDismissUploadNotice,
}: Props) {
  return (
    <>
      {/* ── 进度条（两种模式通用，running 时显示） ── */}
      {phase.kind === "running" && (
        // p71-allow:start brand 渐变 · 工作流执行进度条 violet→fuchsia 双色（项目品牌视觉），见 §3.6.1
        <div className="w-95" aria-live="polite">
          <ProgressBar
            value={pct}
            label={
              <>
                {nodeLabel ? `正在执行 ${nodeLabel}` : "正在执行工作流"}
                {phase.node ? `（${phase.node.value}/${phase.node.max}）` : ""}
              </>
            }
            className="text-[11px]"
            trackClassName="bg-surface-2 h-1.5"
            fillClassName="bg-linear-to-r from-violet-500 to-fuchsia-500 duration-300"
          />
        </div>
        // p71-allow:end
      )}

      {/* ── 运行结果图（只在「实际使用」页签显示；编辑对外参数是配置界面，
            不应展示上一次运行的结果图） ── */}
      {resultUrl && viewMode === "use" && (
        <div className="w-95">
          <p className="text-ink-faint mb-1 text-[11px]">运行结果</p>
          {/* 缩略图盒子只有 380px 宽，看细节得点开通用查看器
              （原始大小 / 缩放 / 拖拽平移，见 `ui/image-viewer`）。 */}
          <ViewableImage
            src={resultUrl}
            alt="运行结果"
            label={`${workflowName} · 运行结果`}
            className="border-border w-full rounded-xl border"
          />
        </div>
      )}

      {/* ── 错误提示（只在「实际使用」页签显示；编辑对外参数是配置界面，
            不应展示上一次运行的执行错误） ── */}
      {phase.kind === "failed" && viewMode === "use" && (
        <div className="border-destructive/20 bg-destructive/8 text-destructive w-95 rounded-lg border px-3 py-2 text-[11px] leading-relaxed">
          {phase.message}
        </div>
      )}

      {/* ── 素材上传提示 ── */}
      {uploadNotice && (
        <div
          className="border-warning/25 bg-warning/10 text-warning-strong w-95 rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1">{uploadNotice}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDismissUploadNotice}
              className="text-warning-strong shrink-0 rounded"
              aria-label="关闭上传提示"
            >
              ✕
            </Button>
          </div>
        </div>
      )}
      {!running && missingLabels.length > 0 && viewMode === "use" && (
        <p className="text-warning-strong/80 w-95 text-[11px]">
          必填参数未填：{missingLabels.join("、")}
        </p>
      )}
    </>
  );
}
