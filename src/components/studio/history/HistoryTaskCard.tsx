import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { clampPct } from "~/lib/progress";

import type { TaskItem } from "./history-types";
import { STATUS_STYLE, timeAgo } from "./history-utils";

interface HistoryTaskCardProps {
  task: TaskItem;
  /** 进行中任务的模拟进度（0-100）。 */
  progress: number;
  /** 重试请求是否进行中（按钮禁用态）。 */
  retrying: boolean;
  onOpenDetail: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  onRemove: (id: string) => void;
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
  const st = (STATUS_STYLE[task.status] ?? STATUS_STYLE.QUEUED)!;
  return (
    <div
      key={task.id}
      className={
        "group bg-card hover:bg-subtle relative overflow-hidden rounded-2xl border border-l-4 py-3 pr-3 pl-5 transition-all " +
        st.accentCls +
        " " +
        st.cardBorderCls
      }
    >
      {/* 左缘 accent 额外强调（border-l-4 已在父级，再叠一层高亮条） */}
      <div
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
        aria-hidden
      />

      <div className="flex items-center gap-4">
        {/* ── 缩略图 ── */}
        <Button
          variant="ghost"
          onClick={() => onOpenDetail(task.id)}
          className="bg-panel-deep relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl p-0"
          aria-label="查看任务详情"
        >
          {task.cover ? (
            <MediaThumbnail
              src={task.cover}
              alt=""
              className="h-full w-full object-cover"
              autoPlay
              loop
            />
          ) : (
            <span className="text-ink-fainter text-xs">
              {task.status === "FAILED" ? "失败" : "无图"}
            </span>
          )}
          {/* 进行中：底部进度条（卡片下缘的一条装饰条：无轨道底色、方角，
              宽度下限与文字百分比分列两处，观感与收口前一致）。 */}
          {st.showProgress && (
            // p71-allow:start brand 渐变 · violet→fuchsia 是项目品牌视觉、非状态色，不 token 化（§3.6.1 装饰渐变例外）
            <ProgressBar
              value={progress}
              showValue={false}
              className="absolute inset-x-0 bottom-0"
              trackClassName="bg-canvas-deep h-1 rounded-none"
              fillClassName="rounded-none bg-linear-to-r from-violet-500 to-fuchsia-500 duration-1000 ease-linear"
            />
            // p71-allow:end
          )}
          {/* 排队中：虚线边框 + 计时图标 */}
          {task.status === "QUEUED" && (
            <div className="border-info/40 pointer-events-none absolute inset-0 rounded-xl border border-dashed" />
          )}
        </Button>

        {/* ── 主体信息 ── */}
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => onOpenDetail(task.id)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.pillCls}`}
            >
              {st.label}
            </span>
            {st.showProgress && (
              <span className="text-primary-strong text-[10px] tabular-nums">
                {clampPct(progress)}%
              </span>
            )}
            <span className="text-ink-muted truncate text-xs">
              {task.workflowName}
            </span>
            <span className="text-ink-fainter shrink-0 text-xs">
              · {timeAgo(task.createdAt)}
            </span>
          </div>
          <p className="text-ink-strong mt-1 line-clamp-1 text-sm">
            {task.prompt || "（无提示词）"}
          </p>
          {task.status === "FAILED" && task.error && (
            <div className="border-destructive/20 bg-destructive/6 mt-2 rounded-md border px-2.5 py-1.5">
              <p className="text-destructive text-[11px] leading-relaxed">
                <span className="font-semibold">错误：</span>
                {task.error}
              </p>
              {st.failureSuggestion && (
                <p className="text-warning-strong/90 mt-1 text-[11px] leading-relaxed">
                  {st.failureSuggestion(task.error)}
                </p>
              )}
              {/* 结构化校验错误逐字段列表 */}
              {task.validationErrors && task.validationErrors.length > 0 && (
                <div className="bg-canvas-deep border-destructive/20 mt-1.5 rounded border px-2 py-1.5">
                  <div className="text-destructive mb-1 text-[10px] font-semibold">
                    节点配置校验（{task.validationErrors.length} 项）
                  </div>
                  <ValidationErrorList
                    errors={task.validationErrors}
                    className="text-destructive/90"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 操作按钮（永远可见） ── */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {st.isActive && (
              <Button
                variant="warning"
                size="xs"
                onClick={() => onCancel(task.id)}
                className="h-auto rounded-lg px-2.5 py-1"
              >
                取消
              </Button>
            )}
            {task.status === "FAILED" && (
              <Button
                variant="primary"
                size="xs"
                onClick={() => onRetry(task)}
                disabled={retrying}
                className="h-auto rounded-lg px-2.5 py-1"
              >
                {retrying ? "提交中…" : "↻ 重试"}
              </Button>
            )}
            <Button
              variant="danger"
              size="xs"
              onClick={() => onRemove(task.id)}
              className="h-auto rounded-lg px-2.5 py-1"
            >
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
