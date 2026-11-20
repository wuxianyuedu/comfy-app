import { memo } from "react";
import { Copy, FileText, FolderOpen } from "lucide-react";

import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { TruncatedText } from "~/components/ui/truncated-text";
import { clampPct } from "~/lib/progress";

import type { TaskItem } from "./history-types";
import { modelLabelOf, modeLabelOf } from "./history-list-derive";
import { QUEUED_STATUS_STYLE, STATUS_STYLE, timeAgo } from "./history-utils";

type HistoryTaskCardProps = {
  /** 这一条的动作（输出目录 / 复制去重投）正在进行吗——按钮禁用态，判据在 controller。 */
  busy: boolean;
  onCancel: (id: string) => void;
  /** 「复制去重投」：把本次提交内容复制到剪贴板，回画布改完再投。 */
  onCopyForReprint: (task: TaskItem) => void;
  onOpenDetail: (id: string) => void;
  /** 打开这一条的产物目录（comfyapp:// 深链）。 */
  onOpenFolder: (task: TaskItem) => void;
  /** 打开这一条的执行日志弹窗（与队列页同一份）。 */
  onOpenLog: (task: TaskItem) => void;
  onRemove: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  /** 进行中任务的模拟进度（0-100）。 */
  progress: number;
  /** 重试请求是否进行中（按钮禁用态）。 */
  retrying: boolean;
  task: TaskItem;
};

/** 历史记录列表中的单条任务卡片（缩略图 + 状态 + 模型/模式 + 错误 + 操作区）。
 *
 *  布局按 ISSUE #4619 重排：主行显示「状态 + 模式 + 模型名 + 时间」
 *  （不再显示工作流名——模型标签才是用户认任务的锚点），底部补一排与
 *  队列页同款的「日志 / 输出目录 / 复制去重投」动作，与右上的
 *  取消 / 重试 / 删除分开放，视觉上「看」与「做」两层分开。
 *
 *  `memo` 是这一页渲染预算的一半（ISSUE #4559）：进度定时器每拍只动 RUNNING 卡的
 *  `progress` 一个数字，其余卡的 props（task / 回调 / 布尔）引用与值都稳定 ——
 *  不 memo 时「加载更多」累积的几十上百张静止卡每 1.5s 陪跑一次整树 diff。 */
export const HistoryTaskCard = memo(function HistoryTaskCard({
  task,
  progress,
  retrying,
  busy,
  onOpenDetail,
  onCancel,
  onRetry,
  onRemove,
  onOpenLog,
  onOpenFolder,
  onCopyForReprint,
}: HistoryTaskCardProps) {
  const st = STATUS_STYLE[task.status] ?? QUEUED_STATUS_STYLE;
  const terminal =
    task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELLED";
  return (
    <div
      className={`group bg-card hover:bg-subtle relative overflow-hidden rounded-2xl border transition-all ${
        st.accentCls
      } ${st.cardBorderCls}`}
      key={task.id}
    >
      {/* 左缘 accent 额外强调：状态色高亮条（border-l-4 已在父级，再叠一层） */}
      <div
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-1 ${
          task.status === "SUCCEEDED"
            ? "bg-success"
            : task.status === "RUNNING"
              ? "bg-primary"
              : task.status === "FAILED"
                ? "bg-destructive"
                : task.status === "QUEUED"
                  ? "bg-info"
                  : "bg-gray-500"
        }`}
      />

      <div className="flex items-center gap-4 py-3 pr-3 pl-5">
        {/* ── 缩略图 ── */}
        <Button
          aria-label="查看任务详情"
          className="bg-panel-deep relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl p-0"
          onClick={() => {
            onOpenDetail(task.id);
          }}
          variant="ghost"
        >
          {task.cover !== null && task.cover !== "" ? (
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
        {/* 整块可点 → 原生按钮，不是「加了 onClick 的 div」：非原生元素键盘用户进不来
            （鼠标点得开、Tab 到不了、Enter 没反应）。原生 button 的键语义由浏览器给；再挂 simpleKeyHandler
            等于复刻默认行为。text-left 与 p→span.block 因 button 不能嵌块级元素、默认排版居中。 */}
        <Button
          className="h-auto min-w-0 flex-1 cursor-pointer justify-start rounded-xl p-0 text-left font-normal whitespace-normal hover:bg-transparent"
          onClick={() => {
            onOpenDetail(task.id);
          }}
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
            {/* 模式 + 模型（ISSUE #4619）：按测试模型页的封装形式认任务 ——
                模式来自任务类型码的中文标签，模型来自工作流上挂的模型标签
                （没挂标签回落工作流名）。工作流名不再单独占一行。 */}
            <span className="border-border-subtle text-ink-muted text-2xs rounded-full border px-2 py-0.5">
              {modeLabelOf(task.type)}
            </span>
            <TruncatedText className="text-ink-strong max-w-48 truncate text-xs font-medium">
              {modelLabelOf(task)}
            </TruncatedText>
            <span className="text-ink-fainter shrink-0 text-xs">· {timeAgo(task.createdAt)}</span>
          </div>
          <span className="text-ink-strong mt-1 line-clamp-1 block text-sm">
            {task.prompt || "（无提示词）"}
          </span>
          {task.status === "FAILED" &&
            task.error !== undefined &&
            task.error !== null &&
            task.error !== "" && (
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

        {/* ── 状态动作（取消 / 重试 / 删除，永远可见） ── */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {st.isActive && (
              <Button
                className="h-auto rounded-lg px-2.5 py-1"
                onClick={() => {
                  onCancel(task.id);
                }}
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
                onClick={() => {
                  onRetry(task);
                }}
                size="xs"
                variant="primary"
              >
                {retrying ? "提交中…" : "↻ 重试"}
              </Button>
            )}
            <Button
              className="h-auto rounded-lg px-2.5 py-1"
              onClick={() => {
                onRemove(task.id);
              }}
              size="xs"
              variant="danger"
            >
              删除
            </Button>
          </div>
        </div>
      </div>

      {/* ── 底部动作区（ISSUE #4619）：与队列页同款的 日志 / 输出目录 / 复制去重投。
          终态行才有产物与「重投」可言；进行中行只给日志（跟队列页同一取舍）。 */}
      <div className="border-border-subtle flex flex-wrap items-center gap-1 border-t px-5 py-2">
        <Button
          aria-label="查看这一条的执行日志"
          className="h-auto gap-1"
          onClick={() => {
            onOpenLog(task);
          }}
          size="xs"
          variant="ghost"
        >
          <FileText aria-hidden className="size-3" data-icon="inline-start" />
          日志
        </Button>
        {terminal ? (
          <>
            <Button
              aria-label="打开这一条的输出目录"
              className="h-auto gap-1"
              disabled={busy}
              onClick={() => {
                onOpenFolder(task);
              }}
              size="xs"
              variant="ghost"
            >
              <FolderOpen aria-hidden className="size-3" data-icon="inline-start" />
              输出目录
            </Button>
            <Button
              aria-label="复制这一条的提交内容，回画布改完再投一次"
              className="h-auto gap-1"
              disabled={busy}
              onClick={() => {
                onCopyForReprint(task);
              }}
              size="xs"
              variant="ghost"
            >
              <Copy aria-hidden className="size-3" data-icon="inline-start" />
              复制去重投
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});
