"use client";

/**
 * GlobalStepLogPanel —— 全局执行步骤日志面板
 *
 * 设计决策（Why 弹窗而非底部抽屉）：
 *   1. 底部抽屉会压缩画布可用空间；
 *   2. 与右下 MiniMap、底部状态栏容易重叠。
 * 故采用「应用日志」同款的居中弹窗。
 *
 * 交互约定：
 *   - 「调试模式」开关仅控制入口按钮显隐；
 *   - 弹窗打开后不受该开关影响，避免操作中突然消失。
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNodes } from "@xyflow/react";
import { FileText, X, Maximize2, Minimize2 } from "lucide-react";
import type { ValidationError } from "~/lib/comfyui/validation";
import type { StepLogEntry } from "./stepLogCache";
import {
  appendStepLog,
  clearStepLogPanelState,
  listCachedTaskIds,
  loadStepLogPanelState,
  patchStepLogMeta,
  setStepLogValidationErrors,
} from "./stepLogCache";
import { useActiveTaskId, getNodeIdByTaskId } from "./activeTask";
import { useCanvasSettings } from "../canvas/WorkflowCanvasSettings";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Button } from "~/components/ui/button";
import { useCancelTask } from "./hooks/use-cancel-task";
import { overlayClass } from "~/lib/full-screen-layer";

/** /api/tasks/[id]/stream 的 SSE 帧的运行时形状 —— 只含
 *  本面板消费的字段。`JSON.parse` 产出 `unknown`；下面的守卫
 *  逐个收窄字段后再用。 */
interface SseFrame {
  type?: unknown;
  entry?: unknown;
  validationErrors?: unknown;
  status?: unknown;
  progress?: unknown;
  error?: unknown;
  workflowName?: unknown;
}

type Level = StepLogEntry["level"];

/* 与应用日志 (LogPanel) 同款 level badge 配色。 */
const LEVEL_STYLES: Record<Level, string> = {
  error: "border-rose-500/20 bg-rose-500/15 text-rose-700 dark:text-rose-400",
  warn: "border-amber-500/20 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  success:
    "border-emerald-500/20 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  progress:
    "border-violet-500/20 bg-violet-500/15 text-violet-700 dark:text-violet-400",
  info: "border-cyan-500/20 bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
};

/** 把「失败原因」补写为一条 error 日志行（横幅之外）。
 *
 *  SSE 的 `state` / `error` 帧只带一个原因字符串、可能不带对应 `log` 帧
 *  （典型：dev server 重启后由 reaper 收口、或 DB 轮询补发的终态）。此前
 *  面板只把这个原因渲染成顶部横幅，用户按「错误 / 警告」筛选或回放时间线时
 *  根本看不到失败原因（ISSUE #378）。
 *
 *  纯函数 + 显式 next：去重判断在 updater 之外完成，避免在 setState 的
 *  updater 里做副作用（StrictMode 下 updater 可能被调用两次）。 */
function withFailureLogLine(
  prev: StepLogEntry[],
  reason: string,
  now: number,
): StepLogEntry[] {
  if (!reason) return prev;
  const text = `✗ 生成失败：${reason}`;
  const last = prev[prev.length - 1];
  /* 末行已是同因错误（服务端自己写过 ✗ 生成失败）→ 不重复追加。 */
  if (
    last?.level === "error" &&
    typeof last.msg === "string" &&
    last.msg.includes(reason)
  ) {
    return prev;
  }
  return [...prev, { t: now, level: "error", msg: text, client: true }];
}

/** 把上面那条日志行同时写进（跨卸载存活的）缓存与组件 state。 */
function appendFailureLogLine(
  taskId: string,
  reason: string,
  setLogs: React.Dispatch<React.SetStateAction<StepLogEntry[]>>,
): void {
  const t = Date.now();
  appendStepLog(taskId, {
    t,
    level: "error",
    msg: `✗ 生成失败：${reason}`,
    client: true,
  });
  setLogs((prev) => withFailureLogLine(prev, reason, t));
}

