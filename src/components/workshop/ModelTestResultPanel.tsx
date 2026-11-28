"use client";

// ── 「测试模型能力」右栏面板（产物 / 分节点进度 / 请求与响应）────────────────
// 从 ModelTestView 拆出的纯展示面板（§17 第③层：只渲染 + 上抛，不做取数 /
// IO）。三种运行状态各有视觉形态：生成中（进度环 + 徽标）、完成（产物预览 +
// 外链）、空闲（占位说明）；失败告警在中栏，右栏保留日志与请求现场。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  ExternalLink,
  Image as ImageIcon,
  Maximize2,
  MessageSquareText,
  ScrollText,
  Video,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { FieldLabel } from "~/components/ui/field";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { displayValue } from "~/lib/display-value";
import { formatClock } from "~/lib/time-format";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { classifyModelTestError } from "./model-test-runs";
import type { useModelTest } from "./hooks/use-model-test";
import { RequestDetailSection } from "./ModelTestRequestDetail";
import { TaskProgressPanel } from "./TaskProgressPanel";

type ModelTestController = ReturnType<typeof useModelTest>;
type ResultCardController = Pick<
  ModelTestController,
  | "error"
  | "generating"
  | "openBusy"
  | "openResultInBrowser"
  | "result"
  | "responseRows"
  | "workflowProgress"
>;
type ResultPanelController = ResultCardController &
  Pick<ModelTestController, "generatingSince" | "requestRows" | "taskLogs">;

