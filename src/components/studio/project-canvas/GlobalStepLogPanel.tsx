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
import { useCanvasSettings } from "../canvas/hooks/use-canvas-settings";
import { EmptyState } from "~/components/ui/empty-state";
import { SelectChip } from "~/components/ui/select-chip";
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

const FILTER_LABELS: Array<{ label: string; value: Level | "all" }> = [
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
    if (activeTaskId && !viewTaskId) {
      setViewTaskId(activeTaskId);
    }
  }, [activeTaskId, viewTaskId]);

  /* 监听该任务的执行日志流：SSE 建连 / 帧解析 / 关流 / 播种 / 空闲卡住检测
   * 全收在 `hooks/use-task-step-log-stream`，视图零 IO（规范 17 / 硬规则 10）。 */
  const { logs, validationErrors, status, progress, error, connected, setError, clear } =
    useTaskStepLogStream(taskId);

  /* 从面板内部取消当前查看的任务。
   * 「取消中…」态与失败文案都在 useCancelTask 里（视图零 IO）。 */
  const { cancelling: cancellingFromPanel, cancel: cancelFromPanel } = useCancelTask({
    taskId,
    onFailed: setError,
  });
  const onCancelFromPanel = () => {
    // 无任务时按钮本就禁用（下方 disabled），这里只是防重复点击的兜底。
    if (!taskId) {
      return;
    }
    return cancelFromPanel();
  };

  /* 自动滚到底部：贴底与「用户有没有接管滚动」的判据收在
   *`ui/use-scroll-follow`（规范 16 §16.2.4.24）—— 收口前这里是手写的
   *`scrollTop = scrollHeight`，且**用户上滚不会退出跟随**（会被按回底部，
   * 读不到上面的步骤）。checkbox 保留为「跟随」的显式开关。 */
  const cachedIds = useMemo(
    () => listCachedTaskIds(),
    /* 依赖是**重算触发器**，不是 `listCachedTaskIds()` 真实读的输入 ——
     * 它读的是 `stepLogCache` 的模块级 Map，静态推不出来「什么时候该重算」。
     * 三条各自对应一次缓存写入：`taskId` 换了（新任务进了缓存）、`logs` 追加了
     * （缓存内容推进）、`validationErrors` 更新了（同批落进来的新条目）。
     * 属规范 §13.4 的「规则静态盲区」；去掉任一条件会让面板停在旧清单上
     * （表现是任务选择器少一条，且不会自愈）。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, validationErrors, taskId],
  );

  /* 把每个已缓存的 taskId 映射回画布节点短序号 (#1, #2…)。
   * 映射来源：运行开始时 setActiveTaskId(taskId, nodeId) 写进 activeTask，
   * 随后通过 patchStepLogMeta 持久化到 stepLogCache。 */
  /* 弹窗已打开时不受 debugMode 开关影响（关闭开关不应让正在查看的日志
   * 瞬间消失）；关闭弹窗后入口按钮与弹窗一起隐藏。 */
  if (!debugMode && !open) {
    return null;
  }

  /* 弹窗里的行数是一处界面预算，不是「倒数 300 条」这段算式各写一遍 ——
   * 尾部窗口收在`~/lib/page-window`（规范 16 §16.2.4.67）。 */
  const visibleAll = tailWindow(logs, LOG_MODAL_MAX_ROWS);
  const visible = filter === "all" ? visibleAll : visibleAll.filter((log) => log.level === filter);
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

  const onClear = () => {
    clear();
  };

  return (
    <>
      {/* 浮动触发按钮 —— 仅调试模式开启时渲染。 */}
      <Hint label="打开执行日志">
        <Button
          className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-canvas-max text-2xs pointer-events-auto fixed top-16 right-3 h-auto items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-medium shadow-lg backdrop-blur-sm"
          data-testid="step-log-trigger"
          onClick={() => {
            setOpen(true);
          }}
          variant="outline"
        >
          <FileText data-icon="inline-start" size={12} />
          执行日志
          {errorCount > 0 && (
            <span className="bg-destructive/20 text-destructive text-3xs rounded-full px-1">
              {errorCount}
            </span>
          )}
        </Button>
      </Hint>

      {/* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写「点到自己才算关闭」的判定，Esc 没接、焦点不锁也不归还。 */}
      <Dialog
        onOpenChange={(next) => {
          setOpen(next);
        }}
        open={open}
      >
        <DialogContent
          aria-label="执行步骤日志"
          className="bg-transparent p-0 ring-0"
          popupClassName={panel.widthClass}
          showCloseButton={false}
        >
          <div
            className={`border-border-strong bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/25 dark:shadow-black/60 ${panel.widthClass}`}
          >
            {/* Header */}
            <div className="border-border-strong bg-surface-1 flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="text-primary-strong shrink-0" size={16} />
                <span className="text-ink-bright truncate text-[15px] font-semibold">执行日志</span>
                <StatusBadge
                  className="text-3xs px-1.5 py-px"
                  dot={false}
                  label={statusLabel}
                  status={status ?? "IDLE"}
                />
                <span
                  className={`inline-block size-1.5 shrink-0 rounded-full ${
                    connected
                      ? "bg-success shadow-[0_0_6px_color-mix(in_srgb,var(--color-glow-success)_70%,transparent)]"
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
                      className="border-destructive/30 bg-destructive/8 text-destructive/90 hover:bg-destructive/15 text-2xs h-auto rounded-md border px-2 py-0.5"
                      data-testid="log-panel-cancel"
                      disabled={cancellingFromPanel}
                      onClick={onCancelFromPanel}
                      variant="outline"
                    >
                      {cancellingFromPanel ? "× 取消中…" : "× 取消"}
                    </Button>
                  </Hint>
                ) : null}
                {cachedIds.length > 0 && (
                  <StepLogTaskPicker
                    cachedIds={cachedIds}
                    onSelect={setViewTaskId}
                    taskId={taskId}
                  />
                )}
                <Button
                  className="border-border-strong bg-subtle text-ink-soft hover:bg-surface-2 hover:text-ink-bright text-2xs h-auto rounded-md border px-2 py-0.5"
                  onClick={onClear}
                  variant="outline"
                >
                  清空
                </Button>
                <WidePanelToggle
                  className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                  panel={panel}
                />
                <Hint accessibleName label="关闭">
                  <Button
                    className="text-ink-muted hover:bg-subtle hover:text-ink-soft h-auto rounded-md p-1.5"
                    onClick={() => {
                      setOpen(false);
                    }}
                    variant="ghost"
                  >
                    <X data-icon="inline-start" size={16} />
                  </Button>
                </Hint>
              </div>
            </div>

            {/* 级别筛选栏 —— 一排里选一个，走 `ui/select-chip`
                （规范 16 §16.2.4.75）。此前是手搓的 `variant="ghost"` + 选中
                三元，选中档没钉悬停值：`ghost` 自带的
                `hover:bg-muted hover:text-foreground` 会把「已选中」在悬停期间
                改写成「未选中」的样子（与全局日志面板的级别筛选同源）。 */}
            <div className="border-border-strong bg-surface-1 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5">
              <div aria-label="日志级别筛选" className="flex items-center gap-1" role="radiogroup">
                {FILTER_LABELS.map((option) => {
                  const count =
                    option.value === "all"
                      ? visibleAll.length
                      : visibleAll.filter((l) => l.level === option.value).length;
                  return (
                    <SelectChip
                      className="px-2.5 py-1 text-sm"
                      data-testid={`log-filter-${option.value}`}
                      key={option.value}
                      onClick={() => {
                        setFilter(option.value);
                      }}
                      selected={filter === option.value}
                      shape="compact"
                    >
                      {option.label}
                      <span className="text-ink-fainter text-2xs ml-1">{count}</span>
                    </SelectChip>
                  );
                })}
              </div>
              <FieldLabel className="text-ink-soft flex cursor-pointer items-center gap-1.5 text-xs select-none">
                <Checkbox
                  checked={autoscroll}
                  className="accent-primary size-3.5 cursor-pointer"
                  onCheckedChange={(checked) => {
                    setAutoscroll(checked === true);
                  }}
                />
                自动滚动
              </FieldLabel>
            </div>

            {/* Log body — 虚拟滚动（复用 VirtualLogList，与应用日志同款行样式） */}
            <VirtualLogList
              className="bg-canvas-deep/60"
              emptySlot={
                <EmptyState
                  icon={FileText}
                  title={taskId ? "等待日志…" : "运行生成后此处会显示执行步骤日志"}
                  variant="panel"
                />
              }
              entries={visible}
              following={autoscroll}
              getMessage={(log) => log.msg}
              onFollowingChange={setAutoscroll}
              renderRow={(log) => <StepLogRow log={log} />}
              topSlot={
                <>
                  {valErrs.length > 0 && (
                    <div className="border-destructive/40 bg-destructive/8 mb-2 rounded border p-2">
                      <div className="text-destructive mb-1.5 text-sm font-semibold">
                        ⚠ 工作流验证错误（{valErrs.length}）
                      </div>
                      <ValidationErrorList
                        className="text-destructive/95"
                        errors={valErrs.slice(0, 12)}
                      />
                      {valErrs.length > 12 && (
                        <div className="text-destructive/80 mt-1 text-xs">
                          +{valErrs.length - 12} more…
                        </div>
                      )}
                    </div>
                  )}

                  {!valErrs.length && error && (
                    <div className="border-destructive/30 bg-destructive/6 text-destructive/90 mb-2 flex flex-col gap-1 rounded border p-2 text-sm">
                      <div className="wrap-break-word whitespace-pre-wrap">{error}</div>
                    </div>
                  )}
                </>
              }
              watch={`${logs.length}:${filter}`}
            />

            {/* Footer */}
            <div className="border-border-strong bg-surface-1 text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-xs">
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