const FILTER_LABELS: { label: string; value: Level | "all" }[] = [
  { label: "全部", value: "all" },
  { label: "错误", value: "error" },
  { label: "警告", value: "warn" },
  { label: "完成", value: "success" },
  { label: "进度", value: "progress" },
  { label: "信息", value: "info" },
];

function levelLabel(level: Level): string {
  switch (level) {
    case "error":
      return "ERROR";
    case "warn":
      return "WARN";
    case "success":
      return "OK";
    case "progress":
      return "PROG";
    default:
      return "INFO";
  }
}

/* 与应用日志同款，带毫秒。 */
function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export const GlobalStepLogPanel = React.memo(function GlobalStepLogPanel() {
  const { settings } = useCanvasSettings();
  const debugMode = settings.debugMode;
  const activeTaskId = useActiveTaskId();

  /* 弹窗打开状态 —— 开关只露出触发按钮；
   * 点它才打开弹窗。新任务开始不再自动弹窗，避免打断画布
   * 操作；日志仍由本面板托管，用户随时可点「执行日志」进入查看。 */
  const [open, setOpen] = useState(false);

  const [viewTaskId, setViewTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<StepLogEntry[]>([]);
  const [validationErrors, setValidationErrors] = useState<
    ValidationError[] | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /* 过滤改为单选（与应用日志同款交互），默认「全部」。 */
  const [filter, setFilter] = useState<Level | "all">("all");
  /* 弹窗宽度切换：默认 max-w-5xl，点击加宽到 max-w-7xl。 */
  const [wide, setWide] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);

  /* 没有显式钉住时，视图重置到活跃任务。 */
  const taskId = viewTaskId ?? activeTaskId;
  useEffect(() => {
    if (activeTaskId && !viewTaskId) setViewTaskId(activeTaskId);
  }, [activeTaskId, viewTaskId]);

  /* 从面板内部取消当前查看的任务。
   * 「取消中…」态与失败文案都在 useCancelTask 里（视图零 IO）。 */
  const { cancelling: cancellingFromPanel, cancel: cancelFromPanel } =
    useCancelTask({ taskId, onFailed: setError });
  const onCancelFromPanel = () => {
    // 无任务时按钮本就禁用（下方 disabled），这里只是防重复点击的兜底。
    if (!taskId) return;
    return cancelFromPanel();
  };

  const esRef = useRef<EventSource | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const loadedForRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // 被查看任务一变化就重新从缓存播种。
  useEffect(() => {
    if (!taskId) return;
    if (loadedForRef.current !== taskId) {
      loadedForRef.current = taskId;
      const cached = loadStepLogPanelState(taskId);
      setLogs(cached?.logs ?? []);
      setValidationErrors(cached?.validationErrors ?? null);
      setStatus(null);
      setProgress(0);
      setError(null);
      lastStatusRef.current = null;
      lastActivityRef.current = Date.now();
    }
  }, [taskId]);

  // 订阅该任务的 SSE 流。
  useEffect(() => {
    if (!taskId) {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
      return;
    }
    const tid = taskId;
    taskIdRef.current = tid;
    lastActivityRef.current = Date.now();

    const es = new EventSource(`/api/tasks/${tid}/stream`);
    esRef.current = es;
    setConnected(false);
    es.onopen = () => {
      setConnected(true);
      lastActivityRef.current = Date.now();
    };
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as SseFrame;
        lastActivityRef.current = Date.now();
        if (msg.type === "log" && msg.entry) {
          const entry = msg.entry as StepLogEntry;
          appendStepLog(tid, entry);
          setLogs((prev) => {
            if (
              prev.some((prev) => prev.t === entry.t && prev.msg === entry.msg)
            )
              return prev;
            return [...prev, entry];
          });
        } else if (msg.type === "state") {
          if (Array.isArray(msg.validationErrors)) {
            const ves = msg.validationErrors as ValidationError[];
            setStepLogValidationErrors(tid, ves);
            setValidationErrors(ves);
          }
          if (typeof msg.status === "string" && msg.status) {
            const st = String(msg.status);
            const pct = Number(msg.progress ?? 0);
            if (lastStatusRef.current !== st) lastStatusRef.current = st;
            setStatus(st);
            if (Number.isFinite(pct)) setProgress(pct);
            if (typeof msg.error === "string") {
              setError(msg.error);
              /* 失败原因同时补一条 error 日志行：横幅只在顶部显示，用户
               *  按「错误 / 警告」筛选或回放时间线时看不到它（ISSUE #378）。 */
              if (st === "FAILED" || st === "ERROR" || st === "CANCELLED") {
                appendFailureLogLine(tid, msg.error, setLogs);
              }
            }
          }
          if (msg.workflowName || msg.status) {
            patchStepLogMeta(tid, {
              workflowName:
                typeof msg.workflowName === "string"
                  ? msg.workflowName
                  : undefined,
              status: typeof msg.status === "string" ? msg.status : undefined,
              nodeId: getNodeIdByTaskId(tid) ?? undefined,
            });
          }
        } else if (msg.type === "done") {
          if (lastStatusRef.current !== "SUCCEEDED")
            lastStatusRef.current = "SUCCEEDED";
          setStatus("SUCCEEDED");
          es.close();
          esRef.current = null;
        } else if (msg.type === "error") {
          if (lastStatusRef.current !== "FAILED")
            lastStatusRef.current = "FAILED";
          setStatus("FAILED");
          if (typeof msg.error === "string") {
            setError(msg.error);
            appendFailureLogLine(tid, msg.error, setLogs);
          }
          es.close();
          esRef.current = null;
        }
      } catch {
        /* SSE 帧格式错误 —— 忽略 */
      }
    };
    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [taskId]);

  // 20 秒无活动的「卡住」提示。
  useEffect(() => {
    if (!taskId) return;
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle > 20000 && status === "RUNNING") {
        const now = Date.now();
        setLogs((prev) => {
          if (
            prev.length &&
            prev[prev.length - 1]!.msg.includes("无新日志") &&
            now - prev[prev.length - 1]!.t < 5000
          )
            return prev;
          return [
            ...prev,
            {
              t: now,
              level: "warn",
              msg: "⏳ 已 20s 无新日志，任务可能卡住（详见后端 runner 日志）",
            },
          ];
        });
        lastActivityRef.current = now;
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [taskId, status]);

  // 自动滚到底部。
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, filter, autoscroll]);

  const cachedIds = useMemo(
    () => listCachedTaskIds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, validationErrors, taskId],
  );

  /* 把每个已缓存的 taskId 映射回画布节点短序号 (#1, #2…)。
   * 映射来源：运行开始时 setActiveTaskId(taskId, nodeId) 写进 activeTask，
   * 随后通过 patchStepLogMeta 持久化到 stepLogCache。 */
  const nodes = useNodes();
  const nodeSeqByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cachedId of cachedIds) {
      const nodeId =
        getNodeIdByTaskId(cachedId) ?? loadStepLogPanelState(cachedId)?.nodeId;
      if (!nodeId) continue;
      const idx = nodes.findIndex((node) => node.id === nodeId);
      if (idx !== -1) map.set(cachedId, idx + 1);
    }
    return map;
  }, [cachedIds, nodes]);

  /* 弹窗已打开时不受 debugMode 开关影响（关闭开关不应让正在查看的日志
   * 瞬间消失）；关闭弹窗后入口按钮与弹窗一起隐藏。 */
  if (!debugMode && !open) return null;

  const visibleAll = logs.slice(-300);
  const visible =
    filter === "all"
      ? visibleAll
      : visibleAll.filter((log) => log.level === filter);
  const valErrs = validationErrors ?? [];
  const statusLabel =
    status === "SUCCEEDED"
      ? "完成"
      : status === "FAILED"
        ? "失败"
        : status === "CANCELLED"
          ? "已取消"
          : status === "RUNNING"
            ? `运行中 ${progress}%`
            : (status ?? "—");
  const statusClass =
    status === "FAILED"
      ? "bg-red-500/20 text-red-700 dark:text-red-300"
      : status === "SUCCEEDED"
        ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
        : status === "RUNNING"
          ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
          : "bg-subtle text-ink-soft";

  const errorCount = visibleAll.filter((l) => l.level === "error").length;

  const onClear = () => {
    if (taskId) clearStepLogPanelState(taskId);
    setLogs([]);
    setValidationErrors(null);
    setStatus(null);
    setProgress(0);
    setError(null);
    loadedForRef.current = null;
  };

  return (
    <>
      {/* 浮动触发按钮 —— 仅调试模式开启时渲染。 */}
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        title="打开执行日志"
        data-testid="step-log-trigger"
        className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright pointer-events-auto fixed top-16 right-3 z-30 h-auto items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-sm"
      >
        <FileText size={12} />
        执行日志
        {errorCount > 0 && (
          <span className="rounded-full bg-rose-500/20 px-1 text-[10px] text-rose-700 dark:text-rose-300">
            {errorCount}
          </span>
        )}
      </Button>

      {open && (
        <div
          className={overlayClass(
            "modal",
            "bg-canvas-deep z-50 flex items-center justify-center p-4 backdrop-blur-sm dark:bg-black/60",
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className={`flex h-[85vh] w-full ${wide ? "max-w-[96vw]" : "max-w-5xl"} border-border-strong bg-panel flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/60`}
          >
            {/* Header */}
            <div className="border-border-strong bg-surface-1 flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileText
                  size={16}
                  className="shrink-0 text-violet-700 dark:text-violet-400"
                />
                <span className="text-ink-bright truncate text-[15px] font-semibold">
                  执行日志
                </span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-medium ${statusClass}`}
                >
                  {statusLabel}
                </span>
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    connected
                      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                      : "bg-gray-600"
                  }`}
                  title={connected ? "SSE 已连接" : "SSE 未连接"}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {taskId &&
                status !== "SUCCEEDED" &&
                status !== "FAILED" &&
                status !== "CANCELLED" ? (
                  <Button
                    variant="outline"
                    onClick={onCancelFromPanel}
                    disabled={cancellingFromPanel}
                    title="取消当前查看的任务"
                    data-testid="log-panel-cancel"
                    className="h-auto rounded-md border border-red-500/30 bg-red-500/8 px-2 py-0.5 text-[10.5px] text-red-700/90 hover:bg-red-500/15 dark:text-red-300/90"
                  >
                    {cancellingFromPanel ? "× 取消中…" : "× 取消"}
                  </Button>
                ) : null}
                {cachedIds.length > 0 && (
                  <select
                    value={taskId ?? ""}
                    onChange={(event) =>
                      setViewTaskId(event.target.value || null)
                    }
                    className="bg-panel border-border-strong text-ink-soft max-w-[200px] truncate rounded-md border px-1.5 py-0.5 text-[10.5px] outline-none"
                    title="切换查看的任务"
                  >
                    {!taskId && <option value="">（无任务）</option>}
                    {cachedIds.map((id) => {
                      const meta = loadStepLogPanelState(id);
                      const seq = nodeSeqByTaskId.get(id);
                      const wn = meta?.workflowName?.trim();
                      const st = meta?.status ?? "?";
                      const seqLabel = seq ? `#${seq}` : null;
                      const titleParts = [seqLabel, wn, st, id].filter(Boolean);
                      const displayParts = [
                        seqLabel,
                        wn ?? `task ${id.slice(0, 8)}`,
                        st,
                      ].filter(Boolean);
                      return (
                        <option
                          key={id}
                          value={id}
                          title={titleParts.join(" · ")}
                        >
                          {displayParts.join(" · ")}
                        </option>
                      );
                    })}
                  </select>
                )}
                <Button
                  variant="outline"
                  onClick={onClear}
                  className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright h-auto rounded-md border px-2 py-0.5 text-[10.5px]"
                >
                  清空
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setWide((w) => !w)}
                  title={wide ? "收缩" : "加宽"}
                  className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                >
                  {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  title="关闭"
                  className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                >
                  <X size={16} />
                </Button>
              </div>
            </div>

            {/* Level filter bar — 与应用日志同款单选按钮 */}
            <div className="border-border-strong bg-surface-1 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5">
              <div className="flex items-center gap-1">
                {FILTER_LABELS.map((option) => {
                  const count =
                    option.value === "all"
                      ? visibleAll.length
                      : visibleAll.filter((l) => l.level === option.value)
                          .length;
                  return (
                    <Button
                      key={option.value}
                      variant="ghost"
                      onClick={() => setFilter(option.value)}
                      title={`${option.label}（${count} 条）`}
                      data-testid={`log-filter-${option.value}`}
                      className={`h-auto rounded-md px-2.5 py-1 text-[13px] font-normal ${
                        filter === option.value
                          ? "bg-surface-2 text-ink-bright"
                          : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
                      }`}
                    >
                      {option.label}
                      <span className="text-ink-fainter ml-1 text-[11px]">
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>
              <label className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-[12px] select-none">
                <input
                  type="checkbox"
                  checked={autoscroll}
                  onChange={(event) => setAutoscroll(event.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
                />
                自动滚动
              </label>
            </div>

            {/* Log body — 与应用日志同款行样式 */}
            <div
              ref={scrollerRef}
              className="custom-scrollbar bg-canvas-deep/60 flex-1 overflow-y-auto"
            >
              {valErrs.length > 0 && (
                <div className="mb-2 rounded border border-red-500/40 bg-red-500/8 p-2">
                  <div className="mb-1.5 text-[13px] font-semibold text-red-700 dark:text-red-300">
                    ⚠ 工作流验证错误（{valErrs.length}）
                  </div>
                  <ValidationErrorList
                    errors={valErrs.slice(0, 12)}
                    className="text-red-700/95 dark:text-red-300/90"
                  />
                  {valErrs.length > 12 && (
                    <div className="mt-1 text-[12px] text-red-700 dark:text-red-300/70">
                      +{valErrs.length - 12} more…
                    </div>
                  )}
                </div>
              )}

              {!valErrs.length && error && (
                <div className="mb-2 space-y-1 rounded border border-red-500/30 bg-red-500/6 p-2 text-[13px] text-red-700/90 dark:text-red-300/90">
                  <div className="break-words whitespace-pre-wrap">{error}</div>
                </div>
              )}

              {visible.length === 0 ? (
                <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                  <FileText
                    size={32}
                    strokeWidth={1.5}
                    className="opacity-30"
                  />
                  {taskId ? "等待日志…" : "运行生成后此处会显示执行步骤日志"}
                </div>
              ) : (
                <div className="flex flex-col">
                  {visible.map((log, index) => {
                    const isClient = log.client === true;
                    return (
                      <div
                        key={`${log.t}:${index}`}
                        data-testid="log-line"
                        data-level={log.level}
                        className="border-border-subtle hover:bg-subtle/60 flex items-start gap-2.5 border-b px-4 py-1 font-mono text-[13px] leading-snug"
                      >
                        <span className="text-ink-muted shrink-0">
                          {fmtTime(log.t)}
                        </span>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
                        >
                          {levelLabel(log.level)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 break-words whitespace-pre-wrap ${
                            isClient ? "text-ink-soft italic" : "text-ink-soft"
                          }`}
                        >
                          {log.msg}
                        </span>
                        {log.src && (
                          <span className="text-ink-fainter hover:text-ink-soft max-w-[200px] shrink-0 truncate text-[11px]">
                            {log.src}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
              <span>
                显示 {visible.length} / 总计 {visibleAll.length} 条
              </span>
              <span>保留最近 300 条</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
