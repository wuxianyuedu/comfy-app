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
import type { ValidationError } from "@/lib/comfyui/validation";
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
import { ValidationErrorList } from "@/components/studio/shared/ValidationErrorList";
import { vanillaApi } from "~/trpc/vanilla";

/** Runtime shape of an SSE frame from /api/tasks/[id]/stream — only the
 *  fields this panel consumes.  `JSON.parse` yields `unknown`; the guards
 *  below narrow each field before use. */
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
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  progress: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
};

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
    case "error": return "ERROR";
    case "warn": return "WARN";
    case "success": return "OK";
    case "progress": return "PROG";
    default: return "INFO";
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

  /* Modal open state — the switch only reveals the trigger button;
   * clicking it (or starting a new task) opens the modal. */
  const [open, setOpen] = useState(false);

  const [viewTaskId, setViewTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<StepLogEntry[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /* 过滤改为单选（与应用日志同款交互），默认「全部」。 */
  const [filter, setFilter] = useState<Level | "all">("all");
  /* 弹窗宽度切换：默认 max-w-5xl，点击加宽到 max-w-7xl。 */
  const [wide, setWide] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [cancellingFromPanel, setCancellingFromPanel] = useState(false);

  /* Auto-open when a new task starts while debug mode is on. */
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTaskId && activeTaskId !== prevActiveRef.current && debugMode) {
      setOpen(true);
    }
    prevActiveRef.current = activeTaskId ?? null;
  }, [activeTaskId, debugMode]);

  /* Reset view to the active task when none is explicitly pinned. */
  const taskId = viewTaskId ?? activeTaskId;
  useEffect(() => {
    if (activeTaskId && !viewTaskId) setViewTaskId(activeTaskId);
  }, [activeTaskId, viewTaskId]);

  /* Cancel the currently viewed task from inside the panel. */
  const onCancelFromPanel = async () => {
    if (!taskId || cancellingFromPanel) return;
    setCancellingFromPanel(true);
    try {
      await vanillaApi.task.cancel.mutate({ id: taskId });
    } catch (e) {
      setError(`取消请求异常：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCancellingFromPanel(false);
    }
  };

  const esRef = useRef<EventSource | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const loadedForRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Re-seed from cache whenever the viewed task changes.
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

  // Subscribe to the task SSE stream.
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
            if (prev.some((prev) => prev.t === entry.t && prev.msg === entry.msg)) return prev;
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
            if (typeof msg.error === "string") setError(msg.error);
          }
          if (msg.workflowName || msg.status) {
            patchStepLogMeta(tid, {
              workflowName: typeof msg.workflowName === "string" ? msg.workflowName : undefined,
              status: typeof msg.status === "string" ? msg.status : undefined,
              nodeId: getNodeIdByTaskId(tid) ?? undefined,
            });
          }
        } else if (msg.type === "done") {
          if (lastStatusRef.current !== "SUCCEEDED") lastStatusRef.current = "SUCCEEDED";
          setStatus("SUCCEEDED");
          es.close();
          esRef.current = null;
        } else if (msg.type === "error") {
          if (lastStatusRef.current !== "FAILED") lastStatusRef.current = "FAILED";
          setStatus("FAILED");
          if (typeof msg.error === "string") setError(msg.error);
          es.close();
          esRef.current = null;
        }
      } catch {
        /* malformed SSE frame — ignore */
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

  // 20s no-activity "stuck" hint.
  useEffect(() => {
    if (!taskId) return;
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle > 20000 && status === "RUNNING") {
        const now = Date.now();
        setLogs((prev) => {
          if (prev.length && prev[prev.length - 1]!.msg.includes("无新日志") && now - prev[prev.length - 1]!.t < 5000)
            return prev;
          return [...prev, { t: now, level: "warn", msg: "⏳ 已 20s 无新日志，任务可能卡住（详见后端 runner 日志）" }];
        });
        lastActivityRef.current = now;
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [taskId, status]);

  // Auto-scroll to bottom.
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, filter, autoscroll]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cachedIds = useMemo(() => listCachedTaskIds(), [logs, validationErrors, taskId]);

  /* 把每个已缓存的 taskId 映射回画布节点短序号 (#1, #2…)。
   * 映射来源：运行开始时 setActiveTaskId(taskId, nodeId) 写进 activeTask，
   * 随后通过 patchStepLogMeta 持久化到 stepLogCache。 */
  const nodes = useNodes();
  const nodeSeqByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cachedId of cachedIds) {
      const nodeId = getNodeIdByTaskId(cachedId) ?? loadStepLogPanelState(cachedId)?.nodeId;
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
  const visible = filter === "all" ? visibleAll : visibleAll.filter((log) => log.level === filter);
  const valErrs = validationErrors ?? [];
  const statusLabel =
    status === "SUCCEEDED" ? "完成" : status === "FAILED" ? "失败" : status === "CANCELLED" ? "已取消"
    : status === "RUNNING" ? `运行中 ${progress}%` : status ?? "—";
  const statusClass =
    status === "FAILED" ? "bg-red-500/20 text-red-300"
    : status === "SUCCEEDED" ? "bg-emerald-500/20 text-emerald-300"
    : status === "RUNNING" ? "bg-violet-500/20 text-violet-300"
    : "bg-white/6 text-gray-400";

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
      {/* Floating trigger button — only rendered while debug mode is on. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="打开执行日志"
        data-testid="step-log-trigger"
        className="pointer-events-auto fixed right-3 top-16 z-30 flex items-center gap-1.5 rounded-md border border-white/10 bg-(--color-panel)/90 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 shadow-lg backdrop-blur-sm transition-colors hover:border-white/25 hover:text-gray-100"
      >
        <FileText size={12} />
        执行日志
        {errorCount > 0 && (
          <span className="rounded-full bg-rose-500/20 px-1 text-[10px] text-rose-300">
            {errorCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className={`flex h-[85vh] w-full ${wide ? "max-w-[96vw]" : "max-w-5xl"} flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#12101c] shadow-2xl shadow-black/60`}>
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-white/2 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={16} className="shrink-0 text-violet-400" />
                <span className="truncate text-[15px] font-semibold text-gray-100">
                  执行日志
                </span>
                <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${statusClass}`}>
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
                {taskId && status !== "SUCCEEDED" && status !== "FAILED" && status !== "CANCELLED" ? (
                  <button
                    type="button"
                    onClick={onCancelFromPanel}
                    disabled={cancellingFromPanel}
                    title="取消当前查看的任务"
                    data-testid="log-panel-cancel"
                    className="rounded-md border border-red-500/30 bg-red-500/8 px-2 py-0.5 text-[10.5px] text-red-200/90 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                  >
                    {cancellingFromPanel ? "× 取消中…" : "× 取消"}
                  </button>
                ) : null}
                {cachedIds.length > 0 && (
                  <select
                    value={taskId ?? ""}
                    onChange={(event) => setViewTaskId(event.target.value || null)}
                    className="max-w-[200px] truncate rounded-md border border-white/10 bg-(--color-panel) px-1.5 py-0.5 text-[10.5px] text-gray-300 outline-none"
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
                      const displayParts = [seqLabel, wn ?? `task ${id.slice(0, 8)}`, st].filter(Boolean);
                      return (
                        <option key={id} value={id} title={titleParts.join(" · ")}>
                          {displayParts.join(" · ")}
                        </option>
                      );
                    })}
                  </select>
                )}
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-md border border-white/10 bg-white/4 px-2 py-0.5 text-[10.5px] text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setWide((w) => !w)}
                  title={wide ? "收缩" : "加宽"}
                  className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
                >
                  {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="关闭"
                  className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Level filter bar — 与应用日志同款单选按钮 */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-white/2 px-4 py-1.5">
              <div className="flex items-center gap-1">
                {FILTER_LABELS.map((option) => {
                  const count =
                    option.value === "all"
                      ? visibleAll.length
                      : visibleAll.filter((l) => l.level === option.value).length;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilter(option.value)}
                      title={`${option.label}（${count} 条）`}
                      data-testid={`log-filter-${option.value}`}
                      className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                        filter === option.value
                          ? "bg-white/10 text-gray-100"
                          : "text-gray-500 hover:bg-white/4 hover:text-gray-300"
                      }`}
                    >
                      {option.label}
                      <span className="ml-1 text-[11px] text-gray-600">{count}</span>
                    </button>
                  );
                })}
              </div>
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-gray-400">
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
              className="custom-scrollbar flex-1 overflow-y-auto bg-[#0d0d14]/60"
            >
              {valErrs.length > 0 && (
                <div className="mb-2 rounded border border-red-500/40 bg-red-500/8 p-2">
                  <div className="mb-1.5 text-[13px] font-semibold text-red-300">
                    ⚠ 工作流验证错误（{valErrs.length}）
                  </div>
                  <ValidationErrorList errors={valErrs.slice(0, 12)} className="text-red-200/95" />
                  {valErrs.length > 12 && (
                    <div className="mt-1 text-[12px] text-red-300/70">+{valErrs.length - 12} more…</div>
                  )}
                </div>
              )}

              {!valErrs.length && error && (
                <div className="mb-2 space-y-1 rounded border border-red-500/30 bg-red-500/6 p-2 text-[13px] text-red-200/90">
                  <div className="break-words whitespace-pre-wrap">{error}</div>
                </div>
              )}

              {visible.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-gray-600">
                  <FileText size={32} strokeWidth={1.5} className="opacity-30" />
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
                        className="flex items-start gap-2.5 border-b border-white/3 px-4 py-1 font-mono text-[13px] leading-snug hover:bg-white/2"
                      >
                        <span className="shrink-0 text-gray-500">{fmtTime(log.t)}</span>
                        <span
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
                        >
                          {levelLabel(log.level)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 break-words ${
                            isClient ? "italic text-gray-400" : "text-gray-300"
                          }`}
                        >
                          {log.msg}
                        </span>
                        {log.src && (
                          <span className="max-w-[200px] shrink-0 truncate text-[11px] text-gray-600 hover:text-gray-400">
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
            <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/8 bg-white/2 px-4 text-[12px] text-gray-500">
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
