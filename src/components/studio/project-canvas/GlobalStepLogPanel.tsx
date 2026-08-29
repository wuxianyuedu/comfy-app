/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
"use client";

/* ── GlobalStepLogPanel.tsx · R-ardot120 (2026-08-18) ─────────────────────────
 * R-ardot118 之后从「固定 maxHeight 240」改成「可拖动的控制台式日志面板」。
 *
 * 用户痛点:
 *   ① 旧的固定 240px 太挤，看 6 条 validation 错误 + 几十行 node 步骤就溢出
 *      滚动条,且滚动条藏在右下, 用户拖动困难。
 *   ② 日志条目无级别区分, error/warn/info 全部灰底, 错误看不出来显眼。
 *
 * 这次的改法 (Chrome DevTools Console 风格):
 *   • 顶部 8px 手柄, hover 紫色光晕, pointer-events 全局监听拖动改高度
 *   • 高度持久化到 localStorage `comfyapp:canvas-step-log-height:v1`
 *   • 高度范围 [48, 72vh], 向上拖能盖住画布一半, 向下拖能压成一条
 *   • 每条日志前加级别 chip: ERROR ✕ (红) / WARN ⚠ (琥珀) / OK ✓ (绿) /
 *     PROG • (紫) / INFO ℹ (天蓝) — 5 个 chip 都能点切换过滤
 *   • 自动滚动开关(默认开, 用户上滚后保留位置)
 *   • 计数 `visible/visibleAll` 显示在右下角
 *   • 早返 (debug mode off) 在所有 hooks 之后,避免 React
 *     "Rendered more hooks than during the previous render" (R-ardot119)
 *
 * 挂载点: ProjectCanvas.tsx + wf-editor-inner.tsx — 任何想要全局执行日志
 * 的画布根,把 <GlobalStepLogPanel /> 放在最外层 relative / fixed 容器内即可。
 * ─────────────────────────────────────────────────────────────────────── */

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useActiveTaskId } from "./activeTask";
import { useCanvasSettings } from "../workflow-canvas-settings";
import { ValidationErrorList } from "@/components/studio/shared/ValidationErrorList";
import { vanillaApi } from "~/trpc/vanilla";

type Level = StepLogEntry["level"];

const HEIGHT_KEY = "comfyapp:canvas-step-log-height:v1";
const HEIGHT_MIN = 48;                       // 只剩一条 header + filter 的"压扁条"
const HEIGHT_MAX_RATIO = 0.72;               // 最多占视口 72%
const HEIGHT_DEFAULT = 260;                  // 略大于旧 240, 给 chip 条留空间

function levelChip(level: Level): { bg: string; text: string; icon: string; label: string } {
  switch (level) {
    case "error":    return { bg: "bg-red-500/20",    text: "text-red-300",     icon: "✕", label: "ERROR" };
    case "warn":     return { bg: "bg-amber-500/20",  text: "text-amber-300",   icon: "⚠", label: "WARN"  };
    case "success":  return { bg: "bg-emerald-500/20",text: "text-emerald-300", icon: "✓", label: "OK"    };
    case "progress": return { bg: "bg-violet-500/20", text: "text-violet-300",  icon: "•", label: "PROG"  };
    default:         return { bg: "bg-sky-500/15",    text: "text-sky-300",     icon: "ℹ", label: "INFO"  };
  }
}

function fmtTime(t: number): string {
  const ts = new Date(t);
  return `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}:${String(ts.getSeconds()).padStart(2, "0")}`;
}

