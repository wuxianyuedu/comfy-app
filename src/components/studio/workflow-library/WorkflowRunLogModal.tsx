"use client";

/**
 * WorkflowRunLogModal —— 工作流库「就地运行」的全屏执行日志弹窗。
 *
 * 与项目画布 GlobalStepLogPanel 同款交互（居中大弹窗 + 级别筛选 + 自动滚动 +
 * 加宽/收窄 + 取消），替代此前挂在节点下方的小日志条。日志与运行态由
 * workflow-run-store 托管：关闭窗口（组件卸载）再打开，仍能看到生成中
 * 状态与全部日志（SSE 重连由服务端回放补齐历史）。
 *
 * view 层只渲染；数据（runs/logs）经 useSyncExternalStore 从 store 读取，
 * 任务订阅逻辑在 use-workflow-run-task.ts（§17 UI/逻辑分离）。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileText, X, Maximize2, Minimize2 } from "lucide-react";
import type { TaskLogEntry } from "@/lib/workshop/generation-client";
import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
} from "@/lib/workflow-run-store";
import type { WorkflowRunMeta } from "@/lib/workflow-run-store";
import { useCancelTask } from "../project-canvas/hooks/use-cancel-task";

/* 与项目画布 GlobalStepLogPanel 同款 level badge 配色。 */
type Level = TaskLogEntry["level"];
const LEVEL_STYLES: Record<Level, string> = {
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  progress: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
};
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

const FILTER_LABELS: { label: string; value: Level | "all" }[] = [
  { label: "全部", value: "all" },
  { label: "错误", value: "error" },
  { label: "警告", value: "warn" },
  { label: "完成", value: "success" },
  { label: "进度", value: "progress" },
  { label: "信息", value: "info" },
];

export interface WorkflowRunLogModalProps {
  /** 所属工作流：日志只展示当前工作流的运行（切换工作流独立显示）。 */
  workflowId: string;
  /** 当前要查看的运行（受控：节点卡片点击时上抛）。 */
  viewTaskId: string | null;
  onViewTaskIdChange: (taskId: string | null) => void;
  open: boolean;
  onClose: () => void;
}

