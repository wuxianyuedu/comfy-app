"use client";

/* 从 CanvasNode 抽出 —— 可折叠的错误面板。
 *  负责 errExpanded 开关状态 + shouldAutoExpand / errorSuggestion
 *  两个推导，并渲染整个面板 JSX（展开/收起、复制、重试、
 *  建议）。父组件无条件渲染 <ErrorPanel/>；节点不处于
 *  可见错误态时，组件在 hooks 之后返回 null，好让展开状态的
 *  生命周期与拆分前内联 JSX 完全一致（隐藏期间状态保留，
 *  running/idle 切换时重置）。 */
import { useMemo, useState } from "react";
import { type CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { ValidationErrorList } from "~/components/studio/shared/ValidationErrorList";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
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
  /* 错误面板状态 —— 默认收起（只有一行摘要），
   *  可展开查看后端原始错误（含 ComfyUI traceback）。
   *  每次新运行开始时重置为收起，好让下一次失败
   *  以干净状态呈现，用户不会看到上次残留的展开态。
   *
   *  错误信息里出现 ComfyUI 的
   *  "Node X not found" / "OOM" / "Cannot find model" / 5xx 形态时，
   *  面板自动展开，让用户能看到可行动的
   *  上下文（taskId、请求 payload、建议）。 */
  const [errExpanded, setErrExpanded] = useState(false);
  /* 每次新运行开始时重置为收起（渲染期间调整，
   * React 19 模式）。 */
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "running" || status === "idle") setErrExpanded(false);
  }

  /* 结构化 / 可行动的错误上自动展开，好让建议 +
   *  请求 payload 区不用多点一次就看得见。 */
  const shouldAutoExpand = shouldAutoExpandError(
    error,
    validationErrors?.length ?? 0,
  );
  /* 可行动错误上自动展开（渲染期间调整，React 19
   *  模式）。 */
  const [prevErrCtx, setPrevErrCtx] = useState(`${status}|${shouldAutoExpand}`);
  const errCtx = `${status}|${shouldAutoExpand}`;
  if (errCtx !== prevErrCtx) {
    setPrevErrCtx(errCtx);
    if (status === "error" && shouldAutoExpand) setErrExpanded(true);
  }

  /* 对错误文本做模式匹配，给出一行可行动的提示。
   *  认不出失败形态时返回 null（UI 保留通用的原始错误块，
   *  而不是编造不靠谱的建议）。 */
  const errorSuggestion: string | null = useMemo(
    () => suggestForError(error),
    [error],
  );

  /* 节点没在显示可行动错误时整体隐藏。放在 hooks 之后
   *  （而不是在父级拦住挂载），好让展开 / 重置生命周期
   *  每次渲染都跑一遍，与原来的
   *  内联块完全一致。 */
  if (!(status === "error" && (error || (validationErrors?.length ?? 0) > 0))) {
    return null;
  }

  return (
    <div className="nodrag nopan border-t border-rose-500/30 bg-rose-500/6 px-3 py-2 text-[10.5px]">
      <div className="flex items-start gap-1.5">
        <Icon
          name="alert"
          size={12}
          className="mt-px shrink-0 text-rose-700 dark:text-rose-300"
        />
        <div className="min-w-0 flex-1">
          {/* 头部行：状态徽标 + 工作流名 + 动作 */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="min-w-0 truncate font-medium text-rose-700 dark:text-rose-300">
              {errorStatus === "TIMEOUT"
                ? "轮询超时"
                : errorStatus === "CANCELLED"
                  ? "任务被取消"
                  : errorStatus
                    ? "生成失败"
                    : "未捕获异常"}
              <span className="ml-1 text-rose-700 dark:text-rose-300/60">
                · {errorStatus ? `task ${errorStatus}` : "client"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {kind === "workflow" && workflowName && (
                <span
                  className="rounded border border-rose-400/15 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[9.5px] text-rose-700/90 dark:text-rose-300/80"
                  title="执行的工作流"
                >
                  {/* 转型说明：CanvasNodeData 有 [key: string]: unknown
                   *  索引签名，会在 JSX 读取时把 d.workflowName 放宽成
                   *  unknown。显式 String() 修好
                   *  ReactNode 兼容性，照顾少见的包裹联合。
                   */}
                  {String(workflowName)}
                </span>
              )}
              {/* 用同一份参数重跑。仅当有 taskId（即任务真的跑过）且不是
               *  预检阶段的校验错误时才出现。用 Boolean() 包一层是为了让 TS
               *  满意 —— `d.errorContext?.request` 的类型是 `unknown`。 */}
              {Boolean(errorContext?.request) && taskId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    void onRetry(errorContext?.request);
                  }}
                  className="h-auto rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-700/90 hover:bg-rose-500/10 dark:text-rose-300/80"
                  title="用相同参数重跑一次"
                >
                  ↻ 重试
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setErrExpanded((value) => !value)}
                className="h-auto rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-700/90 hover:bg-rose-500/10 dark:text-rose-300/80"
                title={errExpanded ? "收起错误详情" : "展开错误详情"}
              >
                {errExpanded ? "▲" : "▼"}
              </Button>
              <Button
                variant="outline"
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
                            ts:
                              errorContext?.timestamp ??
                              new Date().toISOString(),
                          },
                          null,
                          2,
                        ),
                      );
                    } catch {
                      /* 剪贴板不可用 —— 静默；用户仍可
                       *  手动展开并选中原始错误文本 */
                    }
                  })();
                }}
                className="h-auto rounded border border-rose-400/20 px-1.5 py-0.5 text-[10px] text-rose-700/90 hover:bg-rose-500/10 dark:text-rose-300/80"
                title="复制错误详情到剪贴板（含 taskId 与请求参数）"
              >
                ⧉
              </Button>
            </div>
          </div>

          {/* 收起态摘要：只给原始错误串。保持
           *  既有的单行行为，不需要完整上下文的用户
           *  就不用占竖向空间。 */}
          {!errExpanded && (validationErrors?.length ?? 0) > 0 && (
            <p className="nodrag nopan mt-1 text-[10px] font-medium text-rose-700 dark:text-rose-300">
              发现 {(validationErrors ?? []).length} 项节点配置错误（点击 ▼
              查看明细）
            </p>
          )}
          {!errExpanded && (
            <p className="nodrag nopan mt-1 line-clamp-2 text-[10px] break-words text-rose-700/90 dark:text-rose-300/80">
              {typeof error === "string"
                ? error.replace(/\n/g, " ").slice(0, 200)
                : "（点击 ▼ 展开查看完整错误）"}
            </p>
          )}

          {errExpanded &&
            (() => {
              // 重做失败面板，把「执行了什么」结构化展示。
              //
              // 防御性转换：`d.error` 的类型是 `string`，
              // 但遗留行 / 较老代码路径可能存过
              // 字面量 "[object Object]"（例如 buildPromptError 以前
              // 用 `String(res.error)`），或有结构化对象经竞态漏了进来。
              // 我们（1）识别这个垃圾字符串哨兵，（2）把真对象 JSON.stringify，
              //（3）回落到通用的「无详情」文案。展开的 <pre>
              // 永不显示字面量 `[object Object]`。
              //
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
                  {/* 0) 结构化校验错误：精确指出哪个节点哪个字段 */}
                  {(validationErrors?.length ?? 0) > 0 && (
                    <div className="rounded border border-rose-400/25 bg-rose-500/10 px-2 py-1.5">
                      <div className="mb-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                        节点配置校验（{(validationErrors ?? []).length} 项）
                      </div>
                      <ValidationErrorList
                        errors={validationErrors}
                        className="text-rose-700/90 dark:text-rose-300/80"
                      />
                    </div>
                  )}
                  {/* 1) 任务上下文：taskId（可点击复制）+ 时间 */}
                  {hasCtx && (
                    <div className="bg-canvas-deep grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-rose-400/15 px-1.5 py-1 text-[10px]">
                      {taskId && (
                        <>
                          <span className="text-rose-700 dark:text-rose-300/60">
                            taskId
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(taskId)
                                .catch(() => undefined)
                            }
                            className="nodrag nopan h-auto min-w-0 truncate p-0 text-left font-mono font-normal text-rose-700/90 hover:bg-transparent hover:text-rose-900 dark:text-rose-300/80 dark:hover:text-rose-100"
                            title="点击复制 taskId"
                          >
                            {taskId}
                          </Button>
                        </>
                      )}
                      {ts && (
                        <>
                          <span className="text-rose-700 dark:text-rose-300/60">
                            时间
                          </span>
                          <span className="truncate text-rose-700/90 dark:text-rose-300/80">
                            {ts}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* 2) 自动建议 — 正则推断的纠错提示 */}
                  {errorSuggestion && (
                    <div className="rounded border border-amber-400/25 bg-amber-500/8 px-2 py-1 text-[10px] leading-relaxed text-amber-800 dark:text-amber-200">
                      <span className="mr-1 font-semibold text-amber-700 dark:text-amber-300">
                        建议
                      </span>
                      {errorSuggestion}
                    </div>
                  )}

                  {/* 3) 请求参数快照 */}
                  {errorContext?.request ? (
                    <details className="text-[10px]" open>
                      <summary className="cursor-pointer text-rose-700 select-none hover:text-rose-900 dark:text-rose-300/70 dark:hover:text-rose-200">
                        请求参数
                      </summary>
                      <pre className="bg-canvas-deep nodrag nopan mt-1 max-h-40 overflow-auto rounded border border-rose-400/15 p-1.5 font-mono text-[10px] leading-tight whitespace-pre-wrap text-rose-700/90 dark:text-rose-300/85">
                        {typeof errorContext.request === "string"
                          ? errorContext.request
                          : (() => {
                              try {
                                return JSON.stringify(
                                  errorContext.request,
                                  null,
                                  2,
                                );
                              } catch {
                                // eslint-disable-next-line @typescript-eslint/no-base-to-string -- request 非字符串且 JSON 序列化失败时兜底展示原始对象
                                return String(errorContext.request);
                              }
                            })()}
                      </pre>
                    </details>
                  ) : null}

                  {/* 4) 原始错误详情（保持旧版的 <pre> 风格） */}
                  <details className="text-[10px]" open>
                    <summary className="cursor-pointer text-rose-700 select-none hover:text-rose-900 dark:text-rose-300/70 dark:hover:text-rose-200">
                      原始错误
                    </summary>
                    <pre className="bg-canvas-deep nodrag nopan mt-1 max-h-40 overflow-auto rounded border border-rose-400/15 p-1.5 font-mono text-[10px] leading-tight whitespace-pre-wrap text-rose-700/90 dark:text-rose-300/85">
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
