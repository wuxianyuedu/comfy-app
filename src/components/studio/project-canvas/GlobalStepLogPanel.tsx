"use client";

/**
 * GlobalStepLogPanel —— 全局执行步骤日志面板
 *
 * 设计决策（Why 弹窗而非底部抽屉）：
 * 1. 底部抽屉会压缩画布可用空间；
 * 2. 与右下 MiniMap、底部状态栏容易重叠。
 * 故采用「应用日志」同款的居中弹窗。
 *
 * 交互约定：
 * - 「调试模式」开关仅控制入口按钮显隐；
 * - 弹窗打开后不受该开关影响，避免操作中突然消失。
 */

import { LOG_MODAL_MAX_ROWS, tailWindow } from "~/lib/page-window";
import { Checkbox } from "~/components/ui/checkbox";

import React, { useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { StepLogRow } from "./StepLogRow";
import { StepLogTaskPicker } from "./StepLogTaskPicker";
import type { StepLogEntry } from "./stepLogCache";
import { listCachedTaskIds } from "./stepLogCache";
import { useActiveTaskId } from "./activeTask";
import { useCanvasSettings } from "../canvas/WorkflowCanvasSettings";
import { Hint } from "~/components/ui/hint";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { FieldLabel } from "~/components/ui/field";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { useCancelTask } from "./hooks/use-cancel-task";
import { useTaskStepLogStream } from "./hooks/use-task-step-log-stream";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { modalWidth } from "~/components/ui/dialog-width";
import { useWidePanel, WidePanelToggle } from "~/components/ui/wide-panel";
import { VirtualLogList } from "~/components/studio/logs/VirtualLogList";
import { displayValue } from "~/lib/display-value";

type Level = StepLogEntry["level"];

const FILTER_LABELS: { label: string; value: Level | "all" }[] = [
  { label: "全部", value: "all" },
  { label: "错误", value: "error" },
  { label: "警告", value: "warn" },
  { label: "完成", value: "success" },
  { label: "进度", value: "progress" },
  { label: "信息", value: "info" },
];

/* 执行日志弹窗的宽度档：默认 5xl —— 行是「时刻 + 级别 + 正文」三列，比应用日志
 * 少一列；加宽档统一贴视线两边。写`w-*` 而不是`max-w-*` 的理由见
 *`~/components/ui/dialog-width` 的文件头（ISSUE #720）。 */
const EXEC_LOG_WIDTH = modalWidth("w-5xl");

export const GlobalStepLogPanel = React.memo(function GlobalStepLogPanel() {
  const { settings } = useCanvasSettings();
  const debugMode = settings.debugMode;
  const activeTaskId = useActiveTaskId();

  /* 弹窗打开状态 —— 开关只露出触发按钮；
   * 点它才打开弹窗。新任务开始不再自动弹窗，避免打断画布
   * 操作；日志仍由本面板托管，用户随时可点「执行日志」进入查看。 */
  const [open, setOpen] = useState(false);

  const [viewTaskId, setViewTaskId] = useState<string | null>(null);
  /* 过滤改为单选（与应用日志同款交互），默认「全部」。 */
  const [filter, setFilter] = useState<Level | "all">("all");
  /* 加宽档与它的记忆收在`~/components/ui/wide-panel`（规范 16 §16.2.4.18）：
   * 默认档见`EXEC_LOG_WIDTH`，加宽档贴视线两边 —— 与`LogPanel` 此前是
   * 两份同形实现，且都没有持久化。 */
  const panel = useWidePanel("exec-log", EXEC_LOG_WIDTH);
  const [autoscroll, setAutoscroll] = useState(true);

  /* 没有显式钉住时，视图重置到活跃任务。 */
  const taskId = viewTaskId ?? activeTaskId;
  useEffect(() => {
    if (activeTaskId && !viewTaskId) setViewTaskId(activeTaskId);
  }, [activeTaskId, viewTaskId]);

  /* 监听该任务的执行日志流：SSE 建连 / 帧解析 / 关流 / 播种 / 空闲卡住检测
   * 全收在 `hooks/use-task-step-log-stream`，视图零 IO（规范 17 / 硬规则 10）。 */
  const {
    logs,
    validationErrors,
    status,
    progress,
    error,
    connected,
    setError,
    clear,
  } = useTaskStepLogStream(taskId);

  /* 从面板内部取消当前查看的任务。
   * 「取消中…」态与失败文案都在 useCancelTask 里（视图零 IO）。 */
  const { cancelling: cancellingFromPanel, cancel: cancelFromPanel } =
    useCancelTask({ taskId, onFailed: setError });
  const onCancelFromPanel = () => {
    // 无任务时按钮本就禁用（下方 disabled），这里只是防重复点击的兜底。
    if (!taskId) return;
    return cancelFromPanel();
  };

  /* 自动滚到底部：贴底与「用户有没有接管滚动」的判据收在
   *`ui/use-scroll-follow`（规范 16 §16.2.4.24）—— 收口前这里是手写的
   *`scrollTop = scrollHeight`，且**用户上滚不会退出跟随**（会被按回底部，
   * 读不到上面的步骤）。checkbox 保留为「跟随」的显式开关。 */
  const cachedIds = useMemo(
    () => listCachedTaskIds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, validationErrors, taskId],
  );

  /* 把每个已缓存的 taskId 映射回画布节点短序号 (#1, #2…)。
   * 映射来源：运行开始时 setActiveTaskId(taskId, nodeId) 写进 activeTask，
   * 随后通过 patchStepLogMeta 持久化到 stepLogCache。 */
  /* 弹窗已打开时不受 debugMode 开关影响（关闭开关不应让正在查看的日志
   * 瞬间消失）；关闭弹窗后入口按钮与弹窗一起隐藏。 */
  if (!debugMode && !open) return null;

  /* 弹窗里的行数是一处界面预算，不是「倒数 300 条」这段算式各写一遍 ——
   * 尾部窗口收在`~/lib/page-window`（规范 16 §16.2.4.67）。 */
  const visibleAll = tailWindow(logs, LOG_MODAL_MAX_ROWS);
  const visible =
    filter === "all"
      ? visibleAll
      : visibleAll.filter((log) => log.level === filter);
  const valErrs = validationErrors ?? [];
  /* 文案在这里（运行中带实时百分比，是业务信息），配色走`ui/status-badge`
   * 的同一份状态 → 语义 token 映射（规范 16 §16.2.4.5）。 */
  const statusLabel =
    status === "SUCCEEDED"
      ? "完成"
      : status === "FAILED"
        ? "失败"
        : status === "CANCELLED"
          ? "已取消"
          : status === "RUNNING"
            ? `运行中 ${progress}%`
            : displayValue(status);

  const errorCount = visibleAll.filter((l) => l.level === "error").length;

  const onClear = () => clear();

  return (
    <>
      {/* 浮动触发按钮 —— 仅调试模式开启时渲染。 */}
      <Hint label="打开执行日志">
        <Button
          variant="outline"
          onClick={() => setOpen(true)}
          data-testid="step-log-trigger"
          className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-canvas-max pointer-events-auto fixed top-16 right-3 h-auto items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-sm"
        >
          <FileText data-icon="inline-start" size={12} />
          执行日志
          {errorCount > 0 && (
            <span className="bg-destructive/20 text-destructive rounded-full px-1 text-[10px]">
              {errorCount}
            </span>
          )}
        </Button>
      </Hint>

      {/* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写「点到自己才算关闭」的判定，Esc 没接、焦点不锁也不归还。 */}
      <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
        <DialogContent
          aria-label="执行步骤日志"
          showCloseButton={false}
          className="bg-transparent p-0 ring-0"
          popupClassName={panel.widthClass}
        >
          <div
            className={`border-border-strong bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/60 ${panel.widthClass}`}
          >
            {/* Header */}
            <div className="border-border-strong bg-surface-1 flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={16} className="text-primary-strong shrink-0" />
                <span className="text-ink-bright truncate text-[15px] font-semibold">
                  执行日志
                </span>
                <StatusBadge
                  status={status ?? "IDLE"}
                  label={statusLabel}
                  dot={false}
                  className="px-1.5 py-px text-[10px]"
                />
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    connected
                      ? "bg-success shadow-[0_0_6px_rgba(52,211,153,0.7)]"
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
                  <Hint label="取消当前查看的任务" wrap>
                    <Button
                      variant="outline"
                      onClick={onCancelFromPanel}
                      disabled={cancellingFromPanel}
                      data-testid="log-panel-cancel"
                      className="border-destructive/30 bg-destructive/8 text-destructive/90 hover:bg-destructive/15 h-auto rounded-md border px-2 py-0.5 text-[10.5px]"
                    >
                      {cancellingFromPanel ? "× 取消中…" : "× 取消"}
                    </Button>
                  </Hint>
                ) : null}
                {cachedIds.length > 0 && (
                  <StepLogTaskPicker
                    cachedIds={cachedIds}
                    taskId={taskId}
                    onSelect={setViewTaskId}
                  />
                )}
                <Button
                  variant="outline"
                  onClick={onClear}
                  className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright h-auto rounded-md border px-2 py-0.5 text-[10.5px]"
                >
                  清空
                </Button>
                <WidePanelToggle
                  panel={panel}
                  className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                />
                <Hint label="关闭" accessibleName>
                  <Button
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                  >
                    <X data-icon="inline-start" size={16} />
                  </Button>
                </Hint>
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
                    <Hint
                      label={`${option.label}（${count} 条）`}
                      key={option.value}
                    >
                      <Button
                        variant="ghost"
                        onClick={() => setFilter(option.value)}
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
                    </Hint>
                  );
                })}
              </div>
              <FieldLabel className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-[12px] select-none">
                <Checkbox
                  checked={autoscroll}
                  onCheckedChange={(checked) => setAutoscroll(checked === true)}
                  className="accent-primary size-3.5 cursor-pointer"
                />
                自动滚动
              </FieldLabel>
            </div>

            {/* Log body — 虚拟滚动（复用 VirtualLogList，与应用日志同款行样式） */}
            <VirtualLogList
              entries={visible}
              getMessage={(log) => log.msg}
              renderRow={(log) => <StepLogRow log={log} />}
              following={autoscroll}
              onFollowingChange={setAutoscroll}
              watch={`${logs.length}:${filter}`}
              className="bg-canvas-deep/60"
              topSlot={
                <>
                  {valErrs.length > 0 && (
                    <div className="border-destructive/40 bg-destructive/8 mb-2 rounded border p-2">
                      <div className="text-destructive mb-1.5 text-[13px] font-semibold">
                        ⚠ 工作流验证错误（{valErrs.length}）
                      </div>
                      <ValidationErrorList
                        errors={valErrs.slice(0, 12)}
                        className="text-destructive/95"
                      />
                      {valErrs.length > 12 && (
                        <div className="text-destructive/80 mt-1 text-[12px]">
                          +{valErrs.length - 12} more…
                        </div>
                      )}
                    </div>
                  )}

                  {!valErrs.length && error && (
                    <div className="border-destructive/30 bg-destructive/6 text-destructive/90 mb-2 flex flex-col gap-1 rounded border p-2 text-[13px]">
                      <div className="break-words whitespace-pre-wrap">
                        {error}
                      </div>
                    </div>
                  )}
                </>
              }
              emptySlot={
                <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
                  <FileText
                    size={32}
                    strokeWidth={1.5}
                    className="opacity-30"
                  />
                  {taskId ? "等待日志…" : "运行生成后此处会显示执行步骤日志"}
                </div>
              }
            />

            {/* Footer */}
            <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
              <span>
                显示 {visible.length} / 总计 {visibleAll.length} 条
              </span>
              <span>保留最近 300 条</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});
