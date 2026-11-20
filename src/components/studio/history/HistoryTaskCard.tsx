import { memo, useState } from "react";
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

/** 失败卡的错误警示条（ISSUE #4665）：折叠态把错误钳在两行内 —— 每张失败卡
 *  的折叠高度一致，不再被长错误撑开；点「展开」看完整错误 + 修复建议 +
 *  结构化校验清单，展开态超长部分在块内滚动（max-h + 纵向滚动）。
 *  完整文案始终在 DOM 里（读屏可读、可选中复制）。 */
function CardErrorBar({
  message,
  suggestion,
  validationErrors,
}: {
  message: string;
  /** 失败原因 → 可行动建议（`建议：…`），无建议时为 null。 */
  suggestion: string | null;
  validationErrors: TaskItem["validationErrors"];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-destructive/10 flex items-start gap-2 px-4 py-2" role="alert">
      <span aria-hidden className="bg-destructive mt-1.5 size-1.5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className={expanded ? "max-h-40 overflow-y-auto pr-1" : "line-clamp-2"}>
          <p className="text-destructive text-xs leading-relaxed break-words">
            <span className="font-semibold">错误：</span>
            {message}
          </p>
          {expanded && suggestion !== null && (
            <p className="text-warning-strong/90 text-2xs mt-1 leading-relaxed">{suggestion}</p>
          )}
          {/* 结构化校验错误逐字段列表（展开后可见） */}
          {expanded && validationErrors && validationErrors.length > 0 && (
            <div className="border-destructive/20 mt-1.5 rounded border px-2 py-1.5">
              <div className="text-destructive text-3xs mb-1 font-semibold">
                节点配置校验（{validationErrors.length} 项）
              </div>
              <ValidationErrorList className="text-destructive/90" errors={validationErrors} />
            </div>
          )}
        </div>
        <Button
          aria-expanded={expanded}
          className="text-destructive/80 hover:text-destructive mt-1 h-auto px-0 py-0"
          onClick={() => {
            setExpanded((prev) => !prev);
          }}
          size="xs"
          variant="ghost"
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>
    </div>
  );
}

