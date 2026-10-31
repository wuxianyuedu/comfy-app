import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { clampPct } from "~/lib/progress";

import type { TaskItem } from "./history-types";
import { QUEUED_STATUS_STYLE, STATUS_STYLE, timeAgo } from "./history-utils";

interface HistoryTaskCardProps {
  onCancel: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  /** 进行中任务的模拟进度（0-100）。 */
  progress: number;
  /** 重试请求是否进行中（按钮禁用态）。 */
  retrying: boolean;
  task: TaskItem;
}

/** 历史记录列表中的单条任务卡片（缩略图 + 状态 + 错误 + 操作按钮）。 */
export function HistoryTaskCard({
  task,
  progress,
  retrying,
  onOpenDetail,
  onCancel,
  onRetry,
  onRemove,
}: HistoryTaskCardProps) {
  const st = STATUS_STYLE[task.status] ?? QUEUED_STATUS_STYLE;
  return (
    <div
      className={
        "group bg-card hover:bg-subtle relative overflow-hidden rounded-2xl border border-l-4 py-3 pr-3 pl-5 transition-all " +
        st.accentCls +
        " " +
        st.cardBorderCls
      }
      key={task.id}
    >
      {/* 左缘 accent 额外强调（border-l-4 已在父级，再叠一层高亮条） */}
      <div
        aria-hidden
        className={
          "absolute top-0 bottom-0 left-0 w-1 " +
          (task.status === "SUCCEEDED"
            ? "bg-success"
            : task.status === "RUNNING"
              ? "bg-primary"
              : task.status === "FAILED"
                ? "bg-destructive"
                : task.status === "QUEUED"
                  ? "bg-info"
                  : "bg-gray-500")
        }
      />

      <div className="flex items-center gap-4">
        {/* ── 缩略图 ── */}
        <Button
          aria-label="查看任务详情"
          className="bg-panel-deep relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl p-0"
          onClick={() => onOpenDetail(task.id)}
          variant="ghost"
        >
          {task.cover ? (
            <MediaThumbnail
              alt=""
              autoPlay
              className="h-full w-full object-cover"
              loop
              src={task.cover}
            />
          ) : (
            <span className="text-ink-fainter text-xs">
              {task.status === "FAILED" ? "失败" : "无图"}
            </span>
          )}
          {/* 进行中：底部进度条（卡片下缘的一条装饰条：无轨道底色、方角，
              宽度下限与文字百分比分列两处，观感与收口前一致）。 */}
          {st.showProgress && (
            <ProgressBar
              className="absolute inset-x-0 bottom-0"
              fillClassName="u-gradient-brand rounded-none duration-1000 ease-linear"
              showValue={false}
              trackClassName="bg-canvas-deep h-1 rounded-none"
              value={progress}
            />
          )}
          {/* 排队中：虚线边框 + 计时图标 */}
          {task.status === "QUEUED" && (
            <div className="border-info/40 pointer-events-none absolute inset-0 rounded-xl border border-dashed" />
          )}
        </Button>

        {/* ── 主体信息 ── */}
        {/* 整块可点 → **原生按钮**，不是「加了 onClick 的 div」：非原生元素挂
         * `onClick` 时键盘用户根本进不来（鼠标点得开、Tab 到不了、Enter 没反应）。
         * 原生 `<button>` 的键语义由浏览器给，等于这条判据唯一的正解 —— 再挂一个
         * `simpleKeyHandler` 反而是复刻浏览器默认行为（§16.2.4.57 的账要消除的
         * 那种写法）。`text-left` 与 `p` → `span.block` 是因为 `<button>` 里不能嵌
         * 块级元素，而它的默认排版是居中。 */}
        <Button
          className="h-auto min-w-0 flex-1 cursor-pointer justify-start rounded-xl p-0 text-left font-normal whitespace-normal hover:bg-transparent"
          onClick={() => onOpenDetail(task.id)}
          variant="ghost"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-2xs rounded-full px-2 py-0.5 font-medium ${st.pillCls}`}>
              {st.label}
            </span>
            {st.showProgress && (
              <span className="text-primary-strong text-3xs tabular-nums">
                {clampPct(progress)}%
              </span>
            )}
            <span className="text-ink-muted truncate text-xs">{task.workflowName}</span>
            <span className="text-ink-fainter shrink-0 text-xs">· {timeAgo(task.createdAt)}</span>
          </div>
          <span className="text-ink-strong mt-1 line-clamp-1 block text-sm">
            {task.prompt || "（无提示词）"}
          </span>
          {task.status === "FAILED" && task.error && (
            <div className="border-destructive/20 bg-destructive/6 mt-2 rounded-md border px-2.5 py-1.5">
              <p className="text-destructive text-2xs leading-relaxed">
                <span className="font-semibold">错误：</span>
                {task.error}
              </p>
              {st.failureSuggestion && (
                <p className="text-warning-strong/90 text-2xs mt-1 leading-relaxed">
                  {st.failureSuggestion(task.error)}
                </p>
              )}
              {/* 结构化校验错误逐字段列表 */}
              {task.validationErrors && task.validationErrors.length > 0 && (
                <div className="bg-canvas-deep border-destructive/20 mt-1.5 rounded border px-2 py-1.5">
                  <div className="text-destructive text-3xs mb-1 font-semibold">
                    节点配置校验（{task.validationErrors.length} 项）
                  </div>
                  <ValidationErrorList
                    className="text-destructive/90"
                    errors={task.validationErrors}
                  />
                </div>
              )}
            </div>
          )}
        </Button>

        {/* ── 操作按钮（永远可见） ── */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {st.isActive && (
              <Button
                className="h-auto rounded-lg px-2.5 py-1"
                onClick={() => onCancel(task.id)}
                size="xs"
                variant="warning"
              >
                取消
              </Button>
            )}
            {task.status === "FAILED" && (
              <Button
                className="h-auto rounded-lg px-2.5 py-1"
                disabled={retrying}
                onClick={() => onRetry(task)}
                size="xs"
                variant="primary"
              >
                {retrying ? "提交中…" : "↻ 重试"}
              </Button>
            )}
            <Button
              className="h-auto rounded-lg px-2.5 py-1"
              onClick={() => onRemove(task.id)}
              size="xs"
              variant="danger"
            >
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
