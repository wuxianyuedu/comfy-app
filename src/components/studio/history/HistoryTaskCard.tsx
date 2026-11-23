import { memo, useState } from "react";
import { ChevronDown, Copy, FileText, FolderOpen, FolderPlus, Maximize2 } from "lucide-react";

import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { ValidationErrorList } from "~/components/ui/validation-error-list";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { OVERLAY_MAX_HEIGHT } from "~/components/ui/overlay-max-height";
import { ProgressBar } from "~/components/ui/progress-bar";
import { TruncatedText } from "~/components/ui/truncated-text";
import { isVideo } from "~/lib/media/media";
import { clampPct } from "~/lib/progress";
import { cn } from "~/lib/utils";

import type { TaskItem } from "./history-types";
import { modelLabelOf, modeLabelOf } from "./history-list-derive";
import { QUEUED_STATUS_STYLE, STATUS_STYLE, timeAgo } from "./history-utils";

type HistoryTaskCardProps = {
  /** 这一条的动作（输出目录 / 复制去重投）正在进行吗——按钮禁用态，判据在 controller。 */
  busy: boolean;
  /** 「把这条的产物加入资产库」（ISSUE #4868）：打开归属 / 分类选择弹窗。 */
  onAddToLibrary: (task: TaskItem) => void;
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

/** 失败卡的错误警示条（ISSUE #4665 / 用户反馈 #4710）：折叠态**只留单行**
 *  （truncate），「展开」开关与错误**同一行**放在行尾；点「展开」看完整错误 +
 *  修复建议 + 结构化校验清单。完整文案始终在 DOM 里（读屏可读、可选中复制）。 */
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
    <div className="bg-destructive/10 flex items-center gap-2 px-4 py-2" role="alert">
      <span aria-hidden className="bg-destructive size-1.5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <p
          className={`text-destructive text-xs leading-relaxed break-words ${
            expanded ? "" : "truncate"
          }`}
        >
          <span className="font-semibold">错误：</span>
          {message}
        </p>
        {/* 展开态才出现的附加信息：建议 + 结构化校验清单。 */}
        {expanded && suggestion !== null && (
          <p className="text-warning-strong/90 text-2xs mt-1 leading-relaxed">{suggestion}</p>
        )}
        {expanded && validationErrors && validationErrors.length > 0 && (
          <div className="border-destructive/20 mt-1.5 rounded border px-2 py-1.5">
            <div className="text-destructive text-3xs mb-1 font-semibold">
              节点配置校验（{validationErrors.length} 项）
            </div>
            <ValidationErrorList className="text-destructive/90" errors={validationErrors} />
          </div>
        )}
      </div>
      {/* 展开 / 收起用图标表达（用户反馈 #4710）： chevron 旋转 180° 即状态，
          只动 transform（规范 §2.7）；可达名走 aria-label，状态走 aria-expanded。 */}
      <Button
        aria-expanded={expanded}
        aria-label={expanded ? "收起错误详情" : "展开错误详情"}
        className="text-destructive/80 hover:bg-destructive/10 hover:text-destructive h-auto shrink-0 rounded-md px-1 py-0.5"
        onClick={() => {
          setExpanded((prev) => !prev);
        }}
        size="xs"
        variant="ghost"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-180")}
          data-icon="inline-start"
        />
      </Button>
    </div>
  );
}

/** 历史记录列表中的单条任务卡片（缩略图 + 状态 + 模型/模式 + 提示词 + 错误 + 操作区）。
 *
 *  布局按 ISSUE #4619 重排：主行显示「模式 + 模型名 + 时间」
 *  （不再显示工作流名——模型标签才是用户认任务的锚点）；底部一排是
 *  队列页同款的「日志 / 输出目录 / 复制去重投」靠左，取消 / 重试 / 删除
 *  靠右下角（用户反馈 #4710），视觉上「看」与「做」两层分开。
 *  视觉按 ISSUE #4630 轻量化：状态改「左缘短条」表达、失败错误内嵌为卡底警示条。
 *
 *  提示词块（用户反馈 #4710）：背景框 + 定高（h-24）+ 块内纵向滚动（长提示词
 *  不撑开卡片）；字号降到 xs；右上角一枚展开按钮，点开大弹窗看全文。
 *  状态只由左缘色条表达（角标圆点撤掉），读屏文本保留在卡内。
 *
 *  `memo` 是这一页渲染预算的一半（ISSUE #4559）：进度定时器每拍只动 RUNNING 卡的
 *  `progress` 一个数字，其余卡的 props（task / 回调 / 布尔）引用与值都稳定 ——
 *  不 memo 时「加载更多」累积的几十上百张静止卡每 1.5s 陪跑一次整树 diff。 */
