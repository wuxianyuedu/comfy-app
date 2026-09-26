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
import { LOG_MODAL_MAX_ROWS, tailWindow } from "~/lib/page-window";
import { Checkbox } from "~/components/ui/checkbox";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FileText, X } from "lucide-react";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
} from "~/lib/workflow/workflow-run-store";
import {
  runLogSourceLabel,
  type WorkflowRunMeta,
  type WorkflowRunSource,
} from "~/lib/workflow/workflow-run-store";
import { useCancelTask } from "../project-canvas/hooks/use-cancel-task";
import { WorkflowRunRawCliModal } from "./WorkflowRunRawCliModal";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { StatusBadge } from "~/components/ui/status-badge";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { SelectMenu } from "~/components/ui/select-menu";
import { FieldLabel } from "~/components/ui/field";
import { modalWidth } from "~/components/ui/dialog-width";
import { useWidePanel, WidePanelToggle } from "~/components/ui/wide-panel";
import { VirtualLogList } from "~/components/studio/logs/VirtualLogList";

/* 与项目画布 GlobalStepLogPanel 同款 level badge 配色，走语义 token
 * （§4.11.1 / P71）：error→destructive、warn→warning、success→success、
 * progress→primary、info→info。token 内部含深浅两态，不再写 dark:。 */
type Level = TaskLogEntry["level"];
const LEVEL_STYLES: Record<Level, string> = {
  error: "bg-destructive/15 text-destructive border-destructive/20",
  warn: "bg-warning/15 text-warning-strong border-warning/20",
  success: "bg-success/15 text-success-strong border-success/20",
  progress: "bg-primary/15 text-primary-strong border-primary/20",
  info: "bg-info/15 text-info-strong border-info/20",
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
  /** 可选：只看某个来源的运行（画布节点 / 工坊封装各自独立入口时传入）。 */
  source?: WorkflowRunSource;
  /** 当前要查看的运行（受控：节点卡片点击时上抛）。 */
  viewTaskId: string | null;
  onViewTaskIdChange: (taskId: string | null) => void;
  open: boolean;
  onClose: () => void;
}

/* 弹窗宽度档：默认 5xl（行是「时刻 + 级别 + 正文」，与执行日志同密度）；
 * 加宽档统一贴视线两边。写`w-*` 而不是`max-w-*` 的理由见
 *`~/components/ui/dialog-width` 的文件头（ISSUE #720）。 */
const RUN_LOG_WIDTH = modalWidth("w-5xl");