/** 卡片外壳：白底细边 + 轻投影，标题行 = 图标 + 名称 + 右侧弱化说明或操作区。 */
function Panel({
  action,
  children,
  className,
  hint,
  icon,
  title,
}: {
  /** 标题行右侧的操作区（给了就顶掉 hint 的位置）。 */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-primary-strong [&_svg]:size-3.5">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        {action === undefined ? (
          hint !== undefined &&
          hint !== "" && (
            <span className="text-2xs text-muted-foreground ml-auto font-normal">{hint}</span>
          )
        ) : (
          <div className="ml-auto flex items-center gap-2">{action}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/** 状态徽标：完成 / 生成中 / 待生成 / 失败 / 已取消。 */
function StatusChip({
  state,
  text,
}: {
  state: "cancelled" | "done" | "error" | "generating" | "idle";
  text: string;
}) {
  return (
    <span
      className={cn(
        "ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-semibold",
        state === "done" && "bg-success/10 text-success-strong",
        state === "generating" && "bg-warning/10 text-warning-strong",
        state === "cancelled" && "bg-warning/10 text-warning-strong",
        state === "error" && "bg-destructive/10 text-destructive",
        state === "idle" && "bg-subtle text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "done" && "bg-success",
          state === "generating" && "bg-warning-strong",
          state === "cancelled" && "bg-warning-strong",
          state === "error" && "bg-destructive",
          state === "idle" && "bg-muted-foreground/60",
        )}
      />
      {text}
    </span>
  );
}

/** 空态占位：虚线框 + 说明，告诉用户这里会出现什么。 */
function EmptySlot({ children }: { children: ReactNode }) {
  return (
    <div className="border-border bg-surface-1 text-muted-foreground flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 text-center text-xs">
      {children}
    </div>
  );
}

/** 本地工作流任务的执行日志（与工作流库「就地运行」同一份 SSE log 流）。
 *  自动滚动开启时，新日志到达即滚到底部 —— 任务卡住时，最后几行直接指到停在
 *  哪个节点；关掉后视图停在用户翻到的位置（#4743）。 */
function TaskLogSection({ autoscroll, logs }: { autoscroll: boolean; logs: Array<TaskLogEntry> }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /* 日志逐行的时间在行数据里派生一次：SSE 日志随任务跑持续追加，逐行格式化会
   * 在每次父渲染重复一遍（#5290）。 */
  const rows = useMemo(
    () => logs.map((entry, index) => ({ entry, index, clock: formatClock(entry.t) })),
    [logs],
  );
  useEffect(() => {
    if (!autoscroll) {
      return;
    }
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [autoscroll, logs]);
  return (
    <div
      className="border-border bg-surface-1 max-h-72 overflow-y-auto rounded-lg border"
      ref={boxRef}
    >
      {rows.map(({ entry, index, clock }) => (
        <div
          className="text-2xs flex items-start gap-2 px-3 py-1 font-mono"
          key={`${String(entry.t)}-${String(index)}`}
        >
          <span className="text-muted-foreground shrink-0 tabular-nums">{clock}</span>
          <span
            className={cn(
              "w-11 shrink-0 font-semibold",
              entry.level === "error"
                ? "text-destructive"
                : entry.level === "warn"
                  ? "text-warning-strong"
                  : entry.level === "success"
                    ? "text-success-strong"
                    : "text-primary",
            )}
          >
            {entry.level}
          </span>
          <span className="text-ink min-w-0 flex-1 break-all whitespace-pre-wrap">{entry.msg}</span>
        </div>
      ))}
    </div>
  );
}

/** 产物卡：按运行状态给预览形态（生成中进度环 / 完成预览 / 空占位）。 */
function ResultCard({ c }: { c: ResultCardController }) {
  const cancelled = c.error !== null && classifyModelTestError(c.error) === "已取消";
  const state = c.generating
    ? "generating"
    : cancelled
      ? "cancelled"
      : c.error === null
        ? c.result === null
          ? "idle"
          : "done"
        : "error";
  const latestResponse = c.responseRows.at(-1);
  const resultUrl = c.result !== null && c.result.kind !== "chat" ? c.result.url : null;
  const kindIcon =
    c.result?.kind === "video" ? (
      <Video className="text-muted-foreground/60 size-8" />
    ) : c.result?.kind === "chat" ? (
      <MessageSquareText className="text-muted-foreground/60 size-8" />
    ) : (
      <ImageIcon className="text-muted-foreground/60 size-8" />
    );
  return (
    <Panel hint="工坊同款产物提取 · 图片可缩放查看" icon={<ImageIcon />} title="产物">
      <div className="flex items-center gap-2">
        <span className="text-2xs text-muted-foreground">状态</span>
        <StatusChip
          state={state}
          text={
            state === "generating"
              ? "生成中"
              : state === "done"
                ? "生成完成"
                : state === "cancelled"
                  ? "已取消"
                  : state === "error"
                    ? "执行失败"
                    : "待生成"
          }
        />
      </div>

      {latestResponse !== undefined && (
        <dl className="text-2xs grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">端点</dt>
          <dd className="break-all">{latestResponse.endpoint}</dd>
          <dt className="text-muted-foreground">耗时</dt>
          <dd className="tabular-nums">
            {latestResponse.durationMs === undefined
              ? displayValue(latestResponse.durationMs)
              : `${String(latestResponse.durationMs)} ms`}
          </dd>
          <dt className="text-muted-foreground">HTTP</dt>
          <dd className="tabular-nums">{displayValue(latestResponse.status)}</dd>
        </dl>
      )}

      {c.result === null ? (
        c.generating ? (
          <div className="border-border bg-surface-1 flex h-44 flex-col items-center justify-center gap-3 rounded-lg border">
            <span className="relative inline-flex size-12 items-center justify-center">
              <Spinner className="text-primary size-12" />
              <span className="text-2xs text-primary-strong absolute font-semibold tabular-nums">
                {c.workflowProgress === null ? "" : `${Math.floor(c.workflowProgress.pct)}%`}
              </span>
            </span>
            <span className="text-muted-foreground text-xs">
              {c.workflowProgress?.label !== undefined && c.workflowProgress.label !== ""
                ? c.workflowProgress.label
                : "正在生成 · 产物就绪后自动展示"}
            </span>
          </div>
        ) : (
          <EmptySlot>
            {state === "error" || state === "cancelled" ? (
              <CircleAlert
                className={cn(
                  "size-8",
                  state === "error" ? "text-destructive" : "text-warning-strong",
                )}
              />
            ) : (
              kindIcon
            )}
            {state === "error" ? c.error : "生成完成后在这里展示产物，点开可进查看器缩放"}
          </EmptySlot>
        )
      ) : (
        <div className="border-border bg-surface-1 overflow-hidden rounded-lg border">
          {c.result.kind === "image" ? (
            <ViewableImage
              alt="生成结果"
              className="max-h-96 w-full object-contain"
              label="生成结果"
              src={c.result.url}
            />
          ) : c.result.kind === "video" ? (
            <MediaThumbnail
              alt="生成结果"
              as="video"
              className="max-h-96 w-full object-contain"
              controls
              src={c.result.url}
            />
          ) : (
            <pre className="text-2xs text-ink max-h-96 overflow-auto p-4 font-mono whitespace-pre-wrap">
              {c.result.text}
            </pre>
          )}
        </div>
      )}

      {c.result !== null && c.result.kind !== "chat" && (
        <div className="flex items-center gap-2">
          <Button
            className="text-primary h-auto px-0 text-xs"
            disabled={c.openBusy}
            onClick={() => {
              if (resultUrl !== null) {
                void c.openResultInBrowser(resultUrl);
              }
            }}
            size="sm"
            variant="ghost"
          >
            <ExternalLink className="size-3.5" data-icon="inline-start" />
            打开原始产物（系统浏览器）
          </Button>
        </div>
      )}
    </Panel>
  );
}

/** 日志卡：有日志才出列表，否则给占位说明。渲染在**中栏**（生成卡下方）——
 *  右栏太窄，等宽字体行频繁截断；贴着生成动作也更好读。
 *  头部操作区：「自动滚动」开关（#4743）+「大屏查看」入口（有本地任务才出现）。 */
export function LogsCard({
  logs,
  onOpenScreen,
}: {
  logs: Array<TaskLogEntry>;
  /** 打开「大屏查看日志」弹窗；不传 = 当前没有可看的任务（按钮不出现）。 */
  onOpenScreen?: () => void;
}) {
  const [autoscroll, setAutoscroll] = useState(true);
  return (
    <Panel
      action={
        <>
          <FieldLabel className="text-muted-foreground text-2xs flex cursor-pointer items-center gap-1.5 select-none">
            <Checkbox
              checked={autoscroll}
              className="accent-primary size-3.5 cursor-pointer"
              onCheckedChange={(checked) => {
                setAutoscroll(checked === true);
              }}
            />
            自动滚动
          </FieldLabel>
          {onOpenScreen !== undefined && (
            <Button
              className="text-ink-muted hover:bg-subtle hover:text-ink-strong text-2xs h-auto rounded-md px-2 py-1"
              onClick={onOpenScreen}
              size="sm"
              variant="ghost"
            >
              <Maximize2 className="size-3" data-icon="inline-start" />
              大屏查看
            </Button>
          )}
        </>
      }
      icon={<ScrollText />}
      title="执行日志"
    >
      {logs.length > 0 ? (
        <TaskLogSection autoscroll={autoscroll} logs={logs} />
      ) : (
        <EmptySlot>暂无日志 · 生成开始后实时滚动，卡住时看最后几行定位节点</EmptySlot>
      )}
    </Panel>
  );
}

/** 右栏整体：产物 / 分节点进度（#4811，原在中栏）/ 请求与响应（执行日志在中栏）。 */
export function ModelTestResultPanel({
  c,
  excerptPretty,
  onExcerptPretty,
}: {
  c: ResultPanelController;
  excerptPretty: boolean;
  onExcerptPretty: (pretty: boolean) => void;
}) {
  const hasDetails = c.requestRows.length > 0 || c.responseRows.length > 0;
  return (
    /* max-h 与中/左栏同口径（ISSUE #4983/#4991）：右栏也封顶在显示区域高度，
     * 超出在栏内滚动——三栏都不把页面撑出滚动条。 */
    <div className="flex h-fit w-full shrink-0 flex-col gap-4 xl:max-h-[calc(100dvh-96px)] xl:w-80 xl:overflow-y-auto">
      <ResultCard c={c} />
      {/* 分节点进度可视化（#4811：从中栏挪到右栏「请求」原来的位置）：解析执行日志
          里的 comfy-cli progress/executing 事件按节点出条（#4743）；无进度事件
          （对话 / API 中继）不渲染。 */}
      <TaskProgressPanel logs={c.taskLogs} />
      {hasDetails ? (
        <>
          {c.requestRows.length > 0 && (
            <Panel hint="本地提交 + 实际请求" icon={<ScrollText />} title="请求">
              <RequestDetailSection
                excerptPretty={excerptPretty}
                generating={c.generating}
                generatingSince={c.generatingSince}
                onExcerptPretty={onExcerptPretty}
                rows={c.requestRows}
                sent={c.generating || c.responseRows.length > 0}
                variant="request"
              />
            </Panel>
          )}
          {c.responseRows.length > 0 && (
            <Panel hint="真实调用回来了什么" icon={<CircleAlert />} title="响应">
              <RequestDetailSection
                excerptPretty={excerptPretty}
                generating={c.generating}
                generatingSince={c.generatingSince}
                onExcerptPretty={onExcerptPretty}
                rows={c.responseRows}
                variant="response"
              />
            </Panel>
          )}
        </>
      ) : (
        !c.generating && (
          <Panel hint="生成后保留 · 可切原始单行" icon={<ScrollText />} title="请求 / 响应">
            <EmptySlot>生成后这里保留请求与响应读数，可切换格式化 / 原始单行</EmptySlot>
          </Panel>
        )
      )}
    </div>
  );
}