function loadSavedHeight(): number {
  if (typeof window === "undefined") return HEIGHT_DEFAULT;
  const raw = window.localStorage.getItem(HEIGHT_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  const max = Math.floor(window.innerHeight * HEIGHT_MAX_RATIO);
  if (Number.isFinite(n) && n >= HEIGHT_MIN && n <= max) return n;
  return HEIGHT_DEFAULT;
}

export const GlobalStepLogPanel = React.memo(function GlobalStepLogPanel() {
  const { settings } = useCanvasSettings();
  const debugMode = settings.debugMode;
  const activeTaskId = useActiveTaskId();

  // height 在水合前默认 260,水合后从 localStorage 读
  const [height, setHeight] = useState<number>(HEIGHT_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const [viewTaskId, setViewTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<StepLogEntry[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [filters, setFilters] = useState<Record<Level, boolean>>({
    info: true,
    progress: true,
    warn: true,
    error: true,
    success: true,
  });
  const [autoscroll, setAutoscroll] = useState(true);
  /* R-ardot121 (2026-08-18): the panel now has its own cancel
   *  button (so the user can escape a stuck task without having
   *  to find the picture-node body).  Track the in-flight POST
   *  the same way ImageGenerationPanel does. */
  const [cancellingFromPanel, setCancellingFromPanel] = useState(false);

  useEffect(() => {
    setHeight(loadSavedHeight());
  }, []);

  const taskId = viewTaskId ?? activeTaskId;
  useEffect(() => {
    if (activeTaskId && !viewTaskId) setViewTaskId(activeTaskId);
  }, [activeTaskId, viewTaskId]);

  /* R-ardot121 (2026-08-18): cancel the *currently viewed* task
   *  from inside the log panel.  The /cancel endpoint is the same
   *  one ImageGenerationPanel uses; the runner's cancelTask()
   *  path handles DB-only tasks (no in-memory state) gracefully
   *  after the R-ardot121 reaper rewrote it.  The SSE `error`
   *  event emitted by cancelTask will close the EventSource on
   *  the next tick and patch the panel status to "CANCELLED" /
   *  "error" automatically. */
  const onCancelFromPanel = async () => {
    if (!taskId || cancellingFromPanel) return;
    setCancellingFromPanel(true);
    try {
      await vanillaApi.task.cancel.mutate({ id: taskId });
    } catch (e: any) {
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
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

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
        const msg = JSON.parse(ev.data);
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
          /* R-ardot121 (2026-08-18): remember workflowName + status on
           *  the cache entry so the task-switcher dropdown can label
           *  each id with the workflow name and current status. */
          if (msg.workflowName || msg.status) {
            patchStepLogMeta(tid, {
              workflowName: typeof msg.workflowName === "string" ? msg.workflowName : undefined,
              status: typeof msg.status === "string" ? msg.status : undefined,
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
      // EventSource auto-reconnects; leave esRef as-is so onopen refires.
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [taskId]);

  // 20s no-activity "stuck" hint (R-ardot111, debug-panel flavour).
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

  // 自动滚到底 — 仅当用户贴近底部时。 visible (filter 后) 变化时触发。
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, filters, autoscroll]);

  // ALL hooks above this line. R-ardot119-fix: never put a hook call after a
  // conditional return — the cachedIds useMemo used to live here, which caused
  // "Rendered more hooks than during the previous render" the first time the
  // user toggled 调试模式 ON on the project canvas.
  const cachedIds = useMemo(() => listCachedTaskIds(), [logs, validationErrors, taskId]);

  // Unified debug switch: panel hidden entirely when debug mode is off.
  if (!debugMode) return null;

  // —— render ——
  const visibleAll = logs.slice(-300);
  const visible = visibleAll.filter((visibleAll) => filters[visibleAll.level]);
  const valErrs = validationErrors ?? [];
  const statusLabel =
    status === "SUCCEEDED" ? "完成" : status === "FAILED" ? "失败" : status === "CANCELLED" ? "已取消"
    : status === "RUNNING" ? `运行中 ${progress}%` : status ?? "—";

  const onClear = () => {
    if (taskId) clearStepLogPanelState(taskId);
    setLogs([]);
    setValidationErrors(null);
    setStatus(null);
    setProgress(0);
    setError(null);
    loadedForRef.current = null;
  };

  // Drag handle: 全局 pointer events, top edge of the panel.
  const onHandleDown = (e: React.PointerEvent) => {
    if (collapsed) return;
    dragRef.current = { startY: e.clientY, startH: height };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer capture unavailable — drag still works */ }
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY; // 向上拖 = 正高度
    const max = Math.floor(window.innerHeight * HEIGHT_MAX_RATIO);
    const next = Math.max(HEIGHT_MIN, Math.min(max, dragRef.current.startH + dy));
    setHeight(next);
  };
  const onHandleUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* pointer capture already released — ignore */ }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      const max = Math.floor(window.innerHeight * HEIGHT_MAX_RATIO);
      const clamped = Math.max(HEIGHT_MIN, Math.min(max, height));
      window.localStorage.setItem(HEIGHT_KEY, String(clamped));
    } catch { /* localStorage may be disabled */ }
  };
  const onHandleKey = (e: React.KeyboardEvent) => {
    // 键盘也能调: ↑/PageUp = 加大, ↓/PageDown = 缩小 (10px / 60px)
    const step = e.shiftKey ? 60 : 10;
    const delta = e.key === "ArrowUp" || e.key === "PageUp" ? step : e.key === "ArrowDown" || e.key === "PageDown" ? -step : 0;
    if (!delta) return;
    e.preventDefault();
    const max = Math.floor(window.innerHeight * HEIGHT_MAX_RATIO);
    const next = Math.max(HEIGHT_MIN, Math.min(max, height + delta));
    setHeight(next);
    try { window.localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* localStorage may be disabled — height still applies this session */ }
  };

  const levels: Level[] = ["error", "warn", "success", "progress", "info"];

  return (
    <div
      data-testid="global-step-log-panel"
      className="pointer-events-auto absolute bottom-0 left-3 right-3 z-7 flex flex-col rounded-t-xl border border-b-0 border-white/8 bg-[#0c0c14]/97 shadow-2xl shadow-black/50 backdrop-blur-sm"
      style={{ height: collapsed ? "auto" : height }}
    >
      {/* 拖动手柄: 顶部 8px, hover 紫色, 键盘可调 (↑/↓ = ±10, shift = ±60) */}
      {!collapsed && (
        <div
          role="separator"
          aria-label="拖动调整日志面板高度"
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onKeyDown={onHandleKey}
          className="group/handle flex h-2 shrink-0 cursor-ns-resize items-center justify-center border-b border-white/4 bg-linear-to-b from-white/3 to-transparent transition-colors hover:from-violet-500/20 hover:to-violet-500/5 active:from-violet-500/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-violet-400"
        >
          <span aria-hidden className="h-[2px] w-12 rounded-full bg-white/15 transition-all group-hover/handle:w-16 group-hover/handle:bg-violet-300/70" />
        </div>
      )}

      {/* Header (compact) */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-[12px]">🐞</span>
          <span className="text-[12px] font-semibold tracking-wide text-gray-100">执行日志</span>
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium ${
              status === "FAILED"
                ? "bg-red-500/20 text-red-300"
                : status === "SUCCEEDED"
                ? "bg-emerald-500/20 text-emerald-300"
                : status === "RUNNING"
                ? "bg-violet-500/20 text-violet-300"
                : "bg-white/6 text-gray-400"
            }`}
          >
            {statusLabel}
          </span>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                : "bg-gray-600"
            }`}
            title={connected ? "SSE 已连接" : "SSE 未连接"}
            data-testid="log-panel-sse-dot"
          />
          {debugMode && (
            <span className="rounded-full bg-violet-500/20 px-1.5 py-px text-[10px] text-violet-200">
              含调用位置
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* R-ardot121 (2026-08-18): cancel button lives in the
           *  log panel itself so the user does not have to find the
           *  picture node body (which is unmounted on a project
           *  canvas or when the user is currently looking at the
           *  workflow canvas with a different node selected).  The
           *  /cancel endpoint is idempotent on already-terminal
           *  tasks, so the button is safe to render whenever there
           *  is a viewed taskId; the disabled check is just a UI
           *  hint.  Cancelling a QUEUED row that the in-memory
           *  runner doesn't know about still works — the reaper
           *  in `runner.ts` reaps such rows every 30s anyway. */}
          {taskId && status !== "SUCCEEDED" && status !== "FAILED" && status !== "CANCELLED" ? (
            <button
              type="button"
              onClick={onCancelFromPanel}
              disabled={cancellingFromPanel}
              title="取消当前查看的任务（即使 dev server 重启后丢失了 in-memory 状态，也能强制 mark CANCELLED）"
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
              className="max-w-[260px] truncate rounded-md border border-white/10 bg-(--color-panel) px-1.5 py-0.5 text-[10.5px] text-gray-300 outline-none"
              title="切换查看的任务"
            >
              {!taskId && <option value="">（无任务）</option>}
              {cachedIds.map((id) => {
                /* R-ardot121 (2026-08-18): use the per-task metadata
                 *  (workflowName + status) the panel learned from the
                 *  SSE `state` event.  Fall back to truncated id when
                 *  the cache hasn't seen a state event yet (shouldn't
                 *  happen in practice — the initial snapshot always
                 *  fires one — but kept as a safe default). */
                const meta = loadStepLogPanelState(id);
                const wn = meta?.workflowName?.trim() ?? "(未命名工作流)";
                const st = meta?.status ?? "?";
                return (
                  <option key={id} value={id} title={`${wn} · ${st} · ${id}`}>
                    {wn.length > 18 ? wn.slice(0, 17) + "…" : wn} · {st}
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
            onClick={() => setCollapsed((value) => !value)}
            className="rounded-md border border-white/10 bg-white/4 px-2 py-0.5 text-[10.5px] text-gray-300 transition-colors hover:bg-white/8 hover:text-gray-100"
          >
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 级别过滤条 — Chrome DevTools 风格 chip toggle */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 px-3 py-1.5">
            <span className="text-[10px] text-(--color-ink-muted)">级别</span>
            {levels.map((lv) => {
              const ch = levelChip(lv);
              const on = filters[lv];
              const count = visibleAll.filter((visibleAll) => visibleAll.level === lv).length;
              return (
                <button
                  key={lv}
                  type="button"
                  onClick={() => setFilters((filters) => ({ ...filters, [lv]: !filters[lv] }))}
                  title={`${on ? "隐藏" : "显示"} ${ch.label}（当前 ${count} 条）`}
                  data-testid={`log-filter-${lv}`}
                  className={`flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold transition-all ${
                    on
                      ? `${ch.bg} ${ch.text} ring-1 ring-inset ring-white/10`
                      : "bg-white/3 text-[#5b5b6b] opacity-60 hover:opacity-90 line-through"
                  }`}
                >
                  <span aria-hidden className="text-[10px] leading-none">{ch.icon}</span>
                  {ch.label}
                  {count > 0 && (
                    <span className="ml-0.5 rounded bg-black/30 px-1 text-[9px] tabular-nums leading-none text-white/80">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-(--color-ink-muted)">
              <label className="flex cursor-pointer select-none items-center gap-1">
                <input
                  type="checkbox"
                  checked={autoscroll}
                  onChange={(event) => setAutoscroll(event.target.checked)}
                  className="h-3 w-3 cursor-pointer accent-violet-500"
                />
                自动滚动
              </label>
              <span className="tabular-nums" data-testid="log-count">
                {visible.length}/{visibleAll.length}
              </span>
            </span>
          </div>

          {/* 日志主体 */}
          <div
            ref={scrollerRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 font-mono text-[10.5px] leading-[1.6]"
          >
            {valErrs.length > 0 && (
              <div className="mb-2 rounded border border-red-500/40 bg-red-500/8 p-2">
                <div className="mb-1.5 text-[10.5px] font-semibold text-red-300">
                  ⚠ 工作流验证错误（{valErrs.length}）
                </div>
                <ValidationErrorList errors={valErrs.slice(0, 12)} className="text-red-200/95" />
                {valErrs.length > 12 && (
                  <div className="mt-1 text-[10px] text-red-300/70">+{valErrs.length - 12} more…</div>
                )}
              </div>
            )}

            {!valErrs.length && error && (
              <div className="mb-2 space-y-1 rounded border border-red-500/30 bg-red-500/6 p-2 text-[10.5px] text-red-200/90">
                <div className="break-words whitespace-pre-wrap">{error}</div>
              </div>
            )}

            {visible.length === 0 ? (
              <div className="py-6 text-center text-[10.5px] text-(--color-ink-muted)">
                {taskId
                  ? "等待日志…（运行生成后此处显示每节点执行步骤）"
                  : "运行生成后此处会显示执行步骤日志 · 顶部手柄可拖动调整高度"}
              </div>
            ) : (
              <ul className="space-y-px">
                {visible.map((log, index) => {
                  const ch = levelChip(log.level);
                  const isClient = log.client === true;
                  return (
                    <li
                      key={`${log.t}:${index}`}
                      data-testid="log-line"
                      data-level={log.level}
                      className="group/line flex items-baseline gap-1.5 rounded px-1 py-px transition-colors hover:bg-white/4"
                    >
                      <span
                        aria-hidden
                        className="shrink-0 select-none text-[9.5px] tabular-nums text-gray-500"
                      >
                        {fmtTime(log.t)}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-bold leading-none ${ch.bg} ${ch.text}`}
                        aria-label={`级别 ${ch.label}`}
                      >
                        <span aria-hidden>{ch.icon}</span>
                        {ch.label}
                      </span>
                      <span
                        className={`min-w-0 flex-1 break-words ${
                          isClient ? "italic text-gray-400" : "text-gray-200"
                        }`}
                      >
                        {log.msg}
                      </span>
                      {debugMode && log.src && (
                        <span className="shrink-0 rounded bg-white/5 px-1 text-[9px] font-normal text-gray-500">
                          {log.src}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
});