export function WorkflowRunLogModal({
  workflowId,
  source,
  viewTaskId,
  onViewTaskIdChange,
  open,
  onClose,
}: WorkflowRunLogModalProps) {
  const snapshot = useSyncExternalStoreShim();
  /* 「查看完整输出」弹窗：拉取 comfy-cli 未经截断的完整原文（JSON 折叠高亮）。 */
  const [rawOpen, setRawOpen] = useState(false);
  /* 只取当前工作流自己的运行（新→旧），避免把别的工作流的日志串进来。
   * 传入 source 时进一步按来源过滤（画布节点 / 工坊封装各自只看自己的）。 */
  const runs = useMemo(
    () =>
      snapshot.runs.filter(
        (r) => r.workflowId === workflowId && (!source || r.source === source),
      ),
    [snapshot.runs, workflowId, source],
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
  /* 加宽档与它的记忆收在`~/components/ui/wide-panel`（规范 16 §16.2.4.18）。 */
  const panel = useWidePanel("wflib-run-log", RUN_LOG_WIDTH);
  const [autoscroll, setAutoscroll] = useState(true);
  /* 贴底与「用户有没有接管滚动」的判据收在`ui/use-scroll-follow`
   *（规范 16 §16.2.4.24）。收口前这里是手写的`scrollTop = scrollHeight`
   * —— 用户上滚读历史会被按回底部，且没有跟随态可显示。 */
  /* 弹窗取消按钮复用画布同款 hook（视图零 IO）。 */
  const { cancelling, cancel } = useCancelTask({
    taskId: viewTaskId,
    onFailed: () => undefined,
  });

  if (!open) return null;

  /* 弹窗里的行数是一处界面预算，不是「倒数 300 条」这段算式各写一遍 ——
   * 尾部窗口收在`~/lib/page-window`（规范 16 §16.2.4.67）。 */
  const visibleAll = tailWindow(logs, LOG_MODAL_MAX_ROWS);
  const visible =
    filter === "all"
      ? visibleAll
      : visibleAll.filter((l) => l.level === filter);
  const status = run?.status ?? "running";
  /* 文案在这里，配色走`ui/status-badge` 的同一份状态 → 语义 token 映射
   *（规范 16 §16.2.4.5）。 */
  const statusLabel =
    status === "done" ? "完成" : status === "failed" ? "失败" : `运行中`;

  const onCancel = () => {
    void cancel();
  };

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写「点到自己才算关闭」的判定，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="执行日志"
        data-testid="wflib-log-modal"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={panel.widthClass}
      >
        <div
          className={`border-border bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60 ${panel.widthClass}`}
        >
          {/* Header */}
          <div className="border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={16} className="text-primary-strong shrink-0" />
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
                <Hint label="取消当前查看的任务" wrap>
                  <Button
                    variant="danger"
                    onClick={onCancel}
                    disabled={cancelling}
                    data-testid="wflib-log-cancel"
                    className="h-auto rounded-md px-2 py-0.5 text-[10.5px]"
                  >
                    {cancelling ? "× 取消中…" : "× 取消"}
                  </Button>
                </Hint>
              )}
              {runs.length > 1 && (
                <SelectMenu
                  value={viewTaskId ?? ""}
                  onChange={(v) => onViewTaskIdChange(v || null)}
                  options={runs.map((r) => r.taskId)}
                  labels={Object.fromEntries(
                    runs.map((r) => [
                      r.taskId,
                      `${r.workflowName} · ${
                        r.status === "done"
                          ? "完成"
                          : r.status === "failed"
                            ? "失败"
                            : "运行中"
                      }`,
                    ]),
                  )}
                  aria-label="切换查看的任务"
                  className="max-w-[200px] text-[10.5px]"
                />
              )}
              <Hint
                label="查看 comfy-cli 完整输出（未经截断、可格式化 JSON）"
                wrap
              >
                <Button
                  variant="ghost"
                  onClick={() => setRawOpen(true)}
                  disabled={!viewTaskId}
                  data-testid="wflib-log-raw"
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md px-2 py-0.5 text-[10.5px]"
                >
                  查看完整输出
                </Button>
              </Hint>
              <WidePanelToggle
                panel={panel}
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              />
              <Hint label="关闭" accessibleName>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
                >
                  <X data-icon="inline-start" size={16} />
                </Button>
              </Hint>
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
                  <Hint
                    label={`${option.label}（${count} 条）`}
                    key={option.value}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => setFilter(option.value)}
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
                  </Hint>
                );
              })}
            </div>
            <FieldLabel className="text-ink-faint flex cursor-pointer items-center gap-1.5 text-[12px] select-none">
              <Checkbox
                checked={autoscroll}
                onCheckedChange={(checked) => setAutoscroll(checked === true)}
                className="accent-primary size-3.5 cursor-pointer"
              />
              自动滚动
            </FieldLabel>
          </div>

          {/* Log body — 虚拟滚动（复用 VirtualLogList） */}
          <VirtualLogList
            entries={visible}
            getMessage={(log) => log.msg}
            renderRow={(log) => (
              <div
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
            )}
            following={autoscroll}
            onFollowingChange={setAutoscroll}
            watch={`${logs.length}:${filter}`}
            className="bg-panel-deep/60"
            topSlot={
              run?.errorMessage ? (
                <div className="border-destructive/30 bg-destructive/6 text-destructive mb-2 flex-col gap-1 rounded border p-2 text-[13px]">
                  <div className="break-words whitespace-pre-wrap">
                    {run.errorMessage}
                  </div>
                </div>
              ) : null
            }
            emptySlot={
              <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                <FileText size={32} strokeWidth={1.5} className="opacity-30" />
                {run ? "等待日志…" : "运行生成后此处会显示执行步骤日志"}
              </div>
            }
          />

          {/* Footer */}
          <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
            <span>
              显示 {visible.length} / 总计 {visibleAll.length} 条
            </span>
            <span>保留最近 300 条</span>
          </div>
        </div>
      </DialogContent>
      <WorkflowRunRawCliModal
        taskId={viewTaskId}
        running={status === "running"}
        open={rawOpen}
        onClose={() => setRawOpen(false)}
      />
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
