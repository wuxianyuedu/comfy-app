/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-empty-function, @typescript-eslint/no-unnecessary-type-assertion */
"use client";

/* 2026-08-30: extracted from CanvasNode — the collapsible error panel.
 *  Owns the errExpanded toggle state + the shouldAutoExpand / errorSuggestion
 *  derivations and renders the full panel JSX (expand/collapse, copy, retry,
 *  suggestion). The parent renders <ErrorPanel/> unconditionally; when the
 *  node is not in a visible error state the component returns null AFTER its
 *  hooks so the expand-state lifecycle matches the pre-extraction inline JSX
 *  exactly (state survives while hidden, resets on running/idle transitions). */
import { useMemo, useState } from "react";
import { type CanvasNodeData } from "../canvas-types";
import { ValidationErrorList } from "@/components/studio/shared/ValidationErrorList";
import { Icon } from "@/components/ui/icon";
import { shouldAutoExpandError, suggestForError } from "./error-suggestions";

interface ErrorPanelProps {
  nodeId: string;
  kind: CanvasNodeData["kind"];
  status: CanvasNodeData["status"];
  error: CanvasNodeData["error"];
  errorStatus: CanvasNodeData["errorStatus"];
  errorContext: CanvasNodeData["errorContext"];
  validationErrors: CanvasNodeData["validationErrors"];
  taskId: CanvasNodeData["taskId"];
  workflowId: CanvasNodeData["workflowId"];
  workflowName: CanvasNodeData["workflowName"];
  /* 复用上次记录的 payload 重新跑一遍（见 use-generate 的 retryGenerate）。 */
  onRetry: (req: unknown) => void;
}

