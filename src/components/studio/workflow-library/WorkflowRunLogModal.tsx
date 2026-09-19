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

import { formatClock } from "~/lib/time-format";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FileText, X, Maximize2, Minimize2 } from "lucide-react";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
} from "~/lib/workflow/workflow-run-store";
import {
  runLogSourceLabel,
  type WorkflowRunMeta,
} from "~/lib/workflow/workflow-run-store";
import { useCancelTask } from "../project-canvas/hooks/use-cancel-task";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { modalWidth } from "~/components/ui/dialog-width";

/* 与项目画布 GlobalStepLogPanel 同款 level badge 配色。 */
type Level = TaskLogEntry["level"];
const LEVEL_STYLES: Record<Level, string> = {
  error: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  success:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  progress:
    "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
  info: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
};
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
  return formatClock(t, { millis: true });
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

/* 弹窗宽度档：默认 5xl（行是「时刻 + 级别 + 正文」，与执行日志同密度）；
 * 加宽档统一贴视线两边。写 `w-*` 而不是 `max-w-*` 的理由见
 * `~/components/ui/dialog-width` 的文件头（ISSUE #720）。 */
const RUN_LOG_WIDTH = modalWidth("w-5xl");

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

  /* 面板**打开那一刻**裁决默认选中：优先「运行中」的会话（本次运行日志），
   * 没有运行中的落到最近一次。打开之后不再自动切换 —— 用户手动翻旧记录不能
   * 被弹回。此前的判据是「选中仍属于本工作流就不动」：viewTaskId 粘滞指向
   * 上次看过的已完成运行时，哪怕有运行中的会话也永远不会切过去。 */
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    const active = runs.find((r) => r.status === "running" || !r.status);
    const target = active ?? runs[0];
    if (target && target.taskId !== viewTaskId) {
      onViewTaskIdChange(target.taskId);
    }
  }, [open, runs, viewTaskId, onViewTaskIdChange]);

  const run: WorkflowRunMeta | null = useMemo(
    () =>
      viewTaskId ? (runs.find((r) => r.taskId === viewTaskId) ?? null) : null,
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
  const visible =
    filter === "all"
      ? visibleAll
      : visibleAll.filter((l) => l.level === filter);
  const status = run?.status ?? "running";
  /* 文案在这里，配色走 `ui/status-badge` 的同一份状态 → 语义 token 映射
   *（规范 16 §16.2.4.5）。 */
  const statusLabel =
    status === "done" ? "完成" : status === "failed" ? "失败" : `运行中`;

  const onCancel = () => {
    void cancel();
  };

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给 `ui/dialog`：此前自绘遮罩 +
     手写「点到自己才算关闭」的判定，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-testid="wflib-log-modal"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={wide ? RUN_LOG_WIDTH.wide : RUN_LOG_WIDTH.base}
      >
        <div
          className={`border-border bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60 ${wide ? RUN_LOG_WIDTH.wide : RUN_LOG_WIDTH.base}`}
        >
          {/* Header */}
          <div className="border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileText
                size={16}
                className="shrink-0 text-violet-700 dark:text-violet-400"
              />
              <span className="text-ink truncate text-[15px] font-semibold">
                执行日志
              </span>
              {run && (
                <span
                  className="text-ink-muted max-w-[220px] truncate text-[11px]"
                  title={run.workflowName}
                >
                  {run.workflowName}
                </span>
              )}
              {run && (
                <span className="bg-subtle text-ink-faint rounded-full px-1.5 py-px text-[10px] font-medium">
                  {runLogSourceLabel(run.source)}
                </span>
              )}
              {run && (
                <StatusBadge
                  status={status}
                  label={statusLabel}
                  dot={false}
                  className="px-1.5 py-px text-[10px]"
                />
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {viewTaskId && status === "running" && (
                <Button
                  variant="danger"
                  onClick={onCancel}
                  disabled={cancelling}
                  title="取消当前查看的任务"
                  data-testid="wflib-log-cancel"
                  className="h-auto rounded-md px-2 py-0.5 text-[10.5px]"
                >
                  {cancelling ? "× 取消中…" : "× 取消"}
                </Button>
              )}
              {runs.length > 1 && (
                <select
                  value={viewTaskId ?? ""}
                  onChange={(event) =>
                    onViewTaskIdChange(event.target.value || null)
                  }
                  className="border-border bg-panel text-ink-strong max-w-[200px] truncate rounded-md border px-1.5 py-0.5 text-[10.5px] outline-none"
                  title="切换查看的任务"
                >
                  {runs.map((r) => (
                    <option key={r.taskId} value={r.taskId}>
                      {r.workflowName} ·{" "}
                      {r.status === "done"
                        ? "完成"
                        : r.status === "failed"
                          ? "失败"
                          : "运行中"}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setWide((w) => !w)}
                title={wide ? "收缩" : "加宽"}
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                title="关闭"
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              >
                <X size={16} />
              </Button>
            </div>
          </div>

          {/* 级别筛选栏 */}
          <div className="border-border bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5">
            <div className="flex items-center gap-1">
              {FILTER_LABELS.map((option) => {
                const count =
                  option.value === "all"
                    ? visibleAll.length
                    : visibleAll.filter((l) => l.level === option.value).length;
                return (
                  <Button
                    key={option.value}
                    variant="ghost"
                    onClick={() => setFilter(option.value)}
                    title={`${option.label}（${count} 条）`}
                    className={`h-auto rounded-md px-2.5 py-1 text-[13px] ${
                      filter === option.value
                        ? "bg-surface-2 text-ink"
                        : "text-ink-muted hover:bg-subtle hover:text-ink-strong"
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
            <label className="text-ink-faint flex cursor-pointer items-center gap-1.5 text-[12px] select-none">
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
            className="custom-scrollbar bg-panel-deep/60 flex-1 overflow-y-auto"
          >
            {run?.errorMessage && (
              <div className="mb-2 space-y-1 rounded border border-red-500/30 bg-red-500/6 p-2 text-[13px] text-red-700 dark:text-red-300/90">
                <div className="break-words whitespace-pre-wrap">
                  {run.errorMessage}
                </div>
              </div>
            )}

            {visible.length === 0 ? (
              <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
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
                    className="border-border-subtle hover:bg-card flex items-start gap-2.5 border-b px-4 py-1 font-mono text-[13px] leading-snug"
                  >
                    <span className="text-ink-muted shrink-0">
                      {fmtTime(log.t)}
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
                    >
                      {levelLabel(log.level)}
                    </span>
                    <span className="text-ink-strong min-w-0 flex-1 break-words whitespace-pre-wrap">
                      {log.msg}
                    </span>
                    {log.src && (
                      <span className="text-ink-fainter hover:text-ink-faint max-w-[200px] shrink-0 truncate text-[11px]">
                        {log.src}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span>
              显示 {visible.length} / 总计 {visibleAll.length} 条
            </span>
            <span>保留最近 300 条</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* useSyncExternalStore 的局部包装：让本文件保持单一 import 来源。 */
function useSyncExternalStoreShim() {
  return useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
}