/** 历史记录列表中的单条任务卡片（缩略图 + 状态 + 模型/模式 + 错误 + 操作区）。
 *
 *  布局按 ISSUE #4619 重排：主行显示「模式 + 模型名 + 时间」
 *  （不再显示工作流名——模型标签才是用户认任务的锚点），底部一排与
 *  队列页同款的「日志 / 输出目录 / 复制去重投」动作，与右侧的
 *  取消 / 重试 / 删除分开放，视觉上「看」与「做」两层分开。
 *  视觉按 ISSUE #4630 轻量化：状态改「左缘短条 + 头像圆点角标」表达、
 *  失败错误内嵌为卡底警示条、悬停轻微上浮。
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
  const failed = task.status === "FAILED";
  /* 错误条内嵌在卡片底部、占满卡宽（ISSUE #4630）：错误是这条任务的内部信息，
   * 不再做成悬浮在主体旁的独立色块 —— 悬浮块抢视线且把卡片纵向中线打乱。 */
  const errorMessage = failed ? (task.error ?? "") : "";
  const showError = failed && errorMessage !== "";
  return (
    <div
      className="group bg-card hover:bg-subtle border-border-subtle relative flex flex-col overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/25"
      key={task.id}
    >
      {/* 左缘状态短条：只与首行等高、颜色即状态语义（ISSUE #4630）——
          整卡通高的粗边条让每张卡都像「被标了一刀」，缩短后只做状态提示。 */}
      <div aria-hidden className={`absolute top-3 left-0 h-5 w-1 rounded-r-full ${st.toneCls}`} />

      <div className="flex items-center gap-3 py-2.5 pr-3 pl-4">
        {/* ── 缩略图（头像）── 失败项加红色描边；状态以小圆点徽标叠在右上角，
            状态名给读屏（sr-only），色即语义、不再横占一格文字徽标。 */}
        <div className="relative shrink-0">
          <Button
            aria-label="查看任务详情"
            className={`bg-panel-deep relative flex size-20 items-center justify-center overflow-hidden rounded-xl p-0 ${
              failed ? "ring-destructive/50 ring-1" : ""
            }`}
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
              <span className="text-ink-fainter text-xs">{failed ? "失败" : "无图"}</span>
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
          <span
            className={`border-card absolute -top-1 -right-1 size-3 rounded-full border-2 ${st.toneCls}`}
          >
            <span className="sr-only">{st.label}</span>
          </span>
        </div>

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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {st.showProgress && (
              <span className="text-primary-strong text-3xs tabular-nums">
                {clampPct(progress)}%
              </span>
            )}
            {/* 模式 + 模型（ISSUE #4619）：按测试模型页的封装形式认任务 ——
                模式来自任务类型码的中文标签，模型来自工作流上挂的模型标签
                （没挂标签回落工作流名）。工作流名不再单独占一行。
                胶囊改极简底色档、不再描边（ISSUE #4630）：元信息退半步，
                提示词回到视觉主位。 */}
            <span className="bg-subtle text-ink-muted text-2xs rounded-full px-2 py-0.5">
              {modeLabelOf(task.type)}
            </span>
            <TruncatedText className="text-ink-strong max-w-48 truncate text-xs font-medium">
              {modelLabelOf(task)}
            </TruncatedText>
          </div>
          {/* 提示词定高（ISSUE #4665）：宽高固定在信息列内，超出部分在块内
              纵向滚动查看，完整文案仍在 DOM 里（可选中 / 读屏可读）；
              定高同时让每张卡折叠态的固定部分高度一致。 */}
          <span className="text-ink-strong mt-1 block h-12 overflow-y-auto pr-1 text-sm leading-relaxed">
            {task.prompt || "（无提示词）"}
          </span>
        </Button>

        {/* ── 时间戳 + 状态动作（取消 / 重试 / 删除，永远可见）──
            时间戳右对齐、不再挤在元信息行里（ISSUE #4630）。 */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-ink-fainter text-xs tabular-nums">{timeAgo(task.createdAt)}</span>
          <div className="flex items-center gap-1.5">
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
            {failed && (
              <Button
                className="border-primary/40 text-primary-strong hover:bg-primary/10 h-auto rounded-lg border px-2.5 py-1"
                disabled={retrying}
                onClick={() => {
                  onRetry(task);
                }}
                size="xs"
                variant="ghost"
              >
                {retrying ? "提交中…" : "↻ 重试"}
              </Button>
            )}
            <Button
              className="text-ink-faint hover:text-danger-strong h-auto rounded-lg px-2.5 py-1"
              onClick={() => {
                onRemove(task.id);
              }}
              size="xs"
              variant="ghost"
            >
              删除
            </Button>
          </div>
        </div>
      </div>

      {/* ── 错误提示条（卡片内底部内嵌，ISSUE #4630 核心痛点）──
          半透暗红底 + 左侧小红点；「错误：」红字、「建议：」琥珀小字，
          读起来像便签而不是警报；放在底部动作区之上，仍是「这条任务的内部信息」。
          折叠态把错误钳在两行内，让失败卡的折叠高度与成功卡一致（ISSUE #4665）。 */}
      {showError && (
        <CardErrorBar
          message={errorMessage}
          suggestion={st.failureSuggestion?.(errorMessage) ?? null}
          validationErrors={task.validationErrors}
        />
      )}

      {/* ── 底部动作区（ISSUE #4619）：与队列页同款的 日志 / 输出目录 / 复制去重投。
          终态行才有产物与「重投」可言；进行中行只给日志（跟队列页同一取舍）。
          间距拉开一档、悬停时图标随文字转主题色（ISSUE #4630 微交互）；
          lucide 图标走 currentColor，悬停变色只需作用在按钮字色上。 */}
      <div className="border-border-subtle flex flex-wrap items-center gap-2 border-t px-4 py-1.5">
        <Button
          aria-label="查看这一条的执行日志"
          className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
