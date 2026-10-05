"use client";

/* CanvasNode 的可折叠的错误面板。
 * 负责 errExpanded 开关状态 + shouldAutoExpand / errorSuggestion
 * 两个推导，并渲染整个面板 JSX（展开/收起、复制、重试、
 * 建议）。父组件无条件渲染 <ErrorPanel/>；节点不处于
 * 可见错误态时，组件在 hooks 之后返回 null，好让展开状态的
 * 生命周期与拆分前内联 JSX 完全一致（隐藏期间状态保留，
 * running/idle 切换时重置）。 */
import { useMemo, useState } from "react";
import { type CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { Hint } from "~/components/ui/hint";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import {
  copyFailureText,
  useCopyFeedback,
} from "~/components/ui/use-copy-feedback";
import { Alert } from "~/components/ui/alert";
import { Disclosure } from "~/components/ui/disclosure";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";
import { formatLocalStamp } from "~/lib/time-format";
import {
  adviseOnError,
  shouldAutoExpandError,
} from "~/lib/comfyui/error-advice";

/** JSON.stringify 的兜底形态：序列化失败（循环引用等）回落 `String()`。
 *  展示给用户的错误详情永不抛错。 */
function jsonOrString(value: unknown, pretty = false): string {
  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

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
   * 可展开查看后端原始错误（含 ComfyUI traceback）。
   * 每次新运行开始时重置为收起，好让下一次失败
   * 以干净状态呈现，用户不会看到上次残留的展开态。
   *
   * 错误信息里出现 ComfyUI 的
   *"Node X not found" /"OOM" /"Cannot find model" / 5xx 形态时，
   * 面板自动展开，让用户能看到可行动的
   * 上下文（taskId、请求 payload、建议）。 */
  const [errExpanded, setErrExpanded] = useState(false);
  /* 每次新运行开始时重置为收起（渲染期间调整，
   * React 19 模式）。 */
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "running" || status === "idle") setErrExpanded(false);
  }

  /* 结构化 / 可行动的错误上自动展开，好让建议 +
   * 请求 payload 区不用多点一次就看得见。 */
  const shouldAutoExpand = shouldAutoExpandError(
    error,
    validationErrors?.length ?? 0,
  );
  /* 可行动错误上自动展开（渲染期间调整，React 19
   * 模式）。 */
  const [prevErrCtx, setPrevErrCtx] = useState(`${status}|${shouldAutoExpand}`);
  const errCtx = `${status}|${shouldAutoExpand}`;
  if (errCtx !== prevErrCtx) {
    setPrevErrCtx(errCtx);
    if (status === "error" && shouldAutoExpand) setErrExpanded(true);
  }

  /* 两枚复制按钮的成败反馈（规范 16 §16.2.4.43）：详情那枚失败时改口（旁边
   * 就是可手动选中的原文，说一句「复制失败」比静默有用）；taskId 那枚**显式
   * 静默** —— 它本身就是一段可见文本，点它只是省一次选中。 */
  const [detailCopyFailed, setDetailCopyFailed] = useState(false);
  const copyDetail = useCopyFeedback({
    onSuccess: () => setDetailCopyFailed(false),
    onFailure: () => setDetailCopyFailed(true),
  });
  const copyTaskId = useCopyFeedback({ onFailure: "silent" });

  /* 对错误文本做模式匹配，给出一行可行动的提示。
   * 认不出失败形态时返回 null（UI 保留通用的原始错误块，
   * 而不是编造不靠谱的建议）。 */
  const errorSuggestion: string | null = useMemo(
    () => adviseOnError(error),
    [error],
  );

  /* 展开态的错误详情派生 —— 防御性转换：`d.error` 的类型是`string`，
   * 但遗留行 / 较老代码路径可能存过字面量"[object Object]"（例如
   * buildPromptError 以前用`String(res.error)`），或有结构化对象经竞态
   * 漏了进来。识别垃圾字符串哨兵 → 真对象 JSON 化 → 兜底通用文案；
   * 展开的 <pre> 永不显示字面量`[object Object]`。 */
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
    errText = jsonOrString(raw, true);
  }

  const rawTs = errorContext?.timestamp;
  let ts: string | null = null;
  if (rawTs) {
    const dt = new Date(rawTs);
    ts = Number.isNaN(dt.getTime()) ? rawTs : formatLocalStamp(dt);
  }
  const hasCtx =
    Boolean(taskId) ||
    Boolean(ts) ||
    Boolean(errorContext?.request) ||
    Boolean(errorSuggestion);

  /* 节点没在显示可行动错误时整体隐藏。放在 hooks 之后
   * （而不是在父级拦住挂载），好让展开 / 重置生命周期
   * 每次渲染都跑一遍，与原来的
   * 内联块完全一致。 */
  if (!(status === "error" && (error || (validationErrors?.length ?? 0) > 0))) {
    return null;
  }

  return (
    <div className="nodrag nopan border-destructive/30 bg-destructive/6 border-t px-3 py-2 text-[10.5px]">
      <div className="flex items-start gap-1.5">
        <Icon
          name="alert"
          size={12}
          className="text-danger-strong mt-px shrink-0"
        />
        <div className="min-w-0 flex-1">
          {/* 头部行：状态徽标 + 工作流名 + 动作 */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-danger-strong min-w-0 truncate font-medium">
              {errorStatus === "TIMEOUT"
                ? "轮询超时"
                : errorStatus === "CANCELLED"
                  ? "任务被取消"
                  : errorStatus
                    ? "生成失败"
                    : "未捕获异常"}
              <span className="text-danger-strong/60 ml-1">
                · {errorStatus ? `task ${errorStatus}` : "client"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {kind === "workflow" && workflowName && (
                <span
                  className="border-destructive/15 bg-destructive/10 text-danger-strong/80 rounded border px-1.5 py-0.5 font-mono text-[9.5px]"
                  title="执行的工作流"
                >
                  {/* 转型说明：CanvasNodeData 有 [key: string]: unknown
                   * 索引签名，会在 JSX 读取时把 d.workflowName 放宽成
                   * unknown。显式 String() 修好
                   * ReactNode 兼容性，照顾少见的包裹联合。
                   */}
                  {String(workflowName)}
                </span>
              )}
              {/* 用同一份参数重跑。仅当有 taskId（即任务真的跑过）且不是
               * 预检阶段的校验错误时才出现。用 Boolean() 包一层是为了让 TS
               * 满意 ——`d.errorContext?.request` 的类型是`unknown`。 */}
              {Boolean(errorContext?.request) && taskId && (
                <Hint label="用相同参数重跑一次">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void onRetry(errorContext?.request);
                    }}
                    className="border-destructive/20 text-danger-strong/90 hover:bg-destructive/10 text-3xs h-auto rounded border px-1.5 py-0.5"
                  >
                    ↻ 重试
                  </Button>
                </Hint>
              )}
              <Hint
                label={errExpanded ? "收起错误详情" : "展开错误详情"}
                accessibleName
              >
                <Button
                  variant="outline"
                  onClick={() => setErrExpanded((value) => !value)}
                  className="border-destructive/20 text-danger-strong/90 hover:bg-destructive/10 text-3xs h-auto rounded border px-1.5 py-0.5"
                >
                  {errExpanded ? "▲" : "▼"}
                </Button>
              </Hint>
              <Hint
                label={
                  detailCopyFailed
                    ? copyFailureText("下方展开区")
                    : "复制错误详情到剪贴板（含 taskId 与请求参数）"
                }
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    copyDetail(
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
                              : jsonOrString(error),
                          request: errorContext?.request ?? null,
                          ts:
                            errorContext?.timestamp ?? new Date().toISOString(),
                        },
                        null,
                        2,
                      ),
                    );
                  }}
                  className="border-destructive/20 text-danger-strong/90 hover:bg-destructive/10 text-3xs h-auto rounded border px-1.5 py-0.5"
                >
                  {detailCopyFailed ? "复制失败" : "⧉"}
                </Button>
              </Hint>
            </div>
          </div>

          {/* 收起态摘要：只给原始错误串。保持
           * 既有的单行行为，不需要完整上下文的用户
           * 就不用占竖向空间。 */}
          {!errExpanded && (validationErrors?.length ?? 0) > 0 && (
            <p className="nodrag nopan text-danger-strong text-3xs mt-1 font-medium">
              发现 {(validationErrors ?? []).length} 项节点配置错误（点击 ▼
              查看明细）
            </p>
          )}
          {!errExpanded && (
            <p className="nodrag nopan text-danger-strong/80 text-3xs mt-1 line-clamp-2 wrap-break-word">
              {typeof error === "string"
                ? clampText(error.replace(/\n/g, ""), {
                    maxLength: INLINE_SNIPPET_MAX,
                    marker: "",
                  })
                : "（点击 ▼ 展开查看完整错误）"}
            </p>
          )}

          {errExpanded && (
            <div className="nodrag nopan mt-1.5 flex flex-col gap-1.5">
              {/* 重做失败面板，把「执行了什么」结构化展示。派生
               * （errText / ts / hasCtx）在组件体，见 return 之前。 */}
              {/* 0) 结构化校验错误：精确指出哪个节点哪个字段 */}
              {(validationErrors?.length ?? 0) > 0 && (
                <div className="border-destructive/25 bg-destructive/10 rounded border px-2 py-1.5">
                  <div className="text-danger-strong text-3xs mb-1 font-semibold">
                    节点配置校验（{(validationErrors ?? []).length} 项）
                  </div>
                  <ValidationErrorList
                    errors={validationErrors}
                    className="text-danger-strong/80"
                  />
                </div>
              )}
              {/* 1) 任务上下文：taskId（可点击复制）+ 时间 */}
              {hasCtx && (
                <div className="bg-canvas-deep border-destructive/15 text-3xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border px-1.5 py-1">
                  {taskId && (
                    <>
                      <span className="text-danger-strong/60">taskId</span>
                      <Hint label="点击复制 taskId">
                        <Button
                          variant="ghost"
                          onClick={() => copyTaskId(taskId)}
                          className="nodrag nopan text-danger-strong/90 hover:text-danger-strong h-auto min-w-0 truncate p-0 text-left font-mono font-normal hover:bg-transparent"
                        >
                          {taskId}
                        </Button>
                      </Hint>
                    </>
                  )}
                  {ts && (
                    <>
                      <span className="text-danger-strong/60">时间</span>
                      <span className="text-danger-strong/80 truncate">
                        {ts}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* 2) 自动建议 — 正则推断的纠错提示 */}
              {errorSuggestion && (
                <Alert
                  variant="warning"
                  className="text-3xs block rounded px-2 py-1 leading-relaxed"
                >
                  <span className="mr-1 font-semibold">建议</span>
                  {errorSuggestion}
                </Alert>
              )}

              {/* 3) 请求参数快照 */}
              {errorContext?.request ? (
                <Disclosure
                  defaultOpen
                  marker="caret"
                  className="text-danger-strong text-3xs hover:brightness-110"
                  panelClassName="text-3xs"
                  trigger="请求参数"
                >
                  <pre className="bg-canvas-deep nodrag nopan border-destructive/15 text-danger-strong/85 text-3xs mt-1 max-h-40 overflow-auto rounded border p-1.5 font-mono leading-tight whitespace-pre-wrap">
                    {typeof errorContext.request === "string"
                      ? errorContext.request
                      : jsonOrString(errorContext.request, true)}
                  </pre>
                </Disclosure>
              ) : null}

              {/* 4) 原始错误详情（保持旧版的 <pre> 风格） */}
              <Disclosure
                defaultOpen
                marker="caret"
                className="text-danger-strong text-3xs hover:brightness-110"
                panelClassName="text-3xs"
                trigger="原始错误"
              >
                <pre className="bg-canvas-deep nodrag nopan border-destructive/15 text-danger-strong/85 text-3xs mt-1 max-h-40 overflow-auto rounded border p-1.5 font-mono leading-tight whitespace-pre-wrap">
                  {errText}
                </pre>
              </Disclosure>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