export function ErrorPanel({
  nodeId,
  kind,
  status,
  error,
  errorStatus,
  errorContext,
  validationErrors,
  taskId,
  workflowId,
  workflowName,
  onRetry,
}: ErrorPanelProps) {
  /* Error panel state — collapsed by default (just a one-line summary),
   *  expandable to show the raw backend error (incl. ComfyUI tracebacks).
   *  Reset to collapsed whenever a new run starts so the next failure
   *  presents fresh without the user seeing a stale expanded state.
   *
   *  2026-08-13 R83: when the error message contains ComfyUI's
   *  "Node X not found" / "OOM" / "Cannot find model" / 5xx patterns, the
   *  panel auto-expands so the user can actually see the actionable
   *  context (taskId, request payload, suggestion). */
  const [errExpanded, setErrExpanded] = useState(false);
  /* Reset to collapsed whenever a new run starts (adjusted during render,
   * React 19 pattern). */
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "running" || status === "idle") setErrExpanded(false);
  }

  /* Auto-expand on structured / actionable errors so the suggestion +
   *  request-payload sections are visible without an extra click. */
  const shouldAutoExpand = shouldAutoExpandError(error, validationErrors?.length ?? 0);
  /* Auto-expand on actionable errors (adjusted during render, React 19
   *  pattern). */
  const [prevErrCtx, setPrevErrCtx] = useState(`${status}|${shouldAutoExpand}`);
  const errCtx = `${status}|${shouldAutoExpand}`;
  if (errCtx !== prevErrCtx) {
    setPrevErrCtx(errCtx);
    if (status === "error" && shouldAutoExpand) setErrExpanded(true);
  }

  /* Pattern-match the error text to surface a one-line actionable hint.
   *  Returns null if we don't recognize the failure shape (UI keeps the
   *  generic raw-error block instead of making up bad advice). */
  const errorSuggestion: string | null = useMemo(() => suggestForError(error), [error]);

  /* Hidden entirely when the node isn't showing an actionable error. Kept
   *  after the hooks (instead of gating the mount in the parent) so the
   *  expand/reset lifecycle runs on every render exactly like the original
   *  inline block did. */
  if (!(status === "error" && (error || (validationErrors?.length ?? 0) > 0))) {
    return null;
  }

  return (
    <div className="nodrag nopan border-t border-rose-400/20 bg-rose-500/6 px-3 py-2 text-[10.5px]">
      <div className="flex items-start gap-1.5">
        <Icon
          name="alert"
          size={12}
          className="mt-px shrink-0 text-rose-300"
        />
        <div className="min-w-0 flex-1">
          {/* Header row: status badge + workflow name + actions */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="min-w-0 truncate font-medium text-rose-200">
              {errorStatus === "TIMEOUT"
                ? "轮询超时"
                : errorStatus === "CANCELLED"
                  ? "任务被取消"
                  : errorStatus
                    ? "生成失败"
                    : "未捕获异常"}
              <span className="ml-1 text-rose-300/60">
                · {errorStatus ? `task ${errorStatus}` : "client"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {kind === "workflow" && workflowName && (
                <span
                  className="rounded border border-rose-400/15 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[9.5px] text-rose-100/80"
                  title="执行的工作流"
                >
                  {/* cast: CanvasNodeData has [key: string]: unknown
                   *  index signature that widens d.workflowName to
                   *  unknown on JSX read.  Explicit String() fixes
                   *  ReactNode compatibility for the rare wrapper
                   *  union. */}
                  {String(workflowName)}
                </span>
              )}
              {/* Retry with the same payload.  Only enabled when there's a taskId
               *  (i.e. a task actually ran) and we're not the pre-flight
               *  validation errors.  Wrapped in Boolean() to keep TS happy
               *  because `d.errorContext?.request` is typed `unknown`. */}
              {Boolean(errorContext?.request) && taskId && (
                <button
                  type="button"
                  onClick={() => {
                    void onRetry(errorContext?.request);
                  }}
                  className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                  title="用相同参数重跑一次"
                >
                  ↻ 重试
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrExpanded((value) => !value)}
                className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                title={errExpanded ? "收起错误详情" : "展开错误详情"}
              >
                {errExpanded ? "▲" : "▼"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(
                        JSON.stringify(
                          {
                            nodeId: nodeId,
                            workflowId: workflowId ?? null,
                            workflowName: workflowName ?? null,
                            taskId: taskId ?? null,
                            errorStatus: errorStatus ?? null,
                            validationErrors: validationErrors ?? null,
                            error:
                              typeof error === "string"
                                ? error
                                : (() => {
                                    try {
                                      return JSON.stringify(error);
                                    } catch {
                                      return String(error);
                                    }
                                  })(),
                            request: errorContext?.request ?? null,
                            ts: errorContext?.timestamp ?? new Date().toISOString(),
                          },
                          null,
                          2
                        )
                      );
                    } catch {
                      /* clipboard unavailable — silent; user can still
                       *  hand-expand and select the raw error text */
                    }
                  })();
                }}
                className="rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-200/80 transition-colors hover:bg-rose-400/10"
                title="复制错误详情到剪贴板（含 taskId 与请求参数）"
              >
                ⧉
              </button>
            </div>
          </div>

          {/* Collapsed teaser: just the raw error string. Keeps the
           *  existing one-line behavior so users who don't need the
           *  full context don't lose vertical space. */}
          {!errExpanded && (validationErrors?.length ?? 0) > 0 && (
            <p className="nodrag nopan mt-1 text-[10px] font-medium text-rose-200">
              发现 {(validationErrors ?? []).length} 项节点配置错误（点击 ▼ 查看明细）
            </p>
          )}
          {!errExpanded && (
            <p className="nodrag nopan mt-1 line-clamp-2 break-words text-[10px] text-rose-100/80">
              {typeof error === "string"
                ? error.replace(/\n/g, " ").slice(0, 200)
                : "（点击 ▼ 展开查看完整错误）"}
            </p>
          )}

          {errExpanded && (() => {
            // 2026-08-13 R83: 重做失败面板，把「执行了什么」结构化展示。
            //
            // Defensive coerce (R67 + R69): `d.error` is typed `string`
            // but legacy rows / older code paths may have stored the
            // literal "[object Object]" (e.g. buildPromptError pre-R69
            // used `String(res.error)`) or a structured object slipped
            // through a race.  We (1) detect the literal garbage-string
            // sentinel, (2) JSON-stringify real objects, (3) fall back
            // to a generic "no detail" message.  The expanded <pre>
            // never shows literal `[object Object]`.
            const raw = error;
            let errText = "(no error detail)";
            if (typeof raw === "string") {
              const trimmed = raw.trim();
              if (
                trimmed &&
                trimmed !== "[object Object]" &&
                trimmed !== "[unserializable error]"
              ) {
                errText = trimmed;
              }
            } else if (raw && typeof raw === "object") {
              try {
                errText = JSON.stringify(raw, null, 2);
              } catch {
                errText = String(raw);
              }
            }

            const ts = (() => {
              const t = errorContext?.timestamp;
              if (!t) return null;
              const dt = new Date(t);
              if (Number.isNaN(dt.getTime())) return t;
              return dt.toLocaleString("zh-CN", { hour12: false });
            })();
            const hasCtx =
              Boolean(taskId) ||
              Boolean(ts) ||
              Boolean(errorContext?.request) ||
              Boolean(errorSuggestion);

            return (
              <div className="nodrag nopan mt-1.5 space-y-1.5">
                {/* 0) 结构化校验错误（R-Next 2026-08-17）：精确指出哪个节点哪个字段 */}
                {(validationErrors?.length ?? 0) > 0 && (
                  <div className="rounded border border-rose-400/25 bg-rose-500/10 px-2 py-1.5">
                    <div className="mb-1 text-[10px] font-semibold text-rose-200">
                      节点配置校验（{(validationErrors ?? []).length} 项）
                    </div>
                    <ValidationErrorList errors={validationErrors} className="text-rose-100/90" />
                  </div>
                )}
                {/* 1) 任务上下文：taskId（可点击复制）+ 时间 */}
                {hasCtx && (
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-rose-400/15 bg-black/30 px-1.5 py-1 text-[10px]">
                    {taskId && (
                      <>
                        <span className="text-rose-300/60">taskId</span>
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(taskId!)
                              .catch(() => {})
                          }
                          className="nodrag nopan min-w-0 truncate text-left font-mono text-rose-100/90 hover:text-rose-50"
                          title="点击复制 taskId"
                        >
                          {taskId}
                        </button>
                      </>
                    )}
                    {ts && (
                      <>
                        <span className="text-rose-300/60">时间</span>
                        <span className="truncate text-rose-100/80">{ts}</span>
                      </>
                    )}
                  </div>
                )}

                {/* 2) 自动建议 — 正则推断的纠错提示 */}
                {errorSuggestion && (
                  <div className="rounded border border-amber-400/25 bg-amber-500/8 px-2 py-1 text-[10px] leading-relaxed text-amber-100">
                    <span className="mr-1 font-semibold text-amber-300">
                      建议
                    </span>
                    {errorSuggestion}
                  </div>
                )}

                {/* 3) 请求参数快照 */}
                {errorContext?.request ? (
                  <details className="text-[10px]" open>
                    <summary className="cursor-pointer select-none text-rose-300/70 hover:text-rose-200">
                      请求参数
                    </summary>
                    <pre className="nodrag nopan mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-rose-400/15 bg-black/50 p-1.5 font-mono text-[10px] leading-tight text-rose-100/85">
                      {typeof errorContext.request === "string"
                        ? errorContext.request
                        : (() => {
                            try {
                              return JSON.stringify(
                                errorContext.request,
                                null,
                                2
                              );
                            } catch {
                              return String(errorContext.request);
                            }
                          })()}
                    </pre>
                  </details>
                ) : null}

                {/* 4) 原始错误详情（保持旧版的 <pre> 风格） */}
                <details className="text-[10px]" open>
                  <summary className="cursor-pointer select-none text-rose-300/70 hover:text-rose-200">
                    原始错误
                  </summary>
                  <pre className="nodrag nopan mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-rose-400/15 bg-black/50 p-1.5 font-mono text-[10px] leading-tight text-rose-100/85">
                    {errText}
                  </pre>
                </details>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