export const HistoryTaskCard = memo(function HistoryTaskCard({
  task,
  progress,
  retrying,
  busy,
  onAddToLibrary,
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
  const [promptOpen, setPromptOpen] = useState(false);
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
          整卡通高的粗边条让每张卡都像「被标了一刀」，缩短后只做状态提示。
          状态的读屏文本挂在卡内（角标圆点已按用户反馈撤掉）。 */}
      <div aria-hidden className={`absolute top-3 left-0 h-5 w-1 rounded-r-full ${st.toneCls}`} />
      <span className="sr-only">{st.label}</span>

      <div className="flex flex-col gap-2 py-3 pr-3 pl-4">
        {/* ── 首行：模式 + 模型 + 时间 ── 固定一排不换行（用户反馈 #4710）。 */}
        <div className="flex items-center gap-2 whitespace-nowrap">
          {st.showProgress && (
            <span className="text-primary-strong text-3xs shrink-0 tabular-nums">
              {clampPct(progress)}%
            </span>
          )}
          <span className="bg-subtle text-ink-muted text-2xs shrink-0 rounded-full px-2 py-0.5">
            {modeLabelOf(task.type)}
          </span>
          <TruncatedText className="text-ink-strong min-w-0 truncate text-xs font-medium">
            {modelLabelOf(task)}
          </TruncatedText>
          <span className="text-ink-fainter ml-auto shrink-0 text-xs tabular-nums">
            {timeAgo(task.createdAt)}
          </span>
        </div>

        {/* ── 缩略图 + 提示词：同排等高（都 h-24），上下缘对齐（用户反馈 #4710）。 */}
        <div className="flex items-stretch gap-3">
          {/* 缩略图（头像）：失败项加红色描边；点开走图片查看器（看大图），
              详情入口与它分开放在底部动作区（用户反馈：点图不该弹任务详情）。 */}
          <div
            className={`bg-panel-deep relative size-24 shrink-0 overflow-hidden rounded-xl ${
              failed ? "ring-destructive/50 ring-1" : ""
            }`}
          >
            {task.cover !== null && task.cover !== "" ? (
              isVideo(task.cover) ? (
                /* 视频仍按视频渲染：图片查看器只服务静态图。 */
                <MediaThumbnail
                  alt=""
                  autoPlay
                  className="h-full w-full object-cover"
                  loop
                  src={task.cover}
                />
              ) : (
                <ViewableImage
                  alt="任务产物"
                  className="h-full w-full object-cover"
                  label="任务产物"
                  src={task.cover}
                />
              )
            ) : (
              <span className="text-ink-fainter flex size-full items-center justify-center text-xs">
                {failed ? "失败" : "无图"}
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
          </div>
          {/* 提示词背景框：定高 + 块内滚动，长提示词不再撑开卡片；右上角展开
              按钮点开大弹窗看全文（用户反馈 #4710）。 */}
          <div className="bg-canvas border-border-subtle relative h-24 min-w-0 flex-1 rounded-lg border">
            <p className="custom-scrollbar text-ink-strong h-full overflow-y-auto px-3 py-2 pr-8 text-xs leading-relaxed break-words whitespace-pre-wrap">
              {task.prompt || "（无提示词）"}
            </p>
            <Button
              aria-label="展开查看完整提示词"
              className="border-border bg-surface text-ink-faint hover:text-ink-strong absolute top-1 right-1 h-auto rounded-md p-1"
              onClick={() => {
                setPromptOpen(true);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <Maximize2 aria-hidden data-icon="inline-start" size={12} />
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
          `mt-auto` 把它钉在卡底：网格里同行两卡（成功 / 失败）等高时，
          动作区仍在同一条底线上（用户反馈 #4710 的「对不齐」）。
          间距拉开一档、悬停时图标随文字转主题色（ISSUE #4630 微交互）；
          lucide 图标走 currentColor，悬停变色只需作用在按钮字色上。 */}
      <div className="border-border-subtle mt-auto flex flex-wrap items-center gap-2 border-t px-4 py-1.5">
        <Button
          aria-label="查看这一条的任务详情"
          className="text-ink-faint hover:text-primary-strong h-auto gap-1"
          onClick={() => {
            onOpenDetail(task.id);
          }}
          size="xs"
          variant="ghost"
        >
          <Maximize2 aria-hidden className="size-3" data-icon="inline-start" />
          详情
        </Button>
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
            {/* 加入资产库（ISSUE #4868）：与「复制去重投」同排 —— 都是「把这条
                的结果沉淀出去」的动作；弹窗里选归属 / 分类，参数随行快照。 */}
            <Button
              aria-label="把这一条的产物加入资产库"
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
              disabled={busy}
              onClick={() => {
                onAddToLibrary(task);
              }}
              size="xs"
              variant="ghost"
            >
              <FolderPlus aria-hidden className="size-3" data-icon="inline-start" />
              加入资产库
            </Button>
          </>
        ) : null}
        {/* 取消 / 重试 / 删除挪到**右下角**（用户反馈 #4710）；重试对成功与失败
            都给 —— 成功卡的「重试」语义是「再跑一次」。 */}
        <div className="ml-auto flex items-center gap-1.5">
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
          {(failed || task.status === "SUCCEEDED") && (
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

      {/* ── 提示词全文弹窗（用户反馈 #4710）：提示词很多时，卡片里只滚动预览，
          点右上角展开按钮在这里看全文。 */}
      <Dialog onOpenChange={setPromptOpen} open={promptOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>任务提示词</DialogTitle>
            <DialogDescription>
              {modeLabelOf(task.type)} · {modelLabelOf(task)}
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              "custom-scrollbar text-ink-strong overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap",
              OVERLAY_MAX_HEIGHT,
            )}
          >
            {task.prompt || "（无提示词）"}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