export function WorkflowRunLogModal({
  workflowId,
  viewTaskId,
  onViewTaskIdChange,
  open,
  onClose,
}: WorkflowRunLogModalProps) {
  const snapshot = useSyncExternalStoreShim();
  /* 只取当前工作流自己的运行（新→旧），避免把别的工作流的日志串进来。 */
  const runs = useMemo(
    () => snapshot.runs.filter((r) => r.workflowId === workflowId),
    [snapshot.runs, workflowId],
  );

  /* 未显式选择 / 指向了别的工作流的运行 → 落到当前工作流最近一次。 */
  useEffect(() => {
    const current = viewTaskId
      ? runs.some((r) => r.taskId === viewTaskId)
      : false;
    const latest = runs[0];
    if (!current && latest) {
      onViewTaskIdChange(latest.taskId);
    }
  }, [viewTaskId, runs, onViewTaskIdChange]);

  const run: WorkflowRunMeta | null = useMemo(
    () => (viewTaskId ? runs.find((r) => r.taskId === viewTaskId) ?? null : null),
    [viewTaskId, runs],
  );
  const logs = run?.logs ?? [];

  const [filter, setFilter] = useState<Level | "all">("all");
  const [wide, setWide] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /* 弹窗取消按钮复用画布同款 hook（视图零 IO）。 */
  const { cancelling, cancel } = useCancelTask({
    taskId: viewTaskId,
    onFailed: () => undefined,
  });

  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length, filter, autoscroll, open]);

  if (!open) return null;

  const visibleAll = logs.slice(-300);
  const visible = filter === "all" ? visibleAll : visibleAll.filter((l) => l.level === filter);
  const status = run?.status ?? "running";
  const statusLabel =
    status === "done" ? "完成" : status === "failed" ? "失败" : `运行中`;
  const statusClass =
    status === "failed" ? "bg-red-500/20 text-red-600"
    : status === "done" ? "bg-emerald-500/20 text-emerald-600"
    : "bg-violet-500/20 text-violet-600";

  const onCancel = () => {
    void cancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="wflib-log-modal"
    >
      <div className={`flex h-[85vh] w-full ${wide ? "max-w-[96vw]" : "max-w-5xl"} flex-col overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-panel) shadow-2xl shadow-black/60`}>
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-card) px-4">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={16} className="shrink-0 text-violet-400" />
            <span className="truncate text-[15px] font-semibold text-(--color-ink)">
              执行日志
            </span>
            {run && (
              <span className="max-w-[220px] truncate text-[11px] text-(--color-ink-muted)" title={run.workflowName}>
                {run.workflowName}
              </span>
            )}
            {run && (
              <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${statusClass}`}>
                {statusLabel}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {viewTaskId && status === "running" && (
              <button
                type="button"
                onClick={onCancel}
                disabled={cancelling}
                title="取消当前查看的任务"
                data-testid="wflib-log-cancel"
                className="rounded-md border border-red-500/30 bg-red-500/8 px-2 py-0.5 text-[10.5px] text-red-600/90 transition-colors hover:bg-red-500/15 disabled:opacity-50"
              >
                {cancelling ? "× 取消中…" : "× 取消"}
              </button>
            )}
            {runs.length > 1 && (
              <select
                value={viewTaskId ?? ""}
                onChange={(event) => onViewTaskIdChange(event.target.value || null)}
                className="max-w-[200px] truncate rounded-md border border-(--color-border) bg-(--color-panel) px-1.5 py-0.5 text-[10.5px] text-(--color-ink-strong) outline-none"
                title="切换查看的任务"
              >
                {runs.map((r) => (
                  <option key={r.taskId} value={r.taskId}>
                    {r.workflowName} · {r.status === "done" ? "完成" : r.status === "failed" ? "失败" : "运行中"}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => setWide((w) => !w)}
              title={wide ? "收缩" : "加宽"}
              className="rounded-md p-1.5 text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
            >
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              className="rounded-md p-1.5 text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Level filter bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--color-border) bg-(--color-card) px-4 py-1.5">
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
                  className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                    filter === option.value
                      ? "bg-(--color-surface-2) text-(--color-ink)"
                      : "text-(--color-ink-muted) hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
                  }`}
                >
                  {option.label}
                  <span className="ml-1 text-[11px] text-(--color-ink-fainter)">{count}</span>
                </button>
              );
            })}
          </div>
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[12px] text-(--color-ink-faint)">
            <input
              type="checkbox"
              checked={autoscroll}
              onChange={(event) => setAutoscroll(event.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
            />
            自动滚动
          </label>
        </div>

        {/* Log body */}
        <div
          ref={scrollerRef}
          className="custom-scrollbar flex-1 overflow-y-auto bg-(--color-panel-deep)/60"
        >
          {run?.errorMessage && (
            <div className="mb-2 space-y-1 rounded border border-red-500/30 bg-red-500/6 p-2 text-[13px] text-red-600/90">
              <div className="break-words whitespace-pre-wrap">{run.errorMessage}</div>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-(--color-ink-fainter)">
              <FileText size={32} strokeWidth={1.5} className="opacity-30" />
              {run ? "等待日志…" : "运行生成后此处会显示执行步骤日志"}
            </div>
          ) : (
            <div className="flex flex-col">
              {visible.map((log, index) => (
                <div
                  key={`${log.t}:${index}`}
                  data-testid="wflib-modal-log-line"
                  data-level={log.level}
                  className="flex items-start gap-2.5 border-b border-(--color-border-subtle) px-4 py-1 font-mono text-[13px] leading-snug hover:bg-(--color-card)"
                >
                  <span className="shrink-0 text-(--color-ink-muted)">{fmtTime(log.t)}</span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
                  >
                    {levelLabel(log.level)}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-(--color-ink-strong)">
                    {log.msg}
                  </span>
                  {log.src && (
                    <span className="max-w-[200px] shrink-0 truncate text-[11px] text-(--color-ink-fainter) hover:text-(--color-ink-faint)">
                      {log.src}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-(--color-border) bg-(--color-card) px-4 text-[12px] text-(--color-ink-muted)">
          <span>
            显示 {visible.length} / 总计 {visibleAll.length} 条
          </span>
          <span>保留最近 300 条</span>
        </div>
      </div>
    </div>
  );
}

/* useSyncExternalStore 的局部包装：让本文件保持单一 import 来源。 */
function useSyncExternalStoreShim() {
  return useSyncExternalStore(subscribeWorkflowRunStore, getWorkflowRunStoreSnapshot, getWorkflowRunStoreSnapshot);
}
